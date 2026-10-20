import fs from 'node:fs';
import { isSameLiveProcess, processIdentity, processStartIdentity } from './process-liveness.js';

/** A surviving member retains the original group ID even after its leader exits. */
export function isLiveProcessGroup(pid: number, startId: string): boolean {
  const current = processStartIdentity(pid);
  if (current !== null && current !== startId) { return false; }
  if (process.platform === 'linux') {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) { continue; }
      try {
        const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
        if (fields[0] !== 'Z' && Number(fields[2]) === pid && BigInt(fields[19]) >= BigInt(startId)) { return true; }
      } catch { /* A process may exit during enumeration. */ }
    }
    return false;
  }
  try { process.kill(-pid, 0); return true; } catch { return false; }
}

/** The inherited lease token also identifies children that create a new session. */
export function gateDescendants(lease: string): { pid: number; startId: string | null }[] {
  if (process.platform !== 'linux') { return []; }
  const token = Buffer.from(`PARALLIX_GATE_OWNER=${lease}\0`);
  const children: { pid: number; startId: string | null }[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) { continue; }
    const pid = Number(entry);
    try {
      const environment = fs.readFileSync(`/proc/${pid}/environ`);
      const offset = environment.indexOf(token);
      if (offset < 0 || (offset > 0 && environment[offset - 1] !== 0)) { continue; }
      const identity = processIdentity(pid);
      if (identity && isSameLiveProcess(pid, identity.startId)) { children.push(identity); }
    } catch { /* Exited processes and other users are not gate descendants. */ }
  }
  return children;
}
