/**
 * TASK-2322.05 — the checked Mission application boundary.
 *
 * These tests exercise intake, activation/transition, checkpoint, and handoff
 * use cases against fake ports only: no filesystem, no SQL, no Git. They pin
 * SC1 (intake writes one aggregate with its repository and optional external
 * trace), SC2 (transitions go through the port and refuse invalid decisions and
 * stale revisions), SC3 (checkpoint data round-trips with no path/schema input),
 * SC4 (NEL recorded through the boundary; artifacts stay references), and the
 * SC7 no-persistence rule for the application layer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { missionVersion, MissionStaleVersion } from '../src/application/domain-ports.js';
import type {
  MissionLoadResult,
  MissionTransitionStore,
  MissionVersion,
  MissionNelRecordReceipt,
} from '../src/application/domain-ports.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { MissionCheckpointService } from '../src/application/mission-checkpoint-service.js';
import { MissionHandoffService } from '../src/application/mission-handoff-service.js';
import { agentFamily } from '../src/domain/agents.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import type { CheckpointData } from '../src/domain/checkpoint.js';
import { externalTaskRef, ExternalTaskRefViolation } from '../src/domain/external-task.js';
import {
  intakeMission,
  missionId,
  missionLabels,
  type Mission,
} from '../src/domain/mission.js';
import {
  artifactReference,
  classifyNelBucket,
  missionNelRecord,
  NelRuleViolation,
} from '../src/domain/net-engineering-lines.js';
import { repositoryId } from '../src/domain/repository.js';

const MISSION = missionId('task-2322-05');
const REPOSITORY = repositoryId('parallix');

/** In-memory Mission authority. Records every port call in order. */
class FakeMissionStore implements MissionTransitionStore {
  readonly calls: string[] = [];
  readonly events: LaneTransitionEvent[] = [];
  mission: Mission | null;
  version: MissionVersion = missionVersion(1);
  failNextSave: Error | null = null;

  constructor(mission: Mission | null = null, version = 1) {
    this.mission = mission;
    this.version = missionVersion(version);
  }

  async load(id: string): Promise<MissionLoadResult> {
    this.calls.push(`load:${id}`);
    if (this.mission === null) {
      return { kind: 'missing' };
    }
    return { kind: 'found', mission: this.mission, version: this.version };
  }

  async save(mission: Mission, expectedVersion: MissionVersion | null): Promise<MissionVersion> {
    this.calls.push(`save:${mission.id}:${expectedVersion ?? 'insert'}`);
    if (this.failNextSave) {
      const error = this.failNextSave;
      this.failNextSave = null;
      throw error;
    }
    if (expectedVersion !== null && expectedVersion !== this.version) {
      throw new MissionStaleVersion(mission.id, expectedVersion, this.version);
    }
    this.mission = mission;
    this.version = missionVersion(expectedVersion === null ? 1 : expectedVersion + 1);
    return this.version;
  }

  async saveWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    this.calls.push(`transition:${event.from}->${event.to}:${event.trigger}`);
    const version = await this.save(mission, expectedVersion);
    this.events.push(event);
    return version;
  }
}

function activeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    ...intakeMission({
      id: MISSION,
      repositoryId: REPOSITORY,
      title: 'Route mission intake through application use cases',
      labels: missionLabels(['ai_sdlc']),
      assignee: agentFamily('codex'),
    }),
    status: 'active',
    ...overrides,
  } as Mission;
}

function checkpoint(overrides: Partial<CheckpointData> = {}): CheckpointData {
  return {
    missionId: MISSION,
    name: 'CP-2',
    rawFilename: 'CP-2.md',
    firstLine: 'CP-2: Application boundary defined',
    goalCheck: [
      { criterion: 'Use cases exist', evidence: 'src/application/mission-intake-service.ts:44' },
    ],
    nextActionText: 'Reroute the CLI and controller paths.',
    ...overrides,
  };
}

const ALL_CAPABILITIES = new Set([
  'mission:intake',
  'mission:transition',
  'checkpoint:record',
  'handoff:record',
] as const);

