import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missionVersion } from '../src/application/domain-ports.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import {
  loadDefaultMigrations,
  SqliteMigrationRunner,
} from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { MissionCompatibilityImporter } from '../src/adapters/sqlite/mission-importer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function createTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `parallix-mission-import-${name}-`));
  tempDirs.push(dir);
  return dir;
}

function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}

async function createDb(): Promise<{
  db: SqliteDatabaseAdapter;
  store: SqliteMissionStore;
  dbPath: string;
}> {
  const dir = createTempDir('db');
  const dbPath = path.join(dir, 'parallix.db');
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: dbPath });
  const runner = new SqliteMigrationRunner(db);
  await runner.applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(db);
  return { db, store, dbPath };
}

interface RepoFixture {
  rootDir: string;
  db: SqliteDatabaseAdapter;
  store: SqliteMissionStore;
  dbPath: string;
}

async function createRepoFixture(): Promise<RepoFixture> {
  const rootDir = createTempDir('repo');
  const backlogTasks = path.join(rootDir, 'backlog', 'tasks');
  const backlogCompleted = path.join(rootDir, 'backlog', 'completed');
  const backlogArchive = path.join(rootDir, 'backlog', 'archive', 'tasks');
  fs.mkdirSync(backlogTasks, { recursive: true });
  fs.mkdirSync(backlogCompleted, { recursive: true });
  fs.mkdirSync(backlogArchive, { recursive: true });

  const { db, store, dbPath } = await createDb();
  return { rootDir, db, store, dbPath };
}

function writeTaskFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeCheckpointFile(missionDir: string, name: string, content: string): string {
  const filePath = path.join(missionDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function createMissionDir(rootDir: string, slug: string): string {
  const dir = path.join(rootDir, 'missions', slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function createImporter(
  rootDir: string,
  db: SqliteDatabaseAdapter,
  store: SqliteMissionStore,
): Promise<MissionCompatibilityImporter> {
  return new MissionCompatibilityImporter(
    db,
    store,
    rootDir,
    repositoryId('repo-parallix'),
  );
}

/**
 * Generate standard task file content with YAML-like frontmatter.
 * Uses slug-compatible IDs (no dots in slug portion).
 */
function standardTaskContent(overrides: Record<string, string | string[]> = {}): string {
  const fields: Record<string, string | string[]> = {
    id: 'TASK-2322-ONE',
    title: 'Example Mission',
    status: 'ready',
    assignee: 'codex',
    labels: ['ai_sdlc', 'database'],
    ...overrides,
  };
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n\n# ${fields.title}\n`;
}

// Valid mission slugs (must match ^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$)
const SLUG_ONE = 'task-2322-one';
const SLUG_TWO = 'task-2322-two';
const SLUG_THREE = 'task-2322-three';

afterEach(cleanupTempDirs);

// ---------------------------------------------------------------------------
// CP-1: Dry-run discovery
// ---------------------------------------------------------------------------

describe('MissionCompatibilityImporter — CP-1: dry-run discovery', () => {
  // --- Empty backlog ---

  it('dry-run returns empty candidates when no task files exist', async () => {
    const fixture = await createRepoFixture();
    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.ok(report.dryRun, 'Should be a dry-run');
      assert.equal(report.candidates.length, 0, 'Should have no candidates');
      assert.equal(report.conflicts.length, 0, 'Should have no conflicts');
      assert.equal(report.importedCount, 0, 'Should have importedCount 0');
      assert.ok(report.digest, 'Should have a digest');
      assert.ok(report.importedAt, 'Should have importedAt');
      assert.equal(report.sourceRoot, fixture.rootDir, 'Should report sourceRoot');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Single task ---

  it('dry-run discovers a single task file in backlog/tasks', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    writeTaskFile(tasksDir, `${SLUG_ONE} - Example-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Example Mission',
      status: 'ready',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1, 'Should discover 1 candidate');
      const candidate = report.candidates[0];
      assert.equal(candidate.missionId, SLUG_ONE);
      assert.equal(candidate.title, 'Example Mission');
      assert.equal(candidate.status, 'refined'); // "ready" maps to "refined"
      assert.equal(candidate.rawStatus, 'ready');
      assert.equal(candidate.assignee, agentFamily('codex'));
      assert.equal(candidate.labels.length, 2);
      assert.ok(candidate.sourcePath.endsWith(`${SLUG_ONE} - Example-Mission.md`));
    } finally {
      await fixture.db.close();
    }
  });

  // --- Multiple tasks across stores ---

  it('dry-run discovers tasks across all three stores', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const completedDir = path.join(fixture.rootDir, 'backlog', 'completed');
    const archiveDir = path.join(fixture.rootDir, 'backlog', 'archive', 'tasks');

    writeTaskFile(tasksDir, `${SLUG_ONE} - Active-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Active Mission',
      status: 'active',
    }));
    writeTaskFile(completedDir, `${SLUG_TWO} - Done-Mission.md`, standardTaskContent({
      id: 'TASK-2322-TWO',
      title: 'Done Mission',
      status: 'done',
    }));
    writeTaskFile(archiveDir, `${SLUG_THREE} - Archived-Mission.md`, standardTaskContent({
      id: 'TASK-2322-THREE',
      title: 'Archived Mission',
      status: 'done',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 3, 'Should discover 3 candidates');

      // Sorted by missionId (localeCompare: one < three < two)
      assert.equal(report.candidates[0].missionId, SLUG_ONE);
      assert.equal(report.candidates[0].status, 'active');
      assert.equal(report.candidates[1].missionId, SLUG_THREE);
      assert.equal(report.candidates[1].status, 'done');
      assert.equal(report.candidates[2].missionId, SLUG_TWO);
      assert.equal(report.candidates[2].status, 'done');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Unmappable status ---

  it('dry-run reports unmappable status as validation error', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    writeTaskFile(tasksDir, `${SLUG_ONE} - Bad-Status.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Bad Status Mission',
      status: 'unknown-thing',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1, 'Should discover 1 candidate');
      const candidate = report.candidates[0];
      assert.ok(
        candidate.validationErrors.some((e) => e.includes('unmappable-status')),
        'Should have unmappable-status validation error',
      );
      assert.equal(candidate.status, 'backlog', 'Should default to backlog status');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Identity conflict with existing database rows ---

  it('dry-run detects identity conflict with existing database row', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // Pre-populate database with a Mission
    const existingMission: Mission = {
      id: missionId(SLUG_ONE),
      repositoryId: repositoryId('repo-parallix'),
      title: 'Database Title',
      labels: missionLabels(['database-label']),
      assignee: agentFamily('claude'),
      status: 'review',
      rawStatus: 'request-changes',
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      closedAt: null,
    };
    await fixture.store.save(existingMission, null);

    // Write a task file with different content
    writeTaskFile(tasksDir, `${SLUG_ONE} - Conflict-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Source Title',
      status: 'active',
      assignee: 'codex',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1, 'Should discover 1 candidate');
      assert.equal(report.conflicts.length, 1, 'Should detect 1 conflict');
      const conflict = report.conflicts[0];
      assert.equal(conflict.missionId, SLUG_ONE);
      assert.ok(
        conflict.reason === 'divergent-state' || conflict.reason === 'stale-write',
        `Reason should be divergent-state or stale-write, got: ${conflict.reason}`,
      );
      assert.ok(conflict.details?.includes('title'), 'Details should mention title divergence');
    } finally {
      await fixture.db.close();
    }
  });

  // --- No conflict when source matches database ---

  it('dry-run reports no conflict when source matches database row', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // Pre-populate database with a Mission
    const existingMission: Mission = {
      id: missionId(SLUG_ONE),
      repositoryId: repositoryId('repo-parallix'),
      title: 'Matching Title',
      labels: missionLabels(['ai_sdlc', 'database']),
      assignee: agentFamily('codex'),
      status: 'refined',
      rawStatus: 'ready',
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      closedAt: null,
    };
    await fixture.store.save(existingMission, null);

    // Write a matching task file
    writeTaskFile(tasksDir, `${SLUG_ONE} - Matching-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Matching Title',
      status: 'ready',
      assignee: 'codex',
      labels: ['ai_sdlc', 'database'],
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1, 'Should discover 1 candidate');
      assert.equal(report.conflicts.length, 0, 'Should have no conflicts');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Checkpoint discovery ---

  it('dry-run discovers checkpoint artifacts in mission directory', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Checkpoint-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Checkpoint Mission',
      status: 'active',
    }));
    writeCheckpointFile(missionDir, 'CP-1.md', '# CP-1: First Checkpoint\nSome content here.');
    writeCheckpointFile(missionDir, 'CP-2.md', '# CP-2: Second Checkpoint\nMore content.');

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1, 'Should discover 1 candidate');
      const candidate = report.candidates[0];
      assert.equal(candidate.checkpoints.length, 2, 'Should discover 2 checkpoints');
      assert.equal(candidate.checkpoints[0].name, 'CP-1');
      assert.equal(candidate.checkpoints[0].firstLine, 'CP-1: First Checkpoint');
      assert.equal(candidate.checkpoints[1].name, 'CP-2');
      assert.equal(candidate.checkpoints[1].firstLine, 'CP-2: Second Checkpoint');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Source file preservation ---

  it('dry-run leaves source files byte-for-byte untouched', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const content = standardTaskContent();
    const filePath = writeTaskFile(tasksDir, `${SLUG_ONE} - Untouched.md`, content);
    const originalStat = fs.statSync(filePath);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      await importer.dryRun();

      // Verify source file is unchanged
      const afterContent = fs.readFileSync(filePath, 'utf8');
      assert.equal(afterContent, content, 'Source file should be untouched');
      assert.equal(fs.statSync(filePath).size, originalStat.size, 'Source file size should be unchanged');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Deduplication across stores ---

  it('dry-run deduplicates tasks found in multiple stores', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const completedDir = path.join(fixture.rootDir, 'backlog', 'completed');

    // Same task in both tasks and completed dirs
    writeTaskFile(tasksDir, `${SLUG_ONE} - Active.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Active',
      status: 'active',
    }));
    writeTaskFile(completedDir, `${SLUG_ONE} - Completed.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Completed',
      status: 'done',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1, 'Should deduplicate to 1 candidate');
      // Prefers lower priority (tasks > completed)
      assert.ok(
        report.candidates[0].sourcePath.endsWith(`${SLUG_ONE} - Active.md`),
        'Should prefer tasks dir over completed dir',
      );
    } finally {
      await fixture.db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// CP-2: Apply path
// ---------------------------------------------------------------------------

describe('MissionCompatibilityImporter — CP-2: apply path', () => {
  // --- Valid import ---

  it('apply persists valid candidates via SqliteMissionStore.save()', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    writeTaskFile(tasksDir, `${SLUG_ONE} - Example-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Example Mission',
      status: 'ready',
      assignee: 'codex',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.ok(!report.dryRun, 'Should not be a dry-run');
      assert.equal(report.importedCount, 1, 'Should import 1 Mission');
      assert.ok(report.backupPath, 'Should have backupPath');
      assert.ok(fs.existsSync(report.backupPath), 'Backup file should exist');

      // Verify Mission is in the database
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.title, 'Example Mission');
      assert.equal(loaded.mission.status, 'refined');
      assert.equal(loaded.version, missionVersion(1));

      // Verify import_history record
      const historyRows = await fixture.db.query<{ source_path: string; imported_count: number }>(
        'SELECT source_path, imported_count FROM import_history',
      );
      assert.equal(historyRows.length, 1);
      assert.equal(historyRows[0].source_path, fixture.rootDir);
      assert.equal(historyRows[0].imported_count, 1);
    } finally {
      await fixture.db.close();
    }
  });

  // --- Validation rejection (no transaction opened) ---

  it('apply rejects when candidates have validation errors', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    writeTaskFile(tasksDir, `${SLUG_ONE} - Bad-Status.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Bad Status',
      status: 'totally-invalid',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 0, 'Should not import any');
      assert.equal(report.conflicts.length, 1, 'Should report 1 validation conflict');
      assert.equal(report.conflicts[0].reason, 'validation-error');

      // Verify database is unchanged (no Missions persisted)
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'missing', 'Mission should not be in database');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Idempotent replay ---

  it('apply is idempotent on replay with unchanged source', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    writeTaskFile(tasksDir, `${SLUG_ONE} - Idempotent-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Idempotent Mission',
      status: 'ready',
      assignee: 'codex',
      labels: ['ai_sdlc'],
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);

      // First apply
      const report1 = await importer.apply();
      assert.equal(report1.importedCount, 1, 'First apply should import 1');

      // Second apply (idempotent)
      const report2 = await importer.apply();
      assert.equal(report2.importedCount, 0, 'Second apply should import 0');
      assert.equal(report2.skippedCount, 1, 'Second apply should skip 1');

      // Verify database state is identical
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.version, missionVersion(1), 'Version should not have bumped');
      assert.equal(loaded.mission.title, 'Idempotent Mission');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Divergent Mission refusal ---

  it('apply refuses to overwrite a divergent Mission', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // Pre-populate database with a divergent Mission
    const existingMission: Mission = {
      id: missionId(SLUG_ONE),
      repositoryId: repositoryId('repo-parallix'),
      title: 'Database Title',
      labels: missionLabels(['db-label']),
      assignee: agentFamily('claude'),
      status: 'review',
      rawStatus: 'request-changes',
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      closedAt: null,
    };
    await fixture.store.save(existingMission, null);

    // Write a task file with different content
    writeTaskFile(tasksDir, `${SLUG_ONE} - Divergent-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Source Title',
      status: 'active',
      assignee: 'codex',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 0, 'Should not import the divergent mission');
      assert.equal(report.conflicts.length, 1, 'Should report 1 conflict');
      assert.ok(
        report.conflicts[0].reason === 'divergent-state' || report.conflicts[0].reason === 'stale-write',
        `Reason should be divergent-state or stale-write, got: ${report.conflicts[0].reason}`,
      );

      // Verify database Mission is unchanged
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.title, 'Database Title', 'Title should be unchanged');
      assert.equal(loaded.mission.status, 'review', 'Status should be unchanged');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Backup/restore after interrupted import ---

  it('apply creates backup that can restore prior database state', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // Pre-populate database with an existing Mission
    const existingMission: Mission = {
      id: missionId(SLUG_ONE),
      repositoryId: repositoryId('repo-parallix'),
      title: 'Before Import',
      labels: missionLabels(['original']),
      assignee: agentFamily('codex'),
      status: 'active',
      rawStatus: 'active',
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      closedAt: null,
    };
    await fixture.store.save(existingMission, null);

    // Write a new task file for import
    writeTaskFile(tasksDir, `${SLUG_TWO} - New-Mission.md`, standardTaskContent({
      id: 'TASK-2322-TWO',
      title: 'New Mission',
      status: 'ready',
      assignee: 'codex',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.ok(report.backupPath, 'Should have backupPath');
      assert.ok(fs.existsSync(report.backupPath), 'Backup file should exist');
      assert.equal(report.importedCount, 1, 'Should import 1 new mission');

      // Verify backup file contains the pre-import state by opening it directly
      const backupDb = new SqliteDatabaseAdapter();
      await backupDb.open({ path: report.backupPath! });
      try {
        const backupStore = new SqliteMissionStore(backupDb);

        // The original mission should be present in the backup
        const original = await backupStore.load(missionId(SLUG_ONE));
        assert.equal(original.kind, 'found');
        assert.equal(original.mission.title, 'Before Import');

        // The new mission should NOT be in the backup (taken before import)
        const newMission = await backupStore.load(missionId(SLUG_TWO));
        assert.equal(newMission.kind, 'missing', 'New mission should not be in backup');
      } finally {
        await backupDb.close();
      }

      // Verify restore: corrupt main db and restore from backup
      fs.writeFileSync(fixture.dbPath, 'CORRUPT DATA');
      fs.copyFileSync(report.backupPath!, fixture.dbPath);

      const restoredDb = new SqliteDatabaseAdapter();
      await restoredDb.open({ path: fixture.dbPath });
      try {
        const restoredStore = new SqliteMissionStore(restoredDb);
        const restored = await restoredStore.load(missionId(SLUG_ONE));
        assert.equal(restored.kind, 'found');
        assert.equal(restored.mission.title, 'Before Import');
      } finally {
        await restoredDb.close();
      }
    } finally {
      await fixture.db.close();
    }
  });

  // --- Mixed import: some imported, some divergent ---

  it('apply imports non-conflicting missions while reporting divergent ones', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // Pre-populate database with one divergent Mission
    const existingMission: Mission = {
      id: missionId(SLUG_ONE),
      repositoryId: repositoryId('repo-parallix'),
      title: 'DB Title',
      labels: missionLabels(['db']),
      assignee: agentFamily('claude'),
      status: 'review',
      rawStatus: 'request-changes',
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      closedAt: null,
    };
    await fixture.store.save(existingMission, null);

    // Write two task files: one divergent, one new
    writeTaskFile(tasksDir, `${SLUG_ONE} - Divergent.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Source Title',
      status: 'active',
      assignee: 'codex',
    }));
    writeTaskFile(tasksDir, `${SLUG_TWO} - New-Mission.md`, standardTaskContent({
      id: 'TASK-2322-TWO',
      title: 'New Mission',
      status: 'ready',
      assignee: 'codex',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 1, 'Should import 1 new mission');
      assert.equal(report.conflicts.length, 1, 'Should report 1 divergent conflict');
      assert.equal(report.candidates.length, 2, 'Should discover 2 candidates');

      // Verify new mission is in database
      const newLoaded = await fixture.store.load(missionId(SLUG_TWO));
      assert.equal(newLoaded.kind, 'found');
      assert.equal(newLoaded.mission.title, 'New Mission');

      // Verify divergent mission is unchanged
      const divLoaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(divLoaded.kind, 'found');
      assert.equal(divLoaded.mission.title, 'DB Title');
    } finally {
      await fixture.db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// CP-3: Checkpoint and Review import
// ---------------------------------------------------------------------------

describe('MissionCompatibilityImporter — CP-3: checkpoint and review import', () => {
  // --- Mission with checkpoints and Goal Check rows ---

  it('dry-run parses Goal Check table rows from checkpoint files', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Checkpoint-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Checkpoint Mission',
      status: 'active',
    }));
    writeCheckpointFile(missionDir, 'CP-1.md', [
      '# CP-1: First Checkpoint',
      '',
      '## Goal Check',
      '',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| Dry-run discovers legacy tasks | `src/adapters/sqlite/mission-importer.ts:281` | PASS |',
      '| Apply is atomic | `src/adapters/sqlite/mission-importer.ts:205` | PASS |',
      '',
      '## Next action:',
      '',
      'Run the integration suite.',
    ].join('\n'));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.equal(candidate.checkpoints.length, 1);
      const cp = candidate.checkpoints[0];
      assert.equal(cp.name, 'CP-1');
      assert.equal(cp.firstLine, 'CP-1: First Checkpoint');
      assert.equal(cp.goalCheck.length, 2);
      assert.equal(cp.goalCheck[0].criterion, 'Dry-run discovers legacy tasks');
      assert.equal(cp.goalCheck[0].evidence, '`src/adapters/sqlite/mission-importer.ts:281`');
      assert.equal(cp.goalCheck[1].criterion, 'Apply is atomic');
      assert.equal(cp.goalCheck[1].evidence, '`src/adapters/sqlite/mission-importer.ts:205`');
      assert.equal(cp.nextActionText, 'Run the integration suite.');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Mission with review rounds ---

  it('dry-run reads review-state.json and constructs Review domain object', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Review-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Review Mission',
      status: 'review',
    }));

    // Write review-state.json
    const reviewStatePath = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(reviewStatePath, JSON.stringify({
      slug: SLUG_ONE,
      reviewer: 'codex',
      implementer: 'custom',
      round: 1,
      startedAt: '2026-07-29T10:00:00Z',
      phase: 'approved',
      disposition: 'Looks good',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.ok(candidate.review, 'Should have a Review object');
      assert.equal(candidate.review!.rounds.length, 1);
      assert.equal(candidate.review!.rounds[0].number, 1);
      assert.equal(candidate.review!.rounds[0].reviewer, agentFamily('codex'));
      assert.equal(candidate.review!.rounds[0].implementer, agentFamily('custom'));
      assert.equal(candidate.review!.rounds[0].decision?.kind, 'approved');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Mission with both checkpoints and review ---

  it('dry-run imports mission with both checkpoints and review', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Full-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Full Mission',
      status: 'review',
    }));

    writeCheckpointFile(missionDir, 'CP-1.md', [
      '# CP-1: First Checkpoint',
      '',
      '## Goal Check',
      '',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| Criterion A | Evidence A | PASS |',
      '',
      '## Next action:',
      '',
      'Proceed to CP-2.',
    ].join('\n'));

    const reviewStatePath = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(reviewStatePath, JSON.stringify({
      slug: SLUG_ONE,
      reviewer: 'codex',
      implementer: 'custom',
      round: 1,
      startedAt: '2026-07-29T10:00:00Z',
      phase: 'fixing',
      disposition: 'Minor changes requested',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];

      // Checkpoints
      assert.equal(candidate.checkpoints.length, 1);
      assert.equal(candidate.checkpoints[0].goalCheck.length, 1);
      assert.equal(candidate.checkpoints[0].nextActionText, 'Proceed to CP-2.');

      // Review
      assert.ok(candidate.review, 'Should have a Review object');
      assert.equal(candidate.review!.rounds[0].decision?.kind, 'changes-requested');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Mission with no artifacts ---

  it('dry-run handles mission with no checkpoint or review artifacts gracefully', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);
    // Mission directory exists but has no checkpoint or review files
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n');

    writeTaskFile(tasksDir, `${SLUG_ONE} - Minimal-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Minimal Mission',
      status: 'refined',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.equal(candidate.checkpoints.length, 0, 'Should have empty checkpoints');
      assert.equal(candidate.review, null, 'Should have null review');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Checkpoint persistence through apply ---

  it('apply persists checkpoint Goal Check rows and next action through SqliteMissionStore', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Persist-Checkpoints.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Persist Checkpoints',
      status: 'active',
    }));
    writeCheckpointFile(missionDir, 'CP-1.md', [
      '# CP-1: First Checkpoint',
      '',
      '## Goal Check',
      '',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| SC1: Dry-run works | `src/adapters/sqlite/mission-importer.ts:145` | PASS |',
      '',
      '## Next action:',
      '',
      'Run apply.',
    ].join('\n'));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 1);

      // Verify checkpoints are in the database
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.checkpoints.length, 1);
      const cp = loaded.mission.checkpoints[0];
      assert.equal(cp.name, 'CP-1');
      assert.equal(cp.goalCheck.length, 1);
      assert.equal(cp.goalCheck[0].criterion, 'SC1: Dry-run works');
      assert.equal(cp.goalCheck[0].evidence, '`src/adapters/sqlite/mission-importer.ts:145`');
      assert.equal(cp.nextActionText, 'Run apply.');
    } finally {
      await fixture.db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Review fix tests — atomic apply, idempotent provenance, assignee parsing,
// checkpoint validation
// ---------------------------------------------------------------------------

describe('MissionCompatibilityImporter — review fixes', () => {
  // --- Finding 1: Atomic apply (ledger failure rolls back Missions) ---

  it('apply rolls back Missions when provenance ledger insert fails', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    writeTaskFile(tasksDir, `${SLUG_ONE} - Atomic-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Atomic Mission',
      status: 'ready',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);

      // Drop the import_history table so recordImport fails
      await fixture.db.execute('DROP TABLE IF EXISTS import_history;');

      // Apply should throw because recordImport fails
      await assert.rejects(importer.apply());

      // Verify no Missions were persisted (rolled back)
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'missing', 'Mission should not be persisted after ledger failure');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Finding 2: Idempotent provenance (no extra ledger on replay) ---

  it('apply does not append import_history on unchanged replay', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    writeTaskFile(tasksDir, `${SLUG_ONE} - Replay-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Replay Mission',
      status: 'ready',
      assignee: 'codex',
      labels: ['ai_sdlc'],
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);

      // First apply
      const report1 = await importer.apply();
      assert.equal(report1.importedCount, 1, 'First apply should import 1');

      // Second apply (idempotent)
      const report2 = await importer.apply();
      assert.equal(report2.importedCount, 0, 'Second apply should import 0');
      assert.equal(report2.skippedCount, 1, 'Second apply should skip 1');

      // Verify import_history has exactly 1 row (not 2)
      const historyRows = await fixture.db.query<{ imported_count: number }>(
        'SELECT imported_count FROM import_history ORDER BY imported_at',
      );
      assert.equal(historyRows.length, 1, 'import_history should have exactly 1 row after replay');
      assert.equal(historyRows[0].imported_count, 1, 'First row should record 1 import');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Finding 3: Inline YAML list assignee parsing ---

  it('dry-run parses inline YAML list assignee syntax', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // Real production format: assignee: [codex]
    const content = `---
id: TASK-2322-ONE
title: Inline Assignee Mission
status: ready
assignee: [codex]
labels:
  - ai_sdlc
---

# Inline Assignee Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Inline-Assignee.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      assert.equal(
        report.candidates[0].assignee,
        agentFamily('codex'),
        'Should parse inline YAML list assignee',
      );
    } finally {
      await fixture.db.close();
    }
  });

  // --- Finding 4a: Invalid checkpoint name validation ---

  it('apply reports invalid checkpoint name as validation error', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Invalid-CP-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Invalid CP Mission',
      status: 'active',
    }));

    // Write a checkpoint with an invalid name (CHECKPOINT_1 instead of CP-1)
    writeCheckpointFile(missionDir, 'CHECKPOINT_1.md', '# CHECKPOINT_1: Some checkpoint\n');

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.ok(
        candidate.validationErrors.some((e) => e.includes('invalid-checkpoint-name')),
        'Should have invalid-checkpoint-name validation error',
      );
      assert.equal(candidate.checkpoints.length, 0, 'Invalid checkpoint should not be included');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Finding 4b: Unreadable checkpoint artifact ---

  it('apply reports unreadable checkpoint as validation error', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Unreadable-CP-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Unreadable CP Mission',
      status: 'active',
    }));

    // Write a valid CP-1.md
    writeCheckpointFile(missionDir, 'CP-1.md', '# CP-1: Valid checkpoint\n');

    // Write a CP-2.md then make it unreadable (remove read permission)
    const cp2Path = writeCheckpointFile(missionDir, 'CP-2.md', '# CP-2: Will be unreadable\n');
    fs.chmodSync(cp2Path, 0o000);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      // CP-1 should be included, CP-2 should be reported as error
      assert.equal(candidate.checkpoints.length, 1, 'Should have 1 valid checkpoint');
      assert.equal(candidate.checkpoints[0].name, 'CP-1');
      assert.ok(
        candidate.validationErrors.some((e) => e.includes('unreadable-checkpoint')),
        'Should have unreadable-checkpoint validation error',
      );
    } finally {
      // Restore permissions for cleanup
      try { fs.chmodSync(cp2Path, 0o644); } catch { /* best effort */ }
      await fixture.db.close();
    }
  });

  // --- Finding 2: Same-count checkpoint changes detected ---

  it('isUnchanged detects checkpoint content changes with same count', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - CP-Content-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'CP Content Mission',
      status: 'active',
    }));
    writeCheckpointFile(missionDir, 'CP-1.md', [
      '# CP-1: First Checkpoint',
      '',
      '## Goal Check',
      '',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| Criterion A | Evidence A | PASS |',
      '',
      '## Next action:',
      '',
      'Original action.',
    ].join('\n'));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);

      // First apply
      const report1 = await importer.apply();
      assert.equal(report1.importedCount, 1);

      // Modify checkpoint content (same count, different content)
      writeCheckpointFile(missionDir, 'CP-1.md', [
        '# CP-1: First Checkpoint',
        '',
        '## Goal Check',
        '',
        '| Criterion | Evidence | Status |',
        '|---|---|---|',
        '| Criterion B | Evidence B | PASS |',
        '',
        '## Next action:',
        '',
        'Updated action.',
      ].join('\n'));

      // Second apply — should detect the change as divergence
      const report2 = await importer.apply();
      assert.equal(report2.importedCount, 0, 'Should not re-import (divergent)');
      assert.ok(
        report2.conflicts.some((c) => c.reason === 'divergent-state' || c.reason === 'stale-write'),
        'Should report divergence for checkpoint content change',
      );
    } finally {
      await fixture.db.close();
    }
  });

  // --- Finding 3: restore(backupPath) API ---

  it('restore(backupPath) recovers the pre-import database state', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // Pre-populate database with an existing Mission
    const existingMission: Mission = {
      id: missionId(SLUG_ONE),
      repositoryId: repositoryId('repo-parallix'),
      title: 'Before Import',
      labels: missionLabels(['original']),
      assignee: agentFamily('codex'),
      status: 'active',
      rawStatus: 'active',
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      closedAt: null,
    };
    await fixture.store.save(existingMission, null);

    // Write a new task file for import
    writeTaskFile(tasksDir, `${SLUG_TWO} - New-Mission.md`, standardTaskContent({
      id: 'TASK-2322-TWO',
      title: 'New Mission',
      status: 'ready',
      assignee: 'codex',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.ok(report.backupPath, 'Should have backupPath');
      assert.equal(report.importedCount, 1, 'Should import 1 new mission');

      // Verify new mission is in database
      const afterImport = await fixture.store.load(missionId(SLUG_TWO));
      assert.equal(afterImport.kind, 'found');

      // Restore to pre-import state using restore(backupPath)
      await importer.restore(report.backupPath!);

      // Verify new mission is gone (restored to pre-import state)
      const restored = await fixture.store.load(missionId(SLUG_TWO));
      assert.equal(restored.kind, 'missing', 'New mission should be gone after restore');

      // Verify original mission is still present
      const original = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(original.kind, 'found');
      assert.equal(original.mission.title, 'Before Import');
    } finally {
      await fixture.db.close();
    }
  });

  it('replay with unchanged source detects database divergence (SC4 + SC8)', async () => {
    const fixture = await createRepoFixture();
    const mid = missionId(SLUG_ONE);

    // Create mission in source
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(tasksDir, `${SLUG_ONE}.task.md`),
      `---
id: TASK-2322-ONE
title: Original Title
status: active
assignee: codex
---

## Description
Original content

## Goal Check
| Criterion | Evidence |
| ok | yes |`,
    );

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report1 = await importer.apply();
      assert.equal(report1.importedCount, 1, 'First import should import 1');
      assert.equal(report1.conflicts.length, 0, 'First import should have 0 conflicts');

      // Modify the mission in the database (title change)
      await fixture.store.save({
        id: mid,
        repositoryId: repositoryId('repo-parallix'),
        title: 'Modified in DB',
        status: 'active',
        rawStatus: 'active',
        assignee: agentFamily('codex'),
        netEngineeringLines: 0,
        checkpoints: [],
        labels: missionLabels([]),
        closedAt: null,
        review: null,
      }, missionVersion(1));

      // Replay with unchanged source — should detect divergence
      const importer2 = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report2 = await importer2.apply();

      assert.equal(
        report2.conflicts.length, 1,
        'Should detect 1 conflict (database divergence with unchanged source)',
      );
      assert.equal(report2.conflicts[0].missionId, mid);
      assert.ok(
        report2.conflicts[0].reason === 'stale-write',
        `Conflict reason should be stale-write, got: ${report2.conflicts[0].reason}`,
      );
      assert.equal(report2.importedCount, 0, 'Should not import when divergent');
    } finally {
      await fixture.db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Full-aggregate divergence detection and relational provenance
// ---------------------------------------------------------------------------

describe('MissionCompatibilityImporter — aggregate divergence and provenance', () => {
  afterEach(cleanupTempDirs);

  /** Change the digest without touching anything the aggregate is built from. */
  function writeUnmappedMissionNote(missionDir: string, text: string): void {
    fs.writeFileSync(path.join(missionDir, 'NOTES.md'), text);
  }

  it('apply reports divergence when only a label value changes at the same count', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const taskName = `${SLUG_ONE} - Label-Mission.md`;

    writeTaskFile(tasksDir, taskName, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Label Mission',
      status: 'active',
      labels: ['ai_sdlc', 'database'],
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      assert.equal((await importer.apply()).importedCount, 1);

      // Same label count, one different value.
      writeTaskFile(tasksDir, taskName, standardTaskContent({
        id: 'TASK-2322-ONE',
        title: 'Label Mission',
        status: 'active',
        labels: ['ai_sdlc', 'docs'],
      }));

      const report = await importer.apply();
      assert.equal(report.importedCount, 0, 'Divergent mission must not be overwritten');
      assert.equal(report.conflicts.length, 1, 'Should report the label divergence');
      assert.match(report.conflicts[0].details ?? '', /labels/);
    } finally {
      await fixture.db.close();
    }
  });

  it('apply reports divergence when only checkpoint metadata changes', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);
    const checkpoint = (nextAction: string): string => [
      '# CP-1: First Checkpoint',
      '',
      '## Goal Check',
      '',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| Criterion A | Evidence A | PASS |',
      '',
      '## Next action:',
      '',
      nextAction,
    ].join('\n');

    writeTaskFile(tasksDir, `${SLUG_ONE} - CP-Metadata-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'CP Metadata Mission',
      status: 'active',
    }));
    writeCheckpointFile(missionDir, 'CP-1.md', checkpoint('Original action.'));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      assert.equal((await importer.apply()).importedCount, 1);

      // Identical Goal Check rows; only the next action text changes.
      writeCheckpointFile(missionDir, 'CP-1.md', checkpoint('Updated action.'));

      const report = await importer.apply();
      assert.equal(report.importedCount, 0, 'Divergent mission must not be overwritten');
      assert.equal(report.conflicts.length, 1, 'Should report the checkpoint divergence');
      assert.match(report.conflicts[0].details ?? '', /checkpoints/);
    } finally {
      await fixture.db.close();
    }
  });

  it('apply reports divergence when only the review reviewer changes', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);
    const reviewState = (reviewer: string): string => JSON.stringify({
      reviewer,
      implementer: 'claude',
      round: 1,
      phase: 'reviewing',
      startedAt: '2026-07-30T00:00:00.000Z',
    });

    writeTaskFile(tasksDir, `${SLUG_ONE} - Review-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Review Mission',
      status: 'review',
    }));
    fs.writeFileSync(path.join(missionDir, 'review-state.json'), reviewState('codex'));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      assert.equal((await importer.apply()).importedCount, 1);

      // Same single round; only the reviewer family changes.
      fs.writeFileSync(path.join(missionDir, 'review-state.json'), reviewState('claude'));

      const report = await importer.apply();
      assert.equal(report.importedCount, 0, 'Divergent mission must not be overwritten');
      assert.equal(report.conflicts.length, 1, 'Should report the review divergence');
      assert.match(report.conflicts[0].details ?? '', /review/);
    } finally {
      await fixture.db.close();
    }
  });

  it('apply reports no conflict for an unchanged checkpoint that has no Goal Check rows', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Empty-Goal-Check-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Empty Goal Check Mission',
      status: 'active',
    }));
    writeCheckpointFile(missionDir, 'CP-1.md', [
      '# CP-1: No Goal Check Table',
      '',
      '## Next action:',
      '',
      'Keep going.',
    ].join('\n'));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      assert.equal((await importer.apply()).importedCount, 1);

      // Digest changes, aggregate does not.
      writeUnmappedMissionNote(missionDir, 'scratch notes\n');

      const report = await importer.apply();
      assert.deepEqual(report.conflicts, [], 'Unchanged aggregate must not be reported as divergent');
      assert.equal(report.importedCount, 0, 'Unchanged mission must not be rewritten');
      assert.equal(report.skippedCount, 1, 'Unchanged mission should be skipped');
    } finally {
      await fixture.db.close();
    }
  });

  it('provenance keeps source_path as the source root and snapshots versions relationally', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - Provenance-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Provenance Mission',
      status: 'active',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      await importer.apply();

      const history = await fixture.db.query<{ id: number; source_path: string; imported_count: number }>(
        'SELECT id, source_path, imported_count FROM import_history ORDER BY id;',
      );
      assert.equal(history.length, 1);
      assert.equal(
        history[0].source_path,
        fs.realpathSync(fixture.rootDir),
        'source_path must hold the source root and nothing else (SC9)',
      );

      const snapshot = await fixture.db.query<{ mission_id: string; version: number }>(
        'SELECT mission_id, version FROM import_mission_versions WHERE import_id = ?;',
        [history[0].id],
      );
      assert.equal(snapshot.length, 1, 'Snapshot row per imported mission');
      assert.equal(snapshot[0].mission_id, SLUG_ONE);
      assert.equal(typeof snapshot[0].version, 'number', 'version is stored as an INTEGER');
      assert.equal(snapshot[0].version, 1);

      // A later import that skips the unchanged mission still vouches for its
      // version, so the following replay can still spot an out-of-band edit.
      writeUnmappedMissionNote(missionDir, 'scratch notes\n');
      await importer.apply();

      const latest = await fixture.db.query<{ mission_id: string; version: number }>(
        `SELECT mission_id, version FROM import_mission_versions
         WHERE import_id = (SELECT MAX(id) FROM import_history);`,
      );
      assert.deepEqual(
        latest.map((row) => [row.mission_id, row.version]),
        [[SLUG_ONE, 1]],
        'Skipped missions stay in the version snapshot',
      );
    } finally {
      await fixture.db.close();
    }
  });

  it('unrelated import_history entries do not break unchanged-replay idempotency', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    writeTaskFile(tasksDir, `${SLUG_ONE} - Shared-Ledger-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Shared Ledger Mission',
      status: 'active',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const first = await importer.apply();
      assert.equal(first.importedCount, 1, 'First apply imports the mission');

      // import_history is shared with the blocklist/stats importers and with
      // Mission imports of other roots. A newer unrelated row must not shadow
      // this root's provenance.
      await fixture.db.execute(
        `INSERT INTO import_history (source_path, digest, imported_count, skipped_count, imported_at)
         VALUES (?, ?, ?, ?, ?);`,
        ['/some/other/root/blocklist.json', 'unrelated-digest', 7, 0, new Date().toISOString()],
      );

      const second = await importer.apply();
      assert.equal(second.importedCount, 0, 'Unchanged replay must not re-import');
      assert.equal(second.skippedCount, 1, 'Unchanged mission is skipped');
      assert.deepEqual(second.conflicts, [], 'Unchanged replay is not a conflict');

      const versions = await fixture.db.query<{ version: number }>(
        'SELECT version FROM missions WHERE id = ?;',
        [SLUG_ONE],
      );
      assert.equal(versions.length, 1, 'No duplicate mission rows');
      assert.equal(versions[0].version, 1, 'Version must not be bumped by the replay (SC3)');

      const ownHistory = await fixture.db.query<{ id: number }>(
        'SELECT id FROM import_history WHERE source_path = ? ORDER BY id;',
        [fs.realpathSync(fixture.rootDir)],
      );
      assert.equal(ownHistory.length, 1, 'Replay must not append a ledger row for this root');
    } finally {
      await fixture.db.close();
    }
  });

  it('every migration the importer needs ships in the default migration set', async () => {
    // The deployment contract: initOperatorState()/application-services load the
    // migrations directory and apply all pending entries, so an operator database
    // opened the normal way always has the importer's tables. This asserts the
    // importer's requirements are covered by that set rather than by a fixture.
    const ids = loadDefaultMigrations().map((migration) => migration.id);
    assert.ok(
      ids.includes('0004-mission-aggregate'),
      'Mission aggregate migration must be in the default set',
    );
    assert.ok(
      ids.includes('0006-import-mission-versions'),
      'Importer provenance migration must be in the default set',
    );
    // Not a global sort assertion: loadDefaultMigrations deliberately hoists
    // 0006-session-markers ahead of 0005-repository-scoped-session-markers.
    // What the importer needs is only that its table is created after the
    // mission aggregate it references.
    assert.ok(
      ids.indexOf('0006-import-mission-versions') > ids.indexOf('0004-mission-aggregate'),
      'Migrations must be ordered so 0006 applies after 0004',
    );
  });

  it('apply fails with a named precondition error when a required table is absent', async () => {
    const rootDir = createTempDir('repo-schema');
    fs.mkdirSync(path.join(rootDir, 'backlog', 'tasks'), { recursive: true });
    const dbPath = path.join(createTempDir('db-schema'), 'parallix.db');
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: dbPath });

    // Migrate only through 0004 — the precondition the mission states literally,
    // which is short of what the importer (and SqliteMissionStore) need.
    const truncated = loadDefaultMigrations().filter(
      (migration) => migration.id <= '0004-mission-aggregate',
    );
    await new SqliteMigrationRunner(db).applyPending(truncated);
    const store = new SqliteMissionStore(db);

    writeTaskFile(
      path.join(rootDir, 'backlog', 'tasks'),
      `${SLUG_ONE} - Schema-Mission.md`,
      standardTaskContent({ id: 'TASK-2322-ONE', title: 'Schema Mission', status: 'active' }),
    );

    try {
      const importer = await createImporter(rootDir, db, store);
      await assert.rejects(
        () => importer.apply(),
        (error: Error) => {
          assert.equal(error.name, 'MissionImportSchemaError');
          assert.match(error.message, /import_mission_versions/);
          assert.match(error.message, /pending migrations/);
          return true;
        },
        'A truncated schema must produce a named precondition failure, not "no such table"',
      );

      // The refusal happens before any write: no mission rows, no ledger rows.
      const missions = await db.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM missions;',
      );
      assert.equal(missions[0].count, 0, 'Precondition failure must not write missions');
    } finally {
      await db.close();
    }
  });

  it('deleting an import_history row cascades its version snapshot away', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    writeTaskFile(tasksDir, `${SLUG_ONE} - Cascade-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Cascade Mission',
      status: 'active',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      await importer.apply();
      await fixture.db.execute('DELETE FROM import_history;', []);

      const orphans = await fixture.db.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM import_mission_versions;',
      );
      assert.equal(orphans[0].count, 0, 'Snapshot rows must not outlive their ledger entry');
    } finally {
      await fixture.db.close();
    }
  });
});

