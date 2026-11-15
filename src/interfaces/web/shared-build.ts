export interface ProjectionFreshness {
  readonly state: 'fresh' | 'stale' | 'unavailable';
  readonly revision: string | null;
  readonly refreshedAt: string | null;
  readonly reason: string | null;
}

/**
 * The board data families the transport delivers independently (TASK-2854.04):
 * the current workflow families, the historical analytics family, and the
 * on-demand mission detail family.
 */
export type ProjectionFamilyName = 'workflow' | 'analytics' | 'detail';

/** One truthful freshness per family. A deferred family never demotes another. */
export type ProjectionFamilies = Readonly<Record<ProjectionFamilyName, ProjectionFreshness>>;

export interface SharedProjectionRead<T> {
  /** The current workflow family's projection; families are delivered apart. */
  readonly projection: T;
  /** The workflow family's freshness: the command gate and the board read report this. */
  readonly freshness: ProjectionFreshness;
  readonly families: ProjectionFamilies;
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
 *
 * Freshness is per family (TASK-2854.04): `familiesOf` declares the freshness a
 * projection carries beyond the workflow family, so a deferred or failed
 * historical refresh is reported on the analytics family alone. A retained
 * value marks every family that claimed an observation stale, because nothing
 * in it was re-observed.
 */
export function createSharedProjection<T>(
  build: () => Promise<T>,
  identify: (_projection: T) => string,
  now: () => string = () => new Date().toISOString(),
  familiesOf: (_projection: T, _workflow: ProjectionFreshness) => Partial<ProjectionFamilies> = () => ({}),
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
      const families: ProjectionFamilies = {
        workflow: freshness,
        detail: freshness,
        analytics: { state: 'unavailable', revision: null, refreshedAt: null, reason: 'this projection declares no historical analytics family' },
        ...familiesOf(projection, freshness),
      };
      const changed = completed === null
        || completed.freshness.revision !== revision
        || completed.freshness.state === 'stale';
      const result = { projection, freshness, families, changed } as const;
      completed = result;
      return result;
    }).catch((error: unknown) => {
      if (completed !== null) {
        const reason = error instanceof Error ? error.message : String(error);
        const stale = (family: ProjectionFreshness): ProjectionFreshness => family.state === 'unavailable'
          ? family
          : { ...family, state: 'stale', reason: family.reason ?? reason };
        completed = {
          projection: completed.projection,
          freshness: stale(completed.freshness),
          families: {
            workflow: stale(completed.families.workflow),
            analytics: stale(completed.families.analytics),
            detail: stale(completed.families.detail),
          },
        };
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
