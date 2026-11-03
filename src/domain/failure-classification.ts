import { failureReasonFromCause, recognizedFailureReason, type FailureReason } from './failure-reason.js';
/** One dispatch policy over versioned producer facts. Diagnostics never decide recovery. */
export const FailureClass = {
  UnverifiableClaims: 'UnverifiableClaims',
  MalformedGates: 'MalformedGates',
  MissingArtifacts: 'MissingArtifacts',
  IncompleteEvidence: 'IncompleteEvidence',
  GitBlockers: 'GitBlockers',
  GateFailure: 'GateFailure',
  AgentCapacity: 'AgentCapacity',
  InfraBlocker: 'InfraBlocker',
  StateMachineViolation: 'StateMachineViolation',
  ResourceFailure: 'ResourceFailure',
  ProviderFailure: 'ProviderFailure',
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
  [FailureClass.AgentCapacity]: DispatchAction.AutoRepair,
  [FailureClass.InfraBlocker]: DispatchAction.HumanOnly,
  [FailureClass.StateMachineViolation]: DispatchAction.HumanOnly,
  [FailureClass.ResourceFailure]: DispatchAction.HumanOnly,
  [FailureClass.ProviderFailure]: DispatchAction.HumanOnly,
};

/**
 * Look up the dispatch action for a given failure class.
 *
 * @param failureClass - One of the failure class values from ADR 0048
 * @returns The prescribed dispatch action, or null if unknown
 */
export function getDispatchAction(failureClass: FailureClassType): DispatchActionType | null {
  return DISPATCH_TABLE[failureClass] ?? null;
}

/**
 * Sub-reason for GitBlockers classification: distinguishes dirty-artifact from behind-branch errors.
 * Used by repairReviewPreparation() to decide whether to auto-rebase (behind) vs auto-commit only (dirty).
 *
 * NOTE: ADR 0048 defines eight classes; `AgentCapacity` (task-2494) is a
 * narrowly-scoped addition for agent usage/quota blocks so they are not
 * misclassified as infrastructure blockers.
 */
export type GitBlockerReason = 'dirty' | 'behind' | 'other';

/** Classification accepts machine facts only. Diagnostic text is retained by callers. */
const REASON_CLASSES: Readonly<Record<string, FailureClassType>> = {
  'state-machine': FailureClass.StateMachineViolation,
  'approval-retention-pending': FailureClass.StateMachineViolation,
  'agent-quota': FailureClass.AgentCapacity,
  'provider-rate-limit': FailureClass.AgentCapacity,
  'mission-contract-incomplete': FailureClass.IncompleteEvidence,
  'incomplete-evidence': FailureClass.IncompleteEvidence,
  'incomplete-success-criteria': FailureClass.IncompleteEvidence,
  'missing-artifacts': FailureClass.MissingArtifacts,
  'unverifiable-claims': FailureClass.UnverifiableClaims,
  'malformed-gates': FailureClass.MalformedGates,
  'git-hook-failed': FailureClass.GitBlockers,
  'git-conflict': FailureClass.GitBlockers,
  'git-dirty': FailureClass.GitBlockers,
  'git-behind': FailureClass.GitBlockers,
  'git-failed': FailureClass.GitBlockers,
  'git-remote-missing': FailureClass.GitBlockers,
  'gate-failed': FailureClass.GateFailure,
  'cpu-budget-exceeded': FailureClass.GateFailure,
  'process-terminated': FailureClass.GateFailure,
  'resource-exhausted': FailureClass.ResourceFailure,
  'provider-auth': FailureClass.ProviderFailure,
  'provider-unavailable': FailureClass.ProviderFailure,
  'provider-entitlement': FailureClass.ProviderFailure,
  'provider-config': FailureClass.ProviderFailure,
  'provider-session-missing': FailureClass.ProviderFailure,
};

export function classifyFailure(failureReason: unknown): { failureClass: FailureClassType; dispatchAction: DispatchActionType; reason?: GitBlockerReason } {
  const typed = recognizedFailureReason(failureReason);
  const code = typed?.code;
  const failureClass = REASON_CLASSES[code ?? ''] ?? FailureClass.InfraBlocker;
  return { failureClass, dispatchAction: code === 'approval-retention-pending' ? DispatchAction.AutoRepair : code === 'git-failed' || code === 'git-remote-missing' ? DispatchAction.HumanOnly : DISPATCH_TABLE[failureClass],
    ...(code === 'git-dirty' ? { reason: 'dirty' as const } : code === 'git-behind' ? { reason: 'behind' as const } : {}) };
}

/** Compatibility for diagnostic-bearing callers; missing/unsupported facts fail closed. */
export function classifyError(_diagnostic: string, failureReason?: unknown) { return classifyFailure(failureReason); }

/** Producer-side process annotation uses exit protocol, signal, or supplied machine evidence. */
export function gateFailureReasonFromProcess(input: { status?: number | null; signal?: string | null; stdout?: unknown; stderr?: unknown; failureReason?: unknown; error?: unknown }): FailureReason | undefined {
  const prior = recognizedFailureReason(input.failureReason);
  if (input.failureReason !== undefined && (!prior || prior.code !== 'process-failed')) { return input.failureReason as FailureReason; }
  if (input.error) { return failureReasonFromCause(input.error, 'process'); }
  if (input.status === 0 && !input.signal) { return undefined; }
  for (const line of [input.stdout, input.stderr].flatMap(value => String(value ?? '').split('\n'))) {
    try {
      const event = JSON.parse(line) as { type?: unknown; failureReason?: unknown };
      const reason = event?.type === 'parallix.failure' ? recognizedFailureReason(event.failureReason) : null;
      if (reason) { return reason; }
    } catch { /* Non-protocol output remains diagnostic evidence only. */ }
  }
  // EX_TEMPFAIL is the runner-health admission protocol.
  return { version: 1, code: input.status === 75 ? 'infrastructure' : input.signal ? 'process-terminated' : 'gate-failed',
    ...(prior ? { source: 'verification' as const, context: prior.context } : {}) };

}
