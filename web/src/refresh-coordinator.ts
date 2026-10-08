/**
 * The one path every board snapshot read takes (TASK-2655). Reads are serial:
 * at most one is in flight, so a response can never settle after a newer one
 * and roll the board back. A request that arrives while a read is running is
 * queued, never discarded — the queue runs one more read that starts after
 * it, so the newest projection is always fetched.
 *
 * Stream signals (`schedule`) start a read at once and open a coalescing
 * window; signals inside the window collapse into one trailing read when it
 * closes. A change therefore never waits out the window before the board
 * starts refreshing, the window is never postponed by later signals, and a
 * continuous event burst still costs at most one read per window.
 */

export interface RefreshCoordinator {
  /**
   * Ask for a read that starts after this call. Settles once such a read has
   * been applied, or immediately when the coordinator is disposed.
   */
  request(): Promise<void>;
  /** Read now, and coalesce further signals into at most one read per window. */
  schedule(): void;
  /** Cancel the window and release every waiter; nothing is applied after this. */
  dispose(): void;
}

export interface RefreshCoordinatorOptions<T> {
  readonly load: () => Promise<T>;
  /**
   * Apply one read's result. `superseded` is true when another request is
   * already queued behind it. Returning false declines the result; its
   * callers then wait for the queued read instead.
   */
  readonly apply: (result: T, superseded: boolean) => boolean;
  readonly coalesceMs: number;
}

export function createRefreshCoordinator<T>(options: RefreshCoordinatorOptions<T>): RefreshCoordinator {
  let disposed = false;
  let running = false;
  let waiting: (() => void)[] = [];
  let inFlight: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let trailing = false;

  const release = (batch: readonly (() => void)[]) => { for (const settle of batch) { settle(); } };

  async function run() {
    running = true;
    while (!disposed && waiting.length > 0) {
      inFlight = waiting;
      waiting = [];
      const result = await options.load();
      if (disposed) { break; }
      const batch = inFlight;
      inFlight = [];
      if (options.apply(result, waiting.length > 0)) { release(batch); } else { waiting = [...batch, ...waiting]; }
    }
    running = false;
  }

  const request = () => new Promise<void>((settle) => {
    if (disposed) { settle(); return; }
    waiting.push(settle);
    if (!running) { void run(); }
  });

  function schedule() {
    if (disposed) { return; }
    if (timer !== undefined) { trailing = true; return; }
    void request();
    timer = setTimeout(() => {
      timer = undefined;
      if (!trailing) { return; }
      trailing = false;
      schedule();
    }, options.coalesceMs);
  }

  return {
    request,
    schedule,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
      trailing = false;
      const pending = [...inFlight, ...waiting];
      inFlight = [];
      waiting = [];
      release(pending);
    },
  };
}
