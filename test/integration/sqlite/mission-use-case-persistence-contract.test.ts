import { repairCheckpointFlowCases } from './repair-checkpoint-flow.cases.js';
repairCheckpointFlowCases();
// Mission use-case persistence contract: Mission use cases over SQLite and lifecycle write ordering.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Mission use cases: TASK-2322.05
//   Lifecycle ordering: TASK-2582

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { missionVersion, MissionStaleVersion, MissionLoadResult, MissionTransitionStore, MissionVersion, MissionNelRecordReceipt } from '../../../src/application/domain-ports.js';
import { MissionIntakeService } from '../../../src/application/mission-intake-service.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { MissionBriefService } from '../../../src/application/mission-brief-service.js';
import { MissionHandoffService } from '../../../src/application/mission-handoff-service.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { LaneTransitionEvent } from '../../../src/domain/board-event.js';
import { CheckpointData } from '../../../src/domain/checkpoint.js';
import { externalTaskRef, ExternalTaskRefViolation } from '../../../src/domain/external-task.js';
import { intakeMission, missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { artifactReference, classifyNelBucket, missionNelRecord, NelRuleViolation } from '../../../src/domain/net-engineering-lines.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { MissionBrief } from '../../../src/domain/mission-brief.js';
import { ExecuteMissionService } from '../../../src/application/execute-mission-service.js';
import { ExecuteMissionPorts } from '../../../src/application/ports/execute-mission.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { openMigratedMissionStore, type MigratedMissionStore } from '../../fixtures/mission-sqlite-store.js';

// TASK-2322.05 (was this suite (Mission use cases section))
describe('Mission use cases', () => {
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
      // Activation refuses an incomplete contract, so any mission this fixture
      // activates carries what draft settles (requireDraftedContract).
      brief: { goal: 'Route mission intake through application use cases', why: 'Fixture', scope: 'Fixture scope', outOfScope: [] },
      declaredGates: ['npm test'],
      successCriteria: ['The mission is done'],
      predictedNelBucket: 'Small',
      // A planned checkpoint with no evidence yet: draft plans, execution records.
      checkpoints: [{ missionId: MISSION, name: 'CP-1', firstLine: 'Do the work', goalCheck: [], nextActionText: '' }],
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
        { criterion: 'The mission is done', evidence: 'src/application/mission-intake-service.ts:44' },
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
  const CONTEXT_CAPABILITIES = new Set(['mission:context'] as const);

  function brief(overrides: Partial<MissionBrief> = {}): MissionBrief {
    return {
      goal: 'Persist the mission brief', why: 'Restart-safe mission launch needs it.',
      scope: 'Mission aggregate only.', outOfScope: ['A second Mission model'],
      ...overrides,
    };
  }

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
    // exactly one aggregate write happens — there is no second task record. That
    // write is the transition-aware one: entry into the first lane carries its
    // lane event (TASK-2347.02).
    assert.deepEqual(mission.checkpoints, []);
    assert.equal(mission.review, null);
    assert.equal(mission.netEngineeringLines, null);
    assert.deepEqual(store.calls, [
      `load:${MISSION}`,
      'transition:null->backlog:intake',
      `save:${MISSION}:insert`,
    ]);
    assert.deepEqual(store.events.map((event) => ({ from: event.from, to: event.to, trigger: event.trigger })), [
      { from: null, to: 'backlog', trigger: 'intake' },
    ]);
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
    const store = new FakeMissionStore(activeMission({ successCriteria: ['Boundary exists', 'Gate ran'] }), 1);
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

  test('rejects blank Goal Check criterion before mutation or persistence (TASK-2634)', async () => {
    for (const criterion of ['', '   ', '\t\n']) {
      const store = new FakeMissionStore(activeMission(), 1);
      const service = new MissionCheckpointService(store);
      const outcome = await service.record({
        operationId: 'op-blank-criterion', missionId: MISSION, capabilities: ALL_CAPABILITIES,
        checkpoint: checkpoint({ goalCheck: [{ criterion: 'Fine', evidence: '`npm test`' }, { criterion, evidence: '`npm test`' }] }),
      });
      assert.equal(outcome.status, 'failed');
      assert.equal(outcome.error!.kind, 'validation');
      assert.equal(outcome.error!.message, 'Checkpoint goal criterion must not be empty');
      assert.deepEqual(store.calls, []);
      assert.deepEqual(store.mission!.checkpoints, activeMission().checkpoints);
    }
  });

  test('rejects blank Goal Check evidence before mutation or persistence (TASK-2634)', async () => {
    for (const evidence of ['', '   ', '\t\n']) {
      const store = new FakeMissionStore(activeMission(), 1);
      const service = new MissionCheckpointService(store);
      const outcome = await service.record({
        operationId: 'op-blank-evidence', missionId: MISSION, capabilities: ALL_CAPABILITIES,
        checkpoint: checkpoint({ goalCheck: [{ criterion: 'Fine', evidence }] }),
      });
      assert.equal(outcome.status, 'failed');
      assert.equal(outcome.error!.kind, 'validation');
      assert.equal(outcome.error!.message, 'Checkpoint goal evidence must not be empty');
      assert.deepEqual(store.calls, []);
      assert.deepEqual(store.mission!.checkpoints, activeMission().checkpoints);
    }
  });

  test('records a Goal Check with non-empty criterion and evidence (TASK-2634)', async () => {
    const store = new FakeMissionStore(activeMission(), 1);
    const service = new MissionCheckpointService(store);
    const outcome = await service.record({
      operationId: 'op-nonblank', missionId: MISSION, capabilities: ALL_CAPABILITIES,
      checkpoint: checkpoint({ goalCheck: [{ criterion: 'The mission is done', evidence: '`npm test`' }] }),
    });
    assert.equal(outcome.status, 'completed');
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
  // Mission brief and declared gates
  // ---------------------------------------------------------------------------

  test('the brief writes then reads the same facts through the application boundary', async () => {
    const store = new FakeMissionStore(activeMission({ brief: null, declaredGates: [] }), 1);
    const service = new MissionBriefService(store);
    const written = await service.update({ operationId: 'brief-write', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, patch: brief() });
    assert.equal(written.status, 'completed');
    assert.deepEqual(written.value!.brief, brief());
    const read = await service.read({ operationId: 'brief-read', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES });
    assert.equal(read.status, 'completed');
    assert.deepEqual(read.value!.brief, brief());
    assert.equal(read.value!.version, missionVersion(2));
  });

  test('a partial brief update preserves the fields it omits', async () => {
    const store = new FakeMissionStore(activeMission({ brief: null, declaredGates: [] }), 1);
    const service = new MissionBriefService(store);
    await service.update({ operationId: 'a', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, patch: brief() });
    const scoped = await service.update({ operationId: 'b', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, patch: { scope: 'Narrowed.' } });
    assert.equal(scoped.status, 'completed');
    assert.equal(scoped.value!.brief.scope, 'Narrowed.');
    assert.equal(scoped.value!.brief.goal, brief().goal, 'the goal survives a scope-only write');
  });

  test('the first brief write must supply both goal and why', async () => {
    const store = new FakeMissionStore(activeMission({ brief: null, declaredGates: [] }), 1);
    const service = new MissionBriefService(store);
    const partial = await service.update({ operationId: 'x', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, patch: { goal: 'Only a goal' } });
    assert.equal(partial.error!.kind, 'validation');
    assert.match(partial.error!.message, /must set both --goal and --why/);
  });

  test('the brief rejects missing capability, invalid facts, stale writes, and an absent brief', async () => {
    const store = new FakeMissionStore(activeMission({ brief: null, declaredGates: [] }), 2);
    const service = new MissionBriefService(store);
    const missing = await service.update({ operationId: 'x', missionId: MISSION, capabilities: new Set(), patch: brief() });
    assert.equal(missing.error!.kind, 'capability');
    const invalid = await service.update({ operationId: 'x', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, patch: brief({ goal: '  ' }) });
    assert.equal(invalid.error!.kind, 'validation');
    const stale = await service.update({ operationId: 'x', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, expectedVersion: missionVersion(1), patch: brief() });
    assert.equal(stale.error!.kind, 'conflict');
    const absent = await service.read({ operationId: 'x', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES });
    assert.equal(absent.error!.kind, 'unavailable');
  });

  test('declared gates round-trip and reject a duplicate command', async () => {
    const store = new FakeMissionStore(activeMission({ brief: null, declaredGates: [] }), 1);
    const service = new MissionBriefService(store);
    const empty = await service.readGates({ operationId: 'g0', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES });
    assert.deepEqual(empty.value!.declaredGates, [], 'a mission with no declared gates reports none');
    const set = await service.setGates({ operationId: 'g1', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, gates: ['npm test', './scripts/verify-local.sh all'] });
    assert.deepEqual(set.value!.declaredGates, ['npm test', './scripts/verify-local.sh all'], 'order is preserved');
    const duplicate = await service.setGates({ operationId: 'g2', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES, gates: ['npm test', 'npm test'] });
    assert.equal(duplicate.error!.kind, 'validation');
    const unchanged = await service.readGates({ operationId: 'g3', missionId: MISSION, capabilities: CONTEXT_CAPABILITIES });
    assert.deepEqual(unchanged.value!.declaredGates, ['npm test', './scripts/verify-local.sh all'], 'the rejected write changed nothing');
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
});

// TASK-2582 (was test/unit/domain/mission-activation-launch-order.test.ts)
describe('Lifecycle ordering', () => {
  // TASK-2582 CP-5 — regression coverage for lifecycle transition ordering,
  // with external boundaries (the agent run) mocked and made slow.
  //
  // The companion coverage this file relies on:
  //   - multi-round review: test/integration/integrate/workflow-repair-lane-boundaries.test.ts
  //   - approval replay without duplicate lane events:
  //     test/integration/integrate/workflow-repair-lane-boundaries.test.ts 'approval replay emits no duplicate lane event',
  //     test/unit/domain/mission-handoff-lane-events-contract.test.ts
  //   - stale versions never overwriting state:
  //     this suite (Mission use cases section) 'SC2: a stale expected
  //     version is refused before the domain decides' and 'SC2: a stale write
  //     raised by the store surfaces as a conflict'
  //   - done only after all integration work succeeds:
  //     test/unit/domain/integration-mode-dispatch-contract.test.ts (decideIntegration requires
  //     fresh merged Git and passing verification facts)
  //   - resume/recovery: test/integration/integrate/integrate-lifecycle-recovery-and-closeout-contract.test.ts,
  //     test/integration/integrate/integration-provider-approval-recovery.test.ts,
  //     test/unit/interfaces/cli/recover-command.test.ts



  const SLUG = 'task-2582-ordering';
  const AGENT = agentFamily('claude');
  const FALLBACK_AGENT = agentFamily('codex');

  /** A refined mission carrying the full drafted contract: activatable. */
  function seedMission(): Mission {
    return fixtureMission(SLUG, {
      status: 'refined',
      brief: { goal: 'Goal', why: 'Why', scope: 'Scope', outOfScope: [] },
      declaredGates: ['npm test'],
      successCriteria: ['The mission is done'],
      predictedNelBucket: 'Small',
    });
  }

  interface Fixture extends MigratedMissionStore {
    /** Inert mechanism ports over the real mission store. */
    readonly ports: ExecuteMissionPorts;
  }

  async function openFixture(
    launch: (_request: { onAgentChanged?: (_agent: string) => Promise<void> }) => Promise<{
      agent: string; rebaseDeferred: boolean; errored: boolean; errorMessage: string | null; exitStatus: number | null; detail: unknown;
    }>,
    mission: Mission = seedMission(),
  ): Promise<Fixture> {
    const migrated = await openMigratedMissionStore([mission]);
    const { store } = migrated;
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
      checkpointValidation: { async validateBeforeHandoff() { return { ok: true }; } },
      handoffExecution: {
        async run() { return { ok: true }; },
        async repairHygiene() { return { repaired: false }; },
        classifyFailure() { return null; },
        isRelaunchableFailure() { return false; },
      },
      autonomousReview: { async start() {} },
      repairLaunch: {
        async launch() { return {}; },
        available() { return { supported: true }; },
        readHead() { return null; },
      },
      output: { log() {}, error() {}, command(value: string) { return value; }, formatSlug(value: string) { return value; }, formatAgent(value: string) { return value; } },
    } as unknown as ExecuteMissionPorts;
    return { ...migrated, ports };
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
    const { store, ports, laneEvents, close } = await openFixture(async (request) => {
      launchEntered = true;
      // Activation is committed before the launcher enters provider work.
      assert.equal(request.onAgentChanged instanceof Function, true);
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
      const events = await laneEvents(SLUG);
      assert.deepEqual(events, [{ from_status: 'refined', to_status: 'active', trigger: 'activate' }]);
      releaseAgent();
      const outcome = await pending;
      assert.equal(outcome.status, 'completed');
    } finally {
      releaseAgent();
      await close();
    }
  });

  test('a fallback relaunch re-asserts the active boundary with no second lane event', async () => {
    const boundaryAgents: string[] = [];
    const { store, ports, laneEvents, close } = await openFixture(async (request) => {
      // The launch was pre-activated for the selected family. After a usage
      // block, the replacement family updates the authoritative assignee.
      if (request.onAgentChanged) {
        boundaryAgents.push(AGENT);
        await request.onAgentChanged(AGENT);
        boundaryAgents.push(FALLBACK_AGENT);
        await request.onAgentChanged(FALLBACK_AGENT);
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
      const events = await laneEvents(SLUG);
      assert.deepEqual(events, [{ from_status: 'refined', to_status: 'active', trigger: 'activate' }]);
    } finally {
      await close();
    }
  });


  test('an immediate activation blocker stops before launching the agent', async () => {
    let launched = false;
    const { store, ports, laneEvents, close } = await openFixture(async () => {
      launched = true;
      return { agent: AGENT, rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
    }, { ...seedMission(), status: 'backlog', rawStatus: 'backlog' } as Mission);
    try {
      const outcome = await new ExecuteMissionService(ports).execute({
        operationId: `active:${SLUG}:blocked`, slug: SLUG, agent: 'claude',
        capabilities: new Set(['active:execute']),
      } as never);
      assert.equal(outcome.status, 'failed');
      assert.equal(launched, false);
      const loaded = await store.load(missionId(SLUG));
      assert.equal(loaded.kind === 'found' ? loaded.mission.status : null, 'backlog');
      assert.deepEqual(await laneEvents(SLUG), []);
    } finally { await close(); }
  });
});
