/** Gate outcomes are ordered; a plan or validated skip never claims execution. */
export function integrationGateDisposition(facts: {
  dryRun: boolean; skippedAll: boolean; skipped?: boolean; required: boolean; ok: boolean; cancelled?: boolean;
}): 'plan' | 'validated' | 'mandatory-missing' | 'unconfigured' | 'passed' | 'cancelled' | 'recover' {
  if (facts.dryRun) { return 'plan'; }
  if (facts.skippedAll) { return 'validated'; }
  if (facts.skipped) { return facts.required ? 'mandatory-missing' : 'unconfigured'; }
  if (facts.ok) { return 'passed'; }
  return facts.cancelled ? 'cancelled' : 'recover';
}

/** A failed repair withdraws landing eligibility; changed revisions owe fresh review. */
export function integrationRepairRoute(route: string, reReviewAvailable: boolean): 'resume' | 're-review' | 'stop' {
  if (route === 'fixed') { return 'resume'; }
  return route === 'revision-changed' && reReviewAvailable ? 're-review' : 'stop';
}

export function integrationRepairMustReactivate(route: string, status: string): boolean {
  return route !== 'fixed' && status === 'integration';
}

export function repairedRevisionReviewEligible(invalidated: boolean, reviewDebt: boolean): boolean { return invalidated || reviewDebt; }
export function repairCanResumeIntegration(status: string): boolean { return status === 'integration'; }