// ---------------------------------------------------------------------------
// SC1 — intake
// ---------------------------------------------------------------------------

test('SC1: intake materializes a Mission with its RepositoryId and external trace, writing one aggregate', async () => {
  const store = new FakeMissionStore();
  const outcome = await new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: '  Route mission intake  ',
    labels: missionLabels(['AI_SDLC', 'ai_sdlc']),
    assignee: agentFamily('codex'),
    rawStatus: 'refined',
    externalTaskRef: externalTaskRef('Backlog', 'TASK-2322.05', 'backlog/tasks/task-2322.05.md'),
    capabilities: ALL_CAPABILITIES,
  });

  assert.equal(outcome.status, 'completed');
  const mission = outcome.value!.mission;
  assert.equal(mission.repositoryId, REPOSITORY);
  assert.equal(mission.title, 'Route mission intake');
  assert.equal(mission.status, 'backlog');
  assert.deepEqual([...mission.labels], ['ai_sdlc']);
  assert.deepEqual(mission.externalTaskRef, {
    source: 'backlog',
    id: 'TASK-2322.05',
    url: 'backlog/tasks/task-2322.05.md',
  });
  // No checkpoint, review, or change-size claim is manufactured at intake, and
  // exactly one aggregate write happens — there is no second task record.
  assert.deepEqual(mission.checkpoints, []);
  assert.equal(mission.review, null);
  assert.equal(mission.netEngineeringLines, null);
  assert.deepEqual(store.calls, [`load:${MISSION}`, `save:${MISSION}:insert`]);
  assert.equal(outcome.value!.version, missionVersion(1));
  assert.equal(outcome.durableEvidence[0].source, 'mission-store');
});

test('SC1: intake without an external reference records no trace field', async () => {
  const store = new FakeMissionStore();
  const outcome = await new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: 'No external material',
    capabilities: ALL_CAPABILITIES,
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.value!.mission.externalTaskRef ?? null, null);
});

test('SC1: an external task reference rejects embedded task content', () => {
  assert.throws(
    () => externalTaskRef('backlog', 'TASK-1\n## Description\nfull task body'),
    ExternalTaskRefViolation,
  );
  assert.throws(() => externalTaskRef('backlog', '   '), ExternalTaskRefViolation);
  assert.throws(() => externalTaskRef('backlog', 'TASK-1', 'x'.repeat(513)), ExternalTaskRefViolation);
});

test('SC1: re-intake of a recorded mission is a conflict, not an overwrite', async () => {
  const store = new FakeMissionStore(activeMission(), 4);
  const outcome = await new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: 'Second intake',
    capabilities: ALL_CAPABILITIES,
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'conflict');
  assert.deepEqual(store.calls, [`load:${MISSION}`]);
  assert.equal(store.mission!.title, 'Route mission intake through application use cases');
});

test('SC1: intake without the capability is rejected before any port call', async () => {
  const store = new FakeMissionStore();
  const outcome = await new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: 'Blocked',
    capabilities: new Set(['checkpoint:record'] as const),
  });
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error!.kind, 'capability');
  assert.deepEqual(store.calls, []);
});

test('SC1: intake rejects an empty title through the domain rule', async () => {
  const store = new FakeMissionStore();
  const outcome = await new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: '   ',
    capabilities: ALL_CAPABILITIES,
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'validation');
  assert.deepEqual(store.calls, []);
});

// ---------------------------------------------------------------------------
// SC2 — activation and lifecycle transitions
// ---------------------------------------------------------------------------

test('SC2: activation loads, decides, and commits the transition with its lane event', async () => {
  const store = new FakeMissionStore(activeMission({ status: 'refined', assignee: null }), 7);
  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.value!.from, 'refined');
  assert.equal(outcome.value!.to, 'active');
  assert.equal(outcome.value!.laneChanged, true);
  assert.equal(outcome.value!.mission.assignee, 'codex');
  assert.equal(outcome.value!.version, missionVersion(8));
  assert.deepEqual(store.calls, [
    `load:${MISSION}`,
    'transition:refined->active:activate',
    `save:${MISSION}:7`,
  ]);
  assert.deepEqual(store.events.map((event) => event.trigger), ['activate']);
  assert.equal(store.events[0].idempotencyKey, `${MISSION}:activate:2026-07-29T12:00:00Z`);
});

