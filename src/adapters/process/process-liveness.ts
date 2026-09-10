import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const readProcessStat = { sync: (pid: number) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8') };
export const runNativeStartIdentity = { execFileSync };

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
  try { process.kill(pid, 0); } catch { return false; }
  if (identity === null) {
    return null;
  }
  const current = processStartIdentity(pid);
  return current === null ? true : current === identity;
}

export const processLivenessProbe = probeProcessLiveness;
export interface ProcessIdentity { pid: number; startId: string | null; }
export function processIdentity(pid: number): ProcessIdentity | null {
  const startId = processStartIdentity(pid);
  return startId === null ? null : { pid, startId };
}
export function isSameLiveProcess(pid: number, startId: string | null): boolean {
  return probeProcessLiveness(pid, startId) === true;
}
