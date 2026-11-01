/** Isolated running-browser execution observations; no model or operator state. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { processStartIdentity } from '../../src/adapters/process/process-liveness.js';
import { missionRunsDir } from '../../src/adapters/filesystem/run-history-store.js';
import { chromium } from 'playwright-core';
import { MissionLifecycleService } from '../../src/application/mission-lifecycle-service.js';
import { missionId } from '../../src/domain/mission.js';
import { agentFamily } from '../../src/domain/agents.js';
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { workflowBoard, until } from './workflow-board.js';
import { bundleWorkflowChild } from './workflow-bundle.js';
import { seedRetainedProviderHistory } from './workflow-provider.js';

const baseline = process.argv.includes('--baseline');
const retainedHistory = process.argv.includes('--retained-history');
const screenshotPath = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : undefined;
const bundle = await bundleWorkflowChild();
const fixture = await workflowBoard(2, { providers: true, cli: bundle.cli });
const browser = await chromium.launch({ args: ['--disable-extensions'], executablePath: '/usr/bin/chromium', headless: true });
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
  // Cards expose worker identity; repository provider counts belong to the header.
  // Assert both supported surfaces against explicit phase expectations and HTTP facts.
  const sample = async (phase: string, workers: readonly (string | null)[], complete = [true, true]) => {
    const counts = Object.fromEntries(['codex', 'claude'].map(family => {
      const count = workers.filter(worker => worker === family).length;
      return [family, complete.every(Boolean) ? String(count) : count ? `${count}+` : 'unknown'];
    }));
    if (!baseline) {
      await page.waitForFunction(({ slugs, workers, counts }) => {
        const pills = [...document.querySelectorAll('[aria-label="Agent availability"] > div')];
        return slugs.every((slug, index) => {
          const labels = [...document.querySelectorAll(`[data-board-card="${slug}"] [title*="active worker"]`)];
          return workers[index] === null ? labels.length === 0 : labels.length === 1 && labels[0].textContent === workers[index];
        }) && Object.entries(counts).every(([family, count]) => pills.some(pill =>
          pill.children[1]?.textContent?.trim() === family && pill.lastElementChild?.textContent?.trim() === count));
      }, { slugs: fixture.slugs, workers, counts });
    }
    const response = await page.request.get(`${host.origin}/api/board`);
    assert.equal(response.status(), 200);
    const snapshot = await response.json() as WebBoardSnapshot;
    const cards = await Promise.all(fixture.slugs.map(async (slug, index) => {
      const execution = snapshot.stages.flatMap(stage => stage.cards).find(card => card.id === slug)!.execution!;
      const labels = await card(slug).locator('[title*="active worker"]').allTextContents();
      if (!baseline) {
        assert.equal(execution.complete, complete[index], `${phase}: ${slug} observation certainty`);
        assert.deepEqual(execution.invocations.map(run => run.family), workers[index] === null ? [] : [workers[index]], `${phase}: ${slug} HTTP providers`);
        assert.deepEqual(labels, workers[index] === null ? [] : [workers[index]], `${phase}: ${slug} browser worker`);
        assert.equal(await card(slug).locator('[data-provider-execution]').count(), 0, 'the card design has no count row');
      }
      return { slug, execution, workers: labels, spinning: await card(slug).locator('.fan.spin').count() };
    }));
    if (!baseline) {
      for (const [family, count] of Object.entries(counts)) {
        const metric = snapshot.agentAvailability.find(metric => metric.family === family)!;
        assert.equal(metric.runningSessions, count === 'unknown' ? null : Number.parseInt(count), `${phase}: ${family} HTTP count`);
        assert.equal(metric.executionComplete, complete.every(Boolean), `${phase}: ${family} HTTP certainty`);
      }
    }
    const result = { phase, header: await page.locator('[aria-label="Agent availability"]').innerText(), cards };
    if (screenshotPath && phase === 'two-providers') { await page.screenshot({ path: screenshotPath }); }
    console.log(JSON.stringify(result)); return result;
  };
  await card(board).locator('[data-action-kind="active:execute"][aria-disabled="false"]').last().click();
  await until(() => fixture.entered(board), 'board held preparation');
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"]`)?.textContent?.includes('preparing'), board);
  await sample('board-held-preparation', [null, null]);
  cli = spawn(bundle.cli.command, [...bundle.cli.args, '--fixture-cli-execute', fixture.root, command], {
    cwd: fixture.root, env: { ...fixture.configuration.forwardedEnvironment }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  cli.once('spawn', () => { cliIdentity = processStartIdentity(cli!.pid!); });
  let diagnostic = ''; cli.stderr?.on('data', data => { diagnostic += data; });
  await until(() => fixture.entered(command), `CLI held preparation ${diagnostic}`);
  await sample('CLI-and-board-held-preparation', [null, null]);
  fs.writeFileSync(path.join(fixture.root, 'capacity.hold'), 'held');
  fixture.release(board);
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.capacity.entered`)), 'held capacity');
  await sample('capacity-wait-zero-providers', [null, null]);
  fs.rmSync(path.join(fixture.root, 'capacity.hold')); release(`${board}.capacity`);
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.provider-1.entered`)), 'board provider');
  if (retainedHistory) { seedRetainedProviderHistory(fixture.root, board); }
  if (baseline) { await page.reload(); await card(board).waitFor(); }
  await sample('one-provider', ['codex', null]);
  fs.writeFileSync(path.join(fixture.root, `${command}.families`), JSON.stringify(['codex', 'claude', 'claude']));
  fixture.release(command);
  await until(() => fs.existsSync(path.join(fixture.root, `${command}.provider-1.entered`)), `CLI provider ${diagnostic}`);
  if (retainedHistory) { seedRetainedProviderHistory(fixture.root, command); }
  if (baseline) { await page.reload(); await card(board).waitFor(); }
  await sample('two-providers', ['codex', 'codex']);
  if (!baseline) {
  const runs = missionRunsDir(fixture.root, command);
  const executing = fixture.terminal.execution!(command);
  assert.ok('invocations' in executing && executing.invocations.length === 1);
  const metadata = path.join(runs, executing.invocations[0].runId, 'run.json');
  const original = fs.readFileSync(metadata, 'utf8'); const record = JSON.parse(original);
  fs.writeFileSync(metadata, JSON.stringify({ ...record, execution: { ...record.execution, processIdentity: null } }));
  await sample('partial-probe-one-confirmed-one-unknown', ['codex', null], [true, false]);
  fs.writeFileSync(metadata, original);
  await sample('probe-restored', ['codex', 'codex']);
  const idsBefore = fixture.slugs.map(slug => fs.readFileSync(path.join(fixture.root, `${slug}.provider-1.entered`), 'utf8'));
  await page.reload();
  await sample('browser-reload', ['codex', 'codex']);
  host = await fixture.start(true); await page.goto(host.origin);
  await sample('web-host-restart', ['codex', 'codex']);
  assert.deepEqual(fixture.slugs.map(slug => fs.readFileSync(path.join(fixture.root, `${slug}.provider-1.entered`), 'utf8')), idsBefore);
  release(`${board}.provider-1`);
  await until(() => fs.existsSync(path.join(fixture.root, 'post-agent-gate.entered')), 'post-agent gate');
  await sample('provider-exit-gate-held', [null, 'codex']);
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
  await sample('different-family-fallback', [null, 'claude']);
  release(`${command}.provider-2`);
  await until(() => fs.existsSync(path.join(fixture.root, `${command}.provider-3.entered`)), 'retry provider');
  await sample('same-family-retry', [null, 'claude']);
  release('post-agent-gate');
  await until(async () => await fixture.service.current(board) === null, 'first workflow complete');
  const completedMission = await fixture.store.load(missionId(board));
  assert.ok(completedMission.kind === 'found');
  assert.equal(completedMission.mission.status, 'review', 'automatic execution enters review preparation');
  assert.equal(completedMission.mission.review, null, 'the controlled reviewer does not fabricate a review or approval');
  await sample('automatic-review-entry', [null, 'claude']);
  // Arrange a review repair through the checked lifecycle owner before testing
  // replacement/stop. Successful execution now ends in review, not active.
  const repair = await new MissionLifecycleService(fixture.store).transition({
    operationId: 'manual-review-repair', missionId: missionId(board), capabilities: new Set(['mission:transition']),
    command: { type: 'rebound-to-active', agent: agentFamily('codex'), cause: { kind: 'review-repair' } },
    actor: 'manual-fixture', occurredAt: new Date().toISOString(),
  });
  assert.equal(repair.status, 'completed');
  for (const suffix of ['entered', 'release']) { fs.rmSync(path.join(fixture.root, `${board}.provider-1.${suffix}`), { force: true }); }
  await card(board).locator('[data-action-kind="active:execute"][aria-disabled="false"]').last().click();
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.provider-1.entered`)), 'replacement provider');
  const stoppedOwner = (await fixture.service.current(board))!;
  await sample('replacement-before-stop-other-mission-live', ['codex', 'claude']);
  const stopped = page.waitForResponse(response => response.url().endsWith('/api/commands'));
  await card(board).locator('[data-action-kind="workflow:stop"]').click();
  assert.equal((await stopped).status(), 200);
  await sample('confirmed-stop-other-mission-live', [null, 'claude']);
  await assert.rejects(() => fixture.service.providerStarted(stoppedOwner.id, stoppedOwner.generation, 'codex'), /fenced|stopped/);
  for (const suffix of ['entered', 'release']) { fs.rmSync(path.join(fixture.root, `${board}.provider-1.${suffix}`), { force: true }); }
  await card(board).locator('[data-action-kind="active:execute"][aria-disabled="false"]').last().click();
  await until(() => fs.existsSync(path.join(fixture.root, `${board}.provider-1.entered`)), 'restart after stop');
  await sample('confirmed-stop-restart', ['codex', 'claude']);
  fs.rmSync(path.join(fixture.root, 'post-agent-gate.release'));
  fs.rmSync(path.join(fixture.root, 'post-agent-gate.entered'), { force: true });
  // Crash the restarted provider; workflow capture and post-agent path remain independently observable.
  process.kill(Number(fs.readFileSync(path.join(fixture.root, `${board}.provider-1.entered`), 'utf8')), 'SIGKILL');
  await until(() => fs.existsSync(path.join(fixture.root, 'post-agent-gate.entered')), 'crash post-agent gate');
  await sample('provider-crash-gate-held', [null, 'claude']);
  release('post-agent-gate');
  release(`${command}.provider-3`);
  await until(async () => (await Promise.all(fixture.slugs.map(slug => fixture.service.current(slug)))).every(owner => owner === null), 'both workflows complete');
  await sample('automatic-completion', [null, null]);
  console.log(JSON.stringify({ result: 'PASS', providerPidsPreserved: idsBefore, historySearch: true, limitations: 'Deterministic provider executable; CLI uses production active command parsing and shared dispatcher through fixture entry; review repair arranged via checked lifecycle transition; review/decision boundary controlled; no paid models or real Forgejo.' }));
  }
} finally {
  for (const name of fs.readdirSync(fixture.root).filter(name => name.endsWith('.entered'))) { release(name.replace(/\.entered$/, '')); }
  await browser.close(); await fixture.close();
  closeCli(); process.removeListener('exit', closeCli);
  bundle.close();
}
