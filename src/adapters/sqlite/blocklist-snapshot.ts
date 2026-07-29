/**
 * Pure, `node:sqlite`-free materialization of the operator-local agent
 * blocklist into the plain overlay the synchronous agent selector consumes.
 *
 * The composition root reads blocklist rows from SQLite once (async) at
 * startup and calls {@link materializeBlocklistSnapshot} to produce this
 * snapshot; the hot selection path then stays fully synchronous (ADR 0051 /
 * ADR 0053). This module imports nothing effectful so it is safe to load from
 * both the adapter and the application composition layer, and it can be unit
 * tested without opening a database.
 */

/** A blocklist row as stored in SQLite (`agent_blocklist`). */
export interface StoredBlockEntry {
  readonly agent: string;
  readonly blocked: boolean;
  readonly until?: string;
  readonly reason?: string;
}

/**
 * Operator-local blocklist overlay keyed by agent family. The value shape is
 * intentionally identical to a `config.blocklist` entry so the existing
 * `isAgentBlocked` consumer reads it unchanged. `null` (not this type) is used
 * elsewhere to signal the adapter is disabled and file readers should be used.
 */
export type OperatorBlocklistOverlay = Readonly<
  Record<string, { readonly blocked?: boolean; readonly until?: string; readonly reason?: string }>
>;

/**
 * Convert SQLite blocklist rows into the overlay. Only genuinely-blocked agents
 * are included — an agent absent from the overlay is not blocked. Time-based
 * blocks are represented as `{ until }` so the existing `isAgentBlocked` expiry
 * logic applies unchanged; indefinite blocks as `{ blocked: true }`.
 */
export function materializeBlocklistSnapshot(
  entries: readonly StoredBlockEntry[],
): OperatorBlocklistOverlay {
  const overlay: Record<string, { blocked?: boolean; until?: string; reason?: string }> = {};
  for (const entry of entries) {
    if (entry.until) {
      overlay[entry.agent] = {
        until: entry.until,
        ...(entry.reason ? { reason: entry.reason } : {}),
      };
    } else if (entry.blocked) {
      overlay[entry.agent] = {
        blocked: true,
        ...(entry.reason ? { reason: entry.reason } : {}),
      };
    }
    // Rows with blocked=false and no `until` are not blocks; omit them.
  }
  return overlay;
}
