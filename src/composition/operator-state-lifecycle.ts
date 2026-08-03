/** Minimal process surface used to make shutdown ownership mockable. */
export interface ShutdownProcess {
  once(_event: 'beforeExit' | 'exit', _listener: () => void): unknown;
}

const registeredShutdowns = new WeakMap<object, () => Promise<void>>();

/**
 * Register one idempotent shutdown path for the process-lifetime operator DB.
 *
 * `beforeExit` is the normal asynchronous close path. `exit` is a fallback for
 * legacy command handlers that call `process.exit()` directly and therefore
 * bypass `beforeExit`; SQLite's close operation starts synchronously.
 */
export function registerOperatorStateShutdown(
  closeOperatorState: () => Promise<void>,
  closeOperatorStateSync: () => void,
  processRef: ShutdownProcess = process,
): () => Promise<void> {
  const registered = registeredShutdowns.get(processRef as object);
  if (registered) { return registered; }
  let closePromise: Promise<void> | null = null;
  const closeOnce = () => {
    closePromise ??= closeOperatorState();
    return closePromise;
  };
  const closeSynchronouslyOnExit = () => {
    if (!closePromise) {
      closeOperatorStateSync();
    }
  };

  processRef.once('beforeExit', () => { void closeOnce(); });
  processRef.once('exit', closeSynchronouslyOnExit);
  registeredShutdowns.set(processRef as object, closeOnce);
  return closeOnce;
}
