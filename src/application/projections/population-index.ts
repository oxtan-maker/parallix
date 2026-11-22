/**
 * Groups one shared population by a stable identity so a per-item report reads its own slice instead of rescanning
 * the whole population once per item. Rows keep their input order inside each group, so a group lookup answers
 * exactly what the equivalent `filter` returned. A null or undefined identity belongs to no group, which matches a
 * key comparison that can never match a real identity.
 */
export function groupByKey<T>(items: readonly T[], key: (item: T) => string | null | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const identity = key(item);
    if (identity === null || identity === undefined) { continue; }
    const rows = grouped.get(identity);
    if (rows) { rows.push(item); } else { grouped.set(identity, [item]); }
  }
  return grouped;
}

/** The first row carrying each identity, in input order; equivalent to `items.find(...)` per identity. */
export function firstByKey<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const first = new Map<string, T>();
  for (const item of items) { if (!first.has(key(item))) { first.set(key(item), item); } }
  return first;
}
