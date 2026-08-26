// TASK-2402: `px status <slug>` must answer from a focused mission read rather
// than building the whole board. These tests observe the read boundary itself —
// which adapter calls happen — not elapsed time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoardProjectionBuilder,
  type AgentReadAdapter,
  type GateReadAdapter,
  type GitReadAdapter,
  type MissionReadAdapter,
  type OperationLogReadAdapter,
  type ReviewReadAdapter,
  type ReviewProjectionFact,
} from '../src/application/projections/board-readers.js';
import { CURRENT_WORK_EVENT_TYPE, type CurrentWorkEvent } from '../src/application/recording/current-work-recorder.js';
import { ConcreteCurrentWorkReadAdapter } from '../src/adapters/backlog/concrete-current-work-read-adapter.js';
import { createStatusBoardAdapter } from '../src/adapters/cli/commands/status-adapter.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission, type MissionId } from '../src/domain/mission.js';
import { changeRevision, reviewFindingId, type Review, type ReviewRound } from '../src/domain/review.js';
import { repositoryId } from '../src/domain/repository.js';

const repo = repositoryId('parallix');
const selectedId = missionId('task-2402');
const unrelatedIds = ['task-9001', 'task-9002', 'task-9003', 'task-9004'].map(missionId);

/** Every adapter call the focused path may make, recorded for boundary assertions. */
interface ReadLedger {
  loadAllMissionsCalls: number;
  loadedMissionIds: MissionId[];
  materializedMissionIds: MissionId[];
  reviewRequests: MissionId[][];
  gateRequests: MissionId[];
  operationLogCalls: number;
  repositoryIdCalls: number;
  agentAvailabilityCalls: number;
  currentWorkRequests: MissionId[];
}

function newLedger(): ReadLedger {
  return {
    loadAllMissionsCalls: 0,
    loadedMissionIds: [],
    materializedMissionIds: [],
    reviewRequests: [],
    gateRequests: [],
    operationLogCalls: 0,
    repositoryIdCalls: 0,
    agentAvailabilityCalls: 0,
    currentWorkRequests: [],
  };
}

function checkpoint(id: MissionId) {
  return {
    missionId: id,
    name: 'CP-2',
    rawFilename: 'CP-2.md',
    firstLine: 'CP-2: focused mission status query',
    goalCheck: [],
    nextActionText: 'Run ./scripts/verify-local.sh all',
  };
}

function missionRecord(id: MissionId, overrides: Partial<Mission> = {}): Mission {
  return {
    id,
    repositoryId: repo,
    title: `Mission ${id}`,
    labels: missionLabels(['user_value']),
    status: 'review',
    rawStatus: 'in_review',
    closedAt: null,
    assignee: agentFamily('codex'),
    checkpoints: [checkpoint(id)],
    review: null,
    netEngineeringLines: null,
    ...overrides,
  } as Mission;
}

/** A two-round review with a settled first round and an approval still owed. */
function reviewFixture(id: MissionId): Review {
  const subject = (revision: string) => ({
    change: { kind: 'local-branch' as const, sourceBranch: `mission/${id}`, targetBranch: 'main' },
    revision: changeRevision(revision),
  });
  const round = (overrides: Partial<ReviewRound> = {}): ReviewRound => ({
    number: 1,
    subject: subject('revision-one'),
    reviewer: agentFamily('codex'),
    implementer: agentFamily('custom'),
    startedAt: '2026-08-24T08:00:00.000Z',
    decision: null,
    response: null,
    phase: 'reviewing',
    disposition: null,
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
    ...overrides,
  });
  const findingId = reviewFindingId('task-2402-finding');
  const disputedId = reviewFindingId('task-2402-disputed');
  return {
    rounds: [
      round({
        decision: {
          kind: 'changes-requested',
          decidedAt: '2026-08-24T08:10:00.000Z',
          comment: 'Focus the read',
          findings: [
            { id: findingId, summary: 'Board build used for one mission', location: null },
            { id: disputedId, summary: 'Unrelated metric work', location: null },
          ],
        },
        response: {
          kind: 'resolved',
          respondedAt: '2026-08-24T08:20:00.000Z',
          resolutions: [
            { findingId, kind: 'fixed', evidence: 'Focused query covers it' },
            { findingId: disputedId, kind: 'disputed', rationale: 'Owned by TASK-2400' },
          ],
          resultingRevision: changeRevision('revision-two'),
        },
        phase: 'pending-approval',
        disposition: 'CHANGES_MADE',
      }),
      round({ number: 2, subject: subject('revision-two'), phase: 'reviewing' }),
    ],
    intervention: null,
    stageLaunches: [],
    reviewEvents: [{
      position: 1,
      eventType: 'blocked_publication',
      roundNumber: 1,
      phase: 'approved',
      actor: 'workflow',
      content: '',
      disposition: null,
      verdict: null,
      itemDispositions: null,
      blockedReason: 'external-formal-approval-owed',
      followUpReference: null,
      createdAt: '2026-08-24T09:01:00.000Z',
    }],
  } as Review;
}

