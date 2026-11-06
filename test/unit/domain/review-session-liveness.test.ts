import { fixtureMission as completeMissionFixture } from '../../fixtures/mission-builders.js';
// TASK-2368: a mission whose review is being run by a live agent session must
// not be queued as human attention ("Awaiting review decision").
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
  type RunningAgentSession,
} from '../../../src/application/projections/board-readers.js';
import { detectRunningMissionSessions } from '../../../src/adapters/agents/running-sessions.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { changeRevision, type Review } from '../../../src/domain/review.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { reviewRoundLiveness } from '../../../src/application/projections/review-liveness.js';
import { projectReviewRecoveryCard } from '../../../src/application/projections/workflow-board.js';
import { makeCard } from '../../fixtures/board-projection.js';

test('unfinished review is orphaned only when every attributed liveness source confirms absence (TASK-2826)', () => {
  const absent = { workflow: false, coordinator: false, execution: false, reviewer: false } as const;
  assert.equal(reviewRoundLiveness('reviewing', absent), 'orphaned');
  for (const source of Object.keys(absent)) {
    assert.equal(reviewRoundLiveness('reviewing', { ...absent, [source]: true }), 'live');
    assert.equal(reviewRoundLiveness('reviewing', { ...absent, [source]: null }), 'unconfirmed');
  }
  assert.equal(reviewRoundLiveness('approved', absent), null);
  assert.equal(reviewRoundLiveness('pending-approval', absent), null);
});

test('review recovery maps settlement, intervention and liveness facts to exactly one action (TASK-2839)', async () => {
  const { decideReviewRecovery, describeReviewRecovery } = await import('../../../src/application/review-recovery.js');
  const absent = { workflow: false, coordinator: false, execution: false, reviewer: false } as const;
  const stopped = { phase: 'reviewing', humanStop: 'MAX_ATTEMPTS' } as const;
  const settled = decideReviewRecovery('task-2830', { ...stopped, workflow: null, liveness: absent });
  assert.equal(settled?.action, 'acknowledge-and-resume');
  assert.equal(settled?.humanStop, 'MAX_ATTEMPTS');
  assert.match(describeReviewRecovery(settled!), /MAX_ATTEMPTS.*px review task-2830/);
  assert.doesNotMatch(describeReviewRecovery(settled!), /px stop/);
  assert.equal(decideReviewRecovery('task-2830', { phase: 'fixing', humanStop: null, workflow: null, liveness: absent })?.action, 'acknowledge-and-resume');
  const running = decideReviewRecovery('task-2830', { ...stopped, workflow: { id: 'op-1', phase: 'executing', reason: null }, liveness: { ...absent, workflow: true } });
  assert.equal(running?.action, 'stop-and-confirm');
  assert.match(running!.guidance, /px stop task-2830/);
  assert.equal(decideReviewRecovery('task-2830', { ...stopped, workflow: { id: 'op-1', phase: 'stopping', reason: null }, liveness: absent })?.action, 'stop-and-confirm');
  for (const probe of Object.keys(absent)) {
    const live = decideReviewRecovery('task-2830', { ...stopped, workflow: null, liveness: { ...absent, [probe]: true } });
    assert.equal(live?.action, 'stop-and-confirm', probe);
    assert.doesNotMatch(live!.guidance, /Stop it with px stop/, 'px stop cannot settle work no workflow operation owns');
    const unknown = decideReviewRecovery('task-2830', { ...stopped, workflow: null, liveness: { ...absent, [probe]: null } });
    assert.equal(unknown?.action, 'refuse-unconfirmed', probe);
    assert.ok(unknown?.evidence.includes(`${probe} liveness unknown`));
  }
  assert.equal(decideReviewRecovery('task-2830', { ...stopped, workflow: null })?.action, 'refuse-unconfirmed', 'unobserved probes never confirm absence');
  const pending = decideReviewRecovery('task-2830', { ...stopped, workflow: { id: 'op-1', phase: 'stopping', reason: 'Stop is pending: termination is unconfirmed. Inspect px history task-2830 list.' }, liveness: absent });
  assert.equal(pending?.action, 'refuse-unconfirmed');
  assert.ok(pending?.evidence.some(line => line.includes('termination is unconfirmed')), 'the retained stop evidence travels with the refusal');
  assert.equal(decideReviewRecovery('task-2830', { phase: 'reviewing', humanStop: null, workflow: { id: 'op-1', phase: 'executing', reason: null }, liveness: { ...absent, workflow: true } }), null, 'a live round needs no recovery');
  assert.equal(decideReviewRecovery('task-2830', { phase: 'approved', humanStop: 'MAX_ATTEMPTS', workflow: null, liveness: absent }), null);
  assert.equal(decideReviewRecovery('task-2830', { phase: 'awaiting-review', humanStop: null, workflow: null, liveness: absent }), null);
});

test('board recovery probes only stopped or potentially orphaned review rounds (TASK-2839)', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return { workflow: null, liveness: { workflow: false, coordinator: false, execution: false, reviewer: false } } as const;
  };
  const active = makeCard({ reviewPhase: 'fixing', reviewHumanStop: null,
    currentWork: { operationId: 'review-op', agent: agentFamily('codex'), summary: 'fixing findings', phase: 'review',
      updatedAt: '2026-11-04T10:00:00.000Z', freshness: 'live' } });
  assert.equal((await projectReviewRecoveryCard(active, read)).reviewRecovery, undefined);
  assert.equal(reads, 0, 'published live work avoids per-refresh process and history probes');

  const stopped = { ...active, currentWork: null, reviewHumanStop: 'MAX_ATTEMPTS' };
  assert.equal((await projectReviewRecoveryCard(stopped, read)).reviewRecovery?.action, 'acknowledge-and-resume');
  assert.equal(reads, 1);
});

