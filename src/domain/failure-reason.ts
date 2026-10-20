/** Versioned machine evidence. Unknown codes/versions remain legacy-readable. */
export const FAILURE_REASON_VERSION = 1;
export const FAILURE_REASON_CODES = ['gate-failed', 'cpu-budget-exceeded', 'process-terminated', 'agent-quota', 'infrastructure', 'state-machine'] as const;
export type FailureReasonCode = typeof FAILURE_REASON_CODES[number];
export interface FailureReason { readonly version: typeof FAILURE_REASON_VERSION; readonly code: FailureReasonCode }
export function recognizedFailureReason(value: unknown): FailureReason | null {
  if (!value || typeof value !== 'object') { return null; }
  const record = value as Record<string, unknown>;
  return record.version === FAILURE_REASON_VERSION && FAILURE_REASON_CODES.includes(record.code as FailureReasonCode)
    ? { version: FAILURE_REASON_VERSION, code: record.code as FailureReasonCode } : null;
}
export function legacyFailureReason(value: unknown): 'missing' | 'unknown-code' | 'unsupported-version' | null {
  if (recognizedFailureReason(value)) { return null; }
  if (value === undefined || value === null) { return 'missing'; }
  return typeof value === 'object' && 'version' in value && value.version !== FAILURE_REASON_VERSION ? 'unsupported-version' : 'unknown-code';
}
