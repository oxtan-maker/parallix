/** Wake a polling supervisor promptly without retaining an abort listener. */
export async function interruptiblePause(wait: Promise<unknown>, signal?: AbortSignal): Promise<void> {
  if (supervisionStopped(signal)) { return; }
  let wake: () => void = () => {};
  const interrupted = new Promise<void>(resolve => { wake = resolve; });
  signal?.addEventListener('abort', wake, { once: true });
  try { await Promise.race([wait, interrupted]); }
  finally { signal?.removeEventListener('abort', wake); }
}

export function supervisionStopped(signal?: AbortSignal): boolean { return signal?.aborted === true; }

export function assertSupervisionRunning(signal?: AbortSignal): void {
  if (supervisionStopped(signal)) { throw new Error('Supervision interrupted'); }
}
