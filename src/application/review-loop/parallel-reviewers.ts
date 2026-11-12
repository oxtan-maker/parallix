import type { ReviewLoopState } from '../ports/review-round.js';
import { ReviewRound, type LoopContext } from './round.js';

export interface ReviewerRunResult {
  readonly stopped: boolean;
  readonly reviewState?: unknown;
}

export interface ParallelReviewerCollaborators {
  launch(_context: LoopContext, _round: ReviewRound): Promise<'stop' | 'replaced' | 'approved' | null>;
  consume(_context: LoopContext, _round: ReviewRound): Promise<{ readonly step: 'stop' | null; readonly reviewState?: unknown }>;
  recover(_context: LoopContext, _round: ReviewRound, _reviewState: unknown): Promise<{ readonly step: 'stop' | null; readonly reviewState?: unknown }>;
  recordApproval(_context: LoopContext, _round: ReviewRound): Promise<void>;
  persistedOutcome(): Promise<string | null>;
}

export interface ParallelReviewerResult extends ReviewerRunResult {
  readonly reviewer: string;
  readonly round: ReviewRound;
  readonly escalationReasons: readonly string[];
}

/** One selected reviewer gets private mutable loop scratch over shared authorities. */
function isolatedReviewer(context: LoopContext, source: ReviewRound, reviewer: string): { context: LoopContext; round: ReviewRound; reasons: string[] } {
  // Some state adapters return an existing class instance unchanged. Pass a
  // plain snapshot so concurrent reviewers cannot share and overwrite its
  // mutable `reviewer`, phase, or retry fields.
  const state = context.ports.state.resume({ ...context.state });
  state.reviewer = reviewer;
  const reasons: string[] = [];
  const localState = {
    ...context.ports.state,
    // Parallel reviewer scratch must not flatten one identity over another in
    // the shared Review. Verdict/policy methods above remain authoritative.
    persist: async (_next: ReviewLoopState) => {},
  };
  const isolated: LoopContext = {
    ...context,
    parallelReviewer: true,
    ports: { ...context.ports, state: localState },
    state,
    identities: { ...context.identities, reviewer },
    escalateToHumanReview: async reason => { reasons.push(reason); },
  };
  const round = new ReviewRound(source.attempt, isolated);
  round.reviewBaseline = source.reviewBaseline;
  round.preReviewSetupVerified = source.preReviewSetupVerified;
  round.verifiedRevision = source.verifiedRevision;
  round.integrationRepair = source.integrationRepair;
  round.preReviewRepair = source.preReviewRepair;
  round.humanFeedback = source.humanFeedback;
  return { context: isolated, round, reasons };
}

/**
 * Start every selected reviewer before awaiting the batch. Promise.all keeps
 * each admitted launch under its existing admission, watchdog, retry and
 * cancellation owners while ensuring the coordinator observes all settlements.
 */
export async function runParallelReviewers(
  context: LoopContext,
  round: ReviewRound,
  reviewers: readonly string[],
  run: (_context: LoopContext, _round: ReviewRound) => Promise<ReviewerRunResult>,
): Promise<readonly ParallelReviewerResult[]> {
  return await Promise.all(reviewers.map(async reviewer => {
    const isolated = isolatedReviewer(context, round, reviewer);
    try {
      const result = await run(isolated.context, isolated.round);
      return { ...result, reviewer, round: isolated.round, escalationReasons: isolated.reasons };
    } catch (error) {
      isolated.reasons.push(`Reviewer ${reviewer} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { stopped: true, reviewer, round: isolated.round, escalationReasons: isolated.reasons };
    }
  }));
}

async function runOne(context: LoopContext, round: ReviewRound, claimed: Set<string>, collaborators: ParallelReviewerCollaborators,
  serializeSettlement: <T>(_work: () => Promise<T>) => Promise<T>): Promise<ReviewerRunResult> {
  for (;;) {
    const requested = context.identities.reviewer;
    const launch = await collaborators.launch(context, round);
    if (launch === 'approved') { return { stopped: false, reviewState: 'APPROVED' }; }
    if (launch === 'replaced') {
      let replacement = context.identities.reviewer;
      if (replacement !== requested && claimed.has(replacement)) {
        const revision = round.verifiedRevision ?? context.ports.preReview.head();
        const progress = revision ? await context.ports.state.reviewerProgress(context.state, revision) : null;
        const unclaimed = progress?.outstanding.find(reviewer => !claimed.has(reviewer));
        if (!unclaimed) { return { stopped: false }; }
        replacement = unclaimed;
        context.identities.reviewer = replacement;
        context.state.reviewer = replacement;
      }
      claimed.add(replacement);
      continue;
    }
    if (launch) { return { stopped: true }; }
    const actual = context.identities.reviewer;
    if (actual !== requested) {
      if (claimed.has(actual)) { return { stopped: false }; }
      claimed.add(actual);
    }
    return await serializeSettlement(async () => {
      const consumed = await collaborators.consume(context, round);
      if (consumed.step) { return { stopped: true }; }
      const recovered = await collaborators.recover(context, round, consumed.reviewState);
      if (!recovered.step && recovered.reviewState === 'APPROVED') { await collaborators.recordApproval(context, round); }
      return recovered.step ? { stopped: true } : { stopped: false, reviewState: recovered.reviewState };
    });
  }
}

/** Reconcile a complete parallel batch without starting repair while any reviewer remains active. */
export async function runParallelReviewerBatch(
  context: LoopContext,
  round: ReviewRound,
  reviewers: readonly string[],
  collaborators: ParallelReviewerCollaborators,
): Promise<ReviewerRunResult> {
  const claimed = new Set(reviewers);
  let settlement = Promise.resolve();
  const serializeSettlement = async <T>(work: () => Promise<T>): Promise<T> => {
    const current = settlement.then(work);
    settlement = current.then(() => {}, () => {});
    return await current;
  };
  const results = await runParallelReviewers(context, round, reviewers,
    async (isolated, isolatedRound) => await runOne(isolated, isolatedRound, claimed, collaborators, serializeSettlement));
  round.blockingFindings = results.flatMap(result => result.round.blockingFindings);
  round.used = Math.max(round.used, ...results.map(result => result.round.used));
  const authoritative = await collaborators.persistedOutcome();
  if (authoritative) { return { stopped: false, reviewState: authoritative }; }
  const failed = results.find(result => result.stopped);
  if (failed) {
    await context.escalateToHumanReview(failed.escalationReasons[0] ?? 'REVIEWER_NON_APPROVAL');
    return { stopped: true };
  }
  const negative = results.find(result => result.reviewState && result.reviewState !== 'APPROVED');
  if (negative) { return { stopped: false, reviewState: negative.reviewState }; }
  await context.escalateToHumanReview('REVIEWER_NON_APPROVAL');
  return { stopped: true };
}
