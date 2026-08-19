import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  hasRecordedStageLaunch,
  recordStageLaunch,
  reviewFindingId,
  stageLaunchWindowsFrom,
  startReview,
  STAGE_LAUNCH_HISTORY_LIMIT,
  transitionReviewPhase,
} from '../src/domain/review.js';
import { projectReviewHistory } from '../src/application/projections/mission-board.js';

const reviewer = agentFamily('codex');
const implementer = agentFamily('custom');
const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [reviewer],
} as never);

const subject = {
  change: {
    kind: 'local-branch' as const,
    sourceBranch: 'mission/task-2322.12',
    targetBranch: 'main',
  },
  revision: changeRevision('abc123'),
};

function initialReview() {
  return startReview(subject, reviewer, implementer, '2026-08-02T08:00:00Z', reviewerEligibility);
}

const finding = {
  id: reviewFindingId('F1'),
  summary: 'Workflow phase is not modelled',
  location: 'src/domain/review.ts',
};

test('a new review round starts in the reviewing phase with no retries consumed', () => {
  const round = currentReviewRound(initialReview());
  assert.equal(round.phase, 'reviewing');
  assert.equal(round.disposition, null);
  assert.equal(round.reviewerRetryCount, 0);
  assert.equal(round.implementerRetryCount, 0);
});

test('dispositions that share a decision kind stay distinguishable', () => {
  const blocked = applyReviewerCommand(initialReview(), {
    type: 'request-changes',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: null,
    findings: [finding],
    disposition: 'BLOCKED',
  });
  const pushback = applyReviewerCommand(initialReview(), {
    type: 'request-changes',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: null,
    findings: [finding],
    disposition: 'PUSHBACK_ALL',
  });

  // Both are `changes-requested`; only the disposition tells them apart, which
  // is the loss that kept this state in review-state.json.
  assert.equal(currentReviewRound(blocked).decision?.kind, 'changes-requested');
  assert.equal(currentReviewRound(pushback).decision?.kind, 'changes-requested');
  assert.equal(currentReviewRound(blocked).disposition, 'BLOCKED');
  assert.equal(currentReviewRound(pushback).disposition, 'PUSHBACK_ALL');
});

test('request-changes without an explicit disposition is the generic one', () => {
  const review = applyReviewerCommand(initialReview(), {
    type: 'request-changes',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: null,
    findings: [finding],
  });
  assert.equal(currentReviewRound(review).disposition, 'REQUEST_CHANGES');
  assert.equal(currentReviewRound(review).phase, 'fixing');
});

test('approval moves the round to the approved phase', () => {
  const review = applyReviewerCommand(initialReview(), {
    type: 'approve',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: null,
    source: { kind: 'provider', provider: 'forgejo' },
  });
  assert.equal(currentReviewRound(review).phase, 'approved');
  assert.equal(currentReviewRound(review).disposition, 'APPROVED');
});

test('phase transitions follow the loop table and reject illegal jumps', () => {
  const review = initialReview();
  assert.equal(currentReviewRound(transitionReviewPhase(review, 'fixing')).phase, 'fixing');
  assert.throws(
    () => transitionReviewPhase(review, 'pending-approval'),
    /Review phase "reviewing" cannot move to "pending-approval"/,
  );
  const approved = transitionReviewPhase(review, 'approved');
  assert.throws(
    () => transitionReviewPhase(approved, 'reviewing'),
    /Allowed: none/,
  );
});

test('retry counters reset when a round begins (TASK-2377.04: no domain record method; the round fields survive on ReviewRound)', () => {
  // TASK-2377.04 deleted recordReviewRetry: the persisted per-occurrence
  // retry loops that drove it are gone, and the rebound kernel's budget is
  // in-memory. The round fields survive as round columns (ADR 0053); a new
  // round always starts with both counters at 0.
  let review = applyReviewerCommand(initialReview(), {
    type: 'request-changes',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: null,
    findings: [finding],
  });
  review = applyImplementerCommand(review, {
    type: 'submit-resolution',
    respondedAt: '2026-08-02T10:00:00Z',
    resolutions: [{ findingId: finding.id, kind: 'fixed', evidence: 'modelled on Review' }],
    resultingRevision: changeRevision('def456'),
  });
  const next = beginNextReviewRound(
    review, reviewer, implementer, '2026-08-02T11:00:00Z', reviewerEligibility,
  );
  assert.equal(currentReviewRound(next).reviewerRetryCount, 0);
  assert.equal(currentReviewRound(next).implementerRetryCount, 0);
  assert.equal(currentReviewRound(next).phase, 'reviewing');
});

