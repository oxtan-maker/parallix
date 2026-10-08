export function isIncompleteSuccessCriteriaFailure(errorMsg: string): boolean {
  return /Success criteria [\d, ]+ are incomplete before handoff\./i.test(errorMsg);
}

/** Recorded contract evidence prerequisites, independent of its persistence. */
export function handoffEvidencePolicy(contract: {
  checkpoints: readonly { goalCheck: readonly unknown[] }[];
  successCriteria: readonly string[];
  completedSuccessCriteria: readonly number[];
  draftedInDb: boolean;
}) {
  const latest = contract.checkpoints.at(-1);
  return {
    source: latest ? 'recorded' as const : contract.draftedInDb ? 'missing' as const : 'historical' as const,
    incomplete: contract.successCriteria.flatMap((_, index) => contract.completedSuccessCriteria.includes(index) ? [] : [index + 1]),
    insufficientRows: Boolean(latest && latest.goalCheck.length < contract.successCriteria.length),
  };
}

export function handoffBudgetExceeded(attempt: number): boolean { return attempt > 3; }
