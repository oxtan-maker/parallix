import fs from 'node:fs';
import path from 'node:path';
import { resolveDatabasePath } from './database-path-resolver.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';

/**
 * DB-owned, repository-scoped identity for free-text adhoc intakes (task-2468).
 *
 * Backlog-backed missions keep their identity in a Backlog task file. An adhoc
 * mission has no such file in an adhoc-only repository, so its identity is
 * minted here: a monotonic counter owned per repository, allocated atomically,
 * producing `parallix-adhoc-<NNNN>`. No content hash: slug, mission id, branch,
 * and worktree suffix all derive from this counter, exactly like the original
 * pre-Parallix derivation rule for Backlog missions.
 *
 * The counter row is sparse on purpose — only repository identity and the last
 * allocated number — because the identity is fully derivable from it.
 *
 * The synchronous SQLite handle is opened through `SqliteDatabaseAdapter` so the
 * `node:sqlite` driver import stays confined to that one module (SC2).
 */

const ADHOC_PREFIX = 'parallix-adhoc-';

/** @param {number} counter */
function formatCounter(counter: number): string {
  return String(counter).padStart(4, '0');
}

export interface AdhocIdentity {
  readonly slug: string;
  readonly missionId: string;
  /** Derivable task identity: slug upper-cased, no content hash. */
  readonly taskId: string;
}

/**
 * Atomically allocate the next adhoc identity for the repository at `rootDir`.
 *
 * Opens a short-lived synchronous SQLite handle via `SqliteDatabaseAdapter`,
 * upserts the per-repository counter inside one transaction, and closes the
 * handle. Idempotent table creation lets this run before or after the `0018`
 * migration has applied; the migration remains the source of truth for the
 * schema.
 *
 * @param {string} repositoryId repository-scoped identity key
 * @param {{ dbPath?: string }} [opts]
 */
export function allocateAdhocIdentity(
  repositoryId: string,
  opts: { dbPath?: string } = {},
): AdhocIdentity {
  const dbPath = opts.dbPath ?? resolveDatabasePath();

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new SqliteDatabaseAdapter();
  try {
    db.openSync({ path: dbPath });
    db.executeSync(
      'CREATE TABLE IF NOT EXISTS adhoc_mission_counters (' +
        'repository_id TEXT PRIMARY KEY, counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0));',
    );

    let counter: number;
    db.executeSync('BEGIN');
    try {
      const row = db.querySync<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        [repositoryId],
      );
      const next = (row[0]?.counter ?? 0) + 1;
      db.executeSync(
        'INSERT INTO adhoc_mission_counters (repository_id, counter) VALUES (?, ?) ' +
          'ON CONFLICT(repository_id) DO UPDATE SET counter = excluded.counter',
        [repositoryId, next],
      );
      counter = next;
      db.executeSync('COMMIT');
    } catch (error) {
      db.executeSync('ROLLBACK');
      throw error;
    }

    const slug = `${ADHOC_PREFIX}${formatCounter(counter)}`;
    return { slug, missionId: slug, taskId: slug.toUpperCase() };
  } catch (error) {
    db.closeSync();
    throw error;
  }
}
