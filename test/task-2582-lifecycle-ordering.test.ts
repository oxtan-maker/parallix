// TASK-2582 CP-5 — regression coverage for lifecycle transition ordering and
// the 200 ms persistence contract, with external boundaries (the agent run)
// mocked and made slow.
//
// The companion coverage this file relies on:
//   - multi-round review: test/task-2582-repro.test.ts
//   - approval replay without duplicate lane events:
//     test/task-2582-repro.test.ts 'approval replay emits no duplicate lane event',
//     test/task-2456-handoff-retry-duplicate-lane-event.test.ts
//   - stale versions never overwriting state:
//     test/task-2322-05-mission-use-cases.test.ts 'SC2: a stale expected
//     version is refused before the domain decides' and 'SC2: a stale write
//     raised by the store surfaces as a conflict'
//   - done only after all integration work succeeds:
//     test/mission-integration-service.test.ts (decideIntegration requires
//     fresh merged Git and passing verification facts)
//   - resume/recovery: test/task-2397-integrate-active-approved-recovery.test.ts,
//     test/task-2420-integrate-recovery-assigned-reviewer.test.ts,
//     test/recover-command.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
import { LIFECYCLE_DEADLINE_MS, monotonicNowMs } from '../src/application/lifecycle-timing.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';

const SLUG = 'task-2582-ordering';
const AGENT = agentFamily('claude');
const FALLBACK_AGENT = agentFamily('codex');

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `parallix-task-2582-ordering-`));
  tempDirs.push(root);
  return root;
}

test.after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A refined mission carrying the full drafted contract: activatable. */
function seedMission(): Mission {
  return {
    id: missionId(SLUG),
    repositoryId: repositoryId('parallix'),
    title: `Mission ${SLUG}`,
    labels: missionLabels([]),
    status: 'refined',
    rawStatus: 'refined',
    checkpoints: [{
      missionId: missionId(SLUG),
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1',
      goalCheck: [{ criterion: 'criterion', evidence: 'evidence' }],
      nextActionText: 'hand off',
    }],
    brief: { goal: 'Goal', why: 'Why', scope: 'Scope', outOfScope: [] },
    declaredGates: ['npm test'],
    successCriteria: ['The mission is done'],
    dependencies: [],
    predictedNelBucket: 'Small',
    reproductionTest: null,
    assignee: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: null,
    netEngineeringLines: null,
    closedAt: null,
  } as Mission;
}

interface Fixture {
  readonly database: SqliteDatabaseAdapter;
  readonly store: SqliteMissionStore;
  /** Inert mechanism ports over the real mission store. */
  readonly ports: ExecuteMissionPorts;
}

async function openFixture(
  launch: (request: { onActivated?: (agent: string, startedAtMs?: number) => Promise<void> }) => Promise<{
    agent: string; rebaseDeferred: boolean; errored: boolean; errorMessage: string | null; exitStatus: number | null; detail: unknown;
  }>,
): Promise<Fixture> {
  const root = makeTempRoot();
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(root, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  await store.save(seedMission(), null);
  const ports = {
    workspace: {
      async preflight() { return true; },
      async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: false }; },
      async readTaskStatus() { return null; },
      async enforceCommitSafety() {},
    },
    agentExecution: {
      async prepare() { return { prompt: 'execute', agentConfig: {} }; },
      launch,
    },
    // The real mission store: the authoritative boundary under test.
    missionTransitions: store as unknown as ExecuteMissionPorts['missionTransitions'],
    telemetry: { async recordLaunchTelemetry() {} },
    handoffReview: { async runHandoffAndReview() { return true; } },
  } as unknown as ExecuteMissionPorts;
  return { database, store, ports };
}

interface LaneEventRow {
  from_status: string | null;
  to_status: string;
  trigger: string;
}

async function laneEvents(database: SqliteDatabaseAdapter): Promise<Array<{ from_status: string | null, to_status: string, trigger: string }>> {
  const rows = await database.query<LaneEventRow>(
    'SELECT from_status, to_status, trigger FROM board_lane_events WHERE mission_id = ? ORDER BY id',
    [SLUG],
  );
  // node:sqlite returns null-prototype rows; normalize for plain-object asserts.
  return rows.map((row) => ({ from_status: row.from_status, to_status: row.to_status, trigger: row.trigger }));
}

