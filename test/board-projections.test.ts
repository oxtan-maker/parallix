import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_PROJECTION_VERSION,
  attentionReason,
  buildBoardMetrics,
  buildBoardProjection,
  buildBoardStage,
} from '../src/application/projections/board.js';
import {
  attentionQueue,
  attentionRank,
  boardLane,
  type BoardLane,
  type MissionCard,
} from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const repo = repositoryId('parallix');
const id1 = missionId('task-0001');
const id2 = missionId('task-0002');
const id3 = missionId('task-0003');
const id4 = missionId('task-0004');
const id5 = missionId('task-0005');

function makeCard(
  id: typeof id1,
  lane: BoardLane,
  opts: { blockingReason?: string | null; gate?: 'passed' | 'failed' | 'running' | 'unknown' } = {},
): MissionCard {
  return {
    id,
    repositoryId: repo,
    title: `Mission ${id}`,
    labels: missionLabels(['user_value']),
    lane,
    status: lane,
    rawStatus: lane,
    closed: lane === 'done',
    agent: agentFamily('codex'),
    checkpoint: null,
    checkpointDescription: null,
    nextActionText: null,
    gate: opts.gate ?? 'passed',
    pullRequest: null,
    reviewApproved: false,
    reviewRound: null,
    reviewPhase: null,
    reviewDisposition: null,
    reviewHistory: [],
    currentWork: null,
    blockingReason: opts.blockingReason ?? null,
    flags: [],
    commands: [{ command: lane === 'integration' ? 'integrate' : lane === 'review' ? 'review' : 'active', enabled: true, reason: null }],
  };
}

// ---------------------------------------------------------------------------
// SC1: BoardProjection type with version field
// ---------------------------------------------------------------------------

