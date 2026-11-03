import { failureReason, type FailureReason } from '../../domain/failure-reason.js';

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
  for (const event of providerEvents(result.stdout)) {
    if (event.type !== 'error' && event.type !== 'turn.failed' && event.is_error !== true) { continue; }
    return providerEventFailure(event);
  }
  return normalizeProcessFailure(result);
}

function providerEventFailure(event: Record<string, unknown>): FailureReason {
    const details = event.error && typeof event.error === 'object' ? event.error as Record<string, unknown> : event;
    const status = details.status ?? details.statusCode;
    const code = details.code ?? details.type;
    const context = providerContext(details, status, code);
    if (status === 429 || ['insufficient_quota', 'rate_limit_exceeded', 'resource_exhausted'].includes(String(code))) { return failureReason('agent-quota', 'provider', context); }
    if (status === 401 || code === 'authentication_error') { return failureReason('provider-auth', 'provider', context); }
    if (status === 403) { return failureReason('provider-entitlement', 'provider', context); }
    if (typeof status === 'number' && status >= 500 && status <= 599) { return failureReason('provider-unavailable', 'provider', context); }
    if (code === 'session_not_found') { return failureReason('provider-session-missing', 'provider', context); }
    if (['invalid_model', 'invalid_argument', 'unsupported_option'].includes(String(code))) { return failureReason('provider-config', 'provider', context); }
    return failureReason('unexpected', 'provider', context);
}

function providerContext(details: Record<string, unknown>, status: unknown, code: unknown): FailureReason['context'] {
  return { ...(typeof details.resetAt === 'string' ? { resetAt: details.resetAt } : {}), ...(typeof details.retryAfterSeconds === 'number' ? { retryAfterSeconds: details.retryAfterSeconds } : {}), ...(typeof status === 'number' ? { httpStatus: status } : {}), ...(typeof code === 'string' ? { providerCode: code } : {}) };
}
