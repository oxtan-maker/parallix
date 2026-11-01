import { readReviewState, writeReviewState } from '../../../src/adapters/review/review-state.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
// TASK-2343: regression assertions routed to their owning write/read contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConcreteReviewReadAdapter } from '../../../src/adapters/backlog/concrete-review-read-adapter.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../../../src/adapters/review/review-state-mapping.js';
import { missionId } from '../../../src/domain/mission.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { applyReviewerCommand, changeRevision } from '../../../src/domain/review.js';
import { type Review } from '../../../src/domain/review.js';

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
  };
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
  const applied = applyReviewStateToReview(reviewWithLocalBranch(), { phase: 'reviewing' });
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

test('flattened fixing state preserves the actual previous review comment for repeat evidence (TASK-2658)', async () => {
  const { repeatReview } = await import('../../fixtures/repeat-review.js');
  const source = repeatReview();
  const review: Review = { ...source, rounds: [{ ...source.rounds[0], phase: 'fixing', disposition: 'REQUEST_CHANGES', response: null }] };
  const saved = applyReviewStateToReview(review, { round: 1, phase: 'fixing', disposition: 'REQUEST_CHANGES' });
  assert.deepEqual(saved.rounds[0].decision, review.rounds[0].decision);
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
  const approved = applyReviewerCommand(reviewWithLocalBranch(), { type: 'approve', decidedAt: '2026-08-01T11:00:00Z', comment: null, source: { kind: 'local' } });
  const mission = fixtureMission(String(MISSION), { review: approved });
  const adapter = new ConcreteReviewReadAdapter({ missionStore: {
    load: async () => ({ kind: 'found', mission, version: missionVersion(1) }),
    save: async () => { throw new Error('read only'); },
  } });

  const review = await adapter.loadReview(MISSION);
  const approval = await adapter.loadReviewApproval(MISSION);
  assert.ok(review);
  assert.ok(approval);
  assert.deepEqual(review!.rounds[0].subject, approval!.subject);
  assert.equal(approval!.subject.change.kind, 'local-branch');
});

test('loop writes cannot invent approvals, rounds or invalid phases (TASK-2821)', () => {
  const review = reviewWithLocalBranch();
  for (const state of [{ phase: 'approved' }, { phase: 'rewiewing' }, { phase: null }, { round: 2, phase: 'reviewing' }]) {
    // @ts-expect-error Unchecked input deliberately exercises the persistence boundary.
    assert.throws(() => applyReviewStateToReview(review, state));
    assert.equal(review.rounds.length, 1);
    assert.equal(review.rounds[0].decision, null);
  }
});

test('invalid review phase produces a structured failure with no write or read fallback (TASK-2821)', async () => {
  const review = reviewWithLocalBranch();
  const mission = fixtureMission(String(MISSION), { review });
  let saves = 0;
  const store = {
    load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }),
    save: async () => { saves++; return missionVersion(2); },
  };
  for (const phase of ['rewiewing', 'APPROVED', 'unknown', null]) {
    const input = JSON.parse(JSON.stringify({ phase }));
    const result = await writeReviewState(String(MISSION), input, '/unused', { missionStore: store });
    assert.equal(result.outcome, 'validation-failed');
    if (result.outcome === 'validation-failed') { assert.equal(result.kind, 'validation'); }
  }
  assert.equal(saves, 0);
  Object.assign(review.rounds[0], { phase: 'rewiewing' });
  await assert.rejects(() => readReviewState(String(MISSION), '/unused', store), /Invalid review phase/);
  assert.equal(saves, 0);
});