/** Bounded wait on an observable condition (explicit synchronization, no sleeps). */
async function until(condition: () => boolean, what: string, milliseconds = 5_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() >= deadline) { throw new Error(`timed out waiting for ${what}`); }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a slow downstream agent run does not delay the active transition', async () => {
  let releaseAgent: () => void = () => {};
  const agentGate = new Promise<void>((resolve) => { releaseAgent = resolve; });
  let launchEntered = false;
  let boundaryElapsedMs = Number.NaN;
  const { database, store, ports } = await openFixture(async (request) => {
    launchEntered = true;
    // Confirm the spawn, run the boundary the use case supplies, and measure
    // it end to end on the monotonic clock — while the agent run (the
    // destination-state work) is still pending on the gate.
    const startedAtMs = monotonicNowMs();
    await request.onActivated?.(AGENT);
    boundaryElapsedMs = monotonicNowMs() - startedAtMs;
    await agentGate;
    return { agent: AGENT, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
  });
  try {
    const service = new ExecuteMissionService(ports);
    const pending = service.execute({
      operationId: `active:${SLUG}:ordering`,
      slug: SLUG,
      agent: 'claude',
      capabilities: new Set(['active:execute']),
    } as never);

    await until(() => launchEntered, 'the launch to confirm');
    // Downstream work is still running: the committed boundary must already
    // be in the operator database with its lane event.
    const loaded = await store.load(missionId(SLUG));
    assert.equal(loaded.kind, 'found');
    assert.equal(loaded.kind === 'found' ? loaded.mission.status : null, 'active',
      'the destination state commits at the boundary, before the slow work finishes');
    const events = await laneEvents(database);
    assert.deepEqual(events, [{ from_status: 'refined', to_status: 'active', trigger: 'activate' }]);
    // The 200 ms contract, measured end to end with the downstream work slow.
    assert.ok(Number.isFinite(boundaryElapsedMs), 'the boundary persistence was measured');
    assert.ok(boundaryElapsedMs <= LIFECYCLE_DEADLINE_MS,
      `boundary persistence took ${boundaryElapsedMs} ms, over the ${LIFECYCLE_DEADLINE_MS} ms deadline`);

    releaseAgent();
    const outcome = await pending;
    assert.equal(outcome.status, 'completed');
  } finally {
    releaseAgent();
    await database.close();
  }
});

test('a fallback relaunch re-asserts the active boundary with no second lane event', async () => {
  const boundaryAgents: string[] = [];
  const { database, store, ports } = await openFixture(async (request) => {
    // The launcher confirms the first family, then — after a usage block —
    // the replacement family it actually runs.
    if (request.onActivated) {
      boundaryAgents.push(AGENT);
      await request.onActivated(AGENT);
      boundaryAgents.push(FALLBACK_AGENT);
      await request.onActivated(FALLBACK_AGENT);
    }
    return { agent: FALLBACK_AGENT, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
  });
  try {
    const outcome = await new ExecuteMissionService(ports).execute({
      operationId: `active:${SLUG}:fallback`,
      slug: SLUG,
      agent: 'claude',
      capabilities: new Set(['active:execute']),
    } as never);
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(boundaryAgents, [AGENT, FALLBACK_AGENT]);

    const loaded = await store.load(missionId(SLUG));
    assert.equal(loaded.kind, 'found');
    assert.equal(loaded.kind === 'found' ? loaded.mission.status : null, 'active');
    assert.equal(loaded.kind === 'found' ? loaded.mission.assignee : null, FALLBACK_AGENT,
      'the assignee is the family that actually ran');
    // Activation is idempotent on an active lane: the failover re-assert must
    // not invent a second lane event.
    const events = await laneEvents(database);
    assert.deepEqual(events, [{ from_status: 'refined', to_status: 'active', trigger: 'activate' }]);
  } finally {
    await database.close();
  }
});


test('activation deadline includes elapsed work before the boundary callback', async () => {
  let downstreamRan = false;
  const { database, ports } = await openFixture(async (request) => {
    // Mock a launcher whose spawn/bookkeeping already consumed the budget.
    await request.onActivated?.(AGENT, monotonicNowMs() - LIFECYCLE_DEADLINE_MS - 50);
    downstreamRan = true;
    return { agent: AGENT, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
  });
  try {
    const outcome = await new ExecuteMissionService(ports).execute({
      operationId: `active:${SLUG}:late-launch`, slug: SLUG, agent: 'claude',
      capabilities: new Set(['active:execute']),
    } as never);
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error?.message ?? '', /missed the 200 ms/);
    assert.equal(downstreamRan, false);
  } finally { await database.close(); }
});
