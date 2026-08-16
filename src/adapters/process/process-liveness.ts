import { readFileSync } from 'node:fs';
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
 *
 * A bare pid is not an identity: pids are recycled, and a long-dead `px` run
 * whose number was handed to an unrelated process would keep a mission
 * displayed as WORKING forever. When the publisher recorded a start identity,
 * the probe compares it with the identity of whatever now holds that pid and
 * reports a mismatch as dead.
 */
export function probeProcessLiveness(processId: number, identity: string | null = null): boolean | null {
  if (!Number.isInteger(processId) || processId <= 0) { return null; }
  try {
    process.kill(processId, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null;
  }
  // Publisher recorded no start identity (non-Linux or legacy row). Bare pid
  // existence is not enough to prove the original process owns this pid — pid
  // recycling means a new unrelated process can hold the same number. Return
  // null so the freshness check falls through to unverified/stale aging
  // (TASK-2375 AC #28-29).
  if (identity === null) { return null; }
  const current = processStartIdentity(processId);
  // An unreadable identity is not evidence of reuse: the pid answered, so the
  // conservative answer is still "alive".
  return current === null ? true : current === identity;
}

/**
 * A local, cheap identity for one running process: its kernel start time.
 *
 * Read from `/proc/<pid>/stat` field 22 — one targeted read of one known pid,
 * not a scan of the process table. Returns `null` where `/proc` is
 * unavailable (for example macOS), which degrades the probe to the bare-pid
 * check rather than fabricating an identity.
 */
export function processStartIdentity(processId: number): string | null {
  if (!Number.isInteger(processId) || processId <= 0) { return null; }
  try {
    const stat = readFileSync(`/proc/${processId}/stat`, 'utf8');
    // The command name is parenthesized and may itself contain spaces, so
    // fields are counted from the last ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const startTime = fields[19];
    return startTime && /^\d+$/.test(startTime) ? startTime : null;
  } catch {
    return null;
  }
}

export const processLivenessProbe: ProcessLivenessProbe = probeProcessLiveness;
