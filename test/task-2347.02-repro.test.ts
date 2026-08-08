/**
 * TASK-2347.02 — reproduction: the lifecycle event stream has holes.
 *
 * Mission intake, `integration -> done` and closure all persist the aggregate
 * with `save()`, so no `board_lane_events` row is written for them. Backlog age
 * is therefore unknowable, throughput cannot be derived from events, and the
 * final lane dwell of every mission is truncated.
 *
 * Every test below asserts the intended behaviour: each of the three lifecycle
 * steps leaves exactly one lane event behind. They are red on the parent commit
 * and green once the three services take the transition-aware path.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

/** Drive backlog -> active -> review -> integration through the lifecycle service. */
async function toIntegration(fixture: Fixture, version: MissionVersion): Promise<MissionVersion> {
  const lifecycle = new MissionLifecycleService(fixture.store);
  const activated = await lifecycle.activate({
    operationId: 'op-activate',
    missionId: MISSION,
    expectedVersion: version,
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

describe('TASK-2347.02 lifecycle event stream gaps', () => {
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
    const first = await lifecycle.activate({
      operationId: 'op-activate-1',
      missionId: MISSION,
      capabilities: CAPABILITIES,
      agent: agentFamily('custom'),
      occurredAt: '2026-08-08T01:00:00.100Z',
    });
    assert.equal(first.status, 'completed', JSON.stringify(first));

    // Return the mission to backlog so the next activation is a real lane move
    // rather than the idempotent re-activation that records nothing.
    const active = await fixture.store.load(MISSION);
    assert.equal(active.kind, 'found');
    const found = active as { mission: import('../src/domain/mission.js').Mission; version: MissionVersion };
    await fixture.store.save({ ...found.mission, status: 'backlog', closedAt: null }, found.version);

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
      `${MISSION}:activate:2026-08-08T01:00:00.100Z`,
      `${MISSION}:activate:2026-08-08T01:00:00.900Z`,
    ]);
    await fixture.db.close();
  });

  it('close produces a closure lane event', async () => {
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
    assert.equal(closure.length, 1, 'closure must record exactly one lane event');
    assert.equal(closure[0].occurredAt, '2026-08-08T03:00:00.000Z');
    await fixture.db.close();
  });
});
