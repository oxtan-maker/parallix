import { failureReason, type FailureReason, type FailureReasonCode } from '../../domain/failure-reason.js';

import { normalizeProcessFailure, type ProcessFacts } from '../../domain/failure-reason.js';
export { normalizeProcessFailure } from '../../domain/failure-reason.js';
/** Parse protocol events, never substrings in a provider's human diagnostic. */
export function providerEvents(output: string | undefined): Record<string, unknown>[] {
  return (output ?? '').split('\n').flatMap(line => {
    try { const value: unknown = JSON.parse(line); return value && typeof value === 'object' && !Array.isArray(value) ? [value as Record<string, unknown>] : []; }
    catch { return []; }
  });
}

export function normalizeProviderFailure(result: ProcessFacts): FailureReason | undefined {
  const prior = result.failureReason as FailureReason | undefined;
  if (prior && prior.source !== 'process') { return prior; }
  const processFailed = result.status !== 0 || Boolean(result.signal) || Boolean(result.error);
  const failures = collectProviderFailures(providerEvents(result.stdout), processFailed);
  return preferredProviderFailure(failures) ?? normalizeProcessFailure(result);
}

interface ProviderFailures {
  firstQuota?: FailureReason;
  resetAuthoritativeQuota?: FailureReason;
  firstGeneric?: FailureReason;
}

function collectProviderFailures(events: Record<string, unknown>[], processFailed: boolean): ProviderFailures {
  const failures: ProviderFailures = {};
  for (const event of events) {
    collectProviderFailure(failures, event, processFailed);
  }
  return failures;
}

function collectProviderFailure(failures: ProviderFailures, event: Record<string, unknown>, processFailed: boolean): void {
  const claudeQuota = processFailed ? claudeQuotaFailure(event) : undefined;
  failures.firstQuota ??= claudeQuota;
  if (!failures.resetAuthoritativeQuota && event.type === 'rate_limit_event' && claudeQuota?.context?.resetAt) {
    failures.resetAuthoritativeQuota = claudeQuota;
  }
  if (!failures.firstGeneric && (event.type === 'error' || event.type === 'turn.failed' || event.is_error === true)) {
    failures.firstGeneric = providerEventFailure(event);
  }
}

function preferredProviderFailure(failures: ProviderFailures): FailureReason | undefined {
  if (failures.resetAuthoritativeQuota) { return failures.resetAuthoritativeQuota; }
  const quotaReset = failures.firstQuota?.context?.resetAt;
  const genericReset = failures.firstGeneric?.context?.resetAt;
  if (failures.firstQuota && (
    !failures.firstGeneric
    || failures.firstGeneric.code === 'unexpected'
    || (quotaReset && failures.firstGeneric.code === 'agent-quota' && !genericReset)
  )) {
    return failures.firstQuota;
  }
  return failures.firstGeneric;
}

function claudeQuotaFailure(event: Record<string, unknown>): FailureReason | undefined {
  if (event.type === 'rate_limit_event') {
    const info = record(event.rate_limit_info);
    const status = event.api_error_status;
    const code = event.api_error;
    if (info?.status !== 'rejected') { return undefined; }
    const resetAt = resetInstant(info.resetsAt);
    return failureReason('agent-quota', 'provider', claudeQuotaContext(status, code, resetAt));
  }
  if (event.type !== 'assistant' && event.type !== 'result') { return undefined; }
  if (event.api_error_status !== 429 && event.api_error !== 'usage_limit_reached') { return undefined; }
  const info = record(record(event.api_error_params)?.rate_limit_info) ?? record(event.rate_limit_info);
  const resetAt = resetInstant(info?.resetsAt);
  return failureReason('agent-quota', 'provider', claudeQuotaContext(event.api_error_status, event.api_error, resetAt));
}

function claudeQuotaContext(status: unknown, code: unknown, resetAt: string | undefined): FailureReason['context'] {
  return {
    ...(resetAt ? { resetAt } : {}),
    ...(status === 429 ? { httpStatus: 429 } : {}),
    ...(code === 'usage_limit_reached' ? { providerCode: code } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function resetInstant(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) { return undefined; }
  const epochMilliseconds = Math.abs(value) < 100_000_000_000 ? value * 1_000 : value;
  const instant = new Date(epochMilliseconds);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

function providerEventFailure(event: Record<string, unknown>): FailureReason | undefined {
  const details = providerFailureDetails(event);
  if (!isProviderFailureEvent(event, details)) { return undefined; }
  const status = details.status ?? details.statusCode ?? details.api_error_status;
  const code = details.code ?? details.api_error ?? details.type;
  return failureReason(providerFailureCode(status, code), 'provider', providerContext(details, status, code));
}

function providerFailureDetails(event: Record<string, unknown>): Record<string, unknown> {
  return event.error && typeof event.error === 'object' ? event.error as Record<string, unknown> : event;
}

function isProviderFailureEvent(event: Record<string, unknown>, details: Record<string, unknown>): boolean {
  const hasStructuredApiFailure = typeof details.api_error_status === 'number' && typeof details.api_error === 'string';
  return event.type === 'error' || event.type === 'turn.failed' || event.is_error === true || hasStructuredApiFailure;
}

function providerFailureCode(status: unknown, code: unknown): FailureReasonCode {
  if (status === 429 || ['insufficient_quota', 'rate_limit_exceeded', 'resource_exhausted'].includes(String(code))) { return 'agent-quota'; }
  if (status === 401 || code === 'authentication_error') { return 'provider-auth'; }
  if (status === 403) { return 'provider-entitlement'; }
  if (typeof status === 'number' && status >= 500 && status <= 599) { return 'provider-unavailable'; }
  if (code === 'session_not_found') { return 'provider-session-missing'; }
  if (['invalid_model', 'invalid_argument', 'unsupported_option'].includes(String(code))) { return 'provider-config'; }
  return 'unexpected';
}

function providerContext(details: Record<string, unknown>, status: unknown, code: unknown): FailureReason['context'] {
  const rateLimitInfo = details.rate_limit_info && typeof details.rate_limit_info === 'object'
    ? details.rate_limit_info as Record<string, unknown>
    : undefined;
  const resetAt = details.resetAt ?? rateLimitInfo?.resetsAt;
  return { ...(typeof resetAt === 'string' ? { resetAt } : {}), ...(typeof details.retryAfterSeconds === 'number' ? { retryAfterSeconds: details.retryAfterSeconds } : {}), ...(typeof status === 'number' ? { httpStatus: status } : {}), ...(typeof code === 'string' ? { providerCode: code } : {}) };
}
