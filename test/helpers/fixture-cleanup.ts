import type { TestContext } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { processStartIdentity } from '../../src/adapters/process/process-liveness.js';

/** Emergency synchronous teardown, before bootstrap removes fixture directories. */
export function cleanupFixtureProcesses(root: string): void {
  if (process.platform !== 'linux') { return; }
  const directory = path.resolve(root);
  const stopped = new Set<number>();
  const stop = (pid: number, identity = processStartIdentity(pid)) => {
    if (pid === process.pid || stopped.has(pid)) { return; }
    if (!identity || processStartIdentity(pid) !== identity) { return; }
    stopped.add(pid);
    try {
      // Freeze before reading children so teardown cannot race another fork.
      process.kill(pid, 'SIGSTOP');
      const children = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8');
      for (const child of children.trim().split(/\s+/).filter(Boolean)) { stop(Number(child)); }
    } catch { /* process exited while inspecting it */ }
    finally {
      if (processStartIdentity(pid) === identity) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
      }
    }
  };
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) { continue; }
    try {
      const identity = processStartIdentity(Number(entry));
      const cwd = fs.readlinkSync(`/proc/${entry}/cwd`).replace(/ \(deleted\)$/, '');
      if (cwd === directory || cwd.startsWith(`${directory}${path.sep}`)) { stop(Number(entry), identity); }
    } catch { /* process exited or belongs to another user */ }
  }
}

/** Keep fixture cleanup attached until test teardown, including abort and signals. */
export function registerFixtureCleanup(context: TestContext, cleanup: () => void): void {
  const interrupt = () => { cleanup(); process.exit(130); };
  process.prependOnceListener('SIGTERM', cleanup);
  process.once('SIGINT', interrupt);
  context.signal.addEventListener('abort', cleanup, { once: true });
  process.prependOnceListener('exit', cleanup);
  context.after(() => {
    context.signal.removeEventListener('abort', cleanup);
    process.removeListener('exit', cleanup);
    process.removeListener('SIGTERM', cleanup);
    process.removeListener('SIGINT', interrupt);
    cleanup();
  });
}
