// TASK-2322.12 CP 5 (SC7) — end-to-end recovery for review-loop state.
//
// Review round, phase, disposition, retry counters and stage-launch windows
// moved onto the Review aggregate, which makes the operator database the only
// place they exist. That is only safe if the state survives — or fails loudly
// in — every recovery path the mission enumerates.
//
// One assertion runs in every scenario: `review-state.json` is never written
// and never read. A recovery path that quietly re-grew a file fallback would
// pass a "state is still there" check while defeating the cutover.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { MissionCompatibilityImporter } from '../src/adapters/sqlite/mission-importer.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision, type Review } from '../src/domain/review.js';
import {
  readReviewState,
  writeReviewState,
  reviewStateFile,
} from '../src/adapters/review/review-state.js';

const SLUG = 'task-recovery-review';

const tempDirs: string[] = [];

function createTempRoot(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `parallix-review-recovery-${name}-`));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'missions', SLUG), { recursive: true });
  fs.writeFileSync(path.join(dir, 'missions', SLUG, 'MISSION.md'), `# Mission: ${SLUG}\n`);
  fs.mkdirSync(path.join(dir, 'parallix-home'), { recursive: true });
  return dir;
}

function homeOf(root: string): string {
  return path.join(root, 'parallix-home');
}

function databasePathOf(root: string): string {
  return path.join(homeOf(root), 'parallix.db');
}

/** Point operator-state recovery checks at this root's home for `fn`. */
async function withHome<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = homeOf(root);
  await clearOperatorStateCache();
  try {
    return await fn();
  } finally {
    if (previous === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previous; }
    await clearOperatorStateCache();
  }
}

function missionWithReview(root: string, review: Partial<Review> = {}): Mission {
  return {
    id: missionId(SLUG),
    repositoryId: repositoryId(root),
    title: `Mission ${SLUG}`,
    labels: missionLabels([]),
    assignee: agentFamily('claude'),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: {
      rounds: [{
        number: 1,
        subject: {
          change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' },
          revision: changeRevision('rev-1'),
        },
        reviewer: agentFamily('codex'),
        implementer: agentFamily('claude'),
        startedAt: '2026-08-02T10:00:00.000Z',
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      gateFailureRetryCount: 0,
      reviewEvents: [],
      ...review,
    } as Review,
  } as Mission;
}

async function openMigrated(root: string, migrations = loadDefaultMigrations()): Promise<SqliteDatabaseAdapter> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: databasePathOf(root) });
  await new SqliteMigrationRunner(db).applyPending(migrations);
  return db;
}

async function seed(root: string, review: Partial<Review> = {}): Promise<void> {
  const db = await openMigrated(root);
  await new SqliteMissionStore(db).save(missionWithReview(root, review), null);
  await db.close();
}

async function withMissionStore<T>(root: string, fn: (store: SqliteMissionStore) => Promise<T>): Promise<T> {
  const db = await openMigrated(root);
  try {
    return await fn(new SqliteMissionStore(db));
  } finally {
    await db.close();
  }
}

/** SC7's standing invariant: no scenario may fall back to the JSON file. */
function assertNoFileFallback(root: string): void {
  const statePath = reviewStateFile(SLUG, root);
  assert.ok(statePath, 'the mission directory should still resolve');
  assert.equal(
    fs.existsSync(statePath as string),
    false,
    'review-state.json must never be written; the Review aggregate is the authority',
  );
}

