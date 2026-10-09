export interface InvalidContractBlocker {
  readonly command: string;
  readonly diagnostic: string;
  readonly authorityReason: string;
  readonly proposedCorrection: string;
}

export function assertInvalidContractBlocker(value: InvalidContractBlocker): void {
  for (const key of ['command', 'diagnostic', 'authorityReason', 'proposedCorrection'] as const) {
    if (typeof value?.[key] !== 'string' || !value[key].trim()) { throw new Error(`Invalid-contract blocker requires ${key}`); }
  }
}
import { classifyError, hasExplicitHumanOnlyDiagnostic, DispatchAction, FailureClass, type DispatchActionType, type FailureClassType } from './failure-classification.js';
/** A declared verification gate ran and exited non-zero. */
export interface GateFailureReason {
  kind: 'gate-failure';
  /** Agent-discovered locked contract problem, distinct from declaration validation. */
  invalidContract?: InvalidContractBlocker;
  area: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  /** Declared by the verification adapter; the kernel never infers this from prose. */
  transient?: boolean;
  /**
   * Declared for a gate that is an environment/infrastructure failure, not an
   * implementer repair (TASK-2620 AC4). It does not affect the initial
   * classification, so the gate still retries once; after that single retry
   * fails, the kernel returns it to the human instead of launching an
   * implementer. Only agent-smoke sets this today.
   */
  environment?: boolean;
  coverageNote?: string;
  /**
   * The revision the withdrawn approval was given to (TASK-2620 AC3). The
   * implementer fix prompt names it so the repair is understood as a change to
   * previously-approved code, not an independent fix. The classifier never
   * reads it; only the prompt facts print it.
   */
  approvedRevision?: string | null;
}

/** A Git hook rejected a workflow-owned Git operation. */
export interface HookFailureReason {
  kind: 'hook-failure';
  /** Hook identity derived from Git state (`pre-commit`, `pre-push`, …). */
  hook: string | null;
  /** The Git operation the hook rejected, for the fix prompt. */
  operation?: string;
  output: string;
}

/** An agent finished without leaving the artifacts its role must produce. */
export interface ArtifactIncompleteReason {
  kind: 'artifact-incomplete';
  role: string;
  diagnostic: string;
}

/** An agent did not respond within its stage timeout. */
export interface AgentTimeoutReason {
  kind: 'agent-timeout';
  role: string;
  diagnostic?: string;
  /** The concrete artifact or response the role must produce to finish. */
  expectedOutput?: string;
}

/** A handoff verification check rejected the mission. */
export interface HandoffVerificationReason {
  kind: 'handoff-verification';
  error: string;
  gateOutput?: string;
}

/** A declared gate was rejected before process execution. */
export interface DeclaredGateValidationReason {
  kind: 'declared-gate-validation';
  command: string;
  diagnostic: string;
}

/**
 * Every failure kind the kernel can bounce. `gate-failure` and `hook-failure`
 * are wired to the pre-review incident path; the remaining three are part of
 * the contract and are migrated to real consumers by TASK-2377.04/.05.
 */
export type ReboundReason =
  | GateFailureReason
  | HookFailureReason
  | ArtifactIncompleteReason
  | AgentTimeoutReason
  | HandoffVerificationReason
  | DeclaredGateValidationReason;

export interface ReboundClassification {
  failureClass: FailureClassType;
  dispatchAction: DispatchActionType;
  /** False when the table says no agent relaunch can fix this. */
  isRelaunchable: boolean;
  /** Human-readable failure banner used by the fix prompt and logs. */
  label: string;
}
/** Flatten a structured reason into the diagnostic text the classifier reads. */
export function reboundDiagnostic(reason: ReboundReason): string {
  switch (reason.kind) {
    case 'gate-failure':
      return [reason.stdout, reason.stderr, reason.error, ...(reason.invalidContract ? [reason.invalidContract.command, reason.invalidContract.diagnostic, reason.invalidContract.authorityReason, reason.invalidContract.proposedCorrection] : [])].filter(Boolean).join('\n');
    case 'hook-failure':
      return reason.output || '';
    case 'artifact-incomplete':
      return reason.diagnostic || '';
    case 'agent-timeout':
      return reason.diagnostic || `${reason.role} did not respond before its stage timeout`;
    case 'handoff-verification':
      return [reason.error, reason.gateOutput].filter(Boolean).join('\n');
    case 'declared-gate-validation':
      return reason.diagnostic;
  }
}

/** Failure banner per reason kind. */
function reasonLabel(reason: ReboundReason): string {
  switch (reason.kind) {
    case 'gate-failure': return 'PRE-REVIEW GATE FAILURE';
    case 'hook-failure': return 'GIT HOOK FAILURE';
    case 'artifact-incomplete': return 'INCOMPLETE ARTIFACTS';
    case 'agent-timeout': return 'AGENT TIMEOUT';
    case 'handoff-verification': return 'HANDOFF VERIFICATION FAILURE';
    case 'declared-gate-validation': return 'DECLARED GATE VALIDATION FAILURE';
  }
}

