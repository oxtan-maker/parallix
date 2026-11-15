// Manual observation only: node --import tsx test/fixtures/board-loading-manual.mjs CLI LABEL [SNAPSHOT]
// Reports cold and warm browser latency, activity-change latency for CLIENTS
// open pages (default 3), HTTP requests per API path, and the web process tree's
// CPU, steady and peak RSS. PX_FIXTURE_STRACE=1 wraps the host in strace to count
// subprocess execs and PX_FIXTURE_SQL=1 sets PARALLIX_DEBUG_SQL to count the host
// tree's SQL statements per kind; both slow the run, so compare latencies only across
// runs without them.
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright-core';
import { seedBoardLoading } from './board-loading-state.ts';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.ts';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.ts';

const [cli, label, snapshot] = process.argv.slice(2);
const clients = Number(process.env.CLIENTS ?? 3);
const trace = process.env.PX_FIXTURE_STRACE === '1';
const countSql = process.env.PX_FIXTURE_SQL === '1';
const sqlStatements = { query: 0, exec: 0 };
const TICK_MS = 1000 / Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));

/** CPU, resident and peak resident size of one live process, or null once it has exited. */
function processUsage(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const kb = name => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    return { pid, command: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').slice(1, 3).join(' '),
      cpuMs: (Number(fields[11]) + Number(fields[12])) * TICK_MS, reapedChildCpuMs: (Number(fields[13]) + Number(fields[14])) * TICK_MS,
      rssKb: kb('VmRSS'), peakKb: kb('VmHWM') };
  } catch { return null; }
}
const hostUsage = () => [child.pid, ...descendants].map(processUsage).filter(Boolean);
const sumOf = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
assert.ok(cli && label, 'provide the packaged CLI path and comparison label');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-loading-manual-'));
const descendants = new Set();
let browser;
let child;
let scan;
let output = '';
let origin = '';
try {
  if (snapshot) { fs.cpSync(snapshot, root, { recursive: true }); }
  else { await seedBoardLoading(root); }
  browser = await chromium.launch({ args: ['--disable-extensions'], executablePath: '/usr/bin/chromium', headless: true });
  const environment = { ...process.env, PATH: '/usr/bin:/bin', PARALLIX_HOME: path.join(root, 'home'),
    PARALLIX_TEST_NO_FORGEJO: '1', NO_COLOR: '1', ...(countSql ? { PARALLIX_DEBUG_SQL: '1' } : {}) };
  for (const key of Object.keys(environment)) {
    if (/^PARALLIX_(WORKFLOW|MISSION)/.test(key) || /^NODE_/.test(key)) { delete environment[key]; }
  }
  const start = performance.now();
  const traceFile = path.join(root, 'execve.trace');
  const command = trace ? ['strace', '-f', '-qq', '-e', 'trace=execve', '-o', traceFile, process.execPath] : [process.execPath];
  child = spawn(command[0], [...command.slice(1), path.resolve(cli), 'web'], {
    cwd: path.join(root, 'repository'),
    env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  scan = setInterval(() => {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n');
    for (let depth = 0; depth < 4; depth++) {
      for (const row of rows) {
        const [pid, parent] = row.trim().split(/\s+/).map(Number);
        if (parent === child.pid || descendants.has(parent)) { descendants.add(pid); }
      }
    }
  }, 1000);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timeout: ${output}`)), 15_000);
    const read = chunk => {
      if (countSql) {
        // Count statement lines instead of retaining them, so the output stays readable.
        for (const [, kind] of String(chunk).matchAll(/^\[sql-(query|exec)\]/gm)) { sqlStatements[kind] += 1; }
        chunk = String(chunk).replace(/^\[sql-(?:query|exec)\].*\n/gm, '');
      }
      output += chunk;
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { origin = match[1]; clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const responses = [];
  const requests = {};
  const observe = pageOf => pageOf.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) { requests[url.pathname] = (requests[url.pathname] ?? 0) + 1; }
    if (url.pathname === '/api/board') { responses.push(response.status()); }
  });
  observe(page);
  // Resolve from the browser's first painted expected card, without the
  // automation locator's polling/backoff becoming part of render latency.
  const paintProbe = () => {
    window.boardLoadingPaint = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const card = document.querySelector('[data-board-card="task-9001"]');
        if (!card?.textContent?.includes('Board loading fixture 1')) { return; }
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now())));
      });
      observer.observe(document, { childList: true, subtree: true, characterData: true });
    });
  };
  await page.addInitScript(paintProbe);
  const epochStart = Date.now();
  // Include spawn-to-navigation time in the cold result.
  const beforeNavigationMs = performance.now() - start;
  await page.goto(origin);
  const firstPaint = await page.evaluate(() => window.boardLoadingPaint);
  const coldMs = firstPaint - epochStart + beforeNavigationMs;
  // Warm reload to render: 3 unrecorded warmups, then 20 samples with a p95.
  const warmMs = [];
  for (let index = 0; index < 23; index++) {
    const at = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const sample = await page.evaluate(() => window.boardLoadingPaint) - at;
    if (index >= 3) { warmMs.push(sample); }
  }
  const warmP95Ms = [...warmMs].sort((left, right) => left - right)[Math.ceil(warmMs.length * 0.95) - 1];
  const steady = hostUsage();
  // Further clients share the host's one subscription; they join before the change.
  const pages = [page];
  for (let index = 1; index < clients; index++) {
    const extra = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    observe(extra);
    await extra.addInitScript(paintProbe);
    await extra.goto(origin);
    await extra.evaluate(() => window.boardLoadingPaint);
    pages.push(extra);
  }
  const database = new SqliteDatabaseAdapter();
  const changedTitle = 'Board loading fixture changed';
  await database.open({ path: path.join(root, 'home', 'parallix.db') });
  try {
    const store = new SqliteMissionStore(database);
    const loaded = await store.load('task-9001');
    assert.equal(loaded.kind, 'found');
    await store.save({ ...loaded.mission, title: changedTitle }, loaded.version);
  } finally { await database.close(); }
  const changedAt = performance.now();
  const clientsChangedMs = await Promise.all(pages.map(async open => {
    await open.getByText(changedTitle, { exact: true }).waitFor({ timeout: 7_000 });
    return performance.now() - changedAt;
  }));
  const changedMs = clientsChangedMs[0];
  const peak = hostUsage();
  // Let an idle host settle, then confirm the unchanged state costs no further CPU.
  await delay(3000);
  const idle = hostUsage();
  const execs = trace ? fs.readFileSync(traceFile, 'utf8').split('\n').filter(line => /execve\(.*\) = 0/.test(line)).length : null;
  assert.equal(await page.locator('[data-board-card]').count(), 100);
  assert.ok(responses.length >= 6 && responses.every(status => status === 200));
  const idleCpuMs = sumOf(idle, 'cpuMs') + sumOf(idle, 'reapedChildCpuMs') - sumOf(peak, 'cpuMs') - sumOf(peak, 'reapedChildCpuMs');
  console.log(JSON.stringify({ label, origin, coldMs, warmMs, warmP95Ms, changedMs, clientsChangedMs, clients, cards: 100, responses, requests,
    host: { cpuMs: sumOf(idle, 'cpuMs') + sumOf(idle, 'reapedChildCpuMs'), idleCpuMsOver3s: idleCpuMs,
      steadyRssKb: sumOf(steady, 'rssKb'), peakRssKb: sumOf(peak, 'peakKb'), processes: peak, execs, sqlStatements: countSql ? sqlStatements : null }, output,
    environment: { node: process.version, chromium: browser.version(), cpu: os.cpus()[0].model } }));
} finally {
  clearInterval(scan);
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    // strace does not forward its own termination to the traced host.
    if (trace) { for (const pid of descendants) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } } }
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 4000);
    await exited;
    clearTimeout(force);
  }
  const remaining = [...descendants].filter(pid => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
  console.log(JSON.stringify({ label, shutdownCode: child?.exitCode, shutdownSignal: child?.signalCode,
    descendants: [...descendants], remaining }));
  fs.rmSync(root, { recursive: true, force: true });
  assert.deepEqual(remaining, [], 'all owned descendants must exit');
}
