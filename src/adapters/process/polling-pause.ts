import type { Poll } from '../../application/recovery-supervisor.js';

/**
 * The supervisor's polling pause (ADR 0059).
 *
 * The timer is deliberately **referenced**. While the supervisor waits on work
 * owned by another process — a live agent on a mission, a recovery claim held
 * by another run — nothing else keeps this process alive, and an unreferenced
 * timer would let Node exit in the middle of supervision.
 *
 * A referenced timer must therefore be cancellable, which is why a pause is
 * handed back with its `cancel`: the loop races the pause against its running
 * steps and cancels the one it stops waiting on, so no referenced timer
 * outlives its usefulness and holds the process open.
 */
export function pollingPause(
  milliseconds: number,
  timers: {
    readonly set: (_fn: () => void, _ms: number) => NodeJS.Timeout;
    readonly clear: (_handle: NodeJS.Timeout) => void;
  } = { set: setTimeout, clear: clearTimeout },
): Poll {
  let handle: NodeJS.Timeout | undefined;
  const elapsed = new Promise<void>((resolve) => { handle = timers.set(resolve, milliseconds); });
  return {
    elapsed,
    cancel: () => { if (handle) { timers.clear(handle); } },
  };
}
