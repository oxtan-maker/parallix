import { resolveProcessConfiguration } from './config.js';
import type { PiWorkerMessage } from '../adapters/agents/pi-worker-protocol.js';

// A stop signal is a finite flush opportunity, not a licence to linger: the run
// is asked to settle with the provider facts it observed, and the isolated
// process group is reaped if it cannot within this bound.
const PI_WORKER_FLUSH_MS = 1500;

/** Private child entry: the SDK and its tools inherit only this process's environment. */
export function runPiWorker(): void {
  if (!process.send) { throw new Error('Pi session worker requires its parent IPC channel'); }
  const interrupt = new AbortController();
  const reap = () => {
    if (process.platform !== 'win32') {
      try { process.kill(-process.pid, 'SIGKILL'); } catch { /* The confinement parent may own the group. */ }
    }
    process.exit(1);
  };
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    // Stop the session so the run settles from what it already observed, and
    // keep the existing hard reap as the bounded escalation behind it.
    interrupt.abort(new Error('Pi worker stopped before the session completed'));
    escalation ??= setTimeout(reap, PI_WORKER_FLUSH_MS);
  };
  // A disconnected parent has no IPC left to flush into; reap immediately.
  process.once('disconnect', reap);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  // The worker keeps listening after its run starts: a stop request arrives over
  // IPC because a confined worker's wrapper dies on its own signal, so the
  // worker never sees the tree signal in time to drain. The marker reply rides
  // the same channel and is consumed by the pending request's own listener.
  let started = false;
  process.on('message', (message: PiWorkerMessage) => {
    if (message?.kind === 'stop') { stop(); return; }
    if (started) { return; }
    started = true;
    void execute(message).catch(error => { console.error(error); process.exit(1); });
  });
  async function execute(message: PiWorkerMessage) {
    if (message?.kind !== 'run') { process.exit(1); }
    const { runPiSdk } = await import('../adapters/agents/pi-session-runtime.js');
    const result = await runPiSdk({ ...message.request, configuration: resolveProcessConfiguration(),
      interruptSignal: interrupt.signal,
      // The model, provider session and usage are reported as the SDK resolves
      // them, so a stop before the final result cannot lose them.
      onObserved: (observation) => { if (process.connected) { process.send!({ kind: 'observed', observation }); } },
      clearStaleMarker: () => new Promise<void>((resolve, reject) => {
        process.once('message', (reply: PiWorkerMessage) => {
          if (reply.kind !== 'marker-cleared') { reject(new Error('Invalid marker acknowledgement')); }
          else if (reply.error) { reject(new Error(reply.error)); }
          else { resolve(); }
        });
        process.send!({ kind: 'clear-stale-marker' });
      }),
    });
    clearTimeout(escalation);
    if (!process.connected) { process.exit(result.status); }
    process.send!({ kind: 'result', result }, () => {
      process.stdout.write('', () => process.stderr.write('', () => process.exit(result.status)));
    });
  }
}
