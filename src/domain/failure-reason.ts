/** Machine evidence is versioned independently of diagnostic wording. */
export const FAILURE_REASON_VERSION = 1;
export const FAILURE_REASON_CODES = [
  'gate-failed', 'cpu-budget-exceeded', 'process-terminated', 'agent-quota',
  'infrastructure', 'state-machine', 'approval-retention-pending',
  'mission-contract-incomplete', 'classification-missing', 'incomplete-evidence', 'incomplete-success-criteria', 'missing-artifacts',
  'unverifiable-claims', 'malformed-gates', 'git-hook-failed', 'git-conflict', 'git-no-merge', 'git-remote-missing', 'git-dirty', 'git-behind', 'git-failed',
  'provider-session-missing', 'provider-config', 'provider-auth', 'provider-unavailable', 'provider-entitlement', 'provider-rate-limit',
  'resource-exhausted', 'filesystem-failed', 'process-failed', 'unexpected',
] as const;
export type FailureReasonCode = typeof FAILURE_REASON_CODES[number];
export type FailureSource = 'lifecycle' | 'git' | 'forgejo' | 'provider' | 'process' | 'filesystem' | 'verification' | 'review-preparation';
export interface FailureReason {
  readonly version: number;
  readonly code: string;
  readonly source?: FailureSource;
  readonly context?: Readonly<Record<string, string | number | boolean | null>>;
}
export type ProducedFailureReason = FailureReason & { readonly version: 1; readonly code: FailureReasonCode };
export function failureReason(code: FailureReasonCode, source: FailureSource, context?: FailureReason['context']): ProducedFailureReason {
  return { version: FAILURE_REASON_VERSION, code, source, ...(context ? { context } : {}) };
}
export function recognizedFailureReason(value: unknown): (FailureReason & { readonly version: 1; readonly code: FailureReasonCode }) | null {
  if (!value || typeof value !== 'object') { return null; }
  const record = value as FailureReason;
  return record.version === FAILURE_REASON_VERSION && FAILURE_REASON_CODES.includes(record.code as FailureReasonCode)
    ? record as FailureReason & { readonly version: 1; readonly code: FailureReasonCode } : null;
}
export function legacyFailureReason(value: unknown): 'missing' | 'unknown-code' | 'unsupported-version' | null {
  if (recognizedFailureReason(value)) { return null; }
  if (value === undefined || value === null) { return 'missing'; }
  return typeof value === 'object' && 'version' in value && value.version !== FAILURE_REASON_VERSION ? 'unsupported-version' : 'unknown-code';
}

/** Wrappers retain the machine reason and original cause; neither is reconstructed from prose. */
export class StructuredFailure extends Error {
  constructor(message: string, readonly failureReason: FailureReason, cause?: unknown) {
    super(message, { cause });
    this.name = 'StructuredFailure';
  }
}

/** OS error codes are protocol fields, never human-readable diagnostics. */
export function failureReasonFromCause(cause: unknown, source: FailureSource): FailureReason {
  const prior = (cause as { failureReason?: FailureReason } | null)?.failureReason;
  if (prior) { return prior; }
  const code = (cause as { code?: unknown } | null)?.code;
  const context = typeof code === 'string' ? { errno: code } : undefined;
  if (['ENOMEM', 'ENOSPC', 'EMFILE', 'ENFILE', 'ENOBUFS', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(String(code))) {
    return failureReason('resource-exhausted', source, context);
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(String(code))) {
    return failureReason('infrastructure', source, context);
  }
  if (typeof code === 'string') { return failureReason(source === 'filesystem' ? 'filesystem-failed' : 'process-failed', source, context); }
  return failureReason('unexpected', source);
}

export interface ProcessFacts {
  status?: number | null; signal?: string | null; error?: unknown; failureReason?: unknown;
  stdout?: string; stderr?: string;
}

/** Only transport/OS facts establish a process failure; transcripts remain evidence. */
export function normalizeProcessFailure(result: ProcessFacts): FailureReason | undefined {
  if (result.failureReason && typeof result.failureReason === 'object' && 'version' in result.failureReason && 'code' in result.failureReason) { return result.failureReason as FailureReason; }
  if (result.error) { return failureReasonFromCause(result.error, 'process'); }
  if (result.signal) { return failureReason('process-terminated', 'process', { signal: result.signal }); }
  if (result.status !== 0) { return failureReason('process-failed', 'process', { exitCode: result.status ?? null }); }
  return undefined;
}
