/**
 * ADR 0048 failure classification (single dispatch table).
 *
 * The eight failure classes, the three dispatch actions, and the pattern-based
 * classifier live here — in the application layer — so the rebound kernel and
 * the adapter-side repair path consume one table instead of maintaining
 * parallel classifiers. `src/adapters/cli/commands/repair-handoff.ts` re-exports
 * these symbols for its existing callers.
 *
 * Application layer: pure string logic, no I/O.
 */

// ── FailureClass: 8 classes from ADR 0048 ────────────────────────────────────
export const FailureClass = {
  UnverifiableClaims: 'UnverifiableClaims',
  MalformedGates: 'MalformedGates',
  MissingArtifacts: 'MissingArtifacts',
  IncompleteEvidence: 'IncompleteEvidence',
  GitBlockers: 'GitBlockers',
  GateFailure: 'GateFailure',
  InfraBlocker: 'InfraBlocker',
  StateMachineViolation: 'StateMachineViolation',
} as const;

export type FailureClassType = (typeof FailureClass)[keyof typeof FailureClass];

// ── DispatchAction: 3 actions from ADR 0048 ──────────────────────────────────
export const DispatchAction = {
  AutoRepair: 'AutoRepair',
  AutoSendBack: 'AutoSendBack',
  HumanOnly: 'HumanOnly',
} as const;

export type DispatchActionType = (typeof DispatchAction)[keyof typeof DispatchAction];

// ── Dispatch table: maps each failure class to its prescribed action (ADR 0048) ─
export const DISPATCH_TABLE: Record<FailureClassType, DispatchActionType> = {
  [FailureClass.UnverifiableClaims]: DispatchAction.AutoSendBack,
  [FailureClass.MalformedGates]: DispatchAction.AutoRepair,
  [FailureClass.MissingArtifacts]: DispatchAction.AutoSendBack,
  [FailureClass.IncompleteEvidence]: DispatchAction.AutoSendBack,
  [FailureClass.GitBlockers]: DispatchAction.AutoRepair,
  [FailureClass.GateFailure]: DispatchAction.AutoSendBack,
  [FailureClass.InfraBlocker]: DispatchAction.HumanOnly,
  [FailureClass.StateMachineViolation]: DispatchAction.HumanOnly,
};

/**
 * Look up the dispatch action for a given failure class.
 *
 * @param failureClass - One of the 8 failure class values from ADR 0048
 * @returns The prescribed dispatch action, or null if unknown
 */
export function getDispatchAction(failureClass: FailureClassType): DispatchActionType | null {
  return DISPATCH_TABLE[failureClass] ?? null;
}

/**
 * Sub-reason for GitBlockers classification: distinguishes dirty-artifact from behind-branch errors.
 * Used by repairHandoff() to decide whether to auto-rebase (behind) vs auto-commit only (dirty).
 */
export type GitBlockerReason = 'dirty' | 'behind' | 'other';

/**
 * Diagnostics whose remedy lies outside the implementer's working tree.
 *
 * These are the recognized infrastructure and state-machine markers of ADR 0048
 * classes 7 and 8. The kernel uses this rule to tell an *explicit* human-only
 * diagnostic apart from `classifyError`'s catch-all InfraBlocker default, which
 * merely means "no pattern matched". Before the rebound kernel this rule lived
 * as an ad-hoc regex at the pre-review gate call site; it is now a named rule of
 * the classifier with no independent consumer.
 */
const EXPLICIT_HUMAN_ONLY_DIAGNOSTIC_RE = /state\s+violation|invalid\s+state|transition\s+not\s+allowed|cannot\s+(move|transition)\s+(from|to)\s+\w+\s+(to|from)|forgejo|infrastructure|authentication\s+failed|token\s+(expired|invalid|missing)|forbidden|unauthorized\s+(access|request)|rate\s+limit|connection\s+(refused|timed?\s*out)|network\s+error/i;

/**
 * True when the diagnostic names a recognized infrastructure or state-machine
 * blocker, as opposed to landing on the classifier's human-only default.
 */
export function hasExplicitHumanOnlyDiagnostic(diagnostic: string): boolean {
  if (!diagnostic || typeof diagnostic !== 'string') {
    return false;
  }
  const { dispatchAction } = classifyError(diagnostic);
  return dispatchAction === DispatchAction.HumanOnly
    && EXPLICIT_HUMAN_ONLY_DIAGNOSTIC_RE.test(diagnostic);
}

/**
 * Classify an error message into one of the 8 failure classes from ADR 0048
 * and return the associated dispatch action.
 *
 * Patterns are checked in order of specificity to avoid collisions.
 * Returns a `reason` field for GitBlockers to distinguish dirty-artifact from behind-branch errors,
 * allowing callers to derive repair-strategy flags without duplicating pattern matching.
 *
 * @param errorMsg - The error message to classify
 * @returns Object with failureClass, dispatchAction, and (for GitBlockers) reason
 */
