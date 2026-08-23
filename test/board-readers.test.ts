// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoardProjectionBuilder,
  checkProjectionStaleness,
  type AgentReadAdapter,
  type GateReadAdapter,
  type GitReadAdapter,
  type MissionReadAdapter,
  type OperationLogReadAdapter,
  type ReviewReadAdapter,
} from '../src/application/projections/board-readers.js';
import { attentionQueue, attentionRank } from '../src/application/projections/mission-board.js';
import { agentFamily, type AgentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { changeRevision, reviewFindingId, type Review, type ReviewRound } from '../src/domain/review.js';
import { repositoryId } from '../src/domain/repository.js';

const repo = repositoryId('parallix');
const id1 = missionId('task-0001');
const id2 = missionId('task-0002');
const id3 = missionId('task-0003');

// ---------------------------------------------------------------------------
// Mock adapters
// ---------------------------------------------------------------------------

function makeMissionAdapter(missions: Mission[] | null = null): MissionReadAdapter {
  const missionList = missions ?? [];
  return {
    async loadAllMissions() { return missionList; },
    async loadMission(id: typeof id1) { return missionList.find((m) => m.id === id) ?? null; },
    getSourceFacts() {
      return [{ source: 'task-markdown', status: 'fresh' as const, value: 'loaded' }];
    },
  };
}

function makeReviewAdapter(review: Review | null = null): ReviewReadAdapter {
  return {
    async loadReviews(ids) { return new Map(ids.map((id) => [id, { review, approval: null }])); },
  };
}

function makeGateAdapter(status: 'passed' | 'failed' | 'running' | 'unknown' = 'passed'): GateReadAdapter {
  return {
    async loadGateStatus() { return status; },
  };
}

function makeAgentAdapter(): AgentReadAdapter {
  return {
    async loadAgentAvailability() { return [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } }]; },
    async loadAssignedAgent() { return agentFamily('codex'); },
  };
}

function makeGitAdapter(headCommit = 'abc123'): GitReadAdapter {
  return {
    async loadRepositoryId() { return repo; },
    async loadHeadCommit() { return headCommit; },
  };
}

function makeOperationLogAdapter(): OperationLogReadAdapter {
  return {
    async loadOperationLog() { return []; },
  };
}

// ---------------------------------------------------------------------------
// BoardProjectionBuilder integration tests
// ---------------------------------------------------------------------------

test('BoardProjectionBuilder builds projection with repository identity and stages', async () => {
  const missions = [
    { id: id1, repositoryId: repo, title: 'Mission 1', labels: missionLabels(['user_value']), status: 'active' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
    { id: id2, repositoryId: repo, title: 'Mission 2', labels: missionLabels(['bug']), status: 'backlog' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null },
  ];
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter(missions),
    makeReviewAdapter(),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );
  const projection = await builder.build();

  assert.equal(projection.repositoryId, repo);
  assert.equal(projection.stages.length, 6);
  assert.equal(projection.stages.find((s) => s.lane === 'active')?.count, 1);
  assert.equal(projection.stages.find((s) => s.lane === 'backlog')?.count, 1);
});

