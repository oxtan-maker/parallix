import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import { recordCheckpoint } from '../src/domain/checkpoint.js';
import { closeMission, missionId, missionLabels, MissionRuleViolation, recordNetEngineeringLines, requireClosedMission, type Mission } from '../src/domain/mission.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  requestReviewIntervention,
  reviewFindingId,
  reviewStatus,
  resumeReview,
  startReview,
  type ReviewedChange,
} from '../src/domain/review.js';
import { shouldResume } from '../src/domain/session.js';

const id = missionId('task-2294');
const repo = repositoryId('parallix');
const implementer = agentFamily('configured-implementer');
const reviewer = agentFamily('configured-reviewer');

test('missionId accepts dotted child-task suffixes', () => {
  assert.equal(missionId('task-2322.09'), 'task-2322.09');
});

test('missionId rejects empty dotted segments', () => {
  assert.throws(() => missionId('task-2322..09'), /Invalid mission slug/);
});
const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [reviewer],
  strategy: 'random',
});
const pullRequest = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '152',
  url: '/pull/152',
  sourceBranch: 'mission/task-2294',
  targetBranch: 'main',
};

function mission(status: Mission['status'] = 'refined'): Mission {
  return {
    id,
    repositoryId: repo,
    title: 'Model the domain',
    labels: missionLabels(['user_value']),
    status,
    rawStatus: status,
    closedAt: null,
    assignee: null,
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
  };
}

