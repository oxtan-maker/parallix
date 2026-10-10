import type { MigrateLegacyAdhocIdsResult } from '../../application/domain-ports.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

/**
 * Transactional, collision-safe rewrite of legacy `parallix-adhoc-<…>` mission
 * ids to counter-owned `px-<NNNN>` ids (task-2706).
 *
 * A legacy record has no repository-scoped counter, so the migration mints one
 * from the repository's `adhoc_mission_counters` row and reassigns every child
 * reference in the same transaction. The rewrite is a single atomic unit: any
 * failure rolls back everything and leaves no orphan reference, and a rerun over
 * an already-migrated store is a no-op because no `parallix-adhoc-*` id remains.
 *
 * The counter is owned per repository, so each legacy mission in a repository
 * draws its new id from that repository's counter and never collides with a
 * `px-<NNNN>` id already minted elsewhere.
 *
 * Foreign keys are enforced, so the parent `missions.id` rename is deferred for
 * the transaction (`PRAGMA defer_foreign_keys = ON`) while every child row is
 * reassigned. Keeping the deferral through commit lets SQLite re-validate every
 * constraint at commit: a rewrite that would leave an orphan fails there and
 * rolls the whole run back instead of committing a broken store. SQLite resets
 * the pragma to OFF at the end of the transaction, so later statements on the
 * same connection stay enforced without an explicit re-disable.
 */

/** Number of digits a counter-owned id carries, matching `px-<NNNN>`. */
const ID_WIDTH = 4;

/** Format a numeric suffix as a zero-padded `px-` id body. */
function formatPxId(counter: number): string {
  return String(counter).padStart(ID_WIDTH, '0');
}

/**
 * List every `px-<NNNN>` id already owned, globally. `missions.id` is a
 * repository-agnostic primary key, so a number taken in any repository is a
 * collision and must be skipped. Scoped counter reads only pick the starting
 * point; the collision check itself is global.
 */
async function existingPxIds(db: SqliteDatabaseAdapter): Promise<Set<number>> {
  const rows = await db.query<{ id: string }>(
    'SELECT id FROM missions WHERE id LIKE ?',
    ['px-%'],
  );
  const used = new Set<number>();
  for (const { id } of rows) {
    const match = /^px-(\d+)$/i.exec(id.trim());
    if (match) { used.add(Number(match[1])); }
  }
  return used;
}

/**
 * Reserve the next free counter-owned id for `repositoryId`, skipping any
 * number a live `px-<NNNN>` mission already owns. Persists the counter so the
 * reservation is durable and monotonic, exactly like `allocateAdhocIdentity`.
 *
 * Returns the reserved number only; the caller persists it inside the same
 * transaction so a failure rolls the counter back too.
 */
async function reserveUniqueCounter(
  db: SqliteDatabaseAdapter,
  repositoryId: string,
): Promise<number> {
  const counterRow = await db.query<{ counter: number }>(
    'SELECT counter FROM adhoc_mission_counters WHERE repository_id = ?',
    [repositoryId],
  );
  const current = counterRow[0]?.counter ?? 0;
  const used = await existingPxIds(db);

  let candidate = current + 1;
  while (used.has(candidate)) { candidate += 1; }

  // Persist the counter at the reserved number. The counter is monotonic and
  // scoped to the repository, so a skipped (occupied) number stays unowned.
  await db.execute(
    'INSERT INTO adhoc_mission_counters (repository_id, counter) VALUES (?, ?) ' +
      'ON CONFLICT(repository_id) DO UPDATE SET counter = excluded.counter',
    [repositoryId, candidate],
  );
  return candidate;
}

/**
 * Whether a table still exists in the current schema. A later migration may
 * have dropped it, so a missing table skips the rewrite instead of aborting the
 * whole run with "no such table".
 */
async function tableExists(db: SqliteDatabaseAdapter, name: string): Promise<boolean> {
  const row = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return row.length > 0;
}

/**
 * Tables whose `mission_id` column traces back to `missions(id)`, direct or
 * through one intermediate parent. Later migrations drop some of these tables
 * (for example `0021` removed the execution-context tables), so the list is a
 * candidate set, not a promise that every row still exists.
 */
const MISSION_ID_TABLES = [
  'missions',
  'mission_labels',
  'mission_checkpoints',
  'mission_checkpoint_goal_checks',
  'mission_reviews',
  'mission_review_rounds',
  'mission_review_findings',
  'mission_review_resolutions',
  'mission_external_task_refs',
  'mission_execution_contexts',
  'mission_execution_context_items',
  'mission_briefs',
  // `mission_brief_constraints` was renamed to `mission_brief_out_of_scope`
  // by migration 0023. Naming the retired table here would rewrite nothing,
  // leaving the out-of-scope rows orphaned from the new mission id.
  'mission_brief_out_of_scope',
  'mission_declared_gates',
  'mission_success_criteria',
  'mission_dependencies',
  'board_lane_events',
  'session_markers',
  'mission_review_events',
  'mission_review_stage_launches',
] as const;

