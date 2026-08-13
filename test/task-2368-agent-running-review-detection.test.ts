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
} from '../src/application/projections/board-readers.js';
import { detectRunningMissionSessions } from '../src/adapters/agents/running-sessions.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { changeRevision, type Review } from '../src/domain/review.js';
import { repositoryId } from '../src/domain/repository.js';

const repo = repositoryId('parallix');
const reviewed = missionId('task-2274');

// ---------------------------------------------------------------------------
// Mocked read adapters — no Forgejo, no process table, no agent launch
// ---------------------------------------------------------------------------

function reviewLaneMission(): Mission {
  return {
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
  };
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
    gateFailureRetryCount: 0,
    hookFailureRetryCount: 0,
  } as unknown as Review;
}

function makeBuilder(runningSessions: readonly RunningAgentSession[] | null): BoardProjectionBuilder {
  const missions: MissionReadAdapter = {
    async loadAllMissions() { return [reviewLaneMission()]; },
    async loadMission(id) { return id === reviewed ? reviewLaneMission() : null; },
    getSourceFacts() { return [{ source: 'task-markdown', status: 'fresh' as const, value: 'loaded' }]; },
  };
  const reviews: ReviewReadAdapter = {
    async loadReview() { return pendingReview(); },
    async loadReviewApproval() { return null; },
  };
  const gates: GateReadAdapter = { async loadGateStatus() { return 'passed'; } };
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
  assert.ok(item, 'the mission is present in the attention queue');
  assert.equal(item.card.liveSession?.missionId, reviewed, 'the card records the live review session');
  assert.equal(item.reason.kind, 'none', 'a running review is not a human decision');
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