test('BoardProjection has version field and all required shape members', () => {
  const projection = buildBoardProjection(
    repo,
    [makeCard(id1, 'active')],
    [{ command: 'active', enabled: true, reason: null }],
    [],
    buildBoardMetrics({ cumulativeFlow: { series: [], missingHistoryFallback: 'null' }, medianStateTimes: { series: [], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' } }),
    [{ source: 'task-markdown', status: 'fresh', value: 'now' }],
  );

  assert.equal(projection.version, BOARD_PROJECTION_VERSION);
  assert.equal(projection.repositoryId, repo);
  assert.ok(Array.isArray(projection.stages));
  assert.ok(Array.isArray(projection.attentionQueue));
  assert.ok(Array.isArray(projection.wipCounts));
  assert.ok(Array.isArray(projection.availableActions));
  assert.ok(Array.isArray(projection.operationLog));
  assert.ok(projection.metrics);
  assert.ok(Array.isArray(projection.sourceFacts));
});

test('BoardStage contains lane, cards, and count', () => {
  const stage = buildBoardStage('active', [makeCard(id1, 'active'), makeCard(id2, 'active')]);
  assert.equal(stage.lane, 'active');
  assert.equal(stage.count, 2);
  assert.equal(stage.cards.length, 2);
});

test('BoardStage filters to correct lane only', () => {
  const cards = [makeCard(id1, 'active'), makeCard(id2, 'review'), makeCard(id3, 'backlog')];
  const stage = buildBoardStage('review', cards);
  assert.equal(stage.lane, 'review');
  assert.equal(stage.count, 1);
  assert.equal(stage.cards[0].id, id2);
});

test('BoardMetrics has all four metric series with missingHistoryFallback', () => {
  const metrics = buildBoardMetrics({ cumulativeFlow: { series: [{ at: 'now', value: 5 }], missingHistoryFallback: 'null' }, medianStateTimes: { series: [{ at: 'now', value: 30 }], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [{ at: 'now', value: 1.5 }], missingHistoryFallback: 'estimate' } });
  assert.equal(metrics.cumulativeFlow.missingHistoryFallback, 'null');
  assert.equal(metrics.medianStateTimes.missingHistoryFallback, 'null');
  assert.equal(metrics.throughput.missingHistoryFallback, 'skip');
  assert.equal(metrics.reviewBounceRate.missingHistoryFallback, 'estimate');
});

// ---------------------------------------------------------------------------
// SC2: attentionRank deterministic with tie-breaker
// ---------------------------------------------------------------------------

test('attentionRank returns 0 for blocking reason present', () => {
  const card = makeCard(id1, 'active', { blockingReason: 'human decision' });
  assert.equal(attentionRank(card), 0);
});

test('attentionRank returns 1 for gate failed', () => {
  const card = makeCard(id1, 'active', { gate: 'failed' });
  assert.equal(attentionRank(card), 1);
});

test('attentionRank returns 2 for review lane', () => {
  const card = makeCard(id1, 'review');
  assert.equal(attentionRank(card), 2);
});

test('attentionRank returns 3 for integration lane', () => {
  const card = makeCard(id1, 'integration');
  assert.equal(attentionRank(card), 3);
});

test('attentionRank returns 4 for all others', () => {
  const backlog = makeCard(id1, 'backlog');
  const refined = makeCard(id1, 'refined');
  const active = makeCard(id1, 'active');
  const done = makeCard(id1, 'done');
  assert.equal(attentionRank(backlog), 4);
  assert.equal(attentionRank(refined), 4);
  assert.equal(attentionRank(active), 4);
  assert.equal(attentionRank(done), 4);
});

test('attentionQueue sorts by rank then missionId ascending', () => {
  const cards: MissionCard[] = [
    makeCard(id3, 'active'),
    makeCard(id1, 'active', { blockingReason: 'blocked' }),
    makeCard(id5, 'integration'),
    makeCard(id2, 'review'),
    makeCard(id4, 'active', { gate: 'failed' }),
    makeCard(id3, 'backlog'),
  ];
  const queue = attentionQueue(cards);
  const ids = queue.map((c) => c.id);
  // Expected order:
  // rank 0: task-0001 (blocking)
  // rank 1: task-0004 (gate failed)
  // rank 2: task-0002 (review)
  // rank 3: task-0005 (integrate)
  // rank 4: task-0003 (backlog), task-0003 (active) — tie broken by missionId (same id, stable)
  assert.deepEqual(ids, [id1, id4, id2, id5, id3, id3]);
});

test('attentionQueue tie-breaker: same rank sorted by missionId ascending', () => {
  const cards: MissionCard[] = [
    makeCard(id3, 'active'),
    makeCard(id1, 'active'),
    makeCard(id2, 'active'),
  ];
  const queue = attentionQueue(cards);
  assert.deepEqual(queue.map((c) => c.id), [id1, id2, id3]);
});

// ---------------------------------------------------------------------------
// AttentionReason
// ---------------------------------------------------------------------------

test('attentionReason returns blocking kind with detail', () => {
  const card = makeCard(id1, 'active', { blockingReason: 'human decision' });
  const reason = attentionReason(card);
  assert.deepEqual(reason, { kind: 'blocking', detail: 'human decision' });
});

test('attentionReason returns gate-failed kind', () => {
  const card = makeCard(id1, 'active', { gate: 'failed' });
  const reason = attentionReason(card);
  assert.deepEqual(reason, { kind: 'gate-failed', detail: 'Gate failed' });
});

test('attentionReason returns review-lane kind', () => {
  const card = makeCard(id1, 'review');
  const reason = attentionReason(card);
  assert.deepEqual(reason, { kind: 'review-lane', detail: 'Awaiting review decision' });
});

test('attentionReason returns integrate-lane kind', () => {
  const card = makeCard(id1, 'integration');
  const reason = attentionReason(card);
  assert.deepEqual(reason, { kind: 'integrate-lane', detail: 'Awaiting integration' });
});

test('attentionReason returns none for unblocked active mission', () => {
  const card = makeCard(id1, 'active');
  const reason = attentionReason(card);
  assert.deepEqual(reason, { kind: 'none' });
});

// ---------------------------------------------------------------------------
// BoardProjection attentionQueue integration
// ---------------------------------------------------------------------------

test('buildBoardProjection attentionQueue is sorted by priority then missionId with ordinal ranks', () => {
  const cards = [
    makeCard(id3, 'active'),
    makeCard(id1, 'active', { blockingReason: 'blocked' }),
    makeCard(id2, 'review'),
  ];
  const projection = buildBoardProjection(
    repo,
    cards,
    [],
    [],
    buildBoardMetrics({ cumulativeFlow: { series: [], missingHistoryFallback: 'null' }, medianStateTimes: { series: [], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' } }),
    [],
  );

  const queueIds = projection.attentionQueue.map((item) => item.missionId);
  assert.deepEqual(queueIds, [id1, id2]);
  assert.equal(projection.attentionQueue[0].rank, 1);
  assert.equal(projection.attentionQueue[1].rank, 2);
});

test('buildBoardProjection wipCounts reflects all lanes', () => {
  const cards = [
    makeCard(id1, 'backlog'),
    makeCard(id2, 'active'),
    makeCard(id3, 'active'),
    makeCard(id4, 'review'),
    makeCard(id5, 'done'),
  ];
  const projection = buildBoardProjection(
    repo,
    cards,
    [],
    [],
    buildBoardMetrics({ cumulativeFlow: { series: [], missingHistoryFallback: 'null' }, medianStateTimes: { series: [], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' } }),
    [],
  );

  const counts = Object.fromEntries(projection.wipCounts.map((w) => [w.lane, w.count]));
  assert.equal(counts.backlog, 1);
  assert.equal(counts.refined, 0);
  assert.equal(counts.active, 2);
  assert.equal(counts.review, 1);
  assert.equal(counts.integration, 0);
  assert.equal(counts.done, 1);
});

test('buildBoardProjection stages cover all six lanes', () => {
  const projection = buildBoardProjection(
    repo,
    [makeCard(id1, 'active')],
    [],
    [],
    buildBoardMetrics({ cumulativeFlow: { series: [], missingHistoryFallback: 'null' }, medianStateTimes: { series: [], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' } }),
    [],
  );

  assert.equal(projection.stages.length, 6);
  const lanes = projection.stages.map((s) => s.lane);
  assert.deepEqual(lanes, ['backlog', 'refined', 'active', 'review', 'integration', 'done']);
});

// ---------------------------------------------------------------------------
// BoardLane mapping for every status
// ---------------------------------------------------------------------------

test('BoardLane maps backlog status to backlog lane', () => {
  const mission = { id: id1, repositoryId: repo, title: 'x', labels: missionLabels(['a']), status: 'backlog' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  assert.equal(boardLane(mission), 'backlog');
});

test('BoardLane maps refined status to refined lane', () => {
  const mission = { id: id1, repositoryId: repo, title: 'x', labels: missionLabels(['a']), status: 'refined' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  assert.equal(boardLane(mission), 'refined');
});

test('BoardLane maps active status to active lane', () => {
  const mission = { id: id1, repositoryId: repo, title: 'x', labels: missionLabels(['a']), status: 'active' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  assert.equal(boardLane(mission), 'active');
});

test('BoardLane maps review status to review lane', () => {
  const mission = { id: id1, repositoryId: repo, title: 'x', labels: missionLabels(['a']), status: 'review' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  assert.equal(boardLane(mission), 'review');
});

test('BoardLane maps integration status to integration lane', () => {
  const mission = { id: id1, repositoryId: repo, title: 'x', labels: missionLabels(['a']), status: 'integration' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  assert.equal(boardLane(mission), 'integration');
});

test('BoardLane maps done (open) to done lane', () => {
  const mission = { id: id1, repositoryId: repo, title: 'x', labels: missionLabels(['a']), status: 'done' as const, closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  assert.equal(boardLane(mission), 'done');
});

test('BoardLane maps done (closed) to done lane', () => {
  const mission = { id: id1, repositoryId: repo, title: 'x', labels: missionLabels(['a']), status: 'done' as const, closedAt: '2026-01-01', assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  assert.equal(boardLane(mission), 'done');
});
