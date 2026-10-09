import { resolveProcessConfiguration } from './config.js';
import type { PiWorkerMessage } from '../adapters/agents/pi-worker-protocol.js';
import { runPiSdk } from '../adapters/agents/pi-session-runtime.js';

/** Private child entry: the SDK and its tools inherit only this process's environment. */
export function runPiWorker(): void {
  if (!process.send) { throw new Error('Pi session worker requires its parent IPC channel'); }
  const stop = () => {
    if (process.platform !== 'win32') {
      try { process.kill(-process.pid, 'SIGKILL'); } catch { /* The confinement parent may own the group. */ }
    }
    process.exit(1);
  };
  process.once('disconnect', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('message', (message: PiWorkerMessage) => {
    void execute(message).catch(error => { console.error(error); process.exit(1); });
  });
  async function execute(message: PiWorkerMessage) {
    if (message?.kind !== 'run') { process.exit(1); }
    const result = await runPiSdk({ ...message.request, configuration: resolveProcessConfiguration(),
      clearStaleMarker: () => new Promise<void>((resolve, reject) => {
        process.once('message', (reply: PiWorkerMessage) => {
          if (reply.kind !== 'marker-cleared') { reject(new Error('Invalid marker acknowledgement')); }
          else if (reply.error) { reject(new Error(reply.error)); }
          else { resolve(); }
        });
        process.send!({ kind: 'clear-stale-marker' });
      }),
    });
    process.send!({ kind: 'result', result }, () => {
      process.stdout.write('', () => process.stderr.write('', () => process.exit(result.status)));
    });
  }
}
