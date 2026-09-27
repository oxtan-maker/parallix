/**
 * The Mission lifecycle timing contract (TASK-2582).
 *
 * When Parallix accepts a valid transition and begins work belonging to the
 * destination state, the authoritative destination state and its lane event
 * persist directly at the accepted transition boundary, before
 * destination-state work starts. Where direct persistence is not possible, it
 * must complete within the first `LIFECYCLE_DEADLINE_MS` of that work,
 * measured end to end with a monotonic clock from work start to successful
 * persistence. `done` is exempt: no work runs in done, and all integration
 * work finishes in integration before the done transition.
 *
 * A missed deadline is a contract violation, not a slow write: the caller
 * surfaces it and stops dependent work instead of claiming success.
 */

/** Monotonic clock (never wall clock): immune to operator clock changes. */
import { performance } from 'node:perf_hooks';

/** Deferred lifecycle persistence budget, from destination-work start. */
export const LIFECYCLE_DEADLINE_MS = 200;

/** Monotonic now, in milliseconds (node:perf_hooks — never wall clock). */
export function monotonicNowMs(): number {
  return performance.now();
}

export interface LifecycleDeadlineCheck {
  /** Monotonic timestamp when destination-state work started. */
  readonly startedAtMs: number;
  /** Monotonic timestamp when the persistence completed (or is being checked). */
  readonly nowMs?: number;
  /** Budget in milliseconds; defaults to LIFECYCLE_DEADLINE_MS. */
  readonly deadlineMs?: number;
  /** Named in the violation message so the operator sees which boundary ran late. */
  readonly what: string;
}

export class LifecycleDeadlineMissed extends Error {
  constructor(
    readonly what: string,
    readonly elapsedMs: number,
    readonly deadlineMs: number,
  ) {
    super(`${what} missed the ${deadlineMs} ms lifecycle persistence deadline (took ${Math.round(elapsedMs)} ms)`);
    this.name = 'LifecycleDeadlineMissed';
  }
}

/**
 * Check one deferred persistence against the contract. Pure in its clock:
 * pass the observed monotonic readings to make the check deterministic in
 * tests.
 */
export function checkLifecycleDeadline(check: LifecycleDeadlineCheck): void {
  const deadlineMs = check.deadlineMs ?? LIFECYCLE_DEADLINE_MS;
  const nowMs = check.nowMs ?? monotonicNowMs();
  const elapsedMs = nowMs - check.startedAtMs;
  if (elapsedMs > deadlineMs) {
    throw new LifecycleDeadlineMissed(check.what, elapsedMs, deadlineMs);
  }
}
