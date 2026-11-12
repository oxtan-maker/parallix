import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ProcessIdentity } from '../../application/ports/process-identity.js';
export type { ProcessIdentity } from '../../application/ports/process-identity.js';

export const readProcessStat = { sync: (pid: number) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8') };
export const readProcessCommand = { sync: (pid: number) => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8') };
export const runNativeStartIdentity = { execFileSync };

/** Current parentage and command metadata are kernel observations, never durable state. */
export function processParentPid(pid: number): number | null {
  try {
    const stat = readProcessStat.sync(pid);
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[1]);
    return Number.isInteger(parent) && parent > 0 ? parent : null;
  } catch { return null; }
}

export function processCommandLine(pid: number): string | null {
  try { return readProcessCommand.sync(pid).replaceAll('\0', ' '); }
  catch { return null; }
}

export function processStartIdentity(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    if (process.platform === 'linux') {
      const stat = readProcessStat.sync(pid);
      return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19] || null;
    }
    const command = process.platform === 'win32' ? 'powershell' : 'ps';
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`]
      : ['-p', String(pid), '-o', 'lstart='];
    const value = runNativeStartIdentity.execFileSync(command, args, { encoding: 'utf8' }).trim();
    const time = new Date(value);
    return Number.isNaN(time.valueOf()) ? null : time.toISOString();
  } catch { return null; }
}

export function probeProcessLiveness(pid: number, identity: string | null): boolean | null {
  try { process.kill(pid, 0); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null; }
  if (process.platform === 'linux') {
    try {
      const stat = readProcessStat.sync(pid);
      const state = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[0];
      // An unreaped process has exited and cannot still write scratch data.
      if (state === 'Z' || state === 'X') { return false; }
    } catch { /* Unreadable state cannot establish that the process exited. */ }
  }
  if (identity === null) {
    return null;
  }
  const current = processStartIdentity(pid);
  return current === null ? true : current === identity;
}

export const processLivenessProbe = probeProcessLiveness;
export function processIdentity(pid: number): ProcessIdentity | null {
  const startId = processStartIdentity(pid);
  return startId === null ? null : { pid, startId };
}
/** Observation records the PID even when the host cannot supply its start token. */
export function processIdentityForObservation(pid: number): ProcessIdentity {
  return { pid, startId: processStartIdentity(pid) };
}
export function isSameLiveProcess(pid: number, startId: string | null): boolean {
  return probeProcessLiveness(pid, startId) === true;
}