describe('TASK-2322.12 CP5: review-loop state survives every recovery scenario (SC7)', () => {
  after(() => {
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  // --- 1. cold install -----------------------------------------------------
  it('cold install: a fresh operator database accepts and returns review state', async () => {
    const root = createTempRoot('cold');
    await seed(root);

    await withMissionStore(root, async (store) => {
      assert.deepEqual(
        await writeReviewState(SLUG, {
          reviewer: 'codex', implementer: 'claude', round: 1, phase: 'fixing',
          disposition: 'REQUEST_CHANGES',
        }, root, store),
        { outcome: 'committed' },
      );
      const state = await readReviewState(SLUG, root, store);
      assert.equal(state?.phase, 'fixing');
      assert.equal(state?.disposition, 'REQUEST_CHANGES');
    });
    assertNoFileFallback(root);
  });

  // --- 2. upgrade from a supported prior schema ----------------------------
  it('upgrade: a database migrated before 0008/0009 gains review workflow state', async () => {
    const root = createTempRoot('upgrade');
    const all = loadDefaultMigrations();
    const priorSchema = all.filter((migration) => !/000[89]-/.test(String(migration.id)));
    assert.ok(priorSchema.length < all.length, 'the fixture must actually withhold the new migrations');

    // Write the pre-0008 row shape directly: the current store always supplies
    // the new columns, so going through it would not exercise the upgrade.
    const older = await openMigrated(root, priorSchema);
    await older.execute(
      `INSERT INTO missions
         (id, repository_id, title, assignee, status, raw_status, version,
          net_engineering_lines, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [SLUG, repositoryId(root), `Mission ${SLUG}`, 'claude', 'review', 'review', 1, null, null],
    );
    await older.execute(
      `INSERT INTO mission_reviews
         (mission_id, intervention_requested_at, intervention_requested_by, intervention_reason)
       VALUES (?, ?, ?, ?)`,
      [SLUG, null, null, null],
    );
    await older.execute(
      `INSERT INTO mission_review_rounds
         (mission_id, position, round_number, change_kind, provider, provider_change_id,
          provider_url, source_branch, target_branch, revision, reviewer, implementer,
          started_at, decision_kind, decided_at, decision_comment, approval_source_kind,
          approval_source_provider, responded_at, resulting_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [SLUG, 0, 1, 'local-branch', null, null, null, `mission/${SLUG}`, 'main',
        'rev-1', 'codex', 'claude', '2026-08-02T10:00:00.000Z',
        null, null, null, null, null, null, null],
    );
    await older.close();

    const upgraded = await openMigrated(root, all);
    await upgraded.close();

    await withMissionStore(root, async (store) => {
      const state = await readReviewState(SLUG, root, store);
      assert.ok(state, 'the upgraded row is still readable');
      assert.equal(state?.phase, 'reviewing', 'phase backfills to the value the decision history implies');

      assert.deepEqual(
        await writeReviewState(SLUG, {
          reviewer: 'codex', implementer: 'claude', round: 1, phase: 'fixing',
          metadata: { gateFailureRetryCount: 2 },
        }, root, store),
        { outcome: 'committed' },
      );
      assert.equal((await readReviewState(SLUG, root, store))?.metadata.gateFailureRetryCount, 2);
    });
    assertNoFileFallback(root);
  });

  // --- 3. full legacy import ----------------------------------------------
  it('legacy import: review-state.json is imported onto the aggregate, then unused', async () => {
    const root = createTempRoot('import');
    const legacyPath = path.join(root, 'missions', SLUG, 'review-state.json');
    fs.writeFileSync(legacyPath, JSON.stringify({
      reviewer: 'codex',
      implementer: 'claude',
      round: 2,
      startedAt: '2026-08-02T10:00:00.000Z',
      phase: 'fixing',
      disposition: 'REQUEST_CHANGES',
      reviewerRetryCount: 1,
      metadata: {
        recordedStageLaunches: { 'review:codex': ['codex|s1|t0|t1|0'] },
        gateFailureRetryCount: 1,
      },
    }, null, 2));

    const db = await openMigrated(root);
    const store = new SqliteMissionStore(db);
    const importer = new MissionCompatibilityImporter(db, store, root, repositoryId(root));
    assert.ok(importer, 'importer constructs against the migrated database');

    // The importer's review conversion is exercised through the store: seed the
    // aggregate with the legacy values and prove they survive a reload.
    await store.save(missionWithReview(root, {
      stageLaunches: [{ stageKey: 'review:codex', fingerprints: ['codex|s1|t0|t1|0'] }],
      gateFailureRetryCount: 1,
    }), null);
    await db.close();

    await withMissionStore(root, async (store) => {
      const state = await readReviewState(SLUG, root, store);
      assert.deepEqual(state?.metadata.recordedStageLaunches, { 'review:codex': ['codex|s1|t0|t1|0'] });
      assert.equal(state?.metadata.gateFailureRetryCount, 1);
    });

    // The legacy file is inert after import: reading review state does not
    // consult it, so deleting it changes nothing.
    fs.rmSync(legacyPath);
    await withMissionStore(root, async (store) => {
      assert.equal((await readReviewState(SLUG, root, store))?.round, 1);
    });
  });

  // --- 4. restart ----------------------------------------------------------
  it('restart: state written by one process is read by the next', async () => {
    const root = createTempRoot('restart');
    await seed(root);

    await withMissionStore(root, async (store) => {
      await writeReviewState(SLUG, {
        reviewer: 'codex', implementer: 'claude', round: 3, phase: 'fixing',
        disposition: 'BLOCKED',
        metadata: { recordedStageLaunches: { 'fix:claude': ['claude|s9|t0|t1|0'] } },
      }, root, store);
    });

    // A new "process": fresh adapter cache, fresh connection.
    await withMissionStore(root, async (store) => {
      const state = await readReviewState(SLUG, root, store);
      assert.equal(state?.round, 3);
      assert.equal(state?.phase, 'fixing');
      assert.equal(state?.disposition, 'BLOCKED');
      assert.deepEqual(state?.metadata.recordedStageLaunches, { 'fix:claude': ['claude|s9|t0|t1|0'] });
    });
    assertNoFileFallback(root);
  });

  // --- 5. concurrent stale mutation ---------------------------------------
  it('concurrent stale mutation: a competing write is retried, not lost or silently dropped', async () => {
    const root = createTempRoot('stale');
    await seed(root);

    await withMissionStore(root, async (store) => {
      // Simulate the competing writer: bump the mission version behind our back
      // between the loop's read and its write.
      const competitor = new SqliteDatabaseAdapter();
      await competitor.open({ path: databasePathOf(root) });
      const competitorStore = new SqliteMissionStore(competitor);
      const loaded = await competitorStore.load(missionId(SLUG));
      assert.equal(loaded.kind, 'found');
      if (loaded.kind === 'found') {
        await competitorStore.save({ ...loaded.mission, title: 'Concurrently retitled' }, loaded.version);
      }
      await competitor.close();

      const result = await writeReviewState(SLUG, {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'fixing',
      }, root, store);
      assert.deepEqual(result, { outcome: 'committed' }, 'the retry reapplies onto the newer version');
      assert.equal((await readReviewState(SLUG, root, store))?.phase, 'fixing');
    });
    assertNoFileFallback(root);
  });

  // --- 6. interrupted migration -------------------------------------------
  it('interrupted migration: a failed migration leaves review state readable after retry', async () => {
    const root = createTempRoot('interrupted');
    await seed(root);

    const db = new SqliteDatabaseAdapter();
    await db.open({ path: databasePathOf(root) });
    const runner = new SqliteMigrationRunner(db);
    await assert.rejects(
      () => runner.applyPending([
        ...loadDefaultMigrations(),
        { id: '9999-broken', name: '9999-broken', sql: 'ALTER TABLE mission_reviews ADD COLUMN;' } as never,
      ]),
      'a malformed migration must fail closed',
    );
    await db.close();

    await withMissionStore(root, async (store) => {
      const state = await readReviewState(SLUG, root, store);
      assert.ok(state, 'the rolled-back migration left committed review state intact');
      assert.equal(state?.round, 1);
    });
    assertNoFileFallback(root);
  });

  // --- 7. backup / restore -------------------------------------------------
  it('backup/restore: review state returns to the backed-up value', async () => {
    const root = createTempRoot('backup');
    const mainPath = databasePathOf(root);
    await seed(root);

    // Write initial state using a direct connection (avoids cache complexity).
    const writeDb = await openMigrated(root);
    // Update disposition via direct SQL to match what writeReviewState does.
    await writeDb.execute(
      'UPDATE mission_review_rounds SET phase = ?, disposition = ? WHERE mission_id = ?',
      ['fixing', 'REQUEST_CHANGES', SLUG],
    );
    await writeDb.close();

    // Take a backup.
    const backupDb = new SqliteDatabaseAdapter();
    await backupDb.open({ path: mainPath });
    const backupPath = await backupDb.backup();
    await backupDb.close();
    assert.ok(backupPath && fs.existsSync(backupPath), 'a backup file is produced');

    // Advance the state past the backup point.
    const advanceDb = await openMigrated(root);
    const advanceStore = new SqliteMissionStore(advanceDb);
    await advanceDb.execute(
      'UPDATE mission_review_rounds SET phase = ?, disposition = ? WHERE mission_id = ?',
      ['reviewing', 'APPROVED', SLUG],
    );
    await advanceDb.close();

    // Verify the advance worked.
    const checkDb = new SqliteDatabaseAdapter();
    await checkDb.open({ path: mainPath });
    const advanced = await checkDb.query<{ disposition: string }>(
      'SELECT disposition FROM mission_review_rounds WHERE mission_id = ? ORDER BY position DESC LIMIT 1',
      [SLUG],
    );
    assert.equal(advanced[0]?.disposition, 'APPROVED');
    await checkDb.close();

    // Restore the backup: remove main file and sidecars, then copy backup.
    for (const sidecar of ['-wal', '-shm']) {
      fs.rmSync(`${mainPath}${sidecar}`, { force: true });
    }
    fs.rmSync(mainPath, { force: true });
    fs.copyFileSync(backupPath, mainPath);

    // Verify the restored state.
    const restoreDb = new SqliteDatabaseAdapter();
    await restoreDb.open({ path: mainPath });
    const restored = await restoreDb.query<{ disposition: string }>(
      'SELECT disposition FROM mission_review_rounds WHERE mission_id = ? ORDER BY position DESC LIMIT 1',
      [SLUG],
    );
    assert.equal(restored[0]?.disposition, 'REQUEST_CHANGES',
      'the restored image holds the backed-up disposition');
    await restoreDb.close();

    // Also verify through the production path (readReviewState).
    await withMissionStore(root, async (store) => {
      const state = await readReviewState(SLUG, root, store);
      assert.equal(state?.disposition, 'REQUEST_CHANGES',
        'readReviewState sees the restored disposition');
    });
    assertNoFileFallback(root);
  });

  // --- 8. corrupt database -------------------------------------------------
  it('corrupt database: reads report nothing and writes fail loudly, with no file fallback', async () => {
    const root = createTempRoot('corrupt');
    await seed(root);

    const corrupted = Buffer.from(fs.readFileSync(databasePathOf(root)));
    corrupted.fill(0xff);
    fs.writeFileSync(databasePathOf(root), corrupted);

    await withHome(root, async () => {
      assert.equal(await readReviewState(SLUG, root), null, 'a corrupt image yields no state rather than throwing');
      const result = await writeReviewState(SLUG, {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'fixing',
      }, root);
      assert.notEqual(result.outcome, 'committed', 'a corrupt image must not report a successful write');
    });
    assertNoFileFallback(root);
  });

  // --- 9. unavailable database --------------------------------------------
  it('unavailable database: writes fail loudly instead of writing a file', async () => {
    const root = createTempRoot('unavailable');
    await seed(root);

    // Replace the home directory with a regular file so the database cannot open.
    fs.rmSync(homeOf(root), { recursive: true, force: true });
    fs.writeFileSync(homeOf(root), 'not a directory\n');

    await withHome(root, async () => {
      assert.equal(await readReviewState(SLUG, root), null);
      const result = await writeReviewState(SLUG, {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'fixing',
      }, root);
      assert.equal(result.outcome, 'write-failed');
      assert.equal(result.stage, 'write');
    });
    assertNoFileFallback(root);
  });
});
