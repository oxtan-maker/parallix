/**
 * A piped child is finished when its own process exits. Node's `close` event
 * also waits for every descendant that inherited the pipes, so a background
 * process left by a finished gate or agent would hold the caller open for as
 * long as it lives (TASK-2806). This only stops waiting; it signals nothing.
 */
import type { ChildProcess } from 'node:child_process';
import { setImmediate } from 'node:timers';

/** Total time after the direct child's exit before inherited pipes are released. */
export const EXIT_DRAIN_MS = 500;

/**
 * Settle a piped child on its own exit. Output already buffered by the exited
 * child is read for at most `drainMs` (normally `close` arrives first); then
 * reading stops and the exit status settles, however much an inheriting
 * descendant keeps writing. While `terminating()` holds, a cancellation or
 * timeout path owns completion and its escalation, so the pipes are left untouched.
 */
export function settleOnExit(child: ChildProcess, settle: (_code: number | null, _signal: NodeJS.Signals | null) => void,
  { drainMs = EXIT_DRAIN_MS, terminating = () => false }: { drainMs?: number; terminating?: () => boolean } = {}): void {
  const streams = [child.stdout, child.stderr].filter((stream): stream is NonNullable<typeof stream> => Boolean(stream));
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  child.once('close', () => { closed = true; clearTimeout(timer); });
  child.once('exit', (code, signal) => {
    timer = setTimeout(() => {
      // Timers run before the poll phase; let output already in the pipe be read first.
      setImmediate(() => {
        if (closed || terminating()) { return; }
        for (const stream of streams) { stream.destroy(); }
        settle(code, signal);
      });
    }, drainMs);
  });
}
