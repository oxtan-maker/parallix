// TASK-2343: regression assertions routed to their owning write/read contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../src/adapters/review/review-state-mapping.js';
import { missionId } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision } from '../src/domain/review.js';
import { type Review } from '../src/domain/review.js';

const MISSION = missionId('task-2343');
function reviewWithLocalBranch(): Review {
  return {
    rounds: [{
      number: 1,
      subject: {
        change: { kind: 'local-branch', sourceBranch: 'mission/task-2343', targetBranch: 'main' },
        revision: changeRevision('abc123'),
      },
      reviewer: agentFamily('claude'),
      implementer: agentFamily('codex'),
      startedAt: '2026-08-01T10:00:00.000Z',
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
  } as unknown as Review;
}

test('a confirmed PR reference is written onto the round and flattened back out', () => {
  const applied = applyReviewStateToReview(reviewWithLocalBranch(), {
    pullRequest: {
      kind: 'pull-request', provider: 'forgejo', id: '4242',
      url: 'http://localhost:3300/px/px/pulls/4242',
      sourceBranch: 'mission/task-2343', targetBranch: 'main',
    },
  });

  const change = applied.rounds[applied.rounds.length - 1].subject.change;
  assert.equal(change.kind, 'pull-request');
  assert.equal(change.kind === 'pull-request' && change.id, '4242');

  const flattened = reviewStateDataFrom(applied);
  assert.equal(flattened.pullRequest?.id, '4242');
  assert.equal(flattened.pullRequest?.provider, 'forgejo');
});

test('a state carrying no PR reference leaves the aggregate change untouched', () => {
  const applied = applyReviewStateToReview(reviewWithLocalBranch(), { phase: 'approved' });
  assert.equal(applied.rounds[0].subject.change.kind, 'local-branch');
  assert.equal(reviewStateDataFrom(applied).pullRequest, null);
});

test('a stale loop write preserves a verdict recorded during reviewer launch', () => {
  const review = reviewWithLocalBranch();
  const decided = {
    ...review,
    rounds: [{ ...review.rounds[0], reviewer: agentFamily('codex'), phase: 'approved' as const,
      disposition: 'APPROVED' as const,
      decision: { kind: 'approved' as const, decidedAt: '2026-08-01T11:00:00.000Z', comment: 'passed', source: { kind: 'local' as const } },
    }],
  } as Review;
  const saved = applyReviewStateToReview(decided, { round: 1, phase: 'reviewing', reviewer: 'codex' });

  assert.deepEqual(saved.rounds[0].decision, decided.rounds[0].decision);
  assert.equal(saved.rounds[0].phase, 'approved');
  assert.equal(saved.rounds[0].disposition, 'APPROVED');
});

test('an invalid PR reference is refused rather than written onto the round', () => {
  const applied = applyReviewStateToReview(reviewWithLocalBranch(), {
    pullRequest: {
      kind: 'pull-request', provider: '', id: '', url: null,
      sourceBranch: 'mission/task-2343', targetBranch: 'main',
    },
  });
  assert.equal(applied.rounds[0].subject.change.kind, 'local-branch');
});

test('loadReview and loadReviewApproval agree on the reviewed change', async () => {
  const state = {
    slug: 'task-2343',
    reviewer: 'claude',
    implementer: 'codex',
    round: 1,
    startedAt: '2026-08-01T10:00:00.000Z',
    phase: 'approved',
    disposition: 'approved',
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
    metadata: {},
    pullRequest: {
      kind: 'pull-request' as const, provider: 'forgejo', id: '4242',
      url: null, sourceBranch: 'mission/task-2343', targetBranch: 'main',
    },
  };
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: '/tmp',
    missionStore: null,
    readReviewState: () => state as never,
    findMissionDir: () => '/tmp/missions/task-2343',
  });

  const review = await adapter.loadReview(MISSION);
  const approval = await adapter.loadReviewApproval(MISSION);
  assert.ok(review);
  assert.ok(approval);
  assert.deepEqual(review!.rounds[0].subject, approval!.subject);
  assert.equal(approval!.subject.change.kind, 'pull-request');
});
