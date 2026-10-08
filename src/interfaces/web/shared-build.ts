/**
 * Share projection builds between overlapping readers without ever serving a
 * read that began before its caller asked.
 *
 * A caller arriving while a build runs may not take that build's result: the
 * board could have changed after the build read it. It waits for the running
 * build to finish and then for one further build, which every caller that
 * arrived in the meantime shares. N overlapping readers (browser tabs
 * refetching on one invalidation, the change-detection tick, a command's
 * confirmation read) therefore cost at most two serial builds, not N.
 */
export function shareBuilds<T>(build: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  let queued: Promise<T> | null = null;

  const start = (): Promise<T> => {
    const current = build();
    running = current;
    const release = () => {
      if (running === current) { running = null; }
    };
    current.then(release, release);
    return current;
  };

  return () => {
    if (running === null) { return start(); }
    queued ??= running.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      queued = null;
      return start();
    });
    return queued;
  };
}
