import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  changeRevision,
  ConfiguredReviewerEligibility,
  startReview,
} from '../src/domain/review.js';

const id = missionId('task-2339');
const repo = repositoryId('parallix');
const implementer = agentFamily('configured-implementer');
const reviewer = agentFamily('configured-reviewer');

const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [reviewer],
  strategy: 'random',
});

const pullRequest = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '2339',
  url: '/pull/2339',
  sourceBranch: 'mission/task-2339',
  targetBranch: 'main',
};

function activeMission(): Mission {
  return {
    id,
    repositoryId: repo,
    title: 'Stabilize handoff idempotency key across retries',
    labels: missionLabels(['bug']),
    status: 'active',
    rawStatus: 'active',
    closedAt: null,
    assignee: implementer,
    checkpoints: [{
      missionId: id,
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1: Reproduce the retry failure',
      goalCheck: [{ criterion: 'repro', evidence: 'test' }],
      nextActionText: 'apply the domain fix',
    }],
    review: null,
    netEngineeringLines: null,
  };
}

function submittedReview() {
  return startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    '2026-08-04T10:00:00Z',
    reviewerEligibility,
  );
}

test('retrying submit-for-review on a review mission is an idempotent no-op', () => {
  const review = submittedReview();
  const command = {
    type: 'submit-for-review' as const,
    gatesPassed: true,
    review,
    reviewerEligibility,
  };

  const inReview = decideMission(activeMission(), command);
  assert.equal(inReview.status, 'review');

  // A relaunched handoff replays the same transition. Before the fix this threw
  // `Cannot submit-for-review while task-2339 is review; expected active`.
  const retried = decideMission(inReview, command);
  assert.equal(retried.status, 'review');
  assert.deepEqual(retried, inReview);
});

test('submit-for-review retry does not advance the recorded review conversation', () => {
  const review = submittedReview();
  const command = {
    type: 'submit-for-review' as const,
    gatesPassed: true,
    review,
    reviewerEligibility,
  };
  const inReview = decideMission(activeMission(), command);

  // Even a retry carrying a different review payload leaves the persisted
  // review untouched, so the no-op cannot rewrite an in-flight round.
  const retried = decideMission(inReview, {
    ...command,
    review: startReview(
      { change: pullRequest, revision: changeRevision('def456') },
      reviewer,
      implementer,
      '2026-08-04T11:00:00Z',
      reviewerEligibility,
    ),
  });
  assert.deepEqual(retried.review, inReview.review);
});