/**
 * Every current table that carries a `mission_id` column. Querying the schema at
 * run time keeps the rewrite correct across schema revisions: a table dropped by
 * a later migration is simply skipped instead of aborting the whole run with
 * "no such table".
 */
async function existingMissionIdTables(
  db: SqliteDatabaseAdapter,
): Promise<Set<string>> {
  const tables = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const result = new Set<string>();
  for (const { name } of tables) {
    const columns = await db.query<{ name: string }>(`PRAGMA table_info(${name})`);
    if (columns.some((column) => column.name === 'mission_id')) { result.add(name); }
  }
  return result;
}

/**
 * Reassign a single legacy id to `target`: rename the parent row first (foreign
 * keys deferred for the transaction), then reassign every live `mission_id`
 * column and finally the `mission_dependencies.depends_on_mission_id`
 * self-reference. The parent row is deleted last so no orphan references survive
 * a partial run.
 */
async function reassignMission(
  db: SqliteDatabaseAdapter,
  from: string,
  to: string,
): Promise<void> {
  const liveTables = await existingMissionIdTables(db);
  await db.execute('UPDATE missions SET id = ? WHERE id = ?', [to, from]);
  for (const table of MISSION_ID_TABLES) {
    if (table === 'missions' || !liveTables.has(table)) { continue; }
    await db.execute(`UPDATE ${table} SET mission_id = ? WHERE mission_id = ?`, [to, from]);
  }
  await db.execute(
    'UPDATE mission_dependencies SET depends_on_mission_id = ? WHERE depends_on_mission_id = ?',
    [to, from],
  );
  // `mission_checkpoints.checkpoint_mission_id` is a denormalised reference to
  // the checkpoint's own mission. `mission-serialization.ts` rejects an aggregate
  // whose checkpoint points at a different id, so it must move with `mission_id`
  // in the same transaction or the migrated aggregate fails to reload.
  if (liveTables.has('mission_checkpoints')) {
    await db.execute(
      'UPDATE mission_checkpoints SET checkpoint_mission_id = ? WHERE checkpoint_mission_id = ?',
      [to, from],
    );
  }
  // Two durable references trace the legacy id without a `mission_id` column:
  // `usage_statistics.mission` (statistics keyed by mission) and
  // `operational_history.event_data.missionId` (the board current-work reads
  // index this JSON field). The legacy id is a globally unique `missions.id`,
  // so matching it rewrites only that mission's rows — repository-scoped by
  // construction — and leaves `event_data.repositoryId` untouched. A dropped
  // table skips instead of aborting the run.
  if (await tableExists(db, 'usage_statistics')) {
    await db.execute('UPDATE usage_statistics SET mission = ? WHERE mission = ?', [to, from]);
  }
  if (await tableExists(db, 'operational_history')) {
    await db.execute(
      `UPDATE operational_history SET event_data = json_set(event_data, '$.missionId', ?) ` +
        `WHERE json_valid(event_data) = 1 AND json_extract(event_data, '$.missionId') = ?`,
      [to, from],
    );
  }
  await db.execute('DELETE FROM missions WHERE id = ?', [from]);
}

/**
 * Rewrite every legacy adhoc id in the operator database.
 *
 * @param db an open SQLite handle on the operator database
 * @param opts.onAllocate a hook to inject a failure for rollback testing
 */
export async function migrateLegacyAdhocIds(
  db: SqliteDatabaseAdapter,
  opts: { onAllocate?: () => void } = {},
): Promise<MigrateLegacyAdhocIdsResult> {
  const legacy = await db.query<{ id: string; repository_id: string }>(
    'SELECT id, repository_id FROM missions WHERE id LIKE ?',
    ['parallix-adhoc-%'],
  );

  const migrated: { from: string; to: string; repositoryId: string }[] = [];

  // One transaction keeps the whole run atomic: a failure anywhere rolls back
  // every reassignment and the counter bump together.
  await db.beginTransaction();
  try {
    // Deferred checks let the parent `missions.id` rename precede the child
    // reassignments; SQLite re-validates every constraint at commit.
    await db.execute('PRAGMA defer_foreign_keys = ON;');

    for (const { id, repository_id } of legacy) {
      // Injected failure point: the whole run rolls back, proving atomicity.
      if (opts.onAllocate) { opts.onAllocate(); }
      const counter = await reserveUniqueCounter(db, repository_id);
      const to = `px-${formatPxId(counter)}`;
      await reassignMission(db, id, to);
      migrated.push({ from: id, to, repositoryId: repository_id });
    }

    // Leave `defer_foreign_keys` ON through commit so SQLite re-validates every
    // constraint at commit; an orphan left by the rewrite fails the commit and
    // rolls the whole run back. SQLite resets the pragma to OFF at transaction
    // end, so the connection stays enforced afterwards without an explicit
    // re-disable (an explicit OFF before commit would miss orphans from rows
    // this run did not itself modify).
    await db.commitTransaction();
    return { migrated };
  } catch (error) {
    await db.rollbackTransaction();
    throw error;
  }
}
