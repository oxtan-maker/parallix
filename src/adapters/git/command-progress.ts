import { Worker } from 'node:worker_threads';
import { SPINNER_FRAMES } from '../../application/presentation/progress-frames.js';

// A worker owns animation because synchronous external hooks block the CLI's
// event loop. Direct fd writes keep frames visible during spawnSync.
const animationSource = `
import { workerData } from 'node:worker_threads';
import { writeSync } from 'node:fs';
const state = new Int32Array(workerData.state);
let frame = 0;
setInterval(() => {
  if (Atomics.load(state, 0) || Atomics.compareExchange(state, 1, 0, 1)) return;
  try {
    if (!Atomics.load(state, 0)) {
      const elapsed = ((Date.now() - workerData.started) / 1000).toFixed(1);
      writeSync(2, '\\r' + workerData.frames[frame++ % workerData.frames.length]
        + ' ' + workerData.label + ' (' + elapsed + 's)');
    }
  } finally {
    Atomics.store(state, 1, 0);
    Atomics.notify(state, 1);
  }
}, 250);
`;

export interface CommandProgressOptions {
  write?: (_message: string) => void;
  now?: () => number;
  animate?: false | ((_label: string, _started: number) => () => void);
}

function startAnimation(label: string, started: number): () => void {
  const state = new Int32Array(new SharedArrayBuffer(8));
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(animationSource)}`), {
    // CLI loaders and --input-type apply to the parent entry, not this plain
    // ESM worker. Inheriting them can prevent animation from starting.
    execArgv: [],
    workerData: { state: state.buffer, label, started, frames: SPINNER_FRAMES },
  });
  // Presentation failure must never alter the external command's outcome.
  worker.on('error', () => {});
  worker.unref();
  return () => {
    Atomics.store(state, 0, 1);
    while (Atomics.load(state, 1)) { Atomics.wait(state, 1, 1, 100); }
    void worker.terminate().catch(() => {});
    // Stop takes the rendering lock before clearing: no late frames can appear
    // after the completion mark or the next workflow message.
    process.stderr.write(`\r${' '.repeat(label.length + 40)}\r`);
  };
}

/** Preserve captured command evidence; progress is written only to stderr. */
export function withCommandProgress<T extends { status: number | null }>(
  label: string,
  command: () => T,
  options: CommandProgressOptions = {},
): T {
  const write = options.write ?? ((message: string) => { process.stderr.write(message); });
  const now = options.now ?? Date.now;
  const started = now();
  const animate = options.animate ?? (process.stderr.isTTY ? startAnimation : undefined);
  if (animate) { write(`[ ] ${label}`); }
  const stop = animate ? animate(label, started) : undefined;
  let passed = false;
  try {
    const result = command();
    passed = result.status === 0;
    return result;
  } finally {
    stop?.();
    write(`${passed ? '[✓]' : '[✗]'} ${label} (${((now() - started) / 1000).toFixed(1)}s)\n`);
  }
}
