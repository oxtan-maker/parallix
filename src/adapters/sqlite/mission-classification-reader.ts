import fs from 'node:fs';

import { SqliteDatabaseAdapter } from './database-adapter.js';
import { resolveDatabasePath } from './database-path-resolver.js';

/**
 * What the operator Mission database records for one Mission's labels.
 *
 * `found` carries the stored label list (possibly empty). `missing` means the
 * database has no aggregate for the slug — the only state in which a caller may
 * consult a legacy provider task. `unavailable` means the database could not be
 * read at all (absent file or unmigrated schema).
 */
export type StoredMissionLabels =
  | { readonly kind: 'found'; readonly labels: readonly string[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Read a Mission's stored labels synchronously.
 *
 * Stage-stat producers and startup preflight run inside synchronous command
 * code, like the measurement producers, so this opens a short-lived
 * `DatabaseSync` handle on the operator database instead of the queued async
 * `SqliteMissionStore`. It never creates or migrates the database.
 */
export function readStoredMissionLabels(slug: string, options: { readonly dbPath?: string } = {}): StoredMissionLabels {
  const dbPath = options.dbPath ?? resolveDatabasePath();
  if (!fs.existsSync(dbPath)) {
    return { kind: 'unavailable', reason: `no Mission database at ${dbPath}` };
  }
  const db = new SqliteDatabaseAdapter();
  try {
    db.openSync({ path: dbPath });
    const missions = db.querySync<{ id: string }>('SELECT id FROM missions WHERE id = ?', [slug]);
    if (missions.length === 0) {
      return { kind: 'missing' };
    }
    const labels = db.querySync<{ label: string }>(
      'SELECT label FROM mission_labels WHERE mission_id = ? ORDER BY position',
      [slug],
    );
    return { kind: 'found', labels: labels.map(({ label }) => String(label)) };
  } catch (error) {
    return { kind: 'unavailable', reason: (error as Error).message || String(error) };
  } finally {
    try { db.closeSync(); } catch { /* handle may never have opened */ }
  }
}
