import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { migrateLegacyAdhocIds } from '../../../src/adapters/sqlite/legacy-adhoc-migration.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { createMigrateLegacyAdhocIdsCommand } from '../../../src/interfaces/cli/migrate-legacy-adhoc-ids.js';
import { missionId as domainMissionId } from '../../../src/domain/mission.js';

const tempDirs: string[] = [];

function tempDatabasePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-legacy-adhoc-'));
  tempDirs.push(dir);
  return path.join(dir, 'operator.db');
}

async function openDatabase(databasePath = tempDatabasePath()): Promise<SqliteDatabaseAdapter> {
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: databasePath });
  return database;
}

async function migratedDatabase(databasePath = tempDatabasePath()): Promise<SqliteDatabaseAdapter> {
  const database = await openDatabase(databasePath);
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  return database;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Insert a legacy `parallix-adhoc-<NNNN>` mission with a representative set of
 * child rows across direct and nested tables, so the migration has references
 * of every kind to preserve. `counter` seeds the per-repository counter.
 */
async function seedLegacyMission(
  db: SqliteDatabaseAdapter,
  legacyId: string,
  repositoryId: string,
  counter: number,
  extra?: { dependsOn?: string },
): Promise<void> {
  await db.execute(
    'INSERT INTO missions (id, repository_id, title, status, version) VALUES (?, ?, ?, ?, 1)',
    [legacyId, repositoryId, `Legacy ${legacyId}`, 'backlog'],
  );
  // Seed the per-repository counter so the minted id is deterministic.
  await db.execute(
    'INSERT INTO adhoc_mission_counters (repository_id, counter) VALUES (?, ?) '
      + 'ON CONFLICT(repository_id) DO UPDATE SET counter = excluded.counter',
    [repositoryId, counter],
  );
  await db.execute(
    'INSERT INTO mission_labels (mission_id, position, label) VALUES (?, ?, ?)',
    [legacyId, 0, 'adhoc'],
  );
  await db.execute(
    'INSERT INTO mission_success_criteria (mission_id, position, criterion) VALUES (?, ?, ?)',
    [legacyId, 0, 'must migrate'],
  );
  await db.execute(
    'INSERT INTO mission_checkpoints (mission_id, position, checkpoint_mission_id, name, next_action_text) '
      + 'VALUES (?, 0, ?, ?, ?)',
    [legacyId, legacyId, 'CP-1', 'done'],
  );
  await db.execute(
    'INSERT INTO mission_checkpoint_goal_checks (mission_id, checkpoint_position, position, criterion, evidence) '
      + 'VALUES (?, 0, 0, ?, ?)',
    [legacyId, 'migrated', 'counter bumped'],
  );
  await db.execute(
    'INSERT INTO mission_reviews (mission_id) VALUES (?)',
    [legacyId],
  );
  await db.execute(
    'INSERT INTO mission_review_rounds (mission_id, position, round_number, change_kind, provider_change_id, '
      + 'source_branch, target_branch, revision, reviewer, implementer, started_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [legacyId, 0, 1, 'local-branch', null, 'mission/legacy', 'main', 'abc', 'rev', 'custom', 'now'],
  );
  await db.execute(
    'INSERT INTO mission_declared_gates (mission_id, position, command) VALUES (?, 0, ?)',
    [legacyId, 'npm test'],
  );
  await db.execute(
    'INSERT INTO mission_external_task_refs (mission_id, source, external_id) VALUES (?, ?, ?)',
    [legacyId, 'backlog', legacyId.toUpperCase()],
  );
  await db.execute(
    'INSERT INTO mission_briefs (mission_id, goal, why_text, scope_text) VALUES (?, ?, ?, ?)',
    [legacyId, 'goal', 'why', 'scope'],
  );
  // The out-of-scope boundary lives in `mission_brief_out_of_scope` (renamed
  // from `mission_brief_constraints` by migration 0023), whose `mission_id`
  // traces to `mission_briefs(mission_id)`. It must move with the mission or
  // the row is orphaned from the new brief.
  await db.execute(
    'INSERT INTO mission_brief_out_of_scope (mission_id, position, entry) VALUES (?, ?, ?)',
    [legacyId, 0, `${legacyId}: out of scope`],
  );
  // Nested review rows trace to missions through mission_reviews ->
  // mission_review_rounds, so they prove the rewrite is transitive, not just a
  // direct child update.
  await db.execute(
    'INSERT INTO mission_review_findings (mission_id, round_position, position, finding_id, summary) '
      + 'VALUES (?, 0, 0, ?, ?)',
    [legacyId, 'finding-1', 'needs review'],
  );
  await db.execute(
    'INSERT INTO mission_review_events (mission_id, position, event_type, content, created_at) '
      + 'VALUES (?, 0, ?, ?, ?)',
    [legacyId, 'human_note', 'note', '2026-10-09T00:00:00Z'],
  );
  await db.execute(
    'INSERT INTO mission_review_stage_launches (mission_id, stage_key, position, fingerprint) '
      + 'VALUES (?, ?, 0, ?)',
    [legacyId, 'fix:custom', 'fp-1'],
  );
  await db.execute(
    'INSERT INTO board_lane_events (repository_id, mission_id, from_status, to_status, trigger, agent, '
      + 'occurred_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [repositoryId, legacyId, 'backlog', 'refined', 'activate', 'custom', '2026-10-09T00:00:00Z', `${legacyId}:1`],
  );
  await db.execute(
    'INSERT INTO session_markers (repository_id, mission_id, role, agent, last_launched) VALUES (?, ?, ?, ?, ?)',
    [repositoryId, legacyId, 'execute', 'custom', '2026-10-09T00:00:00Z'],
  );
  // Durable references that trace the legacy id without a `mission_id` column:
  // `usage_statistics.mission` (statistics keyed by mission) and
  // `operational_history.event_data.missionId` (the board current-work reads
  // index this JSON field). Both must rewrite with the mission.
  await db.execute(
    'INSERT INTO usage_statistics (date, repo, mission, stage) VALUES (?, ?, ?, ?)',
    ['2026-10-09', repositoryId, legacyId, 'default'],
  );
  await db.execute(
    'INSERT INTO operational_history (event_type, event_data, created_at) VALUES (?, ?, ?)',
    ['brief', JSON.stringify({ missionId: legacyId, repositoryId, message: `${legacyId}: brief`, criterion: 'c1' }), '2026-10-09T00:00:00Z'],
  );
  if (extra?.dependsOn) {
    await db.execute(
      'INSERT INTO mission_dependencies (mission_id, position, depends_on_mission_id) VALUES (?, 0, ?)',
      [legacyId, extra.dependsOn],
    );
  }
}

async function missionId(db: SqliteDatabaseAdapter, id: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>('SELECT id FROM missions WHERE id = ?', [id]);
  return rows[0]?.id ?? null;
}

async function childCount(db: SqliteDatabaseAdapter, table: string, missionIdValue: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE mission_id = ?`,
    [missionIdValue],
  );
  return Number(rows[0]?.n ?? 0);
}

// Task provenance: task-2706 (legacy adhoc id migration).
describe('SQLite legacy adhoc id migration', () => {
  it('rewrites a legacy id to a counter-owned px id and preserves every child reference', async () => {
    const database = await migratedDatabase();
    try {
      await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
      await seedLegacyMission(database, 'parallix-adhoc-0005', 'repo-parallix', 0, { dependsOn: 'task-other' });

      const before = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-parallix'],
      );
      assert.equal(before[0].counter, 0);

      const result = await migrateLegacyAdhocIds(database);

      assert.equal(result.migrated.length, 2);
      assert.deepEqual(
        result.migrated.map(({ from, to }) => ({ from, to })),
        [{ from: 'parallix-adhoc-0004', to: 'px-0001' }, { from: 'parallix-adhoc-0005', to: 'px-0002' }],
      );

      // Old ids are gone; new ids exist and carry the same repository scope.
      assert.equal(await missionId(database, 'parallix-adhoc-0004'), null);
      assert.equal(await missionId(database, 'parallix-adhoc-0005'), null);
      assert.equal(await missionId(database, 'px-0001'), 'px-0001');
      assert.equal(await missionId(database, 'px-0002'), 'px-0002');

      // Every child table now traces to the new id; nothing is orphaned.
      for (const table of [
        'mission_labels',
        'mission_success_criteria',
        'mission_checkpoints',
        'mission_checkpoint_goal_checks',
        'mission_reviews',
        'mission_review_rounds',
        'mission_review_findings',
        'mission_review_events',
        'mission_review_stage_launches',
        'mission_declared_gates',
        'mission_external_task_refs',
        'mission_briefs',
        'board_lane_events',
        'session_markers',
      ] as const) {
        assert.equal(await childCount(database, table, 'parallix-adhoc-0004'), 0, `${table} still references old id`);
        assert.equal(await childCount(database, table, 'px-0001'), 1, `${table} lost the migrated row`);
      }

      // The dependency self-trace moved with its mission; the foreign target
      // (a non-migrated task id) is left untouched.
      const deps = await database.query<{ mission_id: string; depends_on_mission_id: string }>(
        'SELECT mission_id, depends_on_mission_id FROM mission_dependencies',
      );
      assert.ok(deps.some((row) => row.mission_id === 'px-0002' && row.depends_on_mission_id === 'task-other'));

      // `mission_checkpoints.checkpoint_mission_id` is a denormalised reference
      // to the checkpoint's own mission; `mission-serialization.ts` rejects an
      // aggregate whose checkpoint points at a different id, so it must move
      // with `mission_id` in the same rewrite.
      const checkpointRows = await database.query<{ mission_id: string; checkpoint_mission_id: string }>(
        'SELECT mission_id, checkpoint_mission_id FROM mission_checkpoints',
      );
      assert.ok(checkpointRows.length > 0, 'mission_checkpoints seeded');
      assert.ok(
        !checkpointRows.some((row) => row.checkpoint_mission_id === 'parallix-adhoc-0004'),
        'checkpoint_mission_id still references the legacy id',
      );
      assert.ok(
        checkpointRows.some((row) => row.mission_id === 'px-0001' && row.checkpoint_mission_id === 'px-0001'),
        'checkpoint_mission_id now traces the new px id',
      );

      // The out-of-scope boundary row moved with its brief; nothing still points
      // at the legacy id, and the aggregate keeps its outOfScope constraints.
      const outOfScopeRows = await database.query<{ mission_id: string; entry: string }>(
        'SELECT mission_id, entry FROM mission_brief_out_of_scope',
      );
      assert.ok(outOfScopeRows.length > 0, 'mission_brief_out_of_scope seeded');
      assert.ok(
        !outOfScopeRows.some((row) => row.mission_id === 'parallix-adhoc-0004'),
        'mission_brief_out_of_scope still references the legacy id',
      );
      assert.ok(
        outOfScopeRows.some((row) => row.mission_id === 'px-0001'),
        'mission_brief_out_of_scope now traces the new px id',
      );

      // Durable references without a `mission_id` column also moved with the
      // mission: usage_statistics.mission and operational_history.event_data
      // $.missionId. Nothing still holds the legacy id, so history and
      // statistics are not orphaned from the new px id.
      const usageRows = await database.query<{ mission: string }>(
        'SELECT mission FROM usage_statistics',
      );
      assert.ok(usageRows.length > 0, 'usage_statistics seeded');
      assert.ok(!usageRows.some((row) => row.mission === 'parallix-adhoc-0004'), 'usage_statistics still holds the legacy id');
      assert.ok(usageRows.some((row) => row.mission === 'px-0001'), 'usage_statistics now keyed by the new px id');

      const historyRows = await database.query<{ event_data: string }>(
        'SELECT event_data FROM operational_history WHERE event_type = ?',
        ['brief'],
      );
      assert.ok(historyRows.length > 0, 'operational_history seeded');
      assert.ok(
        !historyRows.some((row) => JSON.parse(row.event_data).missionId === 'parallix-adhoc-0004'),
        'operational_history still holds the legacy missionId',
      );
      assert.ok(
        historyRows.some((row) => JSON.parse(row.event_data).missionId === 'px-0001'),
        'operational_history now carries the new missionId',
      );
      // The board current-work read path indexes $.missionId, so it must find the
      // migrated rows under the new id.
      const currentWork = await database.query<{ id: string }>(
        "SELECT id FROM operational_history WHERE event_type = ? AND json_extract(event_data, '$.missionId') = ?",
        ['brief', 'px-0001'],
      );
      assert.ok(currentWork.length > 0, 'board current-work read resolves the migrated missionId');

      // The counter advanced past the last number this run minted.
      const after = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-parallix'],
      );
      assert.equal(after[0].counter, 2);
    } finally {
      await database.close();
    }
  });

  it('is collision-safe when the next counter id is already owned', async () => {
    const database = await migratedDatabase();
    try {
      // The counter reads 2 and px-0003 is already owned, so the next free
      // number skips the hole and mints px-0004.
      await seedLegacyMission(database, 'parallix-adhoc-0006', 'repo-parallix', 2);
      await database.execute(
        'INSERT INTO missions (id, repository_id, title, status, version) VALUES (?, ?, ?, ?, 1)',
        ['px-0003', 'repo-parallix', 'Occupied', 'backlog'],
      );

      const result = await migrateLegacyAdhocIds(database);

      assert.deepEqual(result.migrated.map(({ to }) => to), ['px-0004']);
      assert.equal(await missionId(database, 'px-0004'), 'px-0004');
      // The occupied px-0003 mission is never disturbed.
      assert.equal(await missionId(database, 'px-0003'), 'px-0003');
      const counter = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-parallix'],
      );
      // The counter advances to the number actually minted, so the skipped
      // px-0003 hole can never be minted later.
      assert.equal(counter[0].counter, 4);
    } finally {
      await database.close();
    }
  });

  it('derives each mint from its own repository counter and preserves repository ownership', async () => {
    const database = await migratedDatabase();
    try {
      // Each legacy mission starts from its own repository's counter, so the
      // minted number traces back to that repository, not a shared global one.
      await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-alpha', 0);
      await seedLegacyMission(database, 'parallix-adhoc-0005', 'repo-beta', 2);

      const result = await migrateLegacyAdhocIds(database);

      assert.deepEqual(
        result.migrated.map(({ from, to, repositoryId }) => ({ from, to, repositoryId })),
        [
          { from: 'parallix-adhoc-0004', to: 'px-0001', repositoryId: 'repo-alpha' },
          { from: 'parallix-adhoc-0005', to: 'px-0003', repositoryId: 'repo-beta' },
        ],
      );
      // The minted number carries its repository's counter forward: alpha's
      // counter 0 minted px-0001, beta's counter 2 minted px-0003.
      const alphaCounter = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-alpha'],
      );
      const betaCounter = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-beta'],
      );
      assert.equal(alphaCounter[0].counter, 1);
      assert.equal(betaCounter[0].counter, 3);
      // Repository ownership is preserved on the rewritten mission rows.
      assert.notEqual(await missionId(database, 'px-0001'), null, 'alpha mission rewritten');
      const alphaRow = await database.query<{ repository_id: string }>(
        'SELECT repository_id FROM missions WHERE id = ?',
        ['px-0001'],
      );
      const betaRow = await database.query<{ repository_id: string }>(
        'SELECT repository_id FROM missions WHERE id = ?',
        ['px-0003'],
      );
      assert.equal(alphaRow[0].repository_id, 'repo-alpha');
      assert.equal(betaRow[0].repository_id, 'repo-beta');
    } finally {
      await database.close();
    }
  });

  it('rolls back the whole run atomically when a reassignment fails', async () => {
    const database = await migratedDatabase();
    try {
      await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
      await seedLegacyMission(database, 'parallix-adhoc-0005', 'repo-parallix', 0);

      await assert.rejects(
        migrateLegacyAdhocIds(database, { onAllocate: () => { throw new Error('injected failure'); } }),
        /injected failure/,
      );

      // No partial migration survived: both legacy ids and the counter are
      // exactly as seeded, and no px ids exist.
      assert.equal(await missionId(database, 'parallix-adhoc-0004'), 'parallix-adhoc-0004');
      assert.equal(await missionId(database, 'parallix-adhoc-0005'), 'parallix-adhoc-0005');
      assert.equal(await missionId(database, 'px-0001'), null);
      const counter = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-parallix'],
      );
      assert.equal(counter[0].counter, 0);
      const legacyRows = await database.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM missions WHERE id LIKE ?',
        ['parallix-adhoc-%'],
      );
      assert.equal(legacyRows[0].n, 2);
    } finally {
      await database.close();
    }
  });

  it('is a no-op on rerun over an already-migrated store', async () => {
    const database = await migratedDatabase();
    try {
      await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
      const first = await migrateLegacyAdhocIds(database);
      assert.equal(first.migrated.length, 1);

      const second = await migrateLegacyAdhocIds(database);
      assert.deepEqual(second.migrated, []);

      // A second run cannot mint a duplicate px id or move the counter again.
      assert.equal(await missionId(database, 'px-0001'), 'px-0001');
      const counter = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-parallix'],
      );
      assert.equal(counter[0].counter, 1);
    } finally {
      await database.close();
    }
  });

  it('leaves foreign-key integrity intact after the rewrite', async () => {
    const database = await migratedDatabase();
    try {
      await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
      await migrateLegacyAdhocIds(database);

      const integrity = await database.query<Record<string, string>>('PRAGMA foreign_key_check');
      assert.deepEqual(integrity, [], 'no foreign key violations after migration');
      const constraint = await database.query<{ integrity_check: string }>('PRAGMA integrity_check');
      assert.equal(constraint[0].integrity_check, 'ok');
    } finally {
      await database.close();
    }
  });

  // R3 (round 3, criterion 4): the migrated aggregate must reload through the
  // mission store. `mission_checkpoints.checkpoint_mission_id` and the
  // `mission_brief_out_of_scope` row are denormalised references that must move
  // with the mission or the aggregate refuses to load / loses its boundary.
  it('reloads the migrated aggregate with its checkpoints and out-of-scope boundary', async () => {
    const database = await migratedDatabase();
    try {
      await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
      await migrateLegacyAdhocIds(database);

      // A store load re-reads checkpoints and the out-of-scope boundary; it
      // throws 'Persisted checkpoint belongs to another Mission' if either was
      // left at the legacy id, so a successful load proves both moved.
      const loaded = await new SqliteMissionStore(database).load(domainMissionId('px-0001'));
      assert.equal(loaded.kind, 'found', 'the migrated px id loads from the store');
      if (loaded.kind !== 'found') { throw new Error('expected a found aggregate'); }
      assert.ok(loaded.mission.checkpoints.length > 0, 'checkpoints survive the rewrite');
      assert.ok(Array.isArray(loaded.mission.brief?.outOfScope), 'outOfScope boundary survives the rewrite');
    } finally {
      await database.close();
    }
  });

  // R3 (round 3, criterion 4) + R6 (criterion 4): a deferred foreign-key
  // failure at COMMIT must roll back the whole run, not silently leave a
  // partial migration and an orphan behind. The failure is a REAL deferred
  // constraint (not an injected onAllocate throw): an auxiliary FK child that
  // the migration's rewrite loop skips is left pointing at the rewritten
  // parent when the commit is rejected. The migration must surface that real
  // error instead of a later "Cannot rollback: no active transaction" that
  // would mask it, and the connection must stay usable afterward.
  it('rolls back and leaves no orphan when a deferred foreign-key failure occurs at commit', async () => {
    const database = await migratedDatabase();
    try {
      await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
      await seedLegacyMission(database, 'parallix-adhoc-0005', 'repo-parallix', 1);

      // An auxiliary FK child that is NOT in MISSION_ID_TABLES, so the
      // migration's rewrite loop never moves its `mission_id`. It references the
      // legacy mission, so when the parent is renamed and deleted the deferred
      // foreign-key check at COMMIT rejects the commit and the whole run must
      // roll back. This is a real deferred constraint failure at commit.
      await database.execute(
        'CREATE TABLE auxiliary_fk_child (id INTEGER PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE)',
      );
      await database.execute(
        'INSERT INTO auxiliary_fk_child (id, mission_id) VALUES (1, ?)',
        ['parallix-adhoc-0004'],
      );

      // The commit fails on the deferred foreign-key check. The migration must
      // surface that real error, not a later "Cannot rollback" that masks it.
      await assert.rejects(
        migrateLegacyAdhocIds(database),
        (error: Error) => /FOREIGN KEY constraint failed/.test(error.message),
        'the deferred foreign-key failure is the surfaced error, not a masked rollback error',
      );

      // Nothing survived: both legacy ids are intact, the counter is unchanged,
      // and no px id was minted. The two seeded missions share one repository,
      // so the counter was seeded to 1 (the second seed overwrites the first).
      assert.equal(await missionId(database, 'parallix-adhoc-0004'), 'parallix-adhoc-0004');
      assert.equal(await missionId(database, 'parallix-adhoc-0005'), 'parallix-adhoc-0005');
      assert.equal(await missionId(database, 'px-0001'), null);
      assert.equal(await missionId(database, 'px-0002'), null);
      const counter = await database.query<{ counter: number }>(
        'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
        ['repo-parallix'],
      );
      assert.equal(counter[0].counter, 1, 'counter unchanged by the rolled-back run');
      // The deferred foreign-key check caught the failure; no orphan remains.
      const orphan = await database.query<Record<string, string>>('PRAGMA foreign_key_check');
      assert.deepEqual(orphan, [], 'no foreign key orphan left by the rolled-back run');
      // The connection is usable for new statements after the failed commit.
      await database.execute(
        'INSERT INTO missions (id, repository_id, title, status, version) VALUES (?, ?, ?, ?, 1)',
        ['verify-connection', 'repo-parallix', 'verify', 'backlog'],
      );
      assert.equal(await missionId(database, 'verify-connection'), 'verify-connection');
    } finally {
      await database.close();
    }
  });

  // CLI command wrapper: task-2706. The integration cases above exercise the
  // adapter `migrateLegacyAdhocIds`; these cover the operator-triggered command
  // factory that invokes it, so the command path is part of the new-code set.
  describe('migrate-legacy-adhoc-ids command', () => {
    it('returns 0 and logs each rewrite on a successful run', async () => {
      const database = await migratedDatabase();
      try {
        await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
        const logs: string[] = [];
        const exitCodes: number[] = [];
        const command = createMigrateLegacyAdhocIdsCommand(
          () => migrateLegacyAdhocIds(database),
          (message) => { logs.push(message); },
          (code) => { exitCodes.push(code); },
        );
        const code = await command([]);
        assert.equal(code, 0);
        assert.equal(exitCodes.length, 0, 'a successful run must not request an exit');
        assert.ok(logs.some((logLine) => logLine.includes('rewrote 1 id(s)')), 'logs the rewrite count');
        assert.ok(logs.some((logLine) => logLine.includes('parallix-adhoc-0004') && logLine.includes('px-0001')), 'logs the from/to pair');
      } finally {
        await database.close();
      }
    });

    it('returns 0 and reports zero rewrites on an already-migrated store', async () => {
      const database = await migratedDatabase();
      try {
        await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
        await migrateLegacyAdhocIds(database);
        const logs: string[] = [];
        const command = createMigrateLegacyAdhocIdsCommand(
          () => migrateLegacyAdhocIds(database),
          (message) => { logs.push(message); },
        );
        const code = await command([]);
        assert.equal(code, 0);
        assert.ok(logs.some((logLine) => logLine.includes('rewrote 0 id(s)')), 'reports zero rewrites');
      } finally {
        await database.close();
      }
    });

    it('returns 1 and requests exit 1 when the migration fails', async () => {
      const database = await migratedDatabase();
      try {
        await seedLegacyMission(database, 'parallix-adhoc-0004', 'repo-parallix', 0);
        const logs: string[] = [];
        const exitCodes: number[] = [];
        const command = createMigrateLegacyAdhocIdsCommand(
          () => migrateLegacyAdhocIds(database, { onAllocate: () => { throw new Error('boom'); } }),
          (message) => { logs.push(message); },
          (code) => { exitCodes.push(code); },
        );
        const code = await command([]);
        assert.equal(code, 1);
        assert.deepEqual(exitCodes, [1], 'requests exit 1 on failure');
        assert.ok(logs.some((logLine) => logLine.includes('FAIL') && logLine.includes('boom')), 'logs the failure message');
      } finally {
        await database.close();
      }
    });
  });
});