export function classifyError(errorMsg: string): { failureClass: FailureClassType; dispatchAction: DispatchActionType; reason?: GitBlockerReason } {
  if (!errorMsg || typeof errorMsg !== 'string') {
    return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
  }

  // 1. IncompleteEvidence: goal-check table missing or lacking evidence rows
  // (most specific — checked before generic gate patterns).
  // Covers both "missing section" and "section present but no valid evidence".
  if (errorMsg.includes('"## Goal Check"') &&
      errorMsg.includes('required before handoff')) {
    return { failureClass: FailureClass.IncompleteEvidence, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 1b. IncompleteEvidence: checkpoint missing Goal Check section entirely
  // (architecture migration: handoff.ts emits "missing a \"## Goal Check\" section" for
  // checkpoints that lack the required heading).
  if (errorMsg.includes('missing a') && errorMsg.includes('"## Goal Check" section')) {
    return { failureClass: FailureClass.IncompleteEvidence, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 1c. IncompleteEvidence: no checkpoint documents found at all
  // (architecture migration: validateCheckpointsBeforeHandoff emits "No checkpoint documents
  // found" — classify as IncompleteEvidence so the lifecycle can relaunch the
  // implementer with a targeted repair prompt rather than stranding on manual
  // instructions).
  if (errorMsg.includes('No checkpoint documents found') &&
      errorMsg.includes('Goal Check table')) {
    return { failureClass: FailureClass.IncompleteEvidence, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 2. GitBlockers: dirty/uncommitted mission artifacts (mechanical git blocker — auto-repairable)
  if (errorMsg.includes('is modified but uncommitted') ||
      errorMsg.includes('Commit the mission contract before handoff') ||
      errorMsg.includes('Commit the implementation evidence before handoff')) {
    return { failureClass: FailureClass.GitBlockers, dispatchAction: DispatchAction.AutoRepair, reason: 'dirty' };
  }

  // 3. GitBlockers: branch behind primary / push rejected (mechanical git blocker — auto-repairable via rebase)
  if (errorMsg.includes('Updates were rejected') ||
      errorMsg.includes('fetch first') ||
      errorMsg.includes('non-fast-forward') ||
      errorMsg.includes('behind its remote') ||
      (errorMsg.includes('git push failed') && (
        errorMsg.includes('rejected') ||
        errorMsg.includes('remote contains work')
      ))) {
    return { failureClass: FailureClass.GitBlockers, dispatchAction: DispatchAction.AutoRepair, reason: 'behind' };
  }

  // 4. GateFailure: verification gate failed
  if (/verification gate failed/i.test(errorMsg)) {
    return { failureClass: FailureClass.GateFailure, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 5. GateFailure: pre-handoff rebase failed. This generic wrapper can hide
  // the verification-gate failure that caused the rebase command to fail.
  if (/rebase failed before handoff/i.test(errorMsg)) {
    return { failureClass: FailureClass.GateFailure, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 6. GateFailure: declared gate failed
  if (/\bdeclared gate\b/i.test(errorMsg) && /\bfailed\b/i.test(errorMsg)) {
    return { failureClass: FailureClass.GateFailure, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 7. UnverifiableClaims: test claims that cannot be verified
  if (/test(s?\s+)?passed/i.test(errorMsg) && /cannot\s+verify|unverifiable|proof\s+(not\s+)?found|stale\s+proof/i.test(errorMsg)) {
    return { failureClass: FailureClass.UnverifiableClaims, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 8. MalformedGates: malformed or non-runnable declared gates
  if (/malformed\s+gate|invalid\s+gate\s+config|gate\s+command\s+(not\s+found|syntax\s+error|not\s+runnable)/i.test(errorMsg) ||
      (/gate/i.test(errorMsg) && /syntax\s+error|not\s+found|missing\s+(file|command)/i.test(errorMsg))) {
    return { failureClass: FailureClass.MalformedGates, dispatchAction: DispatchAction.AutoRepair };
  }

  // 9. MissingArtifacts: mandatory mission artifacts missing.
  // The "even after auto-remediation" substring is the stable marker of the
  // handoff checkpoint failure (handoff.ts emits "No checkpoint documents
  // found in ... even after auto-remediation."): checkpoint evidence is a
  // mandatory artifact, so the implementer is auto-sent-back per ADR 0048.
  if (errorMsg.includes('even after auto-remediation') ||
      /mandatory\s+(artifact|file|document)|missing\s+(mission\s+)?(artifact|file|document)|required\s+(artifact|file|document)\s+(not\s+)?found/i.test(errorMsg) ||
      (/gatekeeper/i.test(errorMsg) && /missing\s+(artifact|file|document)/i.test(errorMsg))) {
    return { failureClass: FailureClass.MissingArtifacts, dispatchAction: DispatchAction.AutoSendBack };
  }

  // 10. StateMachineViolation: task state machine violations
  if (/state\s+violation|invalid\s+state|transition\s+not\s+allowed|cannot\s+(move|transition)\s+(from|to)\s+\w+\s+(to|from)/i.test(errorMsg) ||
      (/task\s+state/i.test(errorMsg) && /invalid|violation|incorrect/i.test(errorMsg))) {
    return { failureClass: FailureClass.StateMachineViolation, dispatchAction: DispatchAction.HumanOnly };
  }

  // 11. InfraBlocker: forgejo/infrastructure blockers
  if (/forgejo|infrastructure|authentication\s+failed|token\s+(expired|invalid|missing)|forbidden|unauthorized\s+(access|request)|rate\s+limit|connection\s+(refused|timed?\s*out)|network\s+error/i.test(errorMsg)) {
    return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
  }

  // 12. InfraBlocker: reviewer non-submission (ADR 0048 — human-only after bounded retries)
  // Matches: "Reviewer X did not submit a formal review outcome" and
  // "Reviewer X did not leave a complete local review handoff".
  if (/did not (submit|leave).*(review (outcome|handoff)|formal review)/i.test(errorMsg)) {
    return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
  }

  // Default: human-only for unrecognized errors
  return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
}
