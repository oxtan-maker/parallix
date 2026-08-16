/**
 * TASK-2375 F1 / SC2 — `px active` carries a per-invocation operationId, proved
 * through the real command wiring.
 *
 * The round-1 review (F1) found the execute path still used the slug alone
 * (`active:<slug>`), so two overlapping `px active` runs on the same mission
 * reconciled as one operation: a late `blocked`/`ended` from the older run
 * cleared the newer run's standing work — the exact defect class this mission
 * fixes. These tests drive the real `active()` command, the real
 * `ExecuteMissionService`, and the real current-work recorder/read/reconcile
 * path — no hand-written operationIds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import active from '../src/adapters/cli/commands/active.js';
import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionRequest } from '../src/application/execute-mission-service.js';
import { CurrentWorkRecorder } from '../src/application/recording/current-work-recorder.js';
import { ConcreteCurrentWorkReadAdapter } from '../src/adapters/backlog/concrete-current-work-read-adapter.js';
import { isWorkInProgress, reconcileCurrentWork } from '../src/application/projections/current-work.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteOperationalHistoryRepository } from '../src/adapters/sqlite/operational-history-repository.js';
import { missionId } from '../src/domain/mission.js';
import type { AgentLaunchOutcome, AgentLaunchRequest, ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';

const SLUG = 'task-9101';
const OPERATION_ID = /^active:task-9101:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Bounded wait on an observable condition (explicit synchronization, no sleeps). */
async function until(condition: () => boolean, what: string, milliseconds = 5_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() >= deadline) { throw new Error(`timed out waiting for ${what}`); }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface RecorderFixture {
  readonly recorder: CurrentWorkRecorder;
  readonly readAdapter: ConcreteCurrentWorkReadAdapter;
  dispose(): Promise<void>;
}

