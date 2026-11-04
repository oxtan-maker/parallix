/**
 * Shared admission waiting owner (TASK-2830).
 *
 * Verification-gate admission, custom-agent capacity and Git lock contention
 * all wait for a contended shared resource. Polling cadence, backoff, progress
 * reporting, cancellation, wait limits and retry accounting live here once so a
 * waiter cannot invent its own retry loop, budget or cancellation semantics.
 *
 * Cancellation is exception-based: an aborted signal rejects the pause with an
 * AbortError, which is what both pre-existing callers already propagated.
 */

export interface AdmissionWaitPolicy {
  /** Named contended resource; waiters of the same name observe the same line. */
  readonly resource: string;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** null = no admission-side bound; the caller's own cancellation owns it. */
  readonly maxWaitMs: number | null;
  /** null = silent; otherwise a progress line at most every N ms. */
  readonly progressEveryMs: number | null;
}

export interface AdmissionWaitState {
  readonly resource: string;
  readonly attempts: number;
  readonly waitedMs: number;
}

export interface AdmissionWaitResult<T> {
  readonly acquired: boolean;
  readonly attempts: number;
  readonly waitedMs: number;
  readonly value: T | null;
}

export type AdmissionPause = (_ms: number, _signal?: AbortSignal) => Promise<void>;

export interface AdmissionWaitOptions {
  signal?: AbortSignal;
  onWaiting?: (_state: AdmissionWaitState) => void | Promise<void>;
  pause?: AdmissionPause;
  now?: () => number;
}

/** Exponential backoff bounded by the policy; the first poll is immediate. */
export function admissionDelayMs(policy: AdmissionWaitPolicy, attempt: number): number {
  const grown = policy.initialDelayMs * 2 ** Math.max(0, Math.min(8, attempt - 1));
  return Math.min(policy.maxDelayMs, grown);
}

type AdmissionEvent = { kind: 'probe'; attempt: number } | { kind: 'pause'; ms: number } | { kind: 'report'; state: AdmissionWaitState };

/** One state machine; the drivers only adapt synchronous versus async effects. */
function* admission<T>(policy: AdmissionWaitPolicy, options: Pick<AdmissionWaitOptions, 'signal' | 'now'>): Generator<AdmissionEvent, AdmissionWaitResult<T>, T | null | undefined> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let attempts = 0;
  let nextProgressAt = 0;
  for (;;) {
    if (options.signal?.aborted) { return { acquired: false, attempts, waitedMs: now() - startedAt, value: null }; }
    const value = yield { kind: 'probe', attempt: ++attempts };
    const waitedMs = now() - startedAt;
    if (value) { return { acquired: true, attempts, waitedMs, value }; }
    if (options.signal?.aborted || (policy.maxWaitMs !== null && waitedMs >= policy.maxWaitMs)) {
      return { acquired: false, attempts, waitedMs, value: null };
    }
    if (policy.progressEveryMs !== null && waitedMs >= nextProgressAt) {
      yield { kind: 'report', state: { resource: policy.resource, attempts, waitedMs } };
      nextProgressAt = waitedMs + policy.progressEveryMs;
    }
    const remaining = policy.maxWaitMs === null ? Infinity : Math.max(0, policy.maxWaitMs - waitedMs);
    yield { kind: 'pause', ms: Math.min(admissionDelayMs(policy, attempts), remaining) };
  }
}

export async function waitForAdmission<T>(
  probe: (_attempt: number) => T | null | undefined | Promise<T | null | undefined>,
  policy: AdmissionWaitPolicy,
  options: AdmissionWaitOptions = {},
): Promise<AdmissionWaitResult<T>> {
  const driver = admission<T>(policy, options);
  let step = driver.next();
  while (!step.done) {
    const event = step.value;
    if (event.kind === 'probe') { step = driver.next(await probe(event.attempt)); }
    else {
      if (event.kind === 'pause') { await (options.pause ?? missingPause)(event.ms, options.signal); }
      else { await options.onWaiting?.(event.state); }
      step = driver.next();
    }
  }
  return step.value;
}

/** Existing synchronous Git ports use the same policy and accounting owner. */
export function waitForAdmissionSync<T>(
  probe: (_attempt: number) => T | null | undefined,
  policy: AdmissionWaitPolicy,
  options: Omit<AdmissionWaitOptions, 'pause' | 'onWaiting'> & { pause?: (_ms: number) => void; onWaiting?: (_state: AdmissionWaitState) => void } = {},
): AdmissionWaitResult<T> {
  const driver = admission<T>(policy, options);
  let step = driver.next();
  while (!step.done) {
    const event = step.value;
    if (event.kind === 'probe') { step = driver.next(probe(event.attempt)); }
    else {
      if (event.kind === 'pause') { (options.pause ?? missingPause)(event.ms); }
      else { options.onWaiting?.(event.state); }
      step = driver.next();
    }
  }
  return step.value;
}

function missingPause(): never { throw new Error('Admission pause must be supplied by its adapter'); }
