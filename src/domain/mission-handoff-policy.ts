import { uncoveredCompletedCriteria as completedUncoveredCriteria } from './checkpoint.js';

export function isIncompleteSuccessCriteriaFailure(errorMsg: string): boolean {
  return /Success criteria [\d, ]+ are incomplete before handoff\./i.test(errorMsg);
}

/**
 * Recorded contract evidence prerequisites, independent of its persistence.
 *
 * Coverage is evaluated across every recorded checkpoint, not just the last, and
 * as distinct success-criterion identities rather than a sum of row counts:
 * a repair checkpoint may carry only the rows for the criteria it affects while
 * valid earlier evidence for the other criteria is retained. A row covers the
 * criterion whose identity its `criterion` field equals, so repeated repair rows
 * for one criterion do not count as coverage for another. Handoff refuses only
 * when the recorded checkpoints taken together still leave a completed criterion
 * without a row naming it.
 */
export function handoffEvidencePolicy(contract: {
  checkpoints: readonly { goalCheck: readonly unknown[] }[];
  successCriteria: readonly string[];
  completedSuccessCriteria: readonly number[];
  draftedInDb: boolean;
}) {
  const recorded = contract.checkpoints;
  const insufficientRows = recorded.length > 0
    && completedUncoveredCriteria(
      recorded as { readonly goalCheck: readonly import('./checkpoint.js').GoalCheckRow[] }[],
      contract.successCriteria,
      contract.completedSuccessCriteria,
    ).length > 0;
  return {
    source: recorded.length ? 'recorded' as const : contract.draftedInDb ? 'missing' as const : 'historical' as const,
    incomplete: contract.successCriteria.flatMap((_, index) => contract.completedSuccessCriteria.includes(index) ? [] : [index + 1]),
    insufficientRows,
  };
}

export function handoffBudgetExceeded(attempt: number): boolean { return attempt > 3; }
