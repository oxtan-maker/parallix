/** Merge a typed fixture override while retaining complete service instances. */
export function mergeFixturePort<T extends object>(base: T, override: Partial<T> | undefined): T {
  if (!override) { return base; }
  const keys = Object.keys(base) as (keyof T)[];
  // A complete instance can hold private state and methods on its prototype.
  if (keys.every(key => typeof override[key] === typeof base[key])) { return override as T; }
  return { ...base, ...override };
}
