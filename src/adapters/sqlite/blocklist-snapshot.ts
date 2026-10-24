/**
 * Pure, `node:sqlite`-free materialization of the operator-local agent
 * blocklist into the plain snapshot the synchronous agent selector consumes.
 *
 * The composition root reads blocklist rows from SQLite once (async) at
 * startup and calls {@link materializeBlocklistSnapshot} to produce this
 * snapshot; the hot selection path then stays fully synchronous (ADR 0051 /
 * ADR 0053). This module imports nothing effectful so it is safe to load from
 * both the adapter and the application composition layer, and it can be unit
 * tested without opening a database.
 */
import type { AgentBlockEntry } from '../../application/ports/agent-blocklist.js';

/** A blocklist row as stored in SQLite (`agent_blocklist`). */
export type StoredBlockEntry = AgentBlockEntry;

/**
 * Persisted blocklist rows keyed by lower-case agent family, unchanged. The
 * rows are interpreted at each selection, not here, so a timed block expires as
 * the clock advances without rematerializing. `null` (not this type) is used
 * elsewhere to signal the adapter is disabled and file readers should be used.
 */
export type OperatorBlocklistOverlay = Readonly<Record<string, StoredBlockEntry>>;

/** Key SQLite blocklist rows by family for synchronous lookup. */
export function materializeBlocklistSnapshot(
  entries: readonly StoredBlockEntry[],
): OperatorBlocklistOverlay {
  return Object.fromEntries(entries.map((entry) => [entry.agent.toLowerCase(), { ...entry }]));
}
