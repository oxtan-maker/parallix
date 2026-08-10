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

function nonNegativeCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function metadataFromReview(review: Review): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (review.stageLaunches.length > 0) {
    metadata.recordedStageLaunches = Object.fromEntries(
      review.stageLaunches.map(window => [window.stageKey, [...window.fingerprints]]),
    );
  }
  if (review.gateFailureRetryCount > 0) {
    metadata.gateFailureRetryCount = review.gateFailureRetryCount;
  }
  if (review.hookFailureRetryCount > 0) {
    metadata.hookFailureRetryCount = review.hookFailureRetryCount;
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
    reviewerRetryCount: current.reviewerRetryCount,
    implementerRetryCount: current.implementerRetryCount,
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
    if (previous?.kind !== 'changes-requested') { return null; }
    return { ...previous, decidedAt: startedAt, comment: disposition };
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
    reviewerRetryCount: nonNegativeCount(state.reviewerRetryCount, previous.reviewerRetryCount),
    implementerRetryCount: nonNegativeCount(state.implementerRetryCount, previous.implementerRetryCount),
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
  const requestedNumber = typeof state.round === 'number' && state.round > 0
    ? Math.floor(state.round) : current.number;
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
  const gateFailureRetryCount = metadata.gateFailureRetryCount === undefined
    ? review.gateFailureRetryCount
    : nonNegativeCount(metadata.gateFailureRetryCount, review.gateFailureRetryCount);
  const hookFailureRetryCount = metadata.hookFailureRetryCount === undefined
    ? review.hookFailureRetryCount
    : nonNegativeCount(metadata.hookFailureRetryCount, review.hookFailureRetryCount);

  const escalationReason = typeof metadata.humanEscalationReason === 'string'
    ? metadata.humanEscalationReason.trim() : '';
  const escalationAt = typeof metadata.humanEscalatedAt === 'string'
    ? metadata.humanEscalatedAt.trim() : '';
  const intervention = escalationReason && escalationAt
    ? { requestedAt: escalationAt, requestedBy: 'workflow' as const, reason: escalationReason }
    : review.intervention;

  return { ...review, rounds: rounds as unknown as Review['rounds'], intervention, stageLaunches, gateFailureRetryCount, hookFailureRetryCount };
}
