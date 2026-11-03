import { gateFailureReasonFromProcess } from '../domain/failure-classification.js';
import { failureReason, type FailureReason, type FailureReasonCode, type FailureSource } from '../domain/failure-reason.js';
import type { ReviewPreparationResult } from './ports/review-preparation-workflow.js';

/** One boundary for producer-owned identity and recovery evidence. */
export function preparationFailure(error: string, code: FailureReasonCode, source: FailureSource = 'review-preparation', context?: FailureReason['context']): ReviewPreparationResult & { ok: false; error: string } {
  const reason = failureReason(code, source, context);
  return { ok: false, error, failureReason: reason,
    recoveryFailure: { kind: 'review-preparation-verification', error, failureReason: reason } };
}

export function preparationRecoveryReason(result: ReviewPreparationResult | import('./ports/execute-mission.js').ReviewPreparationRunResult) {
  return result.recoveryFailure ?? (result.gateFailure ? { kind: 'gate-failure' as const, ...result.gateFailure }
    : { kind: 'review-preparation-verification' as const, error: result.error ?? 'Review preparation failed', failureReason: result.failureReason, gateOutput: [result.gateOutput?.stdout, result.gateOutput?.stderr].filter(Boolean).join('\n') });
}

/** A failing verification process keeps precedence over the operation that invoked it. */
export function preparationGateFailure(error: string, gate: NonNullable<ReviewPreparationResult['gateFailure']>): ReviewPreparationResult {
  const reason = gateFailureReasonFromProcess({ ...gate, status: gate.exitCode });
  return { ok: false, error, reason: 'gate-failed', gateFailure: gate, failureReason: reason,
    recoveryFailure: { kind: 'gate-failure', ...gate, error, failureReason: reason } };
}