test('stage launches de-duplicate and survive a round boundary', () => {
  const fingerprint = 'codex|session-1|t0|t1|0';
  let review = recordStageLaunch(initialReview(), 'review:codex', fingerprint);
  assert.ok(hasRecordedStageLaunch(review, 'review:codex', fingerprint));

  // A repeat launch is the same review, so the caller can skip on identity.
  assert.equal(recordStageLaunch(review, 'review:codex', fingerprint), review);

  review = applyReviewerCommand(review, {
    type: 'request-changes',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: null,
    findings: [finding],
  });
  review = applyImplementerCommand(review, {
    type: 'submit-resolution',
    respondedAt: '2026-08-02T10:00:00Z',
    resolutions: [{ findingId: finding.id, kind: 'fixed', evidence: 'modelled on Review' }],
    resultingRevision: changeRevision('def456'),
  });
  const next = beginNextReviewRound(
    review, reviewer, implementer, '2026-08-02T11:00:00Z', reviewerEligibility,
  );
  assert.ok(
    hasRecordedStageLaunch(next, 'review:codex', fingerprint),
    'a new round must not re-open an already recorded launch window',
  );
});

test('a stage window retains only the most recent fingerprints', () => {
  let review = initialReview();
  for (let index = 0; index < STAGE_LAUNCH_HISTORY_LIMIT + 5; index += 1) {
    review = recordStageLaunch(review, 'review:codex', `codex|session-${index}|||0`);
  }
  const [window] = review.stageLaunches;
  assert.equal(window.fingerprints.length, STAGE_LAUNCH_HISTORY_LIMIT);
  assert.ok(!hasRecordedStageLaunch(review, 'review:codex', 'codex|session-0|||0'));
  assert.ok(hasRecordedStageLaunch(review, 'review:codex', 'codex|session-24|||0'));
});

test('stage windows are canonically ordered so a reload is value-identical', () => {
  const review = recordStageLaunch(
    recordStageLaunch(initialReview(), 'review:codex', 'a'),
    'fix:custom',
    'b',
  );
  assert.deepEqual(review.stageLaunches.map((entry) => entry.stageKey), ['fix:custom', 'review:codex']);
});

test('a malformed legacy stage-launch blob is dropped, not thrown on', () => {
  assert.deepEqual(stageLaunchWindowsFrom(undefined), []);
  assert.deepEqual(stageLaunchWindowsFrom('not-an-object'), []);
  assert.deepEqual(
    stageLaunchWindowsFrom({ 'review:codex': ['a', 7, null], '': ['b'], 'fix:custom': 'nope' }),
    [{ stageKey: 'review:codex', fingerprints: ['a'] }],
  );
});

test('review history carries prior verdicts and pushbacks across a reviewer family switch', () => {
  const blocked = agentFamily('claude');
  let review = applyReviewerCommand(initialReview(), {
    type: 'request-changes',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: 'Round 1 needs the domain model',
    findings: [finding, { ...finding, id: reviewFindingId('F2'), summary: 'Second point' }],
    disposition: 'REQUEST_CHANGES',
  });
  review = applyImplementerCommand(review, {
    type: 'submit-resolution',
    respondedAt: '2026-08-02T10:00:00Z',
    resolutions: [
      { findingId: finding.id, kind: 'fixed', evidence: 'modelled on Review' },
      {
        findingId: reviewFindingId('F2'),
        kind: 'disputed',
        rationale: 'Out of mission scope, tracked separately',
      },
    ],
    resultingRevision: changeRevision('def456'),
  });

  // Round 2 is reviewed by a different family: the round-1 reviewer was
  // usage-blocked, so none of its context carries over in-process.
  const next = beginNextReviewRound(
    review, blocked, implementer, '2026-08-02T11:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [blocked] } as never),
  );

  const history = projectReviewHistory(next);
  assert.equal(history.length, 2);
  assert.equal(history[0].reviewer, reviewer);
  assert.equal(history[1].reviewer, blocked);
  assert.equal(history[0].comment, 'Round 1 needs the domain model');
  assert.deepEqual(history[0].fixes, ['F1: modelled on Review']);
  assert.deepEqual(history[0].pushbacks, ['F2: Out of mission scope, tracked separately']);
  assert.deepEqual(history[1].pushbacks, [], 'the open round has no resolutions yet');
});