describe('MissionCompatibilityImporter — malformed review state and ambiguous mission directories', () => {
  // --- Round 3 P1: a present but malformed review-state.json must block apply ---

  const malformedReviewCases: ReadonlyArray<{ label: string; body: string; expected: RegExp }> = [
    {
      label: 'is not valid JSON',
      body: '{ "reviewer": "codex", ',
      expected: /invalid-review-state:.*not valid JSON/,
    },
    {
      label: 'is a JSON array rather than an object',
      body: '["codex"]',
      expected: /invalid-review-state:.*not a JSON object/,
    },
    {
      label: 'is missing the reviewer family',
      body: JSON.stringify({
        implementer: 'claude',
        round: 1,
        startedAt: '2026-07-30T00:00:00.000Z',
        phase: 'reviewing',
      }),
      expected: /invalid-review-state:.*missing the required "reviewer"/,
    },
    {
      label: 'names a malformed reviewer family',
      body: JSON.stringify({
        reviewer: 'Codex Reviewer',
        implementer: 'claude',
        round: 1,
        startedAt: '2026-07-30T00:00:00.000Z',
        phase: 'reviewing',
      }),
      expected: /invalid-review-state:.*invalid "reviewer" agent family/,
    },
    {
      label: 'has a non-integer round',
      body: JSON.stringify({
        reviewer: 'codex',
        implementer: 'claude',
        round: 'first',
        startedAt: '2026-07-30T00:00:00.000Z',
        phase: 'reviewing',
      }),
      expected: /invalid-review-state:.*invalid "round" value.*positive integer/,
    },
    {
      label: 'has an unparseable startedAt',
      body: JSON.stringify({
        reviewer: 'codex',
        implementer: 'claude',
        round: 1,
        startedAt: 'sometime last week',
        phase: 'reviewing',
      }),
      expected: /invalid-review-state:.*invalid "startedAt" value.*ISO-8601/,
    },
  ];

  for (const testCase of malformedReviewCases) {
    it(`apply refuses to write when review-state.json ${testCase.label}`, async () => {
      const fixture = await createRepoFixture();
      const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
      const missionDir = createMissionDir(fixture.rootDir, SLUG_ONE);

      writeTaskFile(tasksDir, `${SLUG_ONE} - Malformed-Review-Mission.md`, standardTaskContent({
        id: 'TASK-2322-ONE',
        title: 'Malformed Review Mission',
        status: 'review',
      }));
      fs.writeFileSync(path.join(missionDir, 'review-state.json'), testCase.body);

      try {
        const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);

        const dry = await importer.dryRun();
        assert.equal(dry.candidates.length, 1);
        assert.ok(
          dry.candidates[0].validationErrors.some((e) => testCase.expected.test(e)),
          `Expected a validation error matching ${testCase.expected}, got: `
          + JSON.stringify(dry.candidates[0].validationErrors),
        );
        assert.equal(
          dry.candidates[0].review,
          null,
          'A malformed review artifact must not yield a fabricated Review',
        );

        const report = await importer.apply();
        assert.equal(report.importedCount, 0, 'Malformed review state must block the import');
        assert.equal(report.conflicts.length, 1);
        assert.equal(report.conflicts[0].reason, 'validation-error');

        const loaded = await fixture.store.load(missionId(SLUG_ONE));
        assert.equal(loaded.kind, 'missing', 'Mission must not be persisted without its review');
        const rows = await fixture.db.query<{ count: number }>(
          'SELECT COUNT(*) AS count FROM missions;',
        );
        assert.equal(rows[0].count, 0, 'Apply must perform no write');
      } finally {
        await fixture.db.close();
      }
    });
  }

  it('an absent review-state.json remains an optional omission, not an error', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');
    createMissionDir(fixture.rootDir, SLUG_ONE);

    writeTaskFile(tasksDir, `${SLUG_ONE} - No-Review-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'No Review Mission',
      status: 'active',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 1, 'A mission without review artifacts still imports');
      assert.equal(report.conflicts.length, 0);
    } finally {
      await fixture.db.close();
    }
  });

  // --- Round 3 P1: mission-directory lookup must be identity-safe ---

  it('does not attach a prefix-colliding mission directory to a different mission', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // The task id is `task-2322-one`; only `task-2322-one-extra` exists on disk.
    const collidingDir = createMissionDir(fixture.rootDir, `${SLUG_ONE}-extra`);
    writeCheckpointFile(collidingDir, 'CP-1.md', '# CP-1: Other mission checkpoint\n');
    fs.writeFileSync(path.join(collidingDir, 'review-state.json'), JSON.stringify({
      reviewer: 'codex',
      implementer: 'claude',
      round: 4,
      startedAt: '2026-07-30T00:00:00.000Z',
      phase: 'reviewing',
    }));

    writeTaskFile(tasksDir, `${SLUG_ONE} - Prefix-Collision-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Prefix Collision Mission',
      status: 'active',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const dry = await importer.dryRun();

      assert.equal(dry.candidates.length, 1);
      const candidate = dry.candidates[0];
      assert.equal(candidate.checkpoints.length, 0, 'Another mission\'s checkpoints must not attach');
      assert.equal(candidate.review, null, 'Another mission\'s review state must not attach');
      assert.ok(
        candidate.validationErrors.some((e) => /ambiguous-mission-directory/.test(e)),
        `Expected an ambiguous-mission-directory error, got: ${JSON.stringify(candidate.validationErrors)}`,
      );

      const report = await importer.apply();
      assert.equal(report.importedCount, 0, 'Ambiguous source identity must block the import');
      assert.equal(report.conflicts[0].reason, 'validation-error');
    } finally {
      await fixture.db.close();
    }
  });

  it('an exact mission-directory match wins over a prefix-colliding sibling', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    const exactDir = createMissionDir(fixture.rootDir, SLUG_ONE);
    writeCheckpointFile(exactDir, 'CP-1.md', '# CP-1: Own checkpoint\n');

    const siblingDir = createMissionDir(fixture.rootDir, `${SLUG_ONE}-extra`);
    writeCheckpointFile(siblingDir, 'CP-1.md', '# CP-1: Sibling checkpoint\n');
    writeCheckpointFile(siblingDir, 'CP-2.md', '# CP-2: Sibling checkpoint\n');

    writeTaskFile(tasksDir, `${SLUG_ONE} - Exact-Match-Mission.md`, standardTaskContent({
      id: 'TASK-2322-ONE',
      title: 'Exact Match Mission',
      status: 'active',
    }));

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const dry = await importer.dryRun();

      assert.equal(dry.candidates.length, 1);
      assert.deepEqual(dry.candidates[0].validationErrors, []);
      assert.equal(dry.candidates[0].checkpoints.length, 1, 'Only the exact directory contributes');
      assert.equal(dry.candidates[0].checkpoints[0].firstLine, 'CP-1: Own checkpoint');
    } finally {
      await fixture.db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Round 4 findings: invalid assignee validation + NEL validation
// ---------------------------------------------------------------------------

describe('MissionCompatibilityImporter — round 4: assignee and NEL validation', () => {
  // --- Finding: invalid assignee must produce a validation error, not silent null ---

  it('dry-run reports invalid assignee as a validation error instead of silently discarding it', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // "Codex Reviewer" has a space and uppercase — agentFamily() rejects it
    const content = `---
id: TASK-2322-ONE
title: Invalid Assignee Mission
status: ready
assignee: Codex Reviewer
labels:
  - ai_sdlc
---

# Invalid Assignee Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Invalid-Assignee.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.ok(
        candidate.validationErrors.some((e) => e.includes('invalid-assignee')),
        `Should have invalid-assignee error, got: ${JSON.stringify(candidate.validationErrors)}`,
      );
      assert.equal(candidate.assignee, null, 'Invalid assignee should be null in candidate');
    } finally {
      await fixture.db.close();
    }
  });

  it('apply refuses to write when assignee is invalid (SC2)', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    // "Codex Reviewer" has a space and uppercase — agentFamily() rejects it
    const content = `---
id: TASK-2322-ONE
title: Invalid Assignee Mission
status: ready
assignee: Codex Reviewer
labels:
  - ai_sdlc
---

# Invalid Assignee Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Invalid-Assignee-Apply.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 0, 'Should not import when assignee is invalid');
      assert.equal(report.conflicts.length, 1, 'Should report 1 validation conflict');
      assert.equal(report.conflicts[0].reason, 'validation-error');
      assert.ok(
        report.conflicts[0].details?.includes('invalid-assignee'),
        'Conflict details should mention invalid-assignee',
      );

      // Verify no write occurred
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'missing', 'Mission should not be in database');
    } finally {
      await fixture.db.close();
    }
  });

  // --- Finding: NEL 0 must be preserved, invalid NEL must be validated before transaction ---

  it('dry-run preserves NEL value of 0 (does not convert to null)', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    const content = `---
id: TASK-2322-ONE
title: Zero NEL Mission
status: active
netEngineeringLines: 0
labels:
  - ai_sdlc
---

# Zero NEL Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Zero-NEL.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      assert.equal(
        report.candidates[0].netEngineeringLines,
        0,
        'NEL value of 0 must be preserved, not converted to null',
      );
      assert.deepEqual(
        report.candidates[0].validationErrors,
        [],
        'Valid NEL of 0 should produce no errors',
      );
    } finally {
      await fixture.db.close();
    }
  });

  it('dry-run reports negative NEL as a validation error', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    const content = `---
id: TASK-2322-ONE
title: Negative NEL Mission
status: active
netEngineeringLines: -5
labels:
  - ai_sdlc
---

# Negative NEL Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Negative-NEL.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.ok(
        candidate.validationErrors.some((e) => e.includes('invalid-net-engineering-lines')),
        `Should have invalid-net-engineering-lines error, got: ${JSON.stringify(candidate.validationErrors)}`,
      );
      assert.equal(candidate.netEngineeringLines, null, 'Invalid NEL should be null in candidate');
    } finally {
      await fixture.db.close();
    }
  });

  it('dry-run reports fractional NEL as a validation error', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    const content = `---
id: TASK-2322-ONE
title: Fractional NEL Mission
status: active
netEngineeringLines: 42.5
labels:
  - ai_sdlc
---

# Fractional NEL Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Fractional-NEL.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.ok(
        candidate.validationErrors.some((e) => e.includes('invalid-net-engineering-lines')),
        `Should have invalid-net-engineering-lines error, got: ${JSON.stringify(candidate.validationErrors)}`,
      );
      assert.equal(candidate.netEngineeringLines, null, 'Invalid NEL should be null in candidate');
    } finally {
      await fixture.db.close();
    }
  });

  it('dry-run reports non-numeric NEL as a validation error', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    const content = `---
id: TASK-2322-ONE
title: Non-Numeric NEL Mission
status: active
netEngineeringLines: medium
labels:
  - ai_sdlc
---

# Non-Numeric NEL Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Non-Numeric-NEL.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.dryRun();

      assert.equal(report.candidates.length, 1);
      const candidate = report.candidates[0];
      assert.ok(
        candidate.validationErrors.some((e) => e.includes('invalid-net-engineering-lines')),
        `Should have invalid-net-engineering-lines error, got: ${JSON.stringify(candidate.validationErrors)}`,
      );
      assert.equal(candidate.netEngineeringLines, null, 'Invalid NEL should be null in candidate');
    } finally {
      await fixture.db.close();
    }
  });

  it('apply refuses to write when NEL is invalid (SC2)', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    const content = `---
id: TASK-2322-ONE
title: Invalid NEL Mission
status: active
netEngineeringLines: -10
labels:
  - ai_sdlc
---

# Invalid NEL Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Invalid-NEL-Apply.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 0, 'Should not import when NEL is invalid');
      assert.equal(report.conflicts.length, 1, 'Should report 1 validation conflict');
      assert.equal(report.conflicts[0].reason, 'validation-error');
      assert.ok(
        report.conflicts[0].details?.includes('invalid-net-engineering-lines'),
        'Conflict details should mention invalid-net-engineering-lines',
      );

      // Verify no write occurred
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'missing', 'Mission should not be in database');
    } finally {
      await fixture.db.close();
    }
  });

  it('apply persists NEL value of 0 correctly', async () => {
    const fixture = await createRepoFixture();
    const tasksDir = path.join(fixture.rootDir, 'backlog', 'tasks');

    const content = `---
id: TASK-2322-ONE
title: Zero NEL Mission
status: active
netEngineeringLines: 0
labels:
  - ai_sdlc
---

# Zero NEL Mission
`;
    writeTaskFile(tasksDir, `${SLUG_ONE} - Zero-NEL-Apply.md`, content);

    try {
      const importer = await createImporter(fixture.rootDir, fixture.db, fixture.store);
      const report = await importer.apply();

      assert.equal(report.importedCount, 1, 'Should import with NEL of 0');

      // Verify NEL is 0 in the database
      const loaded = await fixture.store.load(missionId(SLUG_ONE));
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.netEngineeringLines, 0, 'NEL should be 0 in database');
    } finally {
      await fixture.db.close();
    }
  });
});