test('SC2: an already-active mission records no second lane event', async () => {
  const store = new FakeMissionStore(activeMission(), 2);
  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.value!.laneChanged, false);
  assert.deepEqual(store.events, []);
  assert.deepEqual(store.calls, [`load:${MISSION}`, `save:${MISSION}:2`]);
});

test('SC2: an invalid domain transition is refused and nothing is written', async () => {
  const store = new FakeMissionStore(activeMission({ status: 'done', closedAt: '2026-07-29T09:00:00Z' }), 3);
  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'validation');
  assert.match(outcome.error!.message, /after task-2322-05 was closed/);
  assert.deepEqual(store.calls, [`load:${MISSION}`]);
});

test('SC2: a stale expected version is refused before the domain decides', async () => {
  const store = new FakeMissionStore(activeMission({ status: 'refined' }), 9);
  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    expectedVersion: missionVersion(8),
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'conflict');
  assert.match(outcome.error!.message, /expected version 8, found 9/);
  assert.deepEqual(store.calls, [`load:${MISSION}`]);
});

test('SC2: a stale write raised by the store surfaces as a conflict', async () => {
  const store = new FakeMissionStore(activeMission({ status: 'refined' }), 5);
  store.failNextSave = new MissionStaleVersion(MISSION, missionVersion(5), missionVersion(6));
  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'conflict');
});

test('SC2: an unrecorded mission is unavailable rather than silently created', async () => {
  const store = new FakeMissionStore(null);
  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'unavailable');
  assert.deepEqual(store.calls, [`load:${MISSION}`]);
});

test('SC2: transition without the capability never reaches the port', async () => {
  const store = new FakeMissionStore(activeMission({ status: 'refined' }));
  const outcome = await new MissionLifecycleService(store).activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: new Set(['handoff:record'] as const),
    agent: agentFamily('codex'),
    occurredAt: '2026-07-29T12:00:00Z',
  });
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error!.kind, 'capability');
  assert.deepEqual(store.calls, []);
});

// ---------------------------------------------------------------------------
// SC3 — checkpoint data
// ---------------------------------------------------------------------------

test('SC3: checkpoint data round-trips through the boundary with GoalCheckRow semantics', async () => {
  const store = new FakeMissionStore(activeMission(), 1);
  const service = new MissionCheckpointService(store);
  const recorded = await service.record({
    operationId: 'op-cp',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    checkpoint: checkpoint({
      goalCheck: [
        { criterion: 'Boundary exists', evidence: 'src/application/mission-checkpoint-service.ts:60' },
        { criterion: 'Gate ran', evidence: '`./scripts/verify-local.sh all`' },
      ],
    }),
  });
  assert.equal(recorded.status, 'completed');
  assert.equal(recorded.value!.replaced, false);

  const read = await service.read({
    operationId: 'op-cp-read',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    name: 'CP-2',
  });
  assert.equal(read.status, 'completed');
  assert.deepEqual(read.value!.goalCheck, [
    { criterion: 'Boundary exists', evidence: 'src/application/mission-checkpoint-service.ts:60' },
    { criterion: 'Gate ran', evidence: '`./scripts/verify-local.sh all`' },
  ]);
  assert.equal(read.value!.checkpoints[0].rawFilename, 'CP-2.md');
  assert.equal(read.value!.checkpoints[0].firstLine, 'CP-2: Application boundary defined');
  assert.equal(read.value!.checkpoints[0].nextActionText, 'Reroute the CLI and controller paths.');
});