test('projectReviewHistory falls back to itemDispositions when response.resolutions is empty', () => {
  // Regression: implementer round summary artifact populates itemDispositions
  // but not response.resolutions. Projection must still show fixes/pushbacks.
  const review = startReview(
    subject, reviewer, implementer, '2026-08-02T08:00:00Z', reviewerEligibility,
  );

  // Round 1: reviewer requests changes
  const r1 = applyReviewerCommand(review, {
    type: 'request-changes',
    decidedAt: '2026-08-02T09:00:00Z',
    comment: 'Telemetry and projection findings',
    findings: [
      finding,
      { ...finding, id: reviewFindingId('F2'), summary: 'Projection incomplete' },
    ],
    disposition: 'REQUEST_CHANGES',
  });

  // Round 1 response: itemDispositions set but response.resolutions empty
  // (matches the artifact consumption path where itemDispositions is parsed
  // from the round-resolution.md but formal resolutions not yet converted)
  const round1 = r1.rounds[0];
  const roundWithItems = {
    ...round1,
    response: null,
    itemDispositions: [
      { kind: 'fixed' as const, findingId: finding.id },
      { kind: 'pushed_back' as const, findingId: reviewFindingId('F2') },
    ],
  };
  const reviewWithItems = {
    ...r1,
    rounds: [roundWithItems] as typeof r1.rounds,
  };

  const history = projectReviewHistory(reviewWithItems);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].fixes, ['fixed: F1'], 'itemDispositions fixed shown');
  assert.deepEqual(history[0].pushbacks, ['pushed_back: F2'], 'itemDispositions pushed_back shown');
  assert.deepEqual(history[0].findingSummaries, [finding.summary, 'Projection incomplete']);
});

test('projectReviewHistory restores legacy detail from persisted review events', () => {
  const review = startReview(
    subject, reviewer, implementer, '2026-08-02T08:00:00Z', reviewerEligibility,
  );
  const round = review.rounds[0];
  const history = projectReviewHistory({
    ...review,
    rounds: [{ ...round, disposition: 'CHANGES_MADE' }] as typeof review.rounds,
    reviewEvents: [
      {
        position: 0, eventType: 'reviewer_findings', roundNumber: 1, phase: 'reviewing', actor: 'codex',
        content: '## Finding 1 — Persist review details', disposition: null, verdict: null,
        itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-08-02T09:00:00Z',
      },
      {
        position: 1, eventType: 'reviewer_outcome', roundNumber: 1, phase: 'reviewing', actor: 'codex',
        content: 'Outcome: request-changes\n\n## Summary\nPersist the review continuity.', disposition: null, verdict: 'request-changes',
        itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-08-02T09:01:00Z',
      },
      {
        position: 2, eventType: 'implementer_round_summary', roundNumber: 1, phase: 'fixing', actor: 'custom',
        content: '', disposition: null, verdict: null,
        itemDispositions: [{ kind: 'fixed', findingId: finding.id }], blockedReason: null, followUpReference: null, createdAt: '2026-08-02T10:00:00Z',
      },
    ],
  });

  assert.deepEqual(history[0], {
    number: 1, reviewer, implementer, phase: 'reviewing', disposition: 'REQUEST_CHANGES',
    comment: 'Persist the review continuity.', findingSummaries: ['Persist review details'],
    fixes: ['fixed: F1'], pushbacks: [],
  });
});
