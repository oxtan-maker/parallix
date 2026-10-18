/** Isolated running-browser execution observations; no model or operator state. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { processStartIdentity } from '../../src/adapters/process/process-liveness.js';
import { missionRunsDir } from '../../src/adapters/filesystem/run-history-store.js';
import { chromium } from 'playwright-core';
import { workflowBoard, until } from './workflow-board.js';
import { bundleWorkflowChild } from './workflow-bundle.js';
import { seedRetainedProviderHistory } from './workflow-provider.js';

const baseline = process.argv.includes('--baseline');
const retainedHistory = process.argv.includes('--retained-history');
const screenshotPath = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : undefined;
const bundle = await bundleWorkflowChild();
const fixture = await workflowBoard(2, { providers: true, cli: bundle.cli });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
let cli: ReturnType<typeof spawn> | null = null;
let cliIdentity: string | null = null;
const closeCli = () => { if (cli?.pid && cliIdentity && processStartIdentity(cli.pid) === cliIdentity) { cli.kill('SIGTERM'); } };
process.prependListener('exit', closeCli);
const release = (name: string) => fs.writeFileSync(path.join(fixture.root, `${name}.release`), 'release');
try {
  if (retainedHistory) { for (const slug of fixture.slugs) { seedRetainedProviderHistory(fixture.root, slug); } }
  let host = await fixture.start(true);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => console.error('BROWSER', error));
  page.on('console', message => { if (message.type() === 'error') console.error('BROWSER', message.text()); });
  await page.goto(host.origin);
  console.log('HOST', host.origin);
  const [board, command] = fixture.slugs;
  const card = (slug: string) => page.locator(`[data-board-card="${slug}"]`);
  const sample = async (phase: string) => {
    const result = { phase, header: await page.locator('header').allTextContents(), cards: await Promise.all(fixture.slugs.map(async slug => ({ slug,
      execution: await card(slug).locator('[data-provider-execution]').count() ? await card(slug).locator('[data-provider-execution]').innerText() : 'not displayed on intake card', workers: await card(slug).locator('[title*="active worker"]').allTextContents(), spinning: await card(slug).locator('.fan.spin').count() }))) };
    if (screenshotPath && phase === 'two-providers') { await page.screenshot({ path: screenshotPath }); }
    console.log(JSON.stringify(result)); return result;
  };
  await card(board).locator('[data-action-kind="active:execute"][aria-disabled="false"]').last().click();
  await until(() => fixture.entered(board), 'board held preparation');
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"]`)?.textContent?.includes('preparing'), board);
  const prepared = await sample('board-held-preparation');
  if (!baseline) { assert.equal(prepared.cards[0].execution, '0 executing'); assert.deepEqual(prepared.cards[0].workers, []); }
  cli = spawn(bundle.cli.command, [...bundle.cli.args, '--fixture-cli-execute', fixture.root, command], {
    cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  cli.once('spawn', () => { cliIdentity = processStartIdentity(cli!.pid!); });
  let diagnostic = ''; cli.stderr?.on('data', data => { diagnostic += data; });
  await until(() => fixture.entered(command), `CLI held preparation ${diagnostic}`);
  await sample('CLI-and-board-held-preparation');
  fs.writeFileSync(path.join(fixture.root, 'capacity.hold'), 'held');
  fixture.release(board);
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.capacity.entered`)), 'held capacity');
  await sample('capacity-wait-zero-providers');
  fs.rmSync(path.join(fixture.root, 'capacity.hold')); release(`${board}.capacity`);
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.provider-1.entered`)), 'board provider');
  if (retainedHistory) { seedRetainedProviderHistory(fixture.root, board); }
  if (baseline) { await page.reload(); await card(board).waitFor(); } else { await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.includes('1 executing'), board); }
  await sample('one-provider');
  fs.writeFileSync(path.join(fixture.root, `${command}.families`), JSON.stringify(['codex', 'claude', 'claude']));
  fixture.release(command);
  await until(() => fs.existsSync(path.join(fixture.root, `${command}.provider-1.entered`)), `CLI provider ${diagnostic}`);
  if (retainedHistory) { seedRetainedProviderHistory(fixture.root, command); }
  if (baseline) { await page.reload(); await card(board).waitFor(); } else { await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.includes('1 executing'), command); }
  await sample('two-providers');
  if (!baseline) {
  const runs = missionRunsDir(fixture.root, command);
  const executing = fixture.terminal.execution!(command);
  assert.ok('invocations' in executing && executing.invocations.length === 1);
  const metadata = path.join(runs, executing.invocations[0].runId, 'run.json');
  const original = fs.readFileSync(metadata, 'utf8'); const record = JSON.parse(original);
  fs.writeFileSync(metadata, JSON.stringify({ ...record, execution: { ...record.execution, processIdentity: null } }));
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.trim() === 'execution unknown', command);
  await sample('partial-probe-one-confirmed-one-unknown');
  fs.writeFileSync(metadata, original);
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.includes('1 executing'), command);
  const idsBefore = fixture.slugs.map(slug => fs.readFileSync(path.join(fixture.root, `${slug}.provider-1.entered`), 'utf8'));
  await page.reload();
  await card(board).locator('[data-provider-execution]').waitFor();
  await sample('browser-reload');
  host = await fixture.start(true); await page.goto(host.origin);
  await card(board).locator('[data-provider-execution]').waitFor();
  await sample('web-host-restart');
  assert.deepEqual(fixture.slugs.map(slug => fs.readFileSync(path.join(fixture.root, `${slug}.provider-1.entered`), 'utf8')), idsBefore);
  release(`${board}.provider-1`);
  await until(() => fs.existsSync(path.join(fixture.root, 'post-agent-gate.entered')), 'post-agent gate');
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.trim() === '0 executing', board);
  await sample('provider-exit-gate-held');
  const history = await fixture.observation.terminal.search(board, { pattern: 'PROVIDER-READY' });
  assert.ok('hits' in history && history.hits.length > 0);
  await card(board).locator('p').first().click();
  const dialog = page.getByRole('dialog', { name: `Mission progress for ${board}` });
  await dialog.getByRole('textbox', { name: 'Search retained history' }).fill('PROVIDER-READY');
  await dialog.getByRole('button', { name: 'search', exact: true }).click();
  await dialog.locator('[aria-label="Search results"]').getByText('match(es)', { exact: false }).waitFor();
  await dialog.getByRole('combobox', { name: 'Operation', exact: true }).selectOption(history.hits[0].runId);
  await dialog.locator('[aria-label="Retained history"]').getByText('PROVIDER-READY', { exact: false }).waitFor();
  console.log(JSON.stringify({ phase: 'retained-history-browser', search: await dialog.locator('[aria-label="Search results"]').innerText(), output: await dialog.locator('[aria-label="Retained history"]').innerText() }));
  await dialog.getByRole('button', { name: 'close', exact: true }).click();
  release(`${command}.provider-1`);
  await until(() => fs.existsSync(path.join(fixture.root, `${command}.provider-2.entered`)), 'fallback provider');
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.includes('claude'), command);
  await sample('different-family-fallback');
  release(`${command}.provider-2`);
  await until(() => fs.existsSync(path.join(fixture.root, `${command}.provider-3.entered`)), 'retry provider');
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.includes('claude'), command);
  await sample('same-family-retry');
  release('post-agent-gate');
  await until(async () => await fixture.service.current(board) === null, 'first workflow complete');
  for (const suffix of ['entered', 'release']) { fs.rmSync(path.join(fixture.root, `${board}.provider-1.${suffix}`), { force: true }); }
  await card(board).locator('[data-action-kind="active:execute"][aria-disabled="false"]').last().click();
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.provider-1.entered`)), 'replacement provider');
  const stoppedOwner = (await fixture.service.current(board))!;
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.includes('1 executing'), board);
  await sample('replacement-before-stop-other-mission-live');
  const stopped = page.waitForResponse(response => response.url().endsWith('/api/commands'));
  await card(board).locator('[data-action-kind="workflow:stop"]').click();
  assert.equal((await stopped).status(), 200);
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.trim() === '0 executing', board);
  await sample('confirmed-stop-other-mission-live');
  await assert.rejects(() => fixture.service.progress(stoppedOwner.id, stoppedOwner.generation, 'execute', 'delayed old owner', 'codex', true), /fenced|stopped/);
  for (const suffix of ['entered', 'release']) { fs.rmSync(path.join(fixture.root, `${board}.provider-1.${suffix}`), { force: true }); }
  await card(board).locator('[data-action-kind="active:execute"][aria-disabled="false"]').last().click();
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.provider-1.entered`)), 'restart after stop');
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.includes('1 executing'), board);
  await sample('confirmed-stop-restart');
  fs.rmSync(path.join(fixture.root, 'post-agent-gate.release'));
  fs.rmSync(path.join(fixture.root, 'post-agent-gate.entered'), { force: true });
  // Crash the restarted provider; workflow capture and post-agent path remain independently observable.
  process.kill(Number(fs.readFileSync(path.join(fixture.root, `${board}.provider-1.entered`), 'utf8')), 'SIGKILL');
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"] [data-provider-execution]`)?.textContent?.trim() === '0 executing', board);
  await until(() => fs.existsSync(path.join(fixture.root, 'post-agent-gate.entered')), 'crash post-agent gate');
  await sample('provider-crash-gate-held');
  release('post-agent-gate');
  release(`${command}.provider-3`);
  console.log(JSON.stringify({ result: 'PASS', providerPidsPreserved: idsBefore, historySearch: true, limitations: 'Deterministic provider executable; CLI uses production active command parsing and shared dispatcher through fixture entry; no paid models or real Forgejo.' }));
  }
} finally {
  for (const name of fs.readdirSync(fixture.root).filter(name => name.endsWith('.entered'))) { release(name.replace(/\.entered$/, '')); }
  await browser.close(); await fixture.close();
  closeCli(); process.removeListener('exit', closeCli);
  bundle.close();
}
