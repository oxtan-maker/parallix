export interface NoOutputWatchdog {
  /** Observational reports continue until the launch settles, including after output. */
  onNoOutput?: (_event: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null }) => void;
  initialDelayMs?: number;
  intervalMs?: number;
}

/** The same liveness clock for a child process or an in-process SDK session. */
export function createOutputWatchdog(
  watchdog: NoOutputWatchdog | null | undefined,
  invocation: { command: string; args: string[]; pid?: number },
  startedAt = Date.now(),
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let sawOutput = false;
  let lastOutputAt: number | null = null;
  const clear = () => {
    closed = true;
    if (timer) { clearTimeout(timer); timer = null; }
  };
  const schedule = (delayMs: number) => {
    if (closed || typeof watchdog?.onNoOutput !== 'function') { return; }
    timer = setTimeout(() => {
      timer = null;
      if (closed) { return; }
      try {
        watchdog.onNoOutput?.({ command: invocation.command, args: invocation.args, pid: invocation.pid,
          elapsedMs: Date.now() - startedAt, sawOutput,
          msSinceLastOutput: lastOutputAt === null ? null : Date.now() - lastOutputAt });
      } catch { /* Observational reporting must never fail the launch. */ }
      schedule(watchdog.intervalMs ?? 0);
    }, Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0);
    timer.unref?.();
  };
  schedule(watchdog?.initialDelayMs ?? 0);
  return { clear, noteOutput: () => { sawOutput = true; lastOutputAt = Date.now(); } };
}
