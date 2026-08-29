import { readFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import type { ProcessLivenessProbe } from '../../application/projections/current-work.js';

/**
 * The one native per-PID lookup call each platform branch makes. Held on a
 * plain mutable object so tests can stub it with `mock.method` without invoking
 * real process tooling (mission: platform behaviour is tested through controls,
 * never by spawning `ps`/`powershell`). Production keeps the stdlib default.
 */
export const runNativeStartIdentity = {
  execFileSync: childProcess.execFileSync.bind(childProcess),
};

/**
 * The single `/proc/<pid>/stat` read Linux/WSL uses. Same testability seam as
 * the native lookups: a plain mutable object so tests stub it without touching
 * real process state. Production keeps the stdlib default.
 */
export const readProcessStat = {
  sync: readFileSync.bind(readFileSync),
};

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
 * One targeted read of one known pid, never a scan of the process table. The
 * source is platform-specific:
 *
 *  - Linux / WSL read `/proc/<pid>/stat` field 22 (established behaviour);
 *  - macOS reads the process start time from `ps`, one pid at a time;
 *  - native Windows reads it from PowerShell, one pid at a time.
 *
 * WSL reports `process.platform === 'linux'`, so it keeps the `/proc` path and
 * is never mistaken for native Windows. Any other platform, an unavailable
 * utility, unreadable/malformed output, or an unsupported pid returns `null`,
 * which degrades the probe to the bare-pid check rather than fabricating an
 * identity.
 */
export function processStartIdentity(processId: number): string | null {
  if (!Number.isInteger(processId) || processId <= 0) { return null; }
  switch (process.platform) {
    case 'linux':
      return linuxStartIdentity(processId);
    case 'darwin':
      return darwinStartIdentity(processId);
    case 'win32':
      return windowsStartIdentity(processId);
    default:
      return null;
  }
}

/**
 * `/proc/<pid>/stat` field 22 — the process start time in clock ticks since
 * boot. One targeted read of one known pid. The command name is parenthesized
 * and may itself contain spaces, so fields are counted from the last ')'.
 * Returns `null` where `/proc` is unavailable or the field is not numeric.
 */
function linuxStartIdentity(processId: number): string | null {
  try {
    const stat = readProcessStat.sync(`/proc/${processId}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const startTime = fields[19];
    return startTime && /^\d+$/.test(startTime) ? startTime : null;
  } catch {
    return null;
  }
}

/**
 * macOS start identity for one pid. `ps -o lstart= -p <pid>` prints the
 * absolute start time (for example "Fri Aug 14 04:00:00 2026") for a single
 * pid without listing the process table. Parsed to an ISO-8601 string so the
 * identity is a stable, comparable value. Fails closed: a missing utility, a
 * non-zero exit, or unparseable output returns `null`.
 *
 * ponytail: `lstart` resolves only to the second and its month name follows
 * the host locale, so this is a coarse identity. It is enough to reject a
 * recycled pid that started in a different second; tighten resolution only if
 * same-second reuse is ever observed.
 */
function darwinStartIdentity(processId: number): string | null {
  try {
    const out = runNativeStartIdentity
      .execFileSync('ps', ['-o', 'lstart=', '-p', String(processId)], {
        encoding: 'utf8',
        timeout: 1000,
      })
      .trim();
    const started = Date.parse(out);
    return Number.isNaN(started) ? null : new Date(started).toISOString();
  } catch {
    return null;
  }
}

/**
 * Native Windows start identity for one pid. `Get-Process -Id <pid>` reads a
 * single pid's `CreationTime` without enumerating the process table. Parsed to
 * an ISO-8601 string so the identity is a stable, comparable value. Fails
 * closed: a missing PowerShell, a non-zero exit, or unparseable output returns
 * `null`.
 */
function windowsStartIdentity(processId: number): string | null {
  try {
    const command = `(Get-Process -Id ${processId} -EA SilentlyContinue).CreationTime.ToString('o')`;
    const out = runNativeStartIdentity
      .execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command', command,
      ], {
        encoding: 'utf8',
        timeout: 3000,
      })
      .trim();
    const started = Date.parse(out);
    return Number.isNaN(started) ? null : new Date(started).toISOString();
  } catch {
    return null;
  }
}

export const processLivenessProbe: ProcessLivenessProbe = probeProcessLiveness;