test('read-only review status processes never count as live review coordinators (TASK-2826)', () => {
  assert.deepEqual(detectRunningMissionSessions({ rootDir: '/repo',
    listProcesses: () => [{ pid: 4242, elapsedSeconds: 0, args: 'node /repo/px review task-2274 --status' }],
    listWorktrees: () => new Map(), resolveCwd: () => '/repo',
  }), []);
});

test('focused review liveness is not made uncertain by an unrelated unobservable Mission (TASK-2826)', () => {
  const options = { rootDir: '/repo',
    listProcesses: () => [{ pid: 9999, elapsedSeconds: 10, args: 'node /unknown/px review task-foreign' }],
    listWorktrees: () => new Map(), resolveCwd: () => null };
  assert.equal(detectRunningMissionSessions(options), null);
  assert.deepEqual(detectRunningMissionSessions({ ...options, missionId: reviewed }), []);
});

const repo = repositoryId('parallix');
const reviewed = missionId('task-2274');

// ---------------------------------------------------------------------------
// Mocked read adapters — no Forgejo, no process table, no agent launch
// ---------------------------------------------------------------------------

function reviewLaneMission(): Mission {
  return completeMissionFixture(String(reviewed), {
    id: reviewed,
    repositoryId: repo,
    title: 'route role-owned review artifact failures to their producer',
    labels: missionLabels(['ai_sdlc']),
    status: 'review',
    closedAt: null,
    assignee: agentFamily('custom'),
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
  });
}

/** A review whose current round is still being worked: no decision yet. */
function pendingReview(): Review {
  return {
    rounds: [{
      number: 1,
      subject: {
        change: {
          kind: 'pull-request', provider: 'forgejo', id: '271', url: 'https://forgejo.local/pr/271',
          sourceBranch: 'mission/task-2368', targetBranch: 'main',
        },
        revision: changeRevision('reviewed-revision'),
      },
      reviewer: agentFamily('claude'),
      implementer: agentFamily('custom'),
      startedAt: '2026-08-12T09:00:00.000Z',
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    reviewEvents: [],
    intervention: null,
    stageLaunches: [],
  };
}

function makeBuilder(runningSessions: readonly RunningAgentSession[] | null): BoardProjectionBuilder {
  const missions: MissionReadAdapter = {
    async loadAllMissions() { return [reviewLaneMission()]; },
    async loadMission(id) { return id === reviewed ? reviewLaneMission() : null; },
    getSourceFacts() { return [{ source: 'task-markdown', status: 'fresh' as const, value: 'loaded' }]; },
  };
  const reviews: ReviewReadAdapter = {
    async loadReviews(ids) { return new Map(ids.map((id) => [id, { review: pendingReview(), approval: null }])); },
  };
  const gates: GateReadAdapter = { async observeGate() { return 'passed'; } };
  const agents: AgentReadAdapter = {
    async loadAgentAvailability() {
      return [{ family: agentFamily('claude'), launcherAvailable: true, launcherDetail: null, block: { kind: 'none' } }];
    },
    async loadAssignedAgent() { return agentFamily('custom'); },
    async loadRunningSessions() { return runningSessions; },
  };
  const git: GitReadAdapter = {
    async loadRepositoryId() { return repo; },
    async loadHeadCommit() { return 'head-commit'; },
  };
  const operationLog: OperationLogReadAdapter = { async loadOperationLog() { return []; } };
  return new BoardProjectionBuilder(missions, reviews, gates, agents, git, operationLog);
}

// ---------------------------------------------------------------------------
// Board classification
// ---------------------------------------------------------------------------

test('a review-lane mission whose review is running does not ask for human attention', async () => {
  const projection = await makeBuilder([{ missionId: reviewed, family: null }]).build();

  const item = projection.attentionQueue.find((entry) => entry.missionId === reviewed);
  assert.equal(item, undefined, 'a running review is not a human decision');
});

test('a review-lane mission with no live session still awaits a human review decision', async () => {
  const projection = await makeBuilder([]).build();

  const item = projection.attentionQueue.find((entry) => entry.missionId === reviewed);
  assert.ok(item, 'the mission is present in the attention queue');
  assert.equal(item.card.liveSession, null, 'no session was observed for the mission');
  assert.equal(item.reason.kind, 'review-lane');
  assert.equal(item.reason.detail, 'Awaiting review decision');
});

test('unknown liveness leaves the review-lane attention item unchanged', async () => {
  const projection = await makeBuilder(null).build();

  const item = projection.attentionQueue.find((entry) => entry.missionId === reviewed);
  assert.ok(item, 'the mission is present in the attention queue');
  assert.equal(item.reason.kind, 'review-lane', 'unknown liveness must not be read as "an agent is on it"');
});

// ---------------------------------------------------------------------------
// Session discovery — the shape the board must associate with the mission
// ---------------------------------------------------------------------------

test('a live px review process is detected as a running session for its mission', () => {
  const sessions = detectRunningMissionSessions({
    rootDir: '/repo',
    listProcesses: () => [
      { pid: 4242, elapsedSeconds: 600, args: 'node /repo/node_modules/.bin/px review task-2274' },
    ],
    listWorktrees: () => new Map([['/repo/../parallix-task-2274', reviewed]]),
    resolveCwd: () => null,
    now: () => Date.parse('2026-08-12T09:30:00.000Z'),
  });

  assert.deepEqual(sessions?.map((session) => session.missionId), [reviewed]);
});