function workEvent(id: MissionId, summary: string): CurrentWorkEvent {
  return {
    missionId: id,
    operationId: `op-${id}`,
    phase: 'execute',
    state: 'running',
    summary,
    agent: agentFamily('codex'),
    processId: null,
    processIdentity: null,
    blockedReason: null,
    occurredAt: '2026-08-24T09:00:00.000Z',
  } as CurrentWorkEvent;
}

/**
 * A builder over a fixture board that contains the selected mission plus four
 * unrelated ones. Every read is recorded so a test can assert which missions
 * were materialized at all.
 */
function makeFixtureBuilder(ledger: ReadLedger) {
  const all = [missionRecord(selectedId, { review: null }), ...unrelatedIds.map((id) => missionRecord(id))];
  const reviews = new Map<MissionId, ReviewProjectionFact>([
    [selectedId, { review: reviewFixture(selectedId), approval: null }],
    ...unrelatedIds.map((id) => [id, { review: null, approval: null }] as const),
  ]);

  const missions: MissionReadAdapter = {
    async loadAllMissions() {
      ledger.loadAllMissionsCalls += 1;
      for (const mission of all) { ledger.materializedMissionIds.push(mission.id); }
      return all;
    },
    async loadMission(id) {
      ledger.loadedMissionIds.push(id);
      const found = all.find((mission) => mission.id === id) ?? null;
      if (found) { ledger.materializedMissionIds.push(found.id); }
      return found;
    },
    getSourceFacts() { return [{ source: 'task-markdown', status: 'fresh' as const, value: 'loaded' }]; },
  };

  const reviewAdapter: ReviewReadAdapter = {
    async loadReviews(ids) {
      ledger.reviewRequests.push([...ids]);
      return new Map(ids.map((id) => [id, reviews.get(id) ?? { review: null, approval: null }]));
    },
  };

  const gates: GateReadAdapter = {
    async loadGateStatus(id) { ledger.gateRequests.push(id); return 'passed'; },
  };

  const agents: AgentReadAdapter = {
    async loadAgentAvailability() {
      ledger.agentAvailabilityCalls += 1;
      return [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } }];
    },
    async loadAssignedAgent() { return agentFamily('codex'); },
    async loadRunningSessions() { return []; },
  };

  const git: GitReadAdapter = {
    async loadRepositoryId() { ledger.repositoryIdCalls += 1; return repo; },
    async loadHeadCommit() { return 'abc123'; },
  };

  const operationLog: OperationLogReadAdapter = {
    async loadOperationLog() { ledger.operationLogCalls += 1; return []; },
  };

  return new BoardProjectionBuilder(missions, reviewAdapter, gates, agents, git, operationLog, {
    currentWork: {
      async loadCurrentWork() {
        return [
          workEvent(selectedId, 'implementing focused status query'),
          ...unrelatedIds.map((id) => workEvent(id, `unrelated work on ${id}`)),
        ];
      },
      async loadMissionCurrentWork(id) {
        ledger.currentWorkRequests.push(id);
        return [workEvent(id, id === selectedId ? 'implementing focused status query' : `unrelated work on ${id}`)];
      },
    },
    now: () => Date.parse('2026-08-24T09:00:30.000Z'),
  });
}

function statusBoardFor(ledger: ReadLedger) {
  const builder = makeFixtureBuilder(ledger);
  return createStatusBoardAdapter({ buildProjectionFn: async () => builder });
}

// ---------------------------------------------------------------------------
// Read boundary
// ---------------------------------------------------------------------------

test('explicit-slug status never loads every mission to find the selected one', async () => {
  const ledger = newLedger();
  const board = statusBoardFor(ledger);

  const data = await board.getMissionData(selectedId, '/repo');

  assert.ok(data, 'the selected mission must still resolve');
  assert.equal(ledger.loadAllMissionsCalls, 0, 'loadAllMissions must not run for an explicit slug');
  assert.deepEqual(ledger.loadedMissionIds, [selectedId]);
  assert.deepEqual(ledger.currentWorkRequests, [selectedId]);
});

test('explicit-slug status does not materialize unrelated missions', async () => {
  const ledger = newLedger();
  const board = statusBoardFor(ledger);

  await board.getMissionData(selectedId, '/repo');

  assert.deepEqual(ledger.materializedMissionIds, [selectedId]);
  assert.deepEqual(ledger.currentWorkRequests, [selectedId]);
  for (const unrelated of unrelatedIds) {
    assert.ok(!ledger.materializedMissionIds.includes(unrelated), `${unrelated} must not be materialized`);
    assert.ok(!ledger.gateRequests.includes(unrelated), `${unrelated} gate status must not be read`);
    assert.ok(
      !ledger.reviewRequests.some((request) => request.includes(unrelated)),
      `${unrelated} review state must not be read`,
    );
  }
});