test('BoardProjectionBuilder projects the review loaded by its review adapter', async () => {
  const missions = [
    { id: id1, repositoryId: repo, title: 'Mission 1', labels: missionLabels(['bug']), status: 'review' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
  ];
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter(missions),
    makeReviewAdapter({
      rounds: [{
        number: 2,
        subject: { change: { kind: 'local-branch', sourceBranch: 'mission/task-0001', targetBranch: 'main' }, revision: changeRevision('reviewed-revision') },
        reviewer: agentFamily('codex'),
        implementer: agentFamily('custom'),
        startedAt: '2026-08-04T12:00:00.000Z',
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    }),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );

  const projection = await builder.build();

  assert.equal(projection.attentionQueue[0].card.reviewPhase, 'reviewing');
  assert.equal(projection.attentionQueue[0].card.reviewRound, 2);
});

test('BoardProjectionBuilder preserves populated multi-round review cards from a batch projection', async () => {
  const ids = ['task-2401-none', 'task-2401-progress', 'task-2401-changes', 'task-2401-approved'].map(missionId);
  const subject = (id: typeof ids[number], revision: string, pullRequest = false) => ({
    change: pullRequest
      ? { kind: 'pull-request' as const, provider: 'forgejo', id: '42', url: 'https://forgejo.test/pulls/42', sourceBranch: `mission/${id}`, targetBranch: 'main' }
      : { kind: 'local-branch' as const, sourceBranch: `mission/${id}`, targetBranch: 'main' },
    revision: changeRevision(revision),
  });
  const round = (id: typeof ids[number], overrides: Partial<ReviewRound> = {}): ReviewRound => ({
    number: 1,
    subject: subject(id, `revision-${id}`),
    reviewer: agentFamily('codex'),
    implementer: agentFamily('custom'),
    startedAt: '2026-08-23T08:00:00.000Z',
    decision: null,
    response: null,
    phase: 'reviewing',
    disposition: null,
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
    ...overrides,
  });
  const findingId = reviewFindingId('task-2401-finding');
  const disputedFindingId = reviewFindingId('task-2401-disputed');
  const changesReview: Review = {
    rounds: [
      round(ids[2], {
        decision: { kind: 'changes-requested', decidedAt: '2026-08-23T08:10:00.000Z', comment: 'Fix it', findings: [{ id: findingId, summary: 'Broken projection', location: null }, { id: disputedFindingId, summary: 'Out of scope', location: null }] },
        response: { kind: 'resolved', respondedAt: '2026-08-23T08:20:00.000Z', resolutions: [{ findingId, kind: 'fixed', evidence: 'Covered by regression' }, { findingId: disputedFindingId, kind: 'disputed', rationale: 'Tracked separately' }], resultingRevision: changeRevision('revision-fixed') },
        phase: 'pending-approval',
        disposition: 'CHANGES_MADE',
      }),
      round(ids[2], { number: 2, subject: subject(ids[2], 'revision-fixed'), phase: 'reviewing' }),
    ],
    intervention: null,
    stageLaunches: [],
    reviewEvents: [{ position: 1, eventType: 'blocked_publication', roundNumber: 1, phase: 'approved', actor: 'workflow', content: '', disposition: null, verdict: null, itemDispositions: null, blockedReason: 'external-formal-approval-owed', followUpReference: null, createdAt: '2026-08-23T09:01:00.000Z' }],
  };
  const approvedSubject = subject(ids[3], 'approved-revision', true);
  const approvedReview: Review = {
    rounds: [round(ids[3], {
      subject: approvedSubject,
      decision: { kind: 'approved', decidedAt: '2026-08-23T09:00:00.000Z', comment: null, source: { kind: 'provider', provider: 'forgejo' } },
      phase: 'approved',
      disposition: 'APPROVED',
    })],
    intervention: null,
    stageLaunches: [],
    reviewEvents: [],
  };
  const reviews = new Map([
    [ids[0], { review: null, approval: null }],
    [ids[1], { review: { rounds: [round(ids[1])], intervention: null, stageLaunches: [], reviewEvents: [] } as Review, approval: null }],
    [ids[2], { review: changesReview, approval: null }],
    [ids[3], { review: approvedReview, approval: { subject: approvedSubject, approvedAt: '2026-08-23T09:00:00.000Z' } }],
  ]);
  let batchCalls = 0;
  const missions = ids.map((id) => ({ id, repositoryId: repo, title: id, labels: missionLabels([]), status: 'review' as const, closedAt: null, assignee: agentFamily('custom'), checkpoints: [], review: null, netEngineeringLines: null }));
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter(missions),
    { async loadReviews(requested) { batchCalls += 1; assert.deepEqual(requested, ids); return reviews; } },
    makeGateAdapter(), makeAgentAdapter(), makeGitAdapter(), makeOperationLogAdapter(),
  );

  const projection = await builder.build();
  const cards = new Map(projection.stages.flatMap((stage) => stage.cards).map((card) => [card.id, card]));
  assert.equal(batchCalls, 1);
  assert.equal(cards.get(ids[0])?.reviewRound, null);
  assert.equal(cards.get(ids[1])?.reviewPhase, 'reviewing');
  assert.equal(cards.get(ids[1])?.reviewHistory[0].reviewer, agentFamily('codex'));
  assert.equal(cards.get(ids[1])?.reviewHistory[0].implementer, agentFamily('custom'));
  assert.equal(cards.get(ids[2])?.reviewHistory[0].findingSummaries[0], 'Broken projection');
  assert.equal(cards.get(ids[2])?.reviewHistory[0].disposition, 'CHANGES_MADE');
  assert.equal(cards.get(ids[2])?.approvalOwed, true);
  assert.match(cards.get(ids[2])?.reviewHistory[0].fixes[0] ?? '', /Covered by regression/);
  assert.match(cards.get(ids[2])?.reviewHistory[0].pushbacks[0] ?? '', /Tracked separately/);
  assert.equal(cards.get(ids[3])?.pullRequest?.id, '42');
  assert.equal(cards.get(ids[3])?.reviewApproved, true);
  assert.equal(cards.get(ids[3])?.commands.find(({ command }) => command === 'integrate')?.enabled, true);

  reviews.set(ids[3], { review: approvedReview, approval: { subject: subject(ids[3], 'different-revision', true), approvedAt: '2026-08-23T09:00:00.000Z' } });
  const mismatched = await builder.build();
  const approvedCard = mismatched.stages.flatMap((stage) => stage.cards).find(({ id }) => id === ids[3]);
  assert.equal(approvedCard?.reviewApproved, false);
  assert.equal(approvedCard?.commands.find(({ command }) => command === 'integrate')?.enabled, false);
});

test('BoardProjectionBuilder attentionQueue orders by rank then missionId', async () => {
  const missions = [
    { id: id3, repositoryId: repo, title: 'Active', labels: missionLabels(['a']), status: 'active' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
    { id: id1, repositoryId: repo, title: 'Review', labels: missionLabels(['a']), status: 'review' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
    { id: id2, repositoryId: repo, title: 'Backlog', labels: missionLabels(['a']), status: 'backlog' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null },
  ];
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter(missions),
    makeReviewAdapter(),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );
  const projection = await builder.build();

  const queueIds = projection.attentionQueue.map((item) => item.missionId);
  // review (rank 2) before backlog (rank 4) and active (rank 4)
  // backlog and active both rank 4, tie-broken by missionId: task-0002 < task-0003
  assert.deepEqual(queueIds, [id1, id2, id3]);
});

test('BoardProjectionBuilder wipCounts reflects all missions', async () => {
  const missions = [
    { id: id1, repositoryId: repo, title: 'Active', labels: missionLabels(['a']), status: 'active' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
    { id: id2, repositoryId: repo, title: 'Active 2', labels: missionLabels(['a']), status: 'active' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
    { id: id3, repositoryId: repo, title: 'Review', labels: missionLabels(['a']), status: 'review' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
  ];
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter(missions),
    makeReviewAdapter(),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );
  const projection = await builder.build();

  const counts = Object.fromEntries(projection.wipCounts.map((w) => [w.lane, w.count]));
  assert.equal(counts.active, 2);
  assert.equal(counts.review, 1);
  assert.equal(counts.backlog, 0);
});

test('BoardProjectionBuilder includes source facts from mission adapter', async () => {
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter([]),
    makeReviewAdapter(),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );
  const projection = await builder.build();
  assert.equal(projection.sourceFacts.length, 1);
  assert.equal(projection.sourceFacts[0].source, 'task-markdown');
  assert.equal(projection.sourceFacts[0].status, 'fresh');
});

test('BoardProjectionBuilder includes default metrics with skip fallback', async () => {
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter([]),
    makeReviewAdapter(),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );
  const projection = await builder.build();
  assert.equal(projection.metrics.cumulativeFlow.missingHistoryFallback, 'skip');
  assert.equal(projection.metrics.medianStateTimes.missingHistoryFallback, 'skip');
  assert.equal(projection.metrics.throughput.missingHistoryFallback, 'skip');
  assert.equal(projection.metrics.reviewBounceRate.missingHistoryFallback, 'skip');
});

// ---------------------------------------------------------------------------
// Gate status integration
// ---------------------------------------------------------------------------

test('BoardProjectionBuilder reflects gate-failed status in attention ranking', async () => {
  const missions = [
    { id: id1, repositoryId: repo, title: 'Active', labels: missionLabels(['a']), status: 'active' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
    { id: id2, repositoryId: repo, title: 'Active 2', labels: missionLabels(['a']), status: 'active' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null },
  ];
  const gateAdapter: GateReadAdapter = {
    async loadGateStatus(missionId: typeof id1) {
      return missionId === id1 ? 'failed' : 'passed';
    },
  };
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter(missions),
    makeReviewAdapter(),
    gateAdapter,
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );
  const projection = await builder.build();

  // task-0001 has failed gate (rank 1), task-0002 has passed gate (rank 4)
  assert.equal(projection.attentionQueue[0].missionId, id1);
  assert.equal(projection.attentionQueue[0].rank, 1);
  assert.equal(projection.attentionQueue[1].missionId, id2);
  assert.equal(projection.attentionQueue[1].rank, 4);
});

// ---------------------------------------------------------------------------
// checkProjectionStaleness (SC8)
// ---------------------------------------------------------------------------

test('checkProjectionStaleness returns fresh when Git HEAD matches', () => {
  const fact = checkProjectionStaleness('abc123', 'abc123');
  assert.equal(fact.status, 'fresh');
  assert.equal(fact.source, 'git');
  assert.equal(fact.value, 'abc123');
});

test('checkProjectionStaleness returns stale when Git HEAD differs', () => {
  const fact = checkProjectionStaleness('abc123', 'def456');
  assert.equal(fact.status, 'stale');
  assert.equal(fact.value, 'def456');
});

test('checkProjectionStaleness returns stale when no cached HEAD', () => {
  const fact = checkProjectionStaleness(null, 'abc123');
  assert.equal(fact.status, 'stale');
  assert.equal(fact.value, 'abc123');
});

// ---------------------------------------------------------------------------
// Attention ranking tie-breaker: proximity to completion, then severity, then missionId
// ---------------------------------------------------------------------------

test('attention ranking tie-breaker: proximity to completion (lower rank = closer to completion)', () => {
  // done (rank 4) is "completed" but not in active lanes
  // integration (rank 3) is closest to completion among active lanes
  // review (rank 2) is next
  // gate-failed (rank 1) needs attention
  // blocking (rank 0) needs most attention
  const { makeCard } = createCardHelpers();

  const blocking = makeCard(id1, 'active', { blockingReason: 'blocked' });
  const gateFailed = makeCard(id2, 'active', { gate: 'failed' });
  const review = makeCard(id3, 'review');
  const integrate = makeCard(id1, 'integration');
  const active = makeCard(id2, 'active');

  assert.equal(attentionRank(blocking), 0);
  assert.equal(attentionRank(gateFailed), 1);
  assert.equal(attentionRank(review), 2);
  assert.equal(attentionRank(integrate), 3);
  assert.equal(attentionRank(active), 4);
});

test('attention ranking tie-breaker: same rank, different missionId', () => {
  const { makeCard } = createCardHelpers();

  const cards = [
    makeCard(missionId('task-0005'), 'active'),
    makeCard(missionId('task-0001'), 'active'),
    makeCard(missionId('task-0003'), 'active'),
  ];
  const queue = attentionQueue(cards);
  assert.deepEqual(queue.map((c) => c.id), [missionId('task-0001'), missionId('task-0003'), missionId('task-0005')]);
});

test('attention ranking tie-breaker: severity within same lane (blocking > gate-failed)', () => {
  const { makeCard } = createCardHelpers();

  const cards = [
    makeCard(missionId('task-0002'), 'active', { gate: 'failed' }),
    makeCard(missionId('task-0001'), 'active', { blockingReason: 'blocked' }),
    makeCard(missionId('task-0003'), 'active'),
  ];
  const queue = attentionQueue(cards);
  // blocking (rank 0) > gate-failed (rank 1) > active (rank 4)
  assert.deepEqual(queue.map((c) => c.id), [missionId('task-0001'), missionId('task-0002'), missionId('task-0003')]);
});

// ---------------------------------------------------------------------------
// Helper for creating test cards
// ---------------------------------------------------------------------------

function createCardHelpers() {
  function makeCard(
    id: typeof id1,
    lane: 'backlog' | 'refined' | 'active' | 'review' | 'integration' | 'done',
    opts: { blockingReason?: string | null; gate?: 'passed' | 'failed' | 'running' | 'unknown' } = {},
  ) {
    return {
      id,
      repositoryId: repo,
      title: `Mission ${id}`,
      labels: missionLabels(['user_value']),
      lane,
      status: lane,
      closed: lane === 'done',
      agent: agentFamily('codex'),
      checkpoint: null,
      nextActionText: null,
      gate: opts.gate ?? 'passed',
      pullRequest: null,
      reviewApproved: false,
      currentWork: null,
      blockingReason: opts.blockingReason ?? null,
      flags: [],
      commands: [],
    };
  }
  return { makeCard };
}
