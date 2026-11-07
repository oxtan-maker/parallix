import { recognizedFailureReason } from '../../domain/failure-reason.js';
const DEFAULT_FALLBACK_HOURS = 1;
const SIGINT_SHORT_BLOCK_MINUTES = 15;
function formatBlockUntil(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}`;
}

function ceilToNextHour(date: Date) {
  const ceil = new Date(date.getTime());
  if (ceil.getMinutes() === 0 && ceil.getSeconds() === 0 && ceil.getMilliseconds() === 0) {
    return ceil;
  }
  ceil.setMinutes(0, 0, 0);
  ceil.setHours(ceil.getHours() + 1);
  return ceil;
}

function endOfCurrentUtcMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type DetectedLimitHit =
  | { reroute: true; kind?: string; reason: string; until?: never; source?: string }
  | { reroute?: false; until: string; source?: string; reason: string; kind?: never };

interface DetectLimitHitOptions {
  failureReason?: unknown; log?: (_message: string) => void;
  agent: string; stdout?: string; stderr?: string; status?: number | null;
  signal?: string | null; error?: unknown; now?: Date;
}

/** Capacity is a producer fact. Opaque transcripts never establish a family block. */
export function detectLimitHit({ agent, status, signal, error, now = new Date(), failureReason }: DetectLimitHitOptions = {} as DetectLimitHitOptions): DetectedLimitHit | null {
  if (!agent || processDidNotFail(status, signal, error)) { return null; }
  const typed = recognizedFailureReason(failureReason);
  return typedLimitHit(agent, now, typed) ?? terminationLimit(now, signal, typed);
}
export { formatBlockUntil, ceilToNextHour, endOfCurrentUtcMonth, DEFAULT_FALLBACK_HOURS, SIGINT_SHORT_BLOCK_MINUTES };

function typedLimitHit(agent: string, now: Date, typed: ReturnType<typeof recognizedFailureReason>): DetectedLimitHit | null {
  if (typed?.code === 'provider-entitlement') { return { reroute: true, kind: 'entitlement', reason: 'typed: provider-entitlement' }; }
  if (typed?.code === 'provider-rate-limit') { return { reroute: true, reason: 'typed: provider-rate-limit' }; }
  if (typed?.code === 'provider-unavailable') { return availabilityLimit(now); }
  if (typed?.code === 'agent-quota') { return quotaLimit(agent, now, typed); }
  return null;
}

function terminationLimit(now: Date, signal: string | null | undefined, typed: ReturnType<typeof recognizedFailureReason>): DetectedLimitHit | null {
  if ((typed && typed.code !== 'process-terminated') || !signal || signal === 'SIGTERM') { return null; }
  return { until: formatBlockUntil(ceilToNextHour(new Date(now.getTime() + SIGINT_SHORT_BLOCK_MINUTES * 60000))), source: 'sigint', reason: `signal: ${signal}` };
}

function availabilityLimit(now: Date): DetectedLimitHit {
  const target = new Date(now.getTime() + DEFAULT_FALLBACK_HOURS * 3600000);
  return { until: formatBlockUntil(ceilToNextHour(target)), source: 'structured', reason: 'typed: provider-unavailable' };
}

function quotaLimit(agent: string, now: Date, typed: NonNullable<ReturnType<typeof recognizedFailureReason>>): DetectedLimitHit {
    const resetAt = typed.context?.resetAt;
    const retryAfter = typed.context?.retryAfterSeconds;
    const explicit = typeof resetAt === 'string' ? new Date(resetAt) : typeof retryAfter === 'number' && retryAfter > 0 ? new Date(now.getTime() + retryAfter * 1000) : null;
    const parsed = explicit && Number.isFinite(explicit.getTime()) && explicit > now ? explicit : null;
    const monthEnd = agent === 'mistral' || agent === 'vibe';
    const target = parsed ?? (monthEnd ? endOfCurrentUtcMonth(now) : new Date(now.getTime() + DEFAULT_FALLBACK_HOURS * 3600000));
    return { until: formatBlockUntil(ceilToNextHour(target)), source: parsed ? 'structured' : monthEnd ? 'month-end' : 'fallback', reason: 'typed: agent-quota' };
}

function processDidNotFail(status: number | null | undefined, signal: string | null | undefined, error: unknown): boolean {
  return (status === 0 || status === undefined) && !signal && !error;
}