test('SC3: re-recording a checkpoint replaces it and keeps CP order', async () => {
  const store = new FakeMissionStore(activeMission(), 1);
  const service = new MissionCheckpointService(store);
  await service.record({
    operationId: 'op-cp3', missionId: MISSION, capabilities: ALL_CAPABILITIES,
    checkpoint: checkpoint({ name: 'CP-3', rawFilename: 'CP-3.md' }),
  });
  await service.record({
    operationId: 'op-cp1', missionId: MISSION, capabilities: ALL_CAPABILITIES,
    checkpoint: checkpoint({ name: 'CP-1', rawFilename: 'CP-1.md' }),
  });
  const replaced = await service.record({
    operationId: 'op-cp3b', missionId: MISSION, capabilities: ALL_CAPABILITIES,
    checkpoint: checkpoint({
      name: 'CP-3',
      rawFilename: 'CP-3.md',
      nextActionText: 'Run the declared gate.',
    }),
  });
  assert.equal(replaced.status, 'completed');
  assert.equal(replaced.value!.replaced, true);
  assert.deepEqual(store.mission!.checkpoints.map((cp) => cp.name), ['CP-1', 'CP-3']);
  assert.equal(store.mission!.checkpoints[1].nextActionText, 'Run the declared gate.');
});

test('SC3: checkpoint evidence from another mission and empty Goal Checks are refused', async () => {
  const store = new FakeMissionStore(activeMission(), 1);
  const service = new MissionCheckpointService(store);
  const foreign = await service.record({
    operationId: 'op-cp', missionId: MISSION, capabilities: ALL_CAPABILITIES,
    checkpoint: checkpoint({ missionId: missionId('task-9999') }),
  });
  assert.equal(foreign.status, 'failed');
  assert.equal(foreign.error!.kind, 'validation');

  const empty = await service.record({
    operationId: 'op-cp', missionId: MISSION, capabilities: ALL_CAPABILITIES,
    checkpoint: checkpoint({ goalCheck: [] }),
  });
  assert.equal(empty.status, 'failed');
  assert.match(empty.error!.message, /at least one Goal Check row/);

  const noAction = await service.record({
    operationId: 'op-cp', missionId: MISSION, capabilities: ALL_CAPABILITIES,
    checkpoint: checkpoint({ nextActionText: '   ' }),
  });
  assert.equal(noAction.status, 'failed');
  assert.deepEqual(store.calls, []);
});

