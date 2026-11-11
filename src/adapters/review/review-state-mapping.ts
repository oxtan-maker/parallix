import type { AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import { reviewApprovalOwed, type PullRequestReference, type Review, type ReviewRound } from '../../domain/review.js';
import { assertReviewedChange, parseReviewDisposition } from '../../domain/review.js';
import { assertReviewPhaseTransition, requireReviewPhase, ReviewPhaseViolation } from '../../domain/review-phase-policy.js';
import type { ReviewStateData } from './review-state.js';

/** Return a valid agent family, retaining the aggregate value when input is stale. */
function familyFrom(value: unknown, fallback: AgentFamily): AgentFamily {
  if (typeof value !== 'string' || !value.trim()) { return fallback; }
  try { return agentFamily(value.trim()); } catch { return fallback; }
}

function metadataFromReview(review: Review): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const feedbackSources = review.reviewEvents
    .filter(event => event.eventType === 'human_note' && event.followUpReference?.startsWith('forgejo:'))
    .map(event => event.followUpReference!.split(';', 1)[0])
    .filter((source): source is string => Boolean(source));
  if (feedbackSources.length > 0) { metadata.humanFeedbackSources = [...new Set(feedbackSources)]; }
  if (review.stageLaunches.length > 0) {
    metadata.recordedStageLaunches = Object.fromEntries(
      review.stageLaunches.map(window => [window.stageKey, [...window.fingerprints]]),
    );
  }
  if (review.intervention) {
    metadata.humanEscalationReason = review.intervention.reason;
    metadata.humanEscalatedAt = review.intervention.requestedAt;
  }
  if (reviewApprovalOwed(review)) {
    metadata.approvalOwed = true;
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

/** Flatten the current Review round into the loop-state projection. */
export function reviewStateDataFrom(review: Review): ReviewStateData {
  const current = review.rounds[review.rounds.length - 1];
  return {
    pullRequest: pullRequestFrom(review),
    reviewer: current.reviewer,
    implementer: current.implementer,
    round: current.number,
    startedAt: current.startedAt,
    phase: requireReviewPhase(current.phase),
    disposition: current.disposition,
    metadata: metadataFromReview(review),
  };
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

function reattributedReviewerResults(reviewer: AgentFamily, previous: ReviewRound) {
  const selected = previous.reviewerPolicy?.selected;
  // Two selected identities taking turns are distinct; a previous reviewer the policy dropped was rerouted to the new one.
  if (reviewer === previous.reviewer || !previous.reviewerResults || (selected?.includes(reviewer) && selected.includes(previous.reviewer))) { return previous.reviewerResults; }
  return previous.reviewerResults.map(result => result.agentFamily === previous.reviewer
    ? { ...result, agentFamily: reviewer }
    : result);
}

function implementerFromState(state: ReviewStateData, previous: ReviewRound): AgentFamily {
  // A later fixing-phase fallback is the next implementer, not the author of
  // the revision this recorded judgment evaluated. Keep that historical role
  // immutable once the reviewer has decided this round.
  return previous.decision ? previous.implementer : familyFrom(state.implementer, previous.implementer);
}

function roundFromState(state: ReviewStateData, previous: ReviewRound): ReviewRound {
  const phase = state.phase === undefined ? requireReviewPhase(previous.phase) : requireReviewPhase(state.phase);
  const disposition = state.disposition === undefined ? previous.disposition : parseReviewDisposition(state.disposition);
  const reviewer = familyFrom(state.reviewer, previous.reviewer);
  const startedAt = typeof state.startedAt === 'string' && state.startedAt.trim()
    ? state.startedAt
    : previous.startedAt;
  const staleUndecided = Boolean(previous.decision && phase === 'reviewing' && !state.disposition);
  if (!staleUndecided && phase !== previous.phase) {
    assertReviewPhaseTransition(previous.phase, phase);
  }
  if (phase === 'approved' && previous.decision?.kind !== 'approved') {
    throw new ReviewPhaseViolation('A loop-state write cannot approve a review; record a reviewer verdict first');
  }
  // A reviewer can publish its verdict before a capacity-fallback launch
  // returns. The verdict initially carries the preferred round family; when
  // the launcher later adopts the family that actually ran, keep the result
  // attribution aligned with that authoritative identity as one state write.
  const reviewerResults = reattributedReviewerResults(reviewer, previous);
  return {
    ...previous,
    reviewer,
    ...(reviewerResults ? { reviewerResults } : {}),
    implementer: implementerFromState(state, previous),
    subject: subjectFromState(state, previous),
    startedAt,
    // Typed verdicts and resolutions may commit while an agent is running.
    // Its older flat loop state can update identity, but never erase a decision.
    decision: previous.decision,
    response: previous.response,
    phase: staleUndecided ? previous.phase : phase,
    disposition: staleUndecided ? previous.disposition : disposition,
    // TASK-2377.04: the flat loop state no longer carries the round retry
    // counters (the persisted review-state fields were deleted), so a state
    // update never rewrites them: historical round values round-trip
    // unchanged and a new round shell stores 0.
    reviewerRetryCount: previous.reviewerRetryCount,
    implementerRetryCount: previous.implementerRetryCount,
  };
}

/** Update loop bookkeeping on an existing round without creating decisions or rounds. */
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
  if (suppliedRound !== null && suppliedRound !== current.number) {
    throw new ReviewPhaseViolation(`Cannot apply review state: supplied round ${suppliedRound} differs from current round ${current.number}; open the round through the review workflow`);
  }
  const rounds = [...review.rounds];
  rounds[rounds.length - 1] = roundFromState(state, current);

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

  return { ...review, rounds: [rounds[0], ...rounds.slice(1)], intervention, stageLaunches };
}
