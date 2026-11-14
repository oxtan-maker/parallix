export interface ProjectionFreshness {
  readonly state: 'fresh' | 'stale';
  readonly revision: string;
  readonly refreshedAt: string;
  readonly reason: string | null;
}

export interface SharedProjectionRead<T> {
  readonly projection: T;
  readonly freshness: ProjectionFreshness;
}

export interface SharedProjectionRefresh<T> extends SharedProjectionRead<T> {
  readonly changed: boolean;
}

/**
 * Retain the latest completed application projection for browser reads.
 *
 * Change detection and confirmed commands replace the completed value. Readers
 * either reuse that value or join the first build; they never schedule a
 * second projection merely because another browser arrived. Detection refreshes
 * join a running build, while `refreshAfterCurrent` queues one shared build that
 * begins afterward so a command cannot publish pre-command state. A failed
 * refresh marks the retained value stale and still rejects the detector so the
 * SSE error path reports the unavailability. With no completed value, the
 * failure stays unavailable rather than fabricating an empty projection.
 * Recovering a retained stale value counts as a change even when its projection
 * identity is unchanged, so connected clients can clear the stale state.
 */
export function createSharedProjection<T>(
  build: () => Promise<T>,
  identify: (_projection: T) => string,
  now: () => string = () => new Date().toISOString(),
): {
  read(): Promise<SharedProjectionRead<T>>;
  refresh(): Promise<SharedProjectionRefresh<T>>;
  refreshAfterCurrent(): Promise<SharedProjectionRefresh<T>>;
} {
  let completed: SharedProjectionRead<T> | null = null;
  let running: Promise<SharedProjectionRefresh<T>> | null = null;
  let queued: Promise<SharedProjectionRefresh<T>> | null = null;

  const refresh = (): Promise<SharedProjectionRefresh<T>> => {
    if (running !== null) { return running; }
    let started: Promise<T>;
    try {
      started = Promise.resolve(build());
    } catch (error) {
      started = Promise.reject(error);
    }
    const current = started.then((projection) => {
      const revision = identify(projection);
      const freshness: ProjectionFreshness = { state: 'fresh', revision, refreshedAt: now(), reason: null };
      const changed = completed === null
        || completed.freshness.revision !== revision
        || completed.freshness.state === 'stale';
      const result = { projection, freshness, changed } as const;
      completed = result;
      return result;
    }).catch((error: unknown) => {
      if (completed !== null) {
        const reason = error instanceof Error ? error.message : String(error);
        completed = { projection: completed.projection, freshness: { ...completed.freshness, state: 'stale', reason } };
      }
      throw error;
    });
    running = current;
    const release = () => { if (running === current) { running = null; } };
    current.then(release, release);
    return current;
  };

  const refreshAfterCurrent = (): Promise<SharedProjectionRefresh<T>> => {
    if (running === null) { return refresh(); }
    queued ??= running.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      queued = null;
      return refresh();
    });
    return queued;
  };

  return {
    read: async () => completed ?? refresh(),
    refresh,
    refreshAfterCurrent,
  };
}