/**
 * Classify a structured reason through the single ADR 0048 table.
 *
 * Structured facts decide the class; the diagnostic text only decides whether a
 * recognized human-only blocker (ADR 0048 classes 7 and 8) is present:
 *
 * - `gate-failure`: a declared gate that ran and exited non-zero is a
 *   GateFailure (class 6) — never remapped to a Git blocker.
 * - `hook-failure`: a Git hook rejecting a workflow Git operation is a
 *   mechanical Git blocker (class 5, AutoRepair).
 * - `artifact-incomplete`: incomplete evidence (class 4).
 * - `agent-timeout`: no agent output to act on — infrastructure (class 7).
 * - `handoff-verification`: classified from its own error text, which is the
 *   handoff path's existing evidence.
 *
 * An explicit infrastructure or state-machine diagnostic wins over the
 * structured default for the two incident-path kinds, because its remedy is
 * outside the implementer's working tree.
 */
export function classifyReboundReason(reason: ReboundReason): ReboundClassification {
  const diagnostic = reboundDiagnostic(reason);
  const label = reasonLabel(reason);
  const classified = (failureClass: FailureClassType, dispatchAction: DispatchActionType): ReboundClassification => ({
    failureClass,
    dispatchAction,
    isRelaunchable: dispatchAction !== DispatchAction.HumanOnly,
    label,
  });

  if (reason.kind === 'gate-failure' && reason.invalidContract) {
    return classified(FailureClass.MalformedGates, DispatchAction.HumanOnly);
  }

  if (reason.kind === 'gate-failure' || reason.kind === 'hook-failure') {
    if (hasExplicitHumanOnlyDiagnostic(diagnostic)) {
      const { failureClass, dispatchAction } = classifyError(diagnostic);
      return classified(failureClass, dispatchAction);
    }
    return reason.kind === 'hook-failure'
      ? classified(FailureClass.GitBlockers, DispatchAction.AutoRepair)
      : classified(FailureClass.GateFailure, DispatchAction.AutoSendBack);
  }

  if (reason.kind === 'artifact-incomplete') {
    if (hasExplicitHumanOnlyDiagnostic(diagnostic)) {
      const { failureClass, dispatchAction } = classifyError(diagnostic);
      return classified(failureClass, dispatchAction);
    }
    return classified(FailureClass.IncompleteEvidence, DispatchAction.AutoSendBack);
  }

  if (reason.kind === 'agent-timeout') {
    if (hasExplicitHumanOnlyDiagnostic(diagnostic)) {
      const { failureClass, dispatchAction } = classifyError(diagnostic);
      return classified(failureClass, dispatchAction);
    }
    return classified(FailureClass.IncompleteEvidence, DispatchAction.AutoSendBack);
  }

  if (reason.kind === 'declared-gate-validation') {
    return classified(FailureClass.MalformedGates, DispatchAction.HumanOnly);
  }

  const { failureClass, dispatchAction } = classifyError(diagnostic);
  return classified(failureClass, dispatchAction);
}

/** Known verifier outcomes which are safe to retry once on an unchanged tree. */
export function isTransientVerifierFailure(reason: ReboundReason): boolean {
  return reason.kind === 'gate-failure' && reason.transient === true;
}


export const DEFAULT_REBOUND_ATTEMPTS = 2;

export function transientRetryAllowed(reason: ReboundReason, attempt: number, retries: number): boolean {
  return isTransientVerifierFailure(reason) && attempt <= retries;
}

export function reboundRequiresHuman(reason: ReboundReason, classification: ReboundClassification, afterTransientRetry = false): boolean {
  return afterTransientRetry
    ? isTransientVerifierFailure(reason) && reason.kind === 'gate-failure' && reason.environment === true
    : !classification.isRelaunchable;
}

export function repairStrategy(_attempt: number): 'fresh-diagnostic' {
  return 'fresh-diagnostic';
}

export function launchRecoveryAction(ok: boolean, repairAttempted: boolean, attempts: number, launchFailures: number, maxRetries: number): 'verify' | 'skip' | 'stop' | 'retry' {
  if (ok) { return 'verify'; }
  if (repairAttempted) { return 'skip'; }
  return attempts > 0 || launchFailures + 1 > maxRetries ? 'stop' : 'retry';
}

/** Repair and session retry currencies remain independent. */
export function repairBudgetAllows(attempt: number, maximum: number): boolean { return attempt <= maximum; }
export function reboundExhaustion(classification: ReboundClassification, attempts: number, maximum: number): 'human' | 'repair-budget' | 'launcher-budget' {
  if (!classification.isRelaunchable) { return 'human'; }
  return attempts >= maximum ? 'repair-budget' : 'launcher-budget';
}
