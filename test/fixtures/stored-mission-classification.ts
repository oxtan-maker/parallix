import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import { resolveDatabasePath } from '../../src/adapters/sqlite/database-path-resolver.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../src/adapters/sqlite/migration-runner.js';

/** Give a stats fixture the same classified Mission state as a live workflow. */
export async function seedStoredMissionClassification(slug: string, classification = 'ai_sdlc'): Promise<void> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: resolveDatabasePath({ configuration: resolveConfiguration(process.env) }) });
  try {
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    await db.execute(
      'INSERT OR IGNORE INTO missions (id, repository_id, title, status) VALUES (?, ?, ?, ?)',
      [slug, 'fixture-repository', slug, 'active'],
    );
    await db.execute('DELETE FROM mission_labels WHERE mission_id = ?', [slug]);
    await db.execute(
      'INSERT INTO mission_labels (mission_id, position, label) VALUES (?, ?, ?)',
      [slug, 0, classification],
    );
  } finally {
    await db.close();
  }
}