/** The production current-work write/read pair over a real migrated operator database. */
async function recorderFixture(): Promise<RecorderFixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2375-active-overlap-'));
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'operator.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  const repo = new SqliteOperationalHistoryRepository(db);
  let tick = 0;
  const now = () => new Date(Date.parse('2026-08-15T09:00:00.000Z') + (tick += 1_000));
  return {
    recorder: new CurrentWorkRecorder(repo, { processId: process.pid, now }),
    readAdapter: new ConcreteCurrentWorkReadAdapter(repo),
    dispose: async () => {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Read the mission's current work exactly as the board projection does. */
async function readCurrentWork(fixture: RecorderFixture) {
  const events = await fixture.readAdapter.loadCurrentWork();
  return reconcileCurrentWork(events, {
    nowMs: Date.parse('2026-08-15T09:05:00.000Z'),
    ttlMs: 5 * 60 * 1000,
    isProcessAlive: () => true,
  }).get(missionId(SLUG)) ?? null;
}

function successOutcome(agent = 'claude'): AgentLaunchOutcome {
  return { agent, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
}

function errorOutcome(message: string): AgentLaunchOutcome {
  return { agent: 'claude', rebaseDeferred: false, errored: true, errorMessage: message, exitStatus: null, detail: null };
}

/**
 * Mechanism ports for the execute workflow: everything external is inert,
 * except `launch`, which the test gates so two invocations overlap in the
 * window the defect requires.
 */
function makePorts(launch: (request: AgentLaunchRequest) => Promise<AgentLaunchOutcome>): ExecuteMissionPorts {
  return {
    workspace: {
      preflight: async () => true,
      resolveWorktree: async () => `/tmp/wt-${SLUG}`,
      resolveTaskFile: async () => ({ ok: false }),
      readTaskStatus: async () => null,
      enforceCommitSafety: async () => {},
    },
    agentExecution: {
      prepare: async () => ({ prompt: 'execute', agentConfig: {} }),
      launch,
    },
    // Never reached: task file resolution is `ok: false` and the launch is
    // never rebase-deferred, so lifecycle synchronization is skipped.
    missionTransitions: { save: async () => { throw new Error('missionTransitions must not be called'); }, saveWithTransition: async () => { throw new Error('missionTransitions must not be called'); } } as unknown as ExecuteMissionPorts['missionTransitions'],
    telemetry: { recordLaunchTelemetry: async () => {} },
    handoffReview: { runHandoffAndReview: async () => true },
  } as ExecuteMissionPorts;
}

/**
 * The real `active()` command wired to a real `ExecuteMissionService`. The
 * wrapper records the exact request the command layer hands to the service —
 * that is where the per-invocation operationId comes from.
 */
async function runActive(
  captured: string[],
  fixture: RecorderFixture,
  launch: (request: AgentLaunchRequest) => Promise<AgentLaunchOutcome>,
  exitCodes: number[],
): Promise<void> {
  const service = new ExecuteMissionService(makePorts(launch), undefined, fixture.recorder);
  await active([SLUG], {
    inferSlugFn: () => SLUG,
    service: {
      execute: (request: ExecuteMissionRequest) => {
        captured.push(request.operationId);
        return service.execute(request);
      },
    },
    rootDir: '/tmp/project-task-9101',
    exitFn: (code: number) => { exitCodes.push(code); },
    logFn: () => {},
    errorFn: () => {},
  });
}

test('TASK-2375 SC2: the real px active command assigns a unique per-invocation operationId', async () => {
  const fixture = await recorderFixture();
  try {
    const ids: string[] = [];
    const exitCodes: number[] = [];
    const launch = async () => successOutcome();
    await runActive(ids, fixture, launch, exitCodes);
    await runActive(ids, fixture, launch, exitCodes);

    assert.equal(ids.length, 2, 'two invocations must each reach the execute service');
    assert.notEqual(ids[0], ids[1], 'two overlapping-capable invocations must not share an operationId');
    assert.match(ids[0], OPERATION_ID, 'operationId keeps the type and slug for correlation');
    assert.match(ids[1], OPERATION_ID);
    assert.deepEqual(exitCodes, [], 'both invocations complete cleanly');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2375 SC2: two overlapping real px active runs cannot cross-terminate each other', async () => {
  const fixture = await recorderFixture();
  const ids: string[] = [];
  const launches: AgentLaunchRequest[] = [];
  let releaseA: () => void = () => {};
  let releaseB: () => void = () => {};
  const gateA = new Promise<void>((r) => { releaseA = r; });
  const gateB = new Promise<void>((r) => { releaseB = r; });

  const launch = (request: AgentLaunchRequest) => {
    launches.push(request);
    if (launches.length === 1) {
      // First invocation (A): holds the launch, then fails — its late
      // `blocked` event is exactly the cross-termination the old slug-only id
      // let through.
      return gateA.then(() => errorOutcome('stub launcher exploded'));
    }
    // Second invocation (B): stays running while A terminates.
    return gateB.then(() => successOutcome());
  };

  try {
    const exitCodes: number[] = [];
    const first = runActive(ids, fixture, launch, exitCodes);
    await until(() => launches.length === 1, 'first invocation to reach the launch gate');
    const second = runActive(ids, fixture, launch, exitCodes);
    await until(() => launches.length === 2, 'second invocation to overlap the first');

    releaseA();
    await first; // A terminates: its blocked event lands after B is running.
    assert.equal(exitCodes[0], 1, 'A exits 1 on its own failure');

    const facts = await readCurrentWork(fixture);
    assert.equal(facts?.currentWork?.operationId, ids[1], 'B must remain standing after A\'s late terminal event');
    assert.notEqual(ids[0], ids[1], 'the two real invocations carry distinct operationIds');
    assert.equal(isWorkInProgress(facts?.currentWork ?? null), true, 'the mission must still read as WORKING');

    releaseB();
    await second; // B completes its own operation on its own id.
    assert.deepEqual(exitCodes, [1], 'only A exits non-zero');
    const after = await readCurrentWork(fixture);
    assert.equal(after?.currentWork, null, 'B clears the mission only through its own terminal event');
  } finally {
    releaseA();
    releaseB();
    await fixture.dispose();
  }
});