test('explicit-slug status skips board-wide operation log and metrics reads', async () => {
  const ledger = newLedger();
  const board = statusBoardFor(ledger);

  await board.getMissionData(selectedId, '/repo');

  assert.equal(ledger.operationLogCalls, 0, 'the operation log is board-wide, not mission status');
  assert.equal(ledger.agentAvailabilityCalls, 0, 'board agent availability is not part of the status contract');
  assert.equal(ledger.repositoryIdCalls, 0, 'repository identity is only needed to assemble a board projection');
  assert.deepEqual(ledger.reviewRequests, [[selectedId]]);
  assert.deepEqual(ledger.gateRequests, [selectedId]);
});

test('focused current-work adapter queries only the selected mission', async () => {
  const calls: Array<[string, MissionId]> = [];
  const adapter = new ConcreteCurrentWorkReadAdapter({
    async findAll() { return []; },
    async findByType() { throw new Error('focused query must not read every current-work event'); },
    async findByTypeForMission(type, id) { calls.push([type, id as MissionId]); return []; },
    async append() {},
    async clear() {},
  });

  assert.deepEqual(await adapter.loadMissionCurrentWork(selectedId), []);
  assert.deepEqual(calls, [[CURRENT_WORK_EVENT_TYPE, selectedId]]);
});

// ---------------------------------------------------------------------------
// Contract preservation
// ---------------------------------------------------------------------------

test('focused mission status returns the established status contract fields', async () => {
  const ledger = newLedger();
  const board = statusBoardFor(ledger);

  const data = await board.getMissionData(selectedId, '/repo');

  assert.ok(data);
  assert.equal(data.backlogStatus, 'in_review');
  assert.equal(data.checkpoint, 'CP-2.md');
  assert.equal(data.checkpointDescription, 'CP-2: focused mission status query');
  assert.equal(data.reviewPhase, 'reviewing');
  assert.equal(data.reviewRound, 2);
  assert.equal(data.reviewDisposition, null);
  assert.equal(data.approvalOwed, true);
  assert.equal(data.reviewHistory.length, 2);
  assert.equal(data.reviewHistory[0].reviewer, agentFamily('codex'));
  assert.equal(data.reviewHistory[0].implementer, agentFamily('custom'));
  assert.equal(data.reviewHistory[0].disposition, 'CHANGES_MADE');
  assert.equal(data.reviewHistory[0].comment, 'Focus the read');
  assert.deepEqual(data.reviewHistory[0].findingSummaries, [
    'Board build used for one mission',
    'Unrelated metric work',
  ]);
  assert.match(data.reviewHistory[0].fixes[0] ?? '', /Focused query covers it/);
  assert.match(data.reviewHistory[0].pushbacks[0] ?? '', /Owned by TASK-2400/);
});

test('focused mission status reports the selected mission activity only', async () => {
  const ledger = newLedger();
  const board = statusBoardFor(ledger);

  const data = await board.getMissionData(selectedId, '/repo');

  assert.ok(data?.activity);
  assert.equal(data.activity.work.kind, 'working');
  assert.equal(
    (data.activity.work as { summary: string }).summary,
    'implementing focused status query',
  );
  assert.equal(data.activity.coordinator.state, 'stopped');
});

test('focused mission status returns null for a mission that does not exist', async () => {
  const ledger = newLedger();
  const board = statusBoardFor(ledger);

  const data = await board.getMissionData(missionId('task-9999'), '/repo');

  assert.equal(data, null);
  assert.equal(ledger.loadAllMissionsCalls, 0);
});

test('focused mission status matches the board projection card for the same mission', async () => {
  const focusedLedger = newLedger();
  const board = statusBoardFor(focusedLedger);
  const focused = await board.getMissionData(selectedId, '/repo');

  const boardLedger = newLedger();
  const projection = await makeFixtureBuilder(boardLedger).build();
  const card = projection.stages.flatMap((stage) => stage.cards).find((entry) => entry.id === selectedId);

  assert.ok(card);
  assert.ok(focused);
  assert.equal(focused.backlogStatus, card.rawStatus ?? card.status);
  assert.equal(focused.checkpoint, card.checkpoint);
  assert.equal(focused.checkpointDescription, card.checkpointDescription);
  assert.equal(focused.reviewPhase, card.reviewPhase);
  assert.equal(focused.reviewRound, card.reviewRound);
  assert.equal(focused.reviewDisposition, card.reviewDisposition);
  assert.equal(focused.approvalOwed, card.approvalOwed);
  assert.equal(focused.reviewHistory.length, card.reviewHistory.length);
});

// ---------------------------------------------------------------------------
// The no-slug path keeps its repository-wide reads
// ---------------------------------------------------------------------------

test('board projection build still reads every mission for the no-slug status path', async () => {
  const ledger = newLedger();

  await makeFixtureBuilder(ledger).build();

  assert.equal(ledger.loadAllMissionsCalls, 1);
  assert.equal(ledger.materializedMissionIds.length, unrelatedIds.length + 1);
  assert.equal(ledger.operationLogCalls, 1);
  assert.equal(ledger.repositoryIdCalls, 1);
});
