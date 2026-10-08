/** Rebase continuation and recovery decisions over observed Git/launcher facts. */
export function rebaseHookRecoveryEligible(status: number | null, hookFailure: boolean, missionServicesAvailable: boolean): boolean {
  return status !== 0 && hookFailure && missionServicesAvailable;
}

export function replacementImplementer(selected: string | null, implementer: string, supported: boolean, launcherAgent?: string | null): string | null {
  return selected && selected !== implementer && supported ? launcherAgent ?? selected : null;
}

export function preContinueAction(status: number | null, conflicts: boolean, staged: boolean, rebasing: boolean): 'completed' | 'recursed' | 'retry' {
  if (status === 0) { return 'completed'; }
  if (conflicts) { return 'recursed'; }
  return staged || rebasing ? 'retry' : 'completed';
}

export function postContinueAction(status: number | null, conflicts: boolean, rebasing: boolean, attempts: number, max: number, staged: boolean): 'completed' | 'retry' | 'budget-exhausted' | 'staged-failure' {
  if (status === 0) { return 'completed'; }
  if (conflicts) { return 'retry'; }
  if (!rebasing) { return 'completed'; }
  if (continueBudgetExceeded(attempts, max)) { return 'budget-exhausted'; }
  return staged ? 'staged-failure' : 'retry';
}

export function continueBudgetExceeded(attempts: number, max: number): boolean { return attempts >= max; }