test('SC3: the checkpoint request carries no persistence path or SQL input', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/application/mission-checkpoint-service.ts'),
    'utf8',
  );
  for (const forbidden of ['node:fs', 'node:path', 'missionDir', 'filePath', 'SELECT ', 'INSERT ']) {
    assert.ok(!source.includes(forbidden), `checkpoint use case must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// SC4 — handoff NEL and artifact references
// ---------------------------------------------------------------------------

test('SC4: handoff records NEL through the boundary and reports the derived record', async () => {
  const store = new FakeMissionStore(activeMission(), 3);
  const receipts: string[] = [];
  const recorder = {
    async recordNel(record: { netEngineeringLines: number }): Promise<MissionNelRecordReceipt> {
      receipts.push(`recorded:${record.netEngineeringLines}`);
      return { reference: 'missions/task-2322-05/nel-record.json' };
    },
  };
  const outcome = await new MissionHandoffService(store, recorder).recordNel({
    operationId: 'op-handoff',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    netEngineeringLines: 412,
    predictedBucket: 'Large',
    reviewRounds: 3,
    capturedAt: '2026-07-29T13:00:00Z',
    artifacts: [artifactReference('git-range', 'main..HEAD', 1_048_576)],
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(store.mission!.netEngineeringLines, 412);
  assert.deepEqual(store.calls, [`load:${MISSION}`, `save:${MISSION}:3`]);
  assert.deepEqual(receipts, ['recorded:412']);
  assert.deepEqual(outcome.value!.record, {
    missionId: MISSION,
    predictedBucket: 'Large',
    netEngineeringLines: 412,
    actualBucket: 'Large',
    reviewRounds: 3,
    capturedAt: '2026-07-29T13:00:00Z',
    artifacts: [{ kind: 'git-range', location: 'main..HEAD', byteSize: 1_048_576 }],
  });
  assert.equal(outcome.value!.recordReference, 'missions/task-2322-05/nel-record.json');
  assert.deepEqual(outcome.durableEvidence.at(-1), {
    id: `${MISSION}:handoff:nel-report`,
    source: 'mission-store',
    detail: 'structured NEL report recorded at missions/task-2322-05/nel-record.json',
  });
});

test('SC4: a large generated artifact is carried as a locator, never as content', () => {
  const oneMegabyteDiff = 'x'.repeat(1_048_576);
  assert.throws(() => artifactReference('file', oneMegabyteDiff, oneMegabyteDiff.length), NelRuleViolation);
  assert.throws(() => artifactReference('file', 'diff line 1\ndiff line 2'), NelRuleViolation);
  assert.throws(() => artifactReference('file', '   '), NelRuleViolation);
  const reference = artifactReference('file', 'proofs/task-2322-05/gate.log', 5_242_880);
  assert.deepEqual(reference, {
    kind: 'file',
    location: 'proofs/task-2322-05/gate.log',
    byteSize: 5_242_880,
  });
  // The whole reference stays orders of magnitude smaller than the artifact.
  assert.ok(JSON.stringify(reference).length < 200);
});

test('SC4: a failed NEL report reports the durable evidence that exists and claims no rollback', async () => {
  const store = new FakeMissionStore(activeMission(), 3);
  const outcome = await new MissionHandoffService(store, {
    async recordNel(): Promise<MissionNelRecordReceipt> {
      throw new Error('injected NEL persistence failure');
    },
  }).recordNel({
    operationId: 'op-handoff',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    netEngineeringLines: 12,
    capturedAt: '2026-07-29T13:00:00Z',
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'execution');
  assert.match(outcome.error!.message, /injected NEL persistence failure/);
  assert.equal(outcome.durableEvidence.length, 1);
  assert.match(outcome.durableEvidence[0].detail, /12 NEL \(Small\)/);
  assert.equal(store.mission!.netEngineeringLines, 12);
});

test('SC4: a negative NEL is refused by the domain and never written', async () => {
  const store = new FakeMissionStore(activeMission(), 3);
  const outcome = await new MissionHandoffService(store).recordNel({
    operationId: 'op-handoff',
    missionId: MISSION,
    capabilities: ALL_CAPABILITIES,
    netEngineeringLines: -1,
    capturedAt: '2026-07-29T13:00:00Z',
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error!.kind, 'validation');
  assert.deepEqual(store.calls, [`load:${MISSION}`]);
});

test('SC4: NEL buckets follow the ADR 0047 terciles and review rounds derive from the review', () => {
  assert.equal(classifyNelBucket(0).label, 'Small');
  assert.equal(classifyNelBucket(80).label, 'Small');
  assert.equal(classifyNelBucket(81).label, 'Medium');
  assert.equal(classifyNelBucket(235).label, 'Medium');
  assert.equal(classifyNelBucket(236).label, 'Large');

  const withNel = { ...activeMission(), netEngineeringLines: 100 } as Mission;
  assert.equal(missionNelRecord(withNel, { capturedAt: 'now' }).reviewRounds, 1);
  assert.throws(
    () => missionNelRecord(activeMission(), { capturedAt: 'now' }),
    NelRuleViolation,
  );
  assert.throws(
    () => missionNelRecord(withNel, { capturedAt: 'now', reviewRounds: 0 }),
    NelRuleViolation,
  );
});

// ---------------------------------------------------------------------------
// SC7 — no filesystem or SQL persistence in the covered application modules
// ---------------------------------------------------------------------------

test('SC7: the Mission use cases reach persistence only through the application ports', () => {
  const forbidden = /from\s+'node:(?:fs|path|child_process|sqlite)'|node:sqlite|CREATE TABLE|INSERT INTO|SELECT .* FROM|writeFileSync|readFileSync/;
  for (const file of [
    'mission-intake-service.ts',
    'mission-lifecycle-service.ts',
    'mission-checkpoint-service.ts',
    'mission-handoff-service.ts',
    'mission-command-support.ts',
    'controller/board-controller.ts',
    'controller/board-command.ts',
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/application', file), 'utf8');
    assert.doesNotMatch(source, forbidden, `${file} must delegate persistence to a port`);
  }
});
