import fs from 'node:fs';
import path from 'node:path';
import type { TmuxLaunch } from './tmux-host.js';

/** Read immutable evidence written by the command shell before exec, never a fresh PID lookup. */
export function readTmuxLaunchExecution(file: string): { pid: number; processIdentity: string } | null {
  try {
    const [pidText, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
    if (!/^[1-9][0-9]*$/.test(pidText)) { return null; }
    const pid = Number(pidText);
    const evidence = lines.join('\n');
    if (process.platform === 'linux') {
      if (!evidence.startsWith(`${pid} (`)) { return null; }
      const start = evidence.slice(evidence.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
      return start && /^\d+$/.test(start) ? { pid, processIdentity: start } : null;
    }
    const time = new Date(evidence.trim());
    return Number.isNaN(time.valueOf()) ? null : { pid, processIdentity: time.toISOString() };
  } catch { return null; }
}

/** Observe once while the host starts; the caller stops polling before transport cleanup. */
export function observeTmuxLaunchExecution(launch: TmuxLaunch, observe: (_pid: number, _identity: string) => void): () => void {
  const file = path.join(path.dirname(launch.args[0]), 'command.identity');
  const timer = setInterval(() => {
    const execution = readTmuxLaunchExecution(file);
    if (!execution) { return; }
    try { observe(execution.pid, execution.processIdentity); clearInterval(timer); }
    catch { /* Recording failure must not stop the operation. */ }
  }, 10);
  return () => clearInterval(timer);
}
