import { DecisionError } from '../../application/ports/decision.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Inspect only known machine codes. Untrusted provider messages never escape the adapter. */
export async function decisionHttpError(response: Response, provider: string): Promise<DecisionError> {
  let code: unknown;
  let source: unknown;
  try {
    const body: unknown = await response.json();
    const error = record(body) && record(body.error) ? body.error : undefined;
    code = error?.code ?? error?.type;
    source = error && record(error.metadata) ? error.metadata.limit_source : undefined;
  } catch { /* HTTP status still provides a safe failure category. */ }
  if (source === 'openrouter_in_flight_budget') {
    return new DecisionError('rate-limited', 'Decision provider has reached its concurrent usage limit.', provider);
  }
  if (response.status === 402 || source === 'openrouter_key_limit' || source === 'openrouter_credits'
    || ['insufficient_quota', 'insufficient_credits', 'budget_exceeded', 'quota_exceeded', 'credit_limit_exceeded', 'usage_limit_exceeded'].includes(String(code))) {
    return new DecisionError('usage-blocked', 'Decision provider usage is blocked by a budget, credit, or quota limit.', provider);
  }
  if (response.status === 401 || response.status === 403) {
    return new DecisionError('authentication', 'Decision provider rejected authorization.', provider);
  }
  if (response.status === 429) {
    return new DecisionError('rate-limited', 'Decision provider rate limit reached.', provider);
  }
  if (response.status === 400 || response.status === 422) {
    return new DecisionError('invalid-request', 'Decision provider rejected the request.', provider);
  }
  return new DecisionError('unavailable', 'Decision provider is unavailable.', provider);
}
