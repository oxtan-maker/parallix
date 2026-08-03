import test from 'node:test';
import assert from 'node:assert/strict';

import { projectActivityLog } from '../src/application/projections/activity.js';
import { projectAgentAvailability } from '../src/application/projections/agent-status.js';
import { cumulativeFlow, medianCycleTimeSeries } from '../src/application/projections/analytics.js';
import { availableBoardCommands, attentionQueue, boardLane, projectMissionCard, wipCounts } from '../src/application/projections/mission-board.js';
import { projectMissionDetail } from '../src/application/projections/mission-detail.js';
import { projectRepositorySelector } from '../src/application/projections/repository-selector.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, requireClosedMission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  reviewFindingId,
  startReview,
} from '../src/domain/review.js';

const id = missionId('task-2294');
const repo = repositoryId('parallix');
const pullRequest = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '152',
  url: '/pull/152',
  sourceBranch: 'mission/task-2294',
  targetBranch: 'main',
};
const reviewedSubject = {
  change: pullRequest,
  revision: changeRevision('abc123'),
};
const implementer = agentFamily('configured-implementer');
const reviewer = agentFamily('configured-reviewer');
const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [reviewer],
  strategy: 'random',
});

function reviewConversation() {
  return startReview(
    reviewedSubject,
    reviewer,
    implementer,
    'now',
    reviewerEligibility,
  );
}

test('mission card contains the board decision inputs without changing lifecycle state', () => {
  const card = projectMissionCard({
    id,
    repositoryId: repo,
    title: 'Domain model',
    labels: missionLabels(['ai_sdlc', 'bug']),
    status: 'integration',
    rawStatus: 'approved',
    closedAt: null,
    assignee: implementer,
    checkpoints: [{ missionId: id, name: 'CP-2', rawFilename: 'CP-2.md', firstLine: 'CP-2: Domain model', goalCheck: [{ criterion: 'x', evidence: 'y' }], nextActionText: 'integrate' }],
    review: applyReviewerCommand(reviewConversation(), {
      type: 'approve',
      decidedAt: 'now',
      comment: null,
      source: { kind: 'provider', provider: 'forgejo' },
    }),
    netEngineeringLines: 120,
  }, {
    latestGate: 'passed',
    reviewApproval: { subject: reviewedSubject, approvedAt: '2026-07-22T09:00:00Z' },
    currentWork: {
      operationId: 'integrate:task-2294', phase: 'gates', summary: 'running integration gates',
      agent: null, updatedAt: '2026-07-22T10:00:00Z',
    },
    blockingReason: null,
    flags: ['human-review'],
  });
  assert.equal(card.status, 'integration');
  assert.equal(card.closed, false);
  assert.equal(card.lane, 'integration');
  assert.equal(card.nextActionText, 'integrate');
  assert.equal(card.pullRequest?.id, '152');
  assert.equal(card.currentWork?.phase, 'gates');
  assert.deepEqual(card.labels, ['ai_sdlc', 'bug']);
  assert.equal(card.commands.find(({ command }) => command === 'integrate')?.enabled, true);
});

