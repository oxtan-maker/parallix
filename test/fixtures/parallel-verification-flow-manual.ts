/** Disposable public `px web` and `px stats` acceptance for the retained parallel-verification FLOW segment. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteBoardLaneEventRepository } from '../../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { SqliteOperationalHistoryRepository } from '../../src/adapters/sqlite/operational-history-repository.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { copyMigratedSchema, prepareMigratedSchema } from './migrated-database.js';
import { fixtureMission } from './mission-builders.js';
import { laneEvent } from './statistics-database.js';
import { agentFamily } from '../../src/domain/agents.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../../src/application/ports/verification-observation.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'px-parallel-flow-manual-'));
const home = path.join(temporary, 'home');
const databasePath = path.join(home, 'parallix.db');
const cli = path.resolve('build/px.mjs');
const repositoryId = resolveCanonicalRepositoryId(process.cwd());
const env = { ...process.env, PARALLIX_HOME: home, PARALLIX_NO_TUI: '1', FORCE_COLOR: '0' };
const database = new SqliteDatabaseAdapter();
const missions = ['answer-ready', 'answer-later', 'fixed-fallback', 'evidence-unobserved', 'operator-approved'] as const;

function start(missionId: string, action: 'human' | 'tests' | 'agent', sequence: number, at: string,
  execution: 'pilot' | 'pilot-failure' | 'fallback' | 'unobserved' = 'pilot') {
  const artifactSha256 = execution === 'pilot' || execution === 'pilot-failure' ? 'retained-artifact' : null;
  return { schemaVersion: 1, idempotencyKey: `${missionId}:${action}`, missionId, repositoryId,
    changeIdentity: `${missionId}-change`, artifactSha256,
    recommendedAction: action, predictedPassProbability: { tests: 0.8, agent: 0.8, human: 0.8 }, actualAction: action,
    operatorOverride: false, verdictCorrelation: action === 'tests' ? `${missionId}-gate`
      : `review:1:${action === 'agent' ? 'agent:codex-verdict' : 'human-verdict'}`,
    agentRunId: action === 'agent' ? `${missionId}-agent` : null, gateRunId: action === 'tests' ? `${missionId}-gate` : null,
    operationId: `${missionId}-operation`, actionSequence: sequence, sameRevisionRerun: false,
    failureReason: execution === 'pilot-failure' ? { kind: 'history-unavailable' as const, message: 'history unavailable' }
      : execution === 'fallback' ? { kind: 'artifact-missing' as const, message: 'policy artifact is missing' } : null, recordedAt: at };
}

function outcome(value: ReturnType<typeof start>, at: string, humanWaitMs: number | null = null, passed = true) {
  return { schemaVersion: 1, idempotencyKey: `outcome:${value.idempotencyKey}`, startKey: value.idempotencyKey,
    missionId: value.missionId, changeIdentity: value.changeIdentity, actualAction: value.actualAction,
    runDurationMs: null, reviewMs: null, humanWaitMs, findingCount: null,
    verdictSource: value.actualAction === 'human' ? 'operator' : value.actualAction === 'agent' ? 'reviewer' : null,
    passed, rebuttal: null, recordedAt: at };
}

async function retainedGate(history: SqliteOperationalHistoryRepository, missionId: string,
  phase: 'review' | 'integration', requestedAt: string, finishedAt: string): Promise<void> {
  const measurement = { id: `${missionId}-${phase}-attempt`, repositoryId, missionId,
    operationId: `${missionId}-operation`, revision: 'retained-revision',
    batchId: `${missionId}-${phase}-measurement-batch`, gate: `${phase}-gate`, command: `${phase}-check`, phase,
    after: [], requestedAt, startedAt: requestedAt, finishedAt, result: 'passed', failureReason: null,
    exitCode: 0, wallMs: Date.parse(finishedAt) - Date.parse(requestedAt), cpu: null, profile: null } satisfies VerificationMeasurement;
  await history.append({ eventType: VERIFICATION_MEASUREMENT_EVENT, eventData: JSON.stringify(measurement), createdAt: finishedAt });
}

async function retainedRound(history: SqliteOperationalHistoryRepository, missionId: string,
  humanWaitMinutes: number | null, execution: 'pilot' | 'pilot-failure' | 'fallback' | 'unobserved' = 'pilot',
  automated: readonly [boolean, boolean] = [true, true]): Promise<void> {
  const human = start(missionId, 'human', 1, '2026-11-22T10:00:00.000Z', execution);
  const agent = start(missionId, 'agent', 2, '2026-11-22T10:02:00.000Z', execution);
  const tests = start(missionId, 'tests', 3, '2026-11-22T10:01:00.000Z', execution);
  for (const value of [human, agent, tests]) {
    await history.append({ eventType: 'verification.review-start-decision', eventData: JSON.stringify(value), createdAt: value.recordedAt });
  }
  for (const value of [outcome(tests, '2026-11-22T10:05:00.000Z', null, automated[0]),
    outcome(agent, '2026-11-22T10:06:00.000Z', null, automated[1])]) {
    await history.append({ eventType: 'verification.review-start-outcome', eventData: JSON.stringify(value), createdAt: value.recordedAt });
  }
  await retainedGate(history, missionId, 'review', '2026-11-22T09:58:00.000Z', '2026-11-22T09:59:00.000Z');
  await retainedGate(history, missionId, 'integration', '2026-11-22T10:03:00.000Z', '2026-11-22T10:04:00.000Z');
  if (humanWaitMinutes !== null) {
    const value = outcome(human, '2026-11-22T10:11:00.000Z', humanWaitMinutes * 60_000, false);
    await history.append({ eventType: 'verification.review-start-outcome', eventData: JSON.stringify(value), createdAt: value.recordedAt });
  }
}

async function seed(): Promise<void> {
  fs.mkdirSync(home, { recursive: true });
  await prepareMigratedSchema();
  copyMigratedSchema(databasePath);
  await database.open({ path: databasePath });
  const laneEvents = new SqliteBoardLaneEventRepository(database);
  const store = new SqliteMissionStore(database);
  const history = new SqliteOperationalHistoryRepository(database);
  for (const [index, missionId] of missions.entries()) {
    const closedAt = `2026-11-22T12:0${index}:00.000Z`;
    const agent = index < 2 ? 'codex' : 'custom';
    await store.save(fixtureMission(missionId, { repositoryId, status: 'done', closedAt, assignee: agentFamily(agent) }), null);
    for (const [from, to, at] of [
      [null, 'backlog', `2026-11-22T09:0${index}:00.000Z`],
      ['backlog', 'active', `2026-11-22T09:1${index}:00.000Z`],
      ['active', 'review', `2026-11-22T10:2${index}:00.000Z`],
      ['review', 'integration', `2026-11-22T11:0${index}:00.000Z`],
      ['integration', 'done', closedAt],
    ] as const) {
      await laneEvents.append({ ...laneEvent({ repositoryId, missionId, from, to, at, agent, ...(to === 'integration' ? { trigger: 'approve' } : {}) }),
        ...(to === 'integration' ? { idempotencyKey: `approve:${missionId}:round-1` } : {}) });
    }
  }
  await laneEvents.append({ ...laneEvent({ repositoryId, missionId: 'answer-later', from: 'review', to: 'active',
    at: '2026-11-22T10:31:00.000Z', agent: 'codex' }), returnIdentity: {
      stage: 'integration-gates', operationId: 'answer-later-operation', operationGeneration: 1 } });
  await laneEvents.append(laneEvent({ repositoryId, missionId: 'answer-later', from: 'active', to: 'review',
    at: '2026-11-22T10:41:00.000Z', agent: 'codex' }));
  await retainedRound(history, 'answer-ready', 3, 'pilot-failure');
  await retainedRound(history, 'answer-later', 10, 'pilot', [false, false]);
  await retainedRound(history, 'fixed-fallback', null, 'fallback');
  await retainedRound(history, 'evidence-unobserved', null, 'unobserved');
  await retainedRound(history, 'operator-approved', null);
  // The px integrate attempt uses a commit sha, never the policy patch identity; the committed lane transition completes it.
  await history.append({ eventType: 'review.action-started', createdAt: '2026-11-22T10:50:00.000Z', eventData: JSON.stringify({
    schemaVersion: 1, repositoryId, missionId: 'operator-approved', changeIdentity: '74144a9e1606e1dbc9c2021e3884c3b20f6acce7',
    action: 'human', correlation: 'integrate-shortcut:1:head:head', actionSequence: 9, configuredLimit: 40, failureReason: null,
    idempotencyKey: 'operator-approved-approval', recordedAt: '2026-11-22T10:50:00.000Z' }) });
  await database.close();
}

async function webOrigin(child: ReturnType<typeof spawn>): Promise<{ origin: string; output: () => string }> {
  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const match = /listening on (http:\/\/[\[\]0-9a-f.:]+)\//i.exec(output);
    if (match?.[1]) { return { origin: match[1], output: () => output }; }
    if (child.exitCode !== null) { throw new Error(`px web exited ${child.exitCode}: ${output}`); }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`px web did not report its origin: ${output}`);
}

let web: ReturnType<typeof spawn> | null = null;
try {
  assert.ok(fs.existsSync(cli), 'run npm run build before the manual acceptance');
  await seed();
  const stats = spawnSync(process.execPath, [cli, 'stats', '--today', '2026-11-23'], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(stats.status, 0, stats.stdout + stats.stderr);
  assert.match(stats.stdout, /Parallel verification: configured artifact; executions pilot=3, fallback=1, shadow=0, unobserved=1, historical=0; rounds 3\/5 concurrent, 3 joined/);
  assert.match(stats.stdout, /human-at-join ready=1, later=2, pending=0, withdrawn=0, timing-unavailable=0/);

  web = spawn(process.execPath, [cli, 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const started = await webOrigin(web);
  const browser = await chromium.launch({ executablePath: process.env.PARALLIX_CHROMIUM ?? '/usr/bin/chromium', headless: true });
  let flowReadyMs = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1288, height: 900 } });
    const pageStartedAt = performance.now();
    await page.goto(started.origin);
    await page.getByRole('button', { name: 'Flow', exact: true }).click();
    await page.locator('[data-flow-view]').waitFor();
    flowReadyMs = Math.round(performance.now() - pageStartedAt);
    assert.ok(flowReadyMs < 5_000, `built FLOW page took ${flowReadyMs}ms to become visible`);
    assert.match(await page.locator('[data-flow-view]').innerText(), /one retained rebase · configured parallel verification/i);
    assert.match(await page.locator('[data-flow-view]').innerText(), /Configured artifact policy; 3 concurrent rounds of 5 observed, 3 joined/);
    for (const target of ['integration-tests', 'agent-review', 'human-review']) {
      assert.equal(await page.locator(`[data-flow-edge-label="declared-gates->${target}:concurrent-request"]`).innerText(),
        target === 'agent-review' ? '3 concurrent' : '3 request');
    }
    assert.equal(await page.locator('[data-flow-edge-label="declared-gates->agent-review:flow"]').innerText(), '100% · 2 sequential');
    for (const pair of ['declared-gates->agent-review', 'human-review->human-verdict', 'rebase->rebase-resolve']) {
      assert.equal(await page.locator(`[data-flow-edge^="${pair}"]`).count(), 1);
    }
    assert.equal(await page.locator('[data-flow-edge-label="human-review->human-verdict:human-ready"]').innerText(), '33% · 1 ready');
    assert.equal(await page.locator('[data-flow-edge-label="human-review->human-verdict:human-wait"]').innerText(), '67% · 2 later');
    assert.equal(await page.locator('[data-flow-edge-label="automated-join->implement:joint-repair"]').innerText(), '100% · 1 joint repair');
    assert.equal(await page.locator('[data-flow-edge-label="integration-tests->human-verdict:tests-passed"]').innerText(), '100% · 2 sequential pass');
    assert.equal(await page.locator('[data-flow-edge="integration-tests->landed:flow"]').count(), 0);
    assert.equal(await page.locator('[data-flow-edge-label="human-verdict->landed:operator-land"]').innerText(), '5 landed');
    assert.equal(await page.locator('[data-flow-node="human-verdict"]').getAttribute('data-flow-node-lane'), 'human');
    assert.equal(await page.locator('[data-flow-edge^="human-review->rebase"]').count(), 0);
    assert.equal(await page.locator('[data-flow-node="rebase"]').count(), 1);
    assert.deepEqual(await page.locator('[data-flow-region="graph"]').evaluate(root => {
      return {
        requestColumns: [root.querySelector<HTMLElement>('[data-flow-node="integration-tests"]')!.offsetLeft,
          root.querySelector<HTMLElement>('[data-flow-node="agent-review"]')!.offsetLeft,
          root.querySelector<HTMLElement>('[data-flow-node="human-review"]')!.offsetLeft],
        gateJunctions: root.querySelectorAll('[data-flow-junction="parallel-verification"]').length,
        joinJunctions: root.querySelectorAll('[data-flow-junction="automated-verification"]').length,
        repairArrows: root.querySelectorAll('[data-flow-edge^="automated-join->implement"]').length,
        repair: root.querySelector('[data-flow-edge="automated-join->implement"] polyline')?.getAttribute('points')
          ?.split(' ').map(point => point.split(',').map(Number)),
      };
    }), { requestColumns: [729, 729, 729], gateJunctions: 1, joinJunctions: 1,
      repairArrows: 1, repair: [[992, 297], [992, 168], [334, 168], [334, 218], [310, 218]] });
    if (process.env.FLOW_SCREENSHOT) { await page.screenshot({ path: process.env.FLOW_SCREENSHOT, fullPage: true }); }
    await page.getByText('How FLOW counts add up', { exact: true }).click();
    const breakdown = await page.locator('[data-flow-count-breakdown]').innerText();
    assert.match(breakdown, /Integration tests · 5\s+5 passing batches/);
    assert.match(breakdown, /Landed · 5\s+5 completed lifecycle deliveries/);
    await page.getByRole('group', { name: 'Agent filter' }).getByRole('button', { name: 'codex' }).click();
    assert.equal(await page.locator('[data-flow-edge-label="declared-gates->agent-review:flow"]').count(), 0);
    assert.equal(await page.locator('[data-flow-edge="agent-review->human-review:flow"]').count(), 0);
    assert.equal(await page.locator('[data-flow-edge="integration-tests->human-verdict:tests-passed"]').count(), 0);
    assert.equal(await page.locator('[data-flow-edge="human-verdict->rebase"]').count(), 0);
  } finally { await browser.close(); }
  console.log(JSON.stringify({ result: 'PARALLEL FLOW MANUAL PASS', commands: ['px stats --today 2026-11-23', 'px web --port 0'],
    isolatedHome: home, retainedMissions: missions, webOrigin: started.origin, flowReadyMs }));
} finally {
  if (web && web.exitCode === null) {
    web.kill('SIGTERM');
    await new Promise(resolve => web!.once('exit', resolve));
  }
  await database.close().catch(() => undefined);
  fs.rmSync(temporary, { recursive: true, force: true });
}
