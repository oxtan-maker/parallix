// Manual observation only: node --import tsx test/fixtures/board-loading-manual.mjs CLI LABEL [SNAPSHOT]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright-core';
import { seedBoardLoading } from './board-loading-state.ts';

const [cli, label, snapshot] = process.argv.slice(2);
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
    PARALLIX_TEST_NO_FORGEJO: '1', NO_COLOR: '1' };
  for (const key of Object.keys(environment)) {
    if (/^PARALLIX_(WORKFLOW|MISSION)/.test(key) || /^NODE_/.test(key)) { delete environment[key]; }
  }
  const start = performance.now();
  child = spawn(process.execPath, [path.resolve(cli), 'web'], {
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
  page.on('response', response => {
    if (response.url().endsWith('/api/board')) { responses.push(response.status()); }
  });
  // Resolve from the browser's first painted expected card, without the
  // automation locator's polling/backoff becoming part of render latency.
  await page.addInitScript(() => {
    window.boardLoadingPaint = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const card = document.querySelector('[data-board-card="task-9001"]');
        if (!card?.textContent?.includes('Board loading fixture 1')) { return; }
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now())));
      });
      observer.observe(document, { childList: true, subtree: true, characterData: true });
    });
  });
  const epochStart = Date.now();
  // Include spawn-to-navigation time in the cold result.
  const beforeNavigationMs = performance.now() - start;
  await page.goto(origin);
  const firstPaint = await page.evaluate(() => window.boardLoadingPaint);
  const coldMs = firstPaint - epochStart + beforeNavigationMs;
  const warmMs = [];
  for (let index = 0; index < 5; index++) {
    const at = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    warmMs.push(await page.evaluate(() => window.boardLoadingPaint) - at);
  }
  assert.equal(await page.locator('[data-board-card]').count(), 100);
  assert.ok(responses.length >= 6 && responses.every(status => status === 200));
  console.log(JSON.stringify({ label, origin, coldMs, warmMs, cards: 100, responses, output,
    environment: { node: process.version, chromium: browser.version(), cpu: os.cpus()[0].model } }));
} finally {
  clearInterval(scan);
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
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
