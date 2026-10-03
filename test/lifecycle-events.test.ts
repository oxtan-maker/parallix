// Historical regression provenance: TASK-2347.02.
/**
 * Lifecycle event stream for the metrics slice (TASK-2622.13 consolidation).
 *
 * integration-ci tier provenance test migrated from
 * `test/task-2347.02-repro.test.ts` (TASK-2347.02): every lifecycle transition
 * leaves exactly one gap-free, ordered lane event behind, and closure records
 * its timestamp without inventing a done -> done move. These drive the real
 * application use cases against a migrated SQLite fixture, so they stay in the
 * integration-ci lane. Historical task ID retained in the case name as
 * regression provenance (AC#7).
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MissionBriefService } from '../src/application/mission-brief-service.js';
import { MissionCheckpointService } from '../src/application/mission-checkpoint-service.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import type { MissionVersion } from '../src/application/domain-ports.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

/**
 * TASK-2347.02 — reproduction: the lifecycle event stream has holes.
 *
 * Mission intake and `integration -> done` need lane events so backlog age
 * and throughput can be derived from the event stream. Closure records its
 * timestamp on the aggregate without changing lanes.
 *
 * Every lane transition below leaves exactly one event behind.
 */



/**
 * Draft settles the contract activation demands: a goal, a why, a scope and at
 * least one verification gate (`requireDraftedContract` in mission-workflow.ts).
 * A fixture that activates without it is not a mission the workflow can produce.
 */
async function seedDraftedContract(store: never, mission: never): Promise<number> {
  const briefService = new MissionBriefService(store as never);
  await briefService.update({
    operationId: 'op-brief', missionId: mission,
    capabilities: new Set(['mission:context']),
    patch: { goal: 'Fixture goal', why: 'Fixture why', scope: 'Fixture scope' },
  } as never);
  await briefService.setGates({
    operationId: 'op-gates', missionId: mission,
    capabilities: new Set(['mission:context']), gates: ['npm test'],
  } as never);
  await briefService.setSuccessCriteria({
    operationId: 'op-criteria', missionId: mission,
    capabilities: new Set(['mission:context']), criteria: ['The fixture mission is done'],
  } as never);
  await briefService.setPredictedNelBucket({
    operationId: 'op-nel', missionId: mission,
    capabilities: new Set(['mission:context']), bucket: 'Small',
  } as never);
  const plan = await new MissionCheckpointService(store as never).plan({
    operationId: 'op-plan', missionId: mission,
    capabilities: new Set(['mission:context']), name: 'CP-1', description: 'Do the fixture work',
  } as never);
  // Recording the contract advances the Mission, so the caller activates
  // against the version the seeding produced rather than the one before it.
  return (plan as { value: { version: number } }).value.version;
}

const MISSION = missionId('task-2347.02-fixture');
const REPOSITORY = repositoryId('parallix');
const CAPABILITIES = new Set([
  'mission:intake',
  'mission:transition',
  'integration:decide',
  'closure:record',
] as const);

const temporaryDirectories: string[] = [];

interface Fixture {
  readonly store: SqliteMissionStore;
  readonly events: SqliteBoardLaneEventRepository;
  readonly db: SqliteDatabaseAdapter;
}

/** One database per test: an isolated fixture, never the operator database. */
async function isolatedStore(): Promise<Fixture> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2347-02-'));
  temporaryDirectories.push(directory);
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(directory, 'fixture.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return { store: new SqliteMissionStore(db), events: new SqliteBoardLaneEventRepository(db), db };
}

async function intake(fixture: Fixture, occurredAt: string): Promise<MissionVersion> {
  const outcome = await new MissionIntakeService(fixture.store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: 'Close the gaps in the lifecycle event stream',
    labels: missionLabels(['ai_sdlc']),
    assignee: agentFamily('custom'),
    occurredAt,
    capabilities: CAPABILITIES,
  });
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));
  return (outcome as { value: { version: MissionVersion } }).value.version;
}