test('board lanes are mission statuses, never a vocabulary of their own', () => {
  const open = { id, repositoryId: repo, title: 'x', labels: missionLabels(['unknown']), status: 'integration' as const, rawStatus: 'approved', closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  const integrated = { ...open, status: 'done' as const };
  const closed = { ...integrated, closedAt: '2026-07-22T10:00:00Z' };
  assert.equal(boardLane(closed), 'done');
  assert.equal(boardLane(open), 'integration');
  assert.equal(boardLane(integrated), 'done');
});

test('attention and WIP projections reflect blockers, gates, and lanes', () => {
  const base = { id, repositoryId: repo, title: 'x', labels: missionLabels(['user_value']), lane: 'active' as const, status: 'active' as const, rawStatus: 'active', closed: false, agent: null, checkpoint: null, checkpointDescription: null, nextActionText: null, gate: 'passed' as const, pullRequest: null, reviewApproved: false, reviewRound: null, reviewPhase: null, reviewDisposition: null, reviewHistory: [], currentWork: null, blockingReason: null, flags: [], commands: [] };
  const blocked = { ...base, blockingReason: 'human decision' };
  const failed = { ...base, gate: 'failed' as const };
  assert.deepEqual(attentionQueue([failed, blocked]).map((card) => card.blockingReason), ['human decision', null]);
  assert.equal(wipCounts([base, failed]).active, 2);
});

test('board command projection exposes guarded current CLI actions', () => {
  const active = { id, repositoryId: repo, title: 'x', labels: missionLabels(['user_value']), status: 'active' as const, rawStatus: 'active', closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null };
  const commands = availableBoardCommands(active, { reviewApproval: null });
  assert.equal(commands.find(({ command }) => command === 'active')?.enabled, true);
  assert.deepEqual(commands.find(({ command }) => command === 'handoff'), {
    command: 'handoff', enabled: false, reason: 'Handoff requires an active mission with checkpoint evidence',
  });
});

test('approved review exposes integrate without inventing another lifecycle state', () => {
  const review = {
    id,
    repositoryId: repo,
    title: 'x',
    labels: missionLabels(['user_value']),
    status: 'review' as const,
    rawStatus: 'review',
    closedAt: null,
    assignee: null,
    checkpoints: [],
    review: reviewConversation(),
    netEngineeringLines: null,
  };
  const approval = { subject: reviewedSubject, approvedAt: 'now' };
  assert.equal(availableBoardCommands(review, { reviewApproval: approval }).find(({ command }) => command === 'integrate')?.enabled, true);
  assert.equal(availableBoardCommands(review, {
    reviewApproval: {
      ...approval,
      subject: {
        ...reviewedSubject,
        change: { ...pullRequest, provider: 'another-local-review-surface' },
      },
    },
  }).find(({ command }) => command === 'integrate')?.enabled, false);
  assert.equal(availableBoardCommands({ ...review, review: null }, {
    reviewApproval: approval,
  }).find(({ command }) => command === 'integrate')?.enabled, false);
});

test('flow and median cycle projections operate on domain facts', () => {
  const transition = { missionId: id, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: implementer, occurredAt: '2026-07-22T09:00:00Z' };
  const flow = cumulativeFlow(new Map([[id, 'backlog']]), [transition], ['2026-07-22T08:00:00Z', '2026-07-22T10:00:00Z']);
  assert.equal(flow[0]?.counts.backlog, 1);
  assert.equal(flow[1]?.counts.active, 1);
  const baseMission = { id, repositoryId: repo, title: 'x', labels: missionLabels(['unknown']), status: 'done' as const, rawStatus: 'done', closedAt: '2026-07-21T10:00:00Z', assignee: implementer, checkpoints: [], review: null, netEngineeringLines: 1 };
  const baseOutcome = { missionId: id, repositoryId: repo, cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] };
  const series = medianCycleTimeSeries([
    { mission: requireClosedMission(baseMission), outcome: baseOutcome },
    { mission: requireClosedMission({ ...baseMission, id: missionId('task-other'), closedAt: '2026-07-22T10:00:00Z' }), outcome: { ...baseOutcome, missionId: missionId('task-other'), cycleTimeMinutes: 30 } },
  ], ['2026-07-21T12:00:00Z', '2026-07-22T12:00:00Z']);
  assert.deepEqual(series.map((point) => point.medianMinutes), [10, 20]);
  assert.deepEqual(projectActivityLog([transition]), [{
    missionId: id,
    occurredAt: '2026-07-22T09:00:00Z',
    actor: implementer,
    action: 'activate',
    summary: 'backlog → active',
  }]);
});

test('agent availability exposes a timed-block countdown', () => {
  const rows = projectAgentAvailability([{ family: agentFamily('custom'), launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'limit' } }], 1_250);
  assert.deepEqual(rows, [{
    family: 'custom',
    available: false,
    blockedForMs: 750,
    reason: 'limit',
    expiresAtMs: 2_000,
    limit: 'limit',
  }]);
});

test('known repositories are a de-duplicated projection of observed work', () => {
  const other = repositoryId('other');
  const repositories = projectRepositorySelector([
    { id: repo, displayName: 'Parallix' },
    { id: repo, displayName: 'Parallix' },
    { id: other, displayName: 'Another' },
  ]);
  assert.deepEqual(repositories, [
    { id: other, displayName: 'Another' },
    { id: repo, displayName: 'Parallix' },
  ]);
});

test('mission detail keeps review, checkpoint guidance, NEL, and statistics on one screen contract', () => {
  const mission = {
    id, repositoryId: repo, title: 'x', labels: missionLabels(['user_value', 'bug']), status: 'review' as const,
    rawStatus: 'review', closedAt: null, assignee: implementer, netEngineeringLines: 12,
    checkpoints: [{ missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1: Review', goalCheck: [{ criterion: 'x', evidence: 'y' }], nextActionText: 'address review' }],
    review: applyReviewerCommand(startReview(
      reviewedSubject,
      reviewer,
      implementer,
      'now',
      reviewerEligibility,
    ), {
      type: 'request-changes',
      decidedAt: 'now',
      comment: null,
      findings: [{
        id: reviewFindingId('F1'),
        summary: 'Fix the review model',
        location: 'src/domain/review.ts',
      }],
    }),
  };
  assert.deepEqual(projectMissionDetail(mission, null), {
    id,
    checkpoints: [{ name: 'CP-1', nextActionText: 'address review' }],
    review: {
      round: 1,
      status: 'awaiting-implementation',
      findings: [{
        id: 'F1',
        summary: 'Fix the review model',
        location: 'src/domain/review.ts',
      }],
    },
    netEngineeringLines: 12,
    completedStatistics: null,
  });
  assert.throws(
    () => projectMissionDetail(mission, { missionId: id } as never),
    /Open missions cannot have completed statistics/,
  );
});
