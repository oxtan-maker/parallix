import path from 'node:path';
import fs from 'node:fs';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import type { Mission } from '../../src/domain/mission.js';
import { caseRoot } from './case-root.js';

export interface LaneEventRow {
  readonly from_status: string | null;
  readonly to_status: string;
  readonly trigger: string;
}

/** A case-owned, fully migrated operator database with its Mission store. */
export interface MigratedMissionStore {
  readonly lifetime: 'case';
  /** Private directory holding `parallix.db`. */
  readonly root: string;
  readonly database: SqliteDatabaseAdapter;
  readonly store: SqliteMissionStore;
  /** Lane events recorded for one mission, oldest first, as plain objects. */
  laneEvents(_missionId: string): Promise<LaneEventRow[]>;
  /** Close the database, then remove the root. Idempotent. */
  close(): Promise<void>;
}

/**
 * Open a migrated SQLite operator database in a fresh case root and insert
 * `missions` through the real Mission store (TASK-2622.04).
 */
export async function openMigratedMissionStore(
  missions: readonly Mission[] = [],
  schemaTemplate?: string,
): Promise<MigratedMissionStore> {
  const owned = caseRoot('parallix-mission-store-');
  const database = new SqliteDatabaseAdapter();
  try {
    const databasePath = path.join(owned.root, 'parallix.db');
    // A suite may supply an immutable, SQLite-consistent empty-schema backup.
    // Each case still owns a separate file, connection and Mission population.
    if (schemaTemplate) { fs.copyFileSync(schemaTemplate, databasePath); }
    await database.open({ path: databasePath });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(database);
    for (const mission of missions) { await store.save(mission, null); }
    let closed = false;
    return {
      lifetime: 'case',
      root: owned.root,
      database,
      store,
      async laneEvents(missionId) {
        const rows = await database.query<LaneEventRow>(
          'SELECT from_status, to_status, trigger FROM board_lane_events WHERE mission_id = ? ORDER BY id',
          [missionId],
        );
        // node:sqlite returns null-prototype rows; normalize for plain-object asserts.
        return rows.map((row) => ({ from_status: row.from_status, to_status: row.to_status, trigger: row.trigger }));
      },
      async close() {
        if (closed) { return; }
        closed = true;
        await database.close();
        owned.dispose();
      },
    };
  } catch (error) {
    await database.close().catch(() => {});
    owned.dispose();
    throw error;
  }
}