/** Drive backlog -> refined -> active -> review -> integration through the lifecycle service. */
async function toIntegration(fixture: Fixture, _intakeVersion: MissionVersion): Promise<MissionVersion> {
  const lifecycle = new MissionLifecycleService(fixture.store);
  // Intake materializes the mission as `backlog`; activation demands `refined`,
  // and refine demands the contract the draft records.
  const contractVersion = await seedDraftedContract(fixture.store as never, MISSION as never);
  const refined = await lifecycle.transition({
    operationId: 'op-refine',
    missionId: MISSION,
    expectedVersion: contractVersion as MissionVersion,
    capabilities: CAPABILITIES,
    command: { type: 'refine' },
    actor: agentFamily('custom'),
    occurredAt: '2026-08-08T00:30:00.000Z',
  });
  assert.equal(refined.status, 'completed', JSON.stringify(refined));
  const activated = await lifecycle.activate({
    operationId: 'op-activate',
    missionId: MISSION,
    expectedVersion: (refined as { value: { version: MissionVersion } }).value.version,
    capabilities: CAPABILITIES,
    agent: agentFamily('custom'),
    occurredAt: '2026-08-08T01:00:00.000Z',
  });
  assert.equal(activated.status, 'completed', JSON.stringify(activated));
  const activeVersion = (activated as { value: { version: MissionVersion } }).value.version;

  // The review lane requires a Review, which this reproduction does not model;
  // the aggregate is moved through the store the same way the review path does.
  const loaded = await fixture.store.load(MISSION);
  assert.equal(loaded.kind, 'found');
  const found = loaded as { mission: import('../src/domain/mission.js').Mission };
  const integrationVersion = await fixture.store.save(
    { ...found.mission, status: 'integration', closedAt: null },
    activeVersion,
  );
  return integrationVersion;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("lifecycle event stream gaps", () => {
  it('intake produces a backlog-entry lane event', async () => {
    const fixture = await isolatedStore();
    await intake(fixture, '2026-08-08T00:00:00.000Z');

    const rows = await fixture.events.findByMissionId(MISSION);
    assert.equal(rows.length, 1, 'intake must record exactly one lane event');
    assert.equal(rows[0].fromStatus, null);
    assert.equal(rows[0].toStatus, 'backlog');
    assert.equal(rows[0].occurredAt, '2026-08-08T00:00:00.000Z');
    await fixture.db.close();
  });

  it('decideIntegration produces an integration-to-done lane event', async () => {
    const fixture = await isolatedStore();
    const version = await intake(fixture, '2026-08-08T00:00:00.000Z');
    const integrationVersion = await toIntegration(fixture, version);

    const outcome = await new MissionIntegrationService(fixture.store).decideIntegration({
      operationId: 'op-integrate',
      missionId: MISSION,
      expectedVersion: integrationVersion,
      capabilities: CAPABILITIES,
      occurredAt: '2026-08-08T02:00:00.000Z',
      facts: {
        git: { source: 'git', status: 'fresh', value: { merged: true } },
        verification: { source: 'stats', status: 'fresh', value: { passed: true } },
      },
    });
    assert.equal(outcome.status, 'completed', JSON.stringify(outcome));

    const rows = await fixture.events.findByMissionId(MISSION);
    const done = rows.filter((row) => row.toStatus === 'done' && row.fromStatus === 'integration');
    assert.equal(done.length, 1, 'integration -> done must record exactly one lane event');
    assert.equal(done[0].trigger, 'integrate');
    await fixture.db.close();
  });

  it('replaying one transition appends one row while distinct transitions never collide', async () => {
    const fixture = await isolatedStore();
    await intake(fixture, '2026-08-08T00:00:00.000Z');

    // Replay: the same intake identity, same occurrence time. The deterministic
    // key makes the second attempt a conflict, not a second row.
    const replay = await new MissionIntakeService(fixture.store).execute({
      operationId: 'op-intake-replay',
      missionId: MISSION,
      repositoryId: REPOSITORY,
      title: 'Close the gaps in the lifecycle event stream',
      labels: missionLabels(['ai_sdlc']),
      assignee: agentFamily('custom'),
      occurredAt: '2026-08-08T00:00:00.000Z',
      capabilities: CAPABILITIES,
    });
    assert.notEqual(replay.status, 'completed');
    assert.equal((await fixture.events.findByMissionId(MISSION)).length, 1);

    // Two genuinely distinct transitions share missionId and trigger and differ
    // only in occurrence time: both are recorded. The retired wall-clock key
    // (`slug-from-to-<epoch seconds>`) dropped the second one whenever the two
    // fell inside the same second — these two are 800ms apart.
    const lifecycle = new MissionLifecycleService(fixture.store);
    // Activation demands `refined`, and intake materializes `backlog`.
    await seedDraftedContract(fixture.store as never, MISSION as never);
    const refined = await lifecycle.transition({
      operationId: 'op-refine',
      missionId: MISSION,
      capabilities: CAPABILITIES,
      command: { type: 'refine' },
      actor: agentFamily('custom'),
      occurredAt: '2026-08-08T00:30:00.000Z',
    });
    assert.equal(refined.status, 'completed', JSON.stringify(refined));
    const first = await lifecycle.activate({
      operationId: 'op-activate-1',
      missionId: MISSION,
      capabilities: CAPABILITIES,
      agent: agentFamily('custom'),
      occurredAt: '2026-08-08T01:00:00.100Z',
    });
    assert.equal(first.status, 'completed', JSON.stringify(first));

    // Return the mission to refined so the next activation is a real lane move
    // rather than the idempotent re-activation that records nothing.
    const active = await fixture.store.load(MISSION);
    assert.equal(active.kind, 'found');
    const found = active as { mission: import('../src/domain/mission.js').Mission; version: MissionVersion };
    await fixture.store.save({ ...found.mission, status: 'refined', closedAt: null }, found.version);

    const second = await lifecycle.activate({
      operationId: 'op-activate-2',
      missionId: MISSION,
      capabilities: CAPABILITIES,
      agent: agentFamily('codex'),
      occurredAt: '2026-08-08T01:00:00.900Z',
    });
    assert.equal(second.status, 'completed', JSON.stringify(second));

    const keys = (await fixture.events.findByMissionId(MISSION)).map((row) => row.idempotencyKey);
    assert.deepEqual(keys, [
      `${MISSION}:intake:2026-08-08T00:00:00.000Z`,
      `${MISSION}:refine:2026-08-08T00:30:00.000Z`,
      `${MISSION}:activate:2026-08-08T01:00:00.100Z`,
      `${MISSION}:activate:2026-08-08T01:00:00.900Z`,
    ]);
    await fixture.db.close();
  });

  it('close records its timestamp without a same-lane event', async () => {
    const fixture = await isolatedStore();
    const version = await intake(fixture, '2026-08-08T00:00:00.000Z');
    const integrationVersion = await toIntegration(fixture, version);
    const integration = new MissionIntegrationService(fixture.store);
    const integrated = await integration.decideIntegration({
      operationId: 'op-integrate',
      missionId: MISSION,
      expectedVersion: integrationVersion,
      capabilities: CAPABILITIES,
      occurredAt: '2026-08-08T02:00:00.000Z',
      facts: {
        git: { source: 'git', status: 'fresh', value: { merged: true } },
        verification: { source: 'stats', status: 'fresh', value: { passed: true } },
      },
    });
    assert.equal(integrated.status, 'completed', JSON.stringify(integrated));
    const doneVersion = (integrated as { value: { version: MissionVersion } }).value.version;

    const closed = await integration.close({
      operationId: 'op-close',
      missionId: MISSION,
      expectedVersion: doneVersion,
      capabilities: CAPABILITIES,
      integration: { source: 'git', status: 'fresh', value: { completed: true } },
      closedAt: '2026-08-08T03:00:00.000Z',
    });
    assert.equal(closed.status, 'completed', JSON.stringify(closed));

    const rows = await fixture.events.findByMissionId(MISSION);
    const closure = rows.filter((row) => row.trigger === 'close');
    assert.equal(closure.length, 0, 'closure must not record a done -> done lane event');
    const reloaded = await fixture.store.load(MISSION);
    assert.equal(reloaded.kind, 'found');
    assert.equal((reloaded as { mission: { closedAt: string | null } }).mission.closedAt, '2026-08-08T03:00:00.000Z');
    await fixture.db.close();
  });
});
