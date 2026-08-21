import type { AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import type { PullRequestReference, Review, ReviewRound, ReviewerDecision, ReviewPhase } from '../../domain/review.js';
import { assertReviewedChange, parseReviewDisposition, parseReviewPhase } from '../../domain/review.js';
import type { ReviewStateData } from './review-state.js';

/** Return a valid agent family, retaining the aggregate value when input is stale. */
function familyFrom(value: unknown, fallback: AgentFamily): AgentFamily {
  if (typeof value !== 'string' || !value.trim()) { return fallback; }
  try { return agentFamily(value.trim()); } catch { return fallback; }
}

function metadataFromReview(review: Review): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (review.stageLaunches.length > 0) {
    metadata.recordedStageLaunches = Object.fromEntries(
      review.stageLaunches.map(window => [window.stageKey, [...window.fingerprints]]),
    );
  }
  if (review.intervention) {
    metadata.humanEscalationReason = review.intervention.reason;
    metadata.humanEscalatedAt = review.intervention.requestedAt;
  }
  return metadata;
}

/**
 * The reviewed change of the current round, when it is a provider pull request.
 *
 * Flattened as a typed value so a consumer of the loop-state view reads the
 * same `PullRequestReference` the aggregate holds instead of reconstructing a
 * branch reference from the slug.
 */
function pullRequestFrom(review: Review): PullRequestReference | null {
  const change = review.rounds[review.rounds.length - 1].subject.change;
  return change.kind === 'pull-request' ? change : null;
}

/** Flatten the current Review round into the legacy loop-state view. */
export function reviewStateDataFrom(review: Review): ReviewStateData {
  const current = review.rounds[review.rounds.length - 1];
  return {
    pullRequest: pullRequestFrom(review),
    reviewer: current.reviewer,
    implementer: current.implementer,
    round: current.number,
    startedAt: current.startedAt,
    phase: current.phase,
    disposition: current.disposition,
    metadata: metadataFromReview(review),
  };
}

function decisionFromState(
  phase: ReviewPhase,
  disposition: string | null,
  startedAt: string,
  previous: ReviewerDecision | null,
): ReviewerDecision | null {
  if (phase === 'approved') {
    return { kind: 'approved', decidedAt: startedAt, comment: disposition, source: { kind: 'local' } };
  }
  if (phase === 'fixing' && disposition) {
    // A flattened legacy state has no finding payload. Retain findings from
    // the aggregate when present; otherwise leave the decision absent rather
    // than manufacturing an invalid changes-requested decision with no finds.
    // `startedAt` is the round's start, not the decision time. Approve reads
    // the same value on both sides of its boundary, but a retained
    // changes-requested decision already carries the real `decidedAt` that
    // fired `review -> active`; rewriting it here would skew the aggregate
    // away from the lane event's `occurredAt`.
    if (previous?.kind !== 'changes-requested') { return null; }
    return { ...previous, comment: disposition };
  }
  return null;
}

/**
 * The subject of the updated round.
 *
 * A flattened writer that has confirmed a provider pull request promotes the
 * round's change to that reference; a writer that carries none leaves the
 * aggregate's existing change untouched. An invalid reference is ignored rather
 * than written onto the round.
 */
function subjectFromState(state: ReviewStateData, previous: ReviewRound): ReviewRound['subject'] {
  if (!state.pullRequest) {
    return previous.subject;
  }
  const change: PullRequestReference = { ...state.pullRequest, kind: 'pull-request' };
  try {
    assertReviewedChange(change);
  } catch {
    return previous.subject;
  }
  return { ...previous.subject, change };
}

function roundFromState(state: ReviewStateData, previous: ReviewRound): ReviewRound {
  const phase = parseReviewPhase(state.phase) ?? 'reviewing';
  const disposition = parseReviewDisposition(state.disposition);
  const startedAt = typeof state.startedAt === 'string' && state.startedAt.trim()
    ? state.startedAt
    : previous.startedAt;
  return {
    ...previous,
    number: typeof state.round === 'number' && state.round > 0 ? Math.floor(state.round) : previous.number,
    reviewer: familyFrom(state.reviewer, previous.reviewer),
    implementer: familyFrom(state.implementer, previous.implementer),
    subject: subjectFromState(state, previous),
    startedAt,
    decision: decisionFromState(phase, state.disposition ?? null, startedAt, previous.decision),
    response: null,
    phase,
    disposition,
    // TASK-2377.04: the flat loop state no longer carries the round retry
    // counters (the persisted review-state fields were deleted), so a state
    // update never rewrites them: historical round values round-trip
    // unchanged and a new round shell stores 0.
    reviewerRetryCount: previous.reviewerRetryCount,
    implementerRetryCount: previous.implementerRetryCount,
  };
}

/**
 * Apply a flattened legacy state update to the Review aggregate.
 *
 * This is intentionally a compatibility mapper, not a second domain workflow:
 * the aggregate's conversation and audit trail remain untouched. When a
 * legacy writer advances the round number, a new current-round shell is made
 * from the prior subject; normal handoff/review commands fill in its subject
 * and conversation details afterward.
 */
export function applyReviewStateToReview(review: Review, state: ReviewStateData): Review {
  const current = review.rounds[review.rounds.length - 1];
  const suppliedRound = typeof state.round === 'number' && state.round > 0
    ? Math.floor(state.round) : null;
  // TASK-2385: a flattened write carrying a round lower than the current round
  // previously fell through to `roundFromState`, which rewrote the newest round
  // downward (round 2 -> round 1) and then failed the round uniqueness constraint
  // on the SQLite write, dropping the verdict. Reject it before persistence with a
  // diagnostic naming both conflicting rounds so the two numbers are actionable.
  if (suppliedRound !== null && suppliedRound < current.number) {
    throw new Error(
      `Cannot apply review state: supplied round ${suppliedRound} is lower than the current round ${current.number}; a stale flattened write must not renumber an existing round`,
    );
  }
  const requestedNumber = suppliedRound ?? current.number;
  const rounds = [...review.rounds] as ReviewRound[];
  while (rounds.length < requestedNumber) {
    const previous = rounds[rounds.length - 1];
    rounds.push({
      ...previous,
      number: previous.number + 1,
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    });
  }
  // ponytail: the current round is the only slot a flat writer mutates; a stale
  // lower round is rejected above, an equal round rewrites in place, and a higher
  // round appends before this line rewrites the new tail.
  rounds[rounds.length - 1] = roundFromState(state, rounds[rounds.length - 1]);

  const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata : {};
  const recorded = metadata.recordedStageLaunches;
  const stageLaunches = recorded === undefined ? review.stageLaunches
    : Object.entries(recorded as Record<string, unknown>)
      .filter(([, fingerprints]) => Array.isArray(fingerprints))
      .map(([stageKey, fingerprints]) => ({
        stageKey,
        fingerprints: (fingerprints as unknown[]).filter((entry): entry is string => typeof entry === 'string'),
      }))
      .filter(window => window.stageKey.trim() && window.fingerprints.length > 0);
  const escalationReason = typeof metadata.humanEscalationReason === 'string'
    ? metadata.humanEscalationReason.trim() : '';
  const escalationAt = typeof metadata.humanEscalatedAt === 'string'
    ? metadata.humanEscalatedAt.trim() : '';
  const intervention = escalationReason && escalationAt
    ? { requestedAt: escalationAt, requestedBy: 'workflow' as const, reason: escalationReason }
    : review.intervention;

  return { ...review, rounds: rounds as unknown as Review['rounds'], intervention, stageLaunches };
}