function initialReview(change: ReviewedChange = pullRequest) {
  return startReview(
    { change, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    '2026-07-22T08:00:00Z',
    reviewerEligibility,
  );
}

function approve(review = initialReview(), comment: string | null = null) {
  return applyReviewerCommand(review, {
    type: 'approve',
    decidedAt: '2026-07-22T08:30:00Z',
    comment,
    source: { kind: 'provider', provider: 'forgejo' },
  });
}

const finding = {
  id: reviewFindingId('F1'),
  summary: 'State is not derived from the command protocol',
  location: 'src/domain/review.ts',
};

test('mission labels preserve independent and extensible dimensions', () => {
  assert.deepEqual(missionLabels(['AI_SDLC', 'bug', 'ai_sdlc']), ['ai_sdlc', 'bug']);
  assert.throws(() => missionLabels(['  ']), /cannot be empty/);
});

test('mission lifecycle follows the command-owned path without UI-only states', () => {
  const active = decideMission(mission(), { type: 'activate', agent: implementer });
  const withEvidence = {
    ...active,
    checkpoints: [{
      missionId: id,
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1: Model the domain',
      goalCheck: [{ criterion: 'model', evidence: 'test' }],
      nextActionText: 'request review',
    }],
  };
  const reviewConversation = initialReview();
  const review = decideMission(withEvidence, {
    type: 'submit-for-review',
    gatesPassed: true,
    review: reviewConversation,
    reviewerEligibility,
  });
  const approved = decideMission(review, {
    type: 'approve',
    review: approve(reviewConversation, 'Ready to integrate'),
  });
  const done = decideMission(approved, { type: 'integrate' });
  assert.deepEqual([active.status, review.status, approved.status, done.status], [
    'active', 'review', 'integration', 'done',
  ]);
  assert.equal(done.closedAt, null);
});

test('mission lifecycle rejects unsupported jumps and missing handoff evidence', () => {
  const approvedReview = approve();
  assert.throws(() => decideMission(mission('backlog'), { type: 'activate', agent: implementer }), MissionRuleViolation);
  assert.throws(
    () => decideMission(mission('backlog'), { type: 'approve', review: approvedReview }),
    MissionRuleViolation,
  );
  assert.throws(() => decideMission(mission('refined'), { type: 'integrate' }), MissionRuleViolation);
  // integrate from review is forbidden — recovery must approve (review → integration) first
  assert.throws(() => decideMission(mission('review'), { type: 'integrate' }), MissionRuleViolation);
  assert.throws(
    () => decideMission(mission('active'), {
      type: 'submit-for-review',
      gatesPassed: true,
      review: initialReview(),
      reviewerEligibility,
    }),
    /checkpoint evidence/,
  );
  assert.throws(
    () => decideMission({
      ...mission('active'),
      checkpoints: [{ missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1', goalCheck: [], nextActionText: 'x' }],
    }, {
      type: 'submit-for-review',
      gatesPassed: false,
      review: initialReview(),
      reviewerEligibility,
    }),
    /gates pass/,
  );
});

test('reviewer commands are approve or request-changes and approval may carry a comment', () => {
  const review = initialReview();
  const approved = approve(review, 'One non-blocking observation');
  assert.equal(reviewStatus(approved), 'approved');
  assert.equal(currentReviewRound(approved).decision?.kind, 'approved');
  assert.equal(currentReviewRound(approved).decision?.comment, 'One non-blocking observation');

  const changes = applyReviewerCommand(review, {
    type: 'request-changes',
    decidedAt: '2026-07-22T08:30:00Z',
    comment: 'Please address the finding',
    findings: [finding],
  });
  assert.equal(reviewStatus(changes), 'awaiting-implementation');
  assert.throws(() => applyReviewerCommand(changes, {
    type: 'approve',
    decidedAt: 'later',
    comment: null,
    source: { kind: 'local' },
  }), /awaiting-implementation/);
});

test('review assignment accepts only reviewers eligible in user configuration', () => {
  const configuredReviewer = agentFamily('another-configured-reviewer');
  const configuredEligibility = ConfiguredReviewerEligibility.fromReviewStep({
    eligible: [configuredReviewer],
    strategy: 'random',
  });
  assert.equal(startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    configuredReviewer,
    implementer,
    'now',
    configuredEligibility,
  ).rounds[0].reviewer, configuredReviewer);
  assert.throws(() => startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    agentFamily('legacy-default'),
    implementer,
    'now',
    configuredEligibility,
  ), /not eligible under the configured review policy/);
  assert.throws(
    () => ConfiguredReviewerEligibility.fromReviewStep(undefined),
    /explicitly configured review step/,
  );
  assert.throws(
    () => ConfiguredReviewerEligibility.fromReviewStep({ eligible: [], strategy: 'random' }),
    /at least one eligible reviewer/,
  );

  const active = {
    ...mission('active'),
    checkpoints: [{
      missionId: id,
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1: Review ready',
      goalCheck: [{ criterion: 'review', evidence: 'ready' }],
      nextActionText: 'request review',
    }],
  };
  assert.throws(() => decideMission(active, {
    type: 'submit-for-review',
    gatesPassed: true,
    review: initialReview(),
    reviewerEligibility: configuredEligibility,
  }), /not eligible under the configured review policy/);
});

test('implementer resolution accounts for every finding and opens a new revision round', () => {
  const requested = applyReviewerCommand(initialReview(), {
    type: 'request-changes',
    decidedAt: '2026-07-22T08:30:00Z',
    comment: null,
    findings: [finding],
  });
  assert.throws(() => applyImplementerCommand(requested, {
    type: 'submit-resolution',
    respondedAt: '2026-07-22T09:00:00Z',
    resolutions: [],
    resultingRevision: changeRevision('def456'),
  }), /Missing resolution for F1/);

  const resolved = applyImplementerCommand(requested, {
    type: 'submit-resolution',
    respondedAt: '2026-07-22T09:00:00Z',
    resolutions: [{
      findingId: finding.id,
      kind: 'disputed',
      rationale: 'The behavior is required by the mission',
    }],
    resultingRevision: changeRevision('def456'),
  });
  assert.equal(reviewStatus(resolved), 'ready-for-next-round');
  const next = beginNextReviewRound(
    resolved,
    reviewer,
    implementer,
    '2026-07-22T09:01:00Z',
    reviewerEligibility,
  );
  assert.equal(reviewStatus(next), 'awaiting-review');
  assert.equal(next.rounds.length, 2);
  assert.equal(currentReviewRound(next).number, 2);
  assert.equal(currentReviewRound(next).subject.revision, 'def456');
  assert.equal(next.rounds[0].response?.kind, 'resolved');
  assert.throws(() => beginNextReviewRound(
    resolved,
    agentFamily('legacy-default'),
    implementer,
    '2026-07-22T09:01:00Z',
    reviewerEligibility,
  ), /not eligible under the configured review policy/);
});

test('parked and blocked legacy dispositions collapse to human intervention', () => {
  const requested = applyReviewerCommand(initialReview(), {
    type: 'request-changes',
    decidedAt: '2026-07-22T08:30:00Z',
    comment: null,
    findings: [finding],
  });
  const intervention = applyImplementerCommand(requested, {
    type: 'request-human-intervention',
    requestedAt: '2026-07-22T09:00:00Z',
    reason: 'Needs an operator decision before the finding can be resolved',
  });
  assert.equal(reviewStatus(intervention), 'human-intervention');
  assert.equal(intervention.intervention?.requestedBy, 'implementer');
  assert.equal(reviewStatus(resumeReview(intervention)), 'awaiting-implementation');

  const reviewerFailure = requestReviewIntervention(initialReview(), {
    requestedAt: '2026-07-22T09:00:00Z',
    requestedBy: 'workflow',
    reason: 'Reviewer retries exhausted',
  });
  assert.equal(reviewStatus(reviewerFailure), 'human-intervention');
  assert.equal(reviewStatus(resumeReview(reviewerFailure)), 'awaiting-review');
});

test('mission approval must preserve the exact reviewed revision', () => {
  const active = {
    ...mission('active'),
    checkpoints: [{
      missionId: id,
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1: Model the domain',
      goalCheck: [{ criterion: 'model', evidence: 'test' }],
      nextActionText: 'review',
    }],
  };
  const localChange = {
    kind: 'local-branch' as const,
    sourceBranch: 'mission/task-2294',
    targetBranch: 'main',
  };
  const submitted = initialReview(localChange);
  const inReview = decideMission(active, {
    type: 'submit-for-review',
    gatesPassed: true,
    review: submitted,
    reviewerEligibility,
  });
  const wrongRevision = startReview(
    { change: localChange, revision: changeRevision('different') },
    reviewer,
    implementer,
    'now',
    reviewerEligibility,
  );
  assert.throws(() => decideMission(inReview, {
    type: 'approve',
    review: approve(wrongRevision),
  }), /exact reviewed revision/);
  assert.equal(decideMission(inReview, {
    type: 'approve',
    review: applyReviewerCommand(submitted, {
      type: 'approve',
      decidedAt: 'now',
      comment: null,
      source: { kind: 'local' },
    }),
  }).status, 'integration');
});

test('invalid provider identity cannot enter review', () => {
  assert.throws(() => startReview(
    {
      change: { ...pullRequest, provider: '' },
      revision: changeRevision('abc123'),
    },
    reviewer,
    implementer,
    'now',
    reviewerEligibility,
  ), /provider and its opaque id/);
});

test('done remains open until closeout records closure', () => {
  const integrated = mission('done');
  assert.throws(() => requireClosedMission(integrated), /not closed/);
  const closed = closeMission(integrated, '2026-07-22T10:00:00Z');
  assert.equal(requireClosedMission(closed).closedAt, '2026-07-22T10:00:00Z');
  assert.throws(() => closeMission(mission('active'), 'now'), /before integration is done/);
  assert.throws(() => closeMission(integrated, '  '), /closure time/);
  assert.throws(() => closeMission(closed, 'later'), /already closed/);
  assert.throws(() => decideMission(closed, { type: 'activate', agent: implementer }), /was closed/);
});

test('NEL is a replaceable mission attribute captured at handoff', () => {
  const measured = recordNetEngineeringLines(mission('active'), 91);
  assert.equal(measured.netEngineeringLines, 91);
  assert.equal(recordNetEngineeringLines(measured, 74).netEngineeringLines, 74);
  assert.throws(() => recordNetEngineeringLines(measured, -1), /non-negative integer/);
});

test('activation records the actual implementer and may refresh an active assignment', () => {
  const active = { ...mission('active'), assignee: implementer };
  const reassigned = decideMission(active, { type: 'activate', agent: reviewer });
  assert.equal(reassigned.status, 'active');
  assert.equal(reassigned.assignee, reviewer);
});

test('integration queue remains a required durable lifecycle transition', () => {
  const approvedReview = approve();
  const approved = decideMission(
    { ...mission('review'), review: initialReview() },
    { type: 'approve', review: approvedReview },
  );
  const integrated = decideMission(approved, { type: 'integrate' });
  assert.equal(approved.status, 'integration');
  assert.equal(integrated.status, 'done');
  assert.equal(integrated.closedAt, null);
});

test('recording the same checkpoint replaces stale evidence after a redo', () => {
  const first = { missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1: old', goalCheck: [{ criterion: 'old', evidence: 'old' }], nextActionText: 'old action' };
  const replacement = { missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1: new', goalCheck: [{ criterion: 'new', evidence: 'new' }], nextActionText: 'new action' };
  const checkpoints = recordCheckpoint(recordCheckpoint([], first), replacement);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0]?.nextActionText, 'new action');
});

test('resume marker is scoped to mission, role, and extensible agent family', () => {
  const marker = { missionId: id, role: 'execute' as const, agent: agentFamily('new-runner'), lastLaunched: 'now', sessionId: null };
  assert.equal(shouldResume(marker, id, 'execute', agentFamily('new-runner')), true);
  assert.equal(shouldResume(marker, id, 'review', agentFamily('new-runner')), false);
  assert.equal(shouldResume(marker, id, 'execute', implementer), false);
});
