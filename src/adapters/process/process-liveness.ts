import type { ProcessLivenessProbe } from '../../application/projections/current-work.js';

/**
 * Bounded recovery evidence: does the process that published a current-work
 * fact still exist?
 *
 * `process.kill(pid, 0)` sends no signal — it only asks the kernel whether the
 * target is addressable. Three outcomes matter and they are deliberately kept
 * apart:
 *
 *  - no error       → the process exists;
 *  - `ESRCH`        → it does not;
 *  - anything else (typically `EPERM`, a process owned by another user, or an
 *    unsupported platform) → we cannot tell, reported as `null`.
 *
 * The third case is why this returns `boolean | null` instead of `boolean`.
 * Collapsing an unanswerable probe into `false` is exactly the silent
 * "nobody is running" conclusion the board must never draw (ADR 0053 keeps
 * process liveness an observation, never stored truth).
 */
export function probeProcessLiveness(processId: number): boolean | null {
  if (!Number.isInteger(processId) || processId <= 0) { return null; }
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null;
  }
}

export const processLivenessProbe: ProcessLivenessProbe = probeProcessLiveness;
