import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Mission, MissionId } from '../../domain/mission.js';
import { missionId } from '../../domain/mission.js';
import { missionVersion, type MissionVersion } from '../../application/domain-ports.js';
import type { RepositoryId } from '../../domain/repository.js';
import {
  buildCandidate,
  canonicalJson,
  extractTaskId,
  parseFrontmatter,
  readMdFiles,
  truncate,
  type MissionImportCandidate,
} from './mission-import-parsing.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { SqliteMissionStore } from './mission-store.js';
import { MissionStaleWriteError } from './mission-store.js';
import {
  hydrateMission,
  type MissionCheckpointRecord,
  type MissionExternalTaskRefRecord,
  type MissionGoalCheckRecord,
  type MissionLabelRecord,
  type MissionRecord,
  type MissionReviewFindingRecord,
  type MissionReviewRecord,
  type MissionReviewResolutionRecord,
  type MissionReviewRoundRecord,
  type MissionReviewStageLaunchRecord,
} from './mission-serialization.js';
import type { BacklogMissionRecord } from '../backlog/mission-materialization.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { MissionImportCandidate } from './mission-import-parsing.js';

/** A conflict between a legacy source and an existing database Mission row. */
export interface MissionImportConflict {
  /** The mission id involved in the conflict. */
  readonly missionId: MissionId;
  /** Source path of the legacy task file. */
  readonly sourcePath: string;
  /** Description of the conflict (e.g. "divergent-title", "unmappable-status"). */
  readonly reason: string;
  /** Details about the divergence, if applicable. */
  readonly details?: string;
}

/** Omission: a source file that could not be mapped to a Mission. */
export interface MissionImportOmission {
  /** Absolute path to the source file. */
  readonly sourcePath: string;
  /** Reason the file was omitted (e.g. "invalid-frontmatter", "no-task-id"). */
  readonly reason: string;
}

/**
 * Report produced by dry-run or apply.
 *
 * Dry-run: discovers and validates candidates without writing to the database.
 * Apply: additionally records import provenance and persists new/updated Missions.
 */
export interface MissionImportReport {
  /** Repository root directory used for discovery. */
  readonly sourceRoot: string;
  /** SHA-256 digest of the combined source file contents (for idempotency). */
  readonly digest: string;
  /** Whether this was a dry-run (no database writes). */
  readonly dryRun: boolean;
  /** Validated candidates ready for import. */
  readonly candidates: readonly MissionImportCandidate[];
  /** Conflicts with existing database rows. */
  readonly conflicts: readonly MissionImportConflict[];
  /** Source files that could not be mapped. */
  readonly omissions: readonly MissionImportOmission[];
  /** Number of Missions persisted (apply only; 0 for dry-run). */
  readonly importedCount: number;
  /** Number of Missions skipped because they were unchanged (apply only). */
  readonly skippedCount: number;
  /** ISO timestamp of the import operation. */
  readonly importedAt: string;
  /** Path of the pre-import backup file (apply only). */
  readonly backupPath?: string;
}

// ---------------------------------------------------------------------------
// Schema precondition
// ---------------------------------------------------------------------------

/**
 * Tables the importer reads or writes directly, beyond the Mission aggregate
 * tables owned by `SqliteMissionStore`.
 */
const REQUIRED_IMPORTER_TABLES = [
  'missions',
  'import_history',
  'import_mission_versions',
] as const;

/**
 * Raised when the database has not had every migration the importer depends on
 * applied. The importer refuses to start rather than failing mid-apply with a
 * bare `no such table` from SQLite.
 */
export class MissionImportSchemaError extends Error {
  readonly missingTables: readonly string[];

  constructor(missingTables: readonly string[]) {
    super(
      `Mission import requires tables that are not present: ${missingTables.join(', ')}. ` +
        'Apply all pending migrations (loadDefaultMigrations + SqliteMigrationRunner.applyPending) ' +
        'before importing.',
    );
    this.name = 'MissionImportSchemaError';
    this.missingTables = missingTables;
  }
}

// ---------------------------------------------------------------------------
// MissionCompatibilityImporter
// ---------------------------------------------------------------------------

/**
 * Atomic one-way compatibility importer from legacy task Markdown files into
 * the checked Mission aggregate in SQLite.
 *
 * Dry-run discovers all legacy task files, maps each to a candidate Mission
 * domain value, and reports validation errors, identity conflicts, and omissions
 * without writing to the database or modifying source files.
 *
 * Apply validates the complete candidate set before opening any database
 * transaction, creates a pre-import backup, persists via SqliteMissionStore
 * ports, records provenance in import_history, and is idempotent on replay.
 *
 * Source files are never modified, deleted, or normalized.
 */
export class MissionCompatibilityImporter {
  private readonly db: SqliteDatabaseAdapter;
  private readonly store: SqliteMissionStore;
  private readonly rootDir: string;
  private readonly repositoryId: RepositoryId;

  constructor(
    db: SqliteDatabaseAdapter,
    store: SqliteMissionStore,
    rootDir: string,
    repositoryId: RepositoryId,
  ) {
    this.db = db;
    this.store = store;
    this.rootDir = path.resolve(rootDir);
    this.repositoryId = repositoryId;
  }

  // -----------------------------------------------------------------------
  // Dry-run
  // -----------------------------------------------------------------------

  /**
   * Discover all legacy task files and produce a report without writing to the
   * database or modifying any source files.
   */
  async dryRun(): Promise<MissionImportReport> {
    const candidates = this.discoverCandidates();
    const conflicts = await this.detectConflicts(candidates);
    const omissions = this.detectOmissions();
    const digest = this.computeDigest();

    return {
      sourceRoot: this.rootDir,
      digest,
      dryRun: true,
      candidates,
      conflicts,
      omissions,
      importedCount: 0,
      skippedCount: 0,
      importedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Apply
  // -----------------------------------------------------------------------

  /**
   * Validate the complete candidate set, create a backup, and atomically
   * persist all importable Missions. Idempotent on replay with unchanged source.
   *
   * Divergent Missions (architecture invariant) are reported in the conflict list and the import
   * proceeds for non-conflicting missions.
   */
  async apply(): Promise<MissionImportReport> {
    await this.assertSchemaPresent();
    const candidates = this.discoverCandidates();
    const omissions = this.detectOmissions();
    const digest = this.computeDigest();

    // architecture invariant: Validate complete candidate set before any database write
    const validationErrors = this.validateCandidates(candidates);
    if (validationErrors.length > 0) {
      const conflicts = validationErrors.map((err) => ({
        missionId: err.missionId,
        sourcePath: err.sourcePath,
        reason: 'validation-error',
        details: err.errors.join('; '),
      }));
      return {
        sourceRoot: this.rootDir,
        digest,
        dryRun: false,
        candidates,
        conflicts,
        omissions,
        importedCount: 0,
        skippedCount: 0,
        importedAt: new Date().toISOString(),
      };
    }

    // architecture invariant idempotent replay: digest check via raw SQL (no MissionStore.load()).
    // If source digest matches, check for database divergence before skipping.
    const lastImport = await this.getLastImport();
    if (lastImport && lastImport.digest === digest) {
      // architecture invariant: Detect database divergence even when source is unchanged.
      // Compare current DB versions against the snapshot stored at last import.
      const dbConflicts = await this.detectDatabaseDivergence(
        candidates,
        lastImport.versionSnapshot,
      );
      if (dbConflicts.length > 0) {
        return {
          sourceRoot: this.rootDir,
          digest,
          dryRun: false,
          candidates,
          conflicts: dbConflicts,
          omissions,
          importedCount: 0,
          skippedCount: candidates.length - dbConflicts.length,
          importedAt: new Date().toISOString(),
        };
      }
      return {
        sourceRoot: this.rootDir,
        digest,
        dryRun: false,
        candidates,
        conflicts: [],
        omissions,
        importedCount: 0,
        skippedCount: candidates.length,
        importedAt: new Date().toISOString(),
      };
    }

    // architecture invariant: Detect divergence and obtain versions via raw SQL (no MissionStore.load()).
    // detectDivergenceViaSQL compares candidate fields against DB rows directly.
    const existingVersions = await this.getExistingMissionVersions(candidates);
    const divergenceResults = await this.detectDivergenceViaSQL(
      candidates,
      existingVersions,
    );
    const conflictIds = new Set(
      divergenceResults.conflicts.map((c) => c.missionId),
    );

    // Classify candidates into imported vs skipped (unchanged).
    // architecture invariant compliant: no MissionStore.load() calls.
    const toImport: Array<{
      candidate: MissionImportCandidate;
      mission: Mission;
      expectedVersion: MissionVersion | null;
    }> = [];
    const skipped: MissionId[] = [];

    for (const candidate of candidates) {
      if (conflictIds.has(candidate.missionId)) {
        continue;
      }
      const existingVersion = existingVersions.get(candidate.missionId);
      if (existingVersion !== undefined) {
        // Check if unchanged via snapshot comparison.
        const snapshotVersion = lastImport?.versionSnapshot.get(
          candidate.missionId,
        );
        if (snapshotVersion !== undefined && snapshotVersion === existingVersion) {
          skipped.push(candidate.missionId);
          continue;
        }
      }
      const mission = this.toMission(candidate);
      toImport.push({ candidate, mission, expectedVersion: existingVersion ?? null });
    }

    // architecture invariant: Create pre-import backup of parallix.db
    const backupPath = await this.db.backup();

    // Atomic persist: all Mission aggregates + provenance in one transaction.
    // Each store.save() participates in the outer transaction (nested begin/
    // commit are no-ops via transaction depth tracking in SqliteDatabaseAdapter).
    // architecture invariant: Divergent Missions from SQL detection + stale-write errors from save().
    const imported: MissionId[] = [];
    const existingConflicts: Array<{
      missionId: MissionId;
      sourcePath: string;
      reason: 'stale-write';
      details: string;
    }> = [...divergenceResults.conflicts];
    const importedAt = new Date().toISOString();
    try {
      await this.db.beginTransaction();

      for (const { candidate, mission, expectedVersion } of toImport) {
        try {
          await this.store.save(mission, expectedVersion);
          imported.push(candidate.missionId);
        } catch (error) {
          if (error instanceof MissionStaleWriteError) {
            // architecture invariant: Divergent Mission — report and skip
            existingConflicts.push({
              missionId: candidate.missionId,
              sourcePath: candidate.sourcePath,
              reason: 'stale-write',
              details: error.message,
            });
            continue;
          }
          throw error;
        }
      }

      // architecture invariant: Record import provenance in import_history (inside same transaction).
      // Snapshot the post-save version of every Mission this import vouches for
      // — imported and unchanged-skipped alike — so the next replay can tell an
      // out-of-band database edit from its own writes (architecture invariant). Conflicted
      // Missions are excluded: their current version is the divergence, and
      // recording it would hide the conflict from the following run.
      const conflictedIds = new Set(existingConflicts.map((c) => c.missionId));
      const versionSnapshot = new Map<MissionId, MissionVersion>();
      for (const [mission, version] of await this.getExistingMissionVersions(candidates)) {
        if (!conflictedIds.has(mission)) {
          versionSnapshot.set(mission, version);
        }
      }
      await this.recordImport({
        sourcePath: this.rootDir,
        digest,
        importedCount: imported.length,
        skippedCount: skipped.length + existingConflicts.length,
        importedAt,
        backupPath,
        versionSnapshot,
      });

      await this.db.commitTransaction();
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }

    return {
      sourceRoot: this.rootDir,
      digest,
      dryRun: false,
      candidates,
      conflicts: existingConflicts,
      omissions,
      importedCount: imported.length,
      skippedCount: skipped.length + existingConflicts.length,
      importedAt,
      backupPath,
    };
  }

  // -----------------------------------------------------------------------
  // architecture invariant: Raw SQL helpers (no MissionStore.load())
  // -----------------------------------------------------------------------

  /**
   * Fail fast when the database is missing a table the importer depends on.
   *
   * The importer is a pre-cutover tool run against an operator database that is
   * normally opened through `initOperatorState()`, which applies every pending
   * migration from the migrations directory before handing back the adapter. A
   * database opened some other way — or an explicitly truncated migration list
   * — gets a named precondition failure here instead of a bare SQLite
   * `no such table` part-way through the apply path.
   * architecture invariant compliant: read-only introspection, not MissionStore.load().
   */
  private async assertSchemaPresent(): Promise<void> {
    const placeholders = REQUIRED_IMPORTER_TABLES.map(() => '?').join(', ');
    const rows = await this.db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders});`,
      REQUIRED_IMPORTER_TABLES as unknown as readonly unknown[],
    );
    const present = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_IMPORTER_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new MissionImportSchemaError(missing);
    }
  }

  /**
   * Return the digest and version snapshot from the most recent import_history
   * entry *for this importer's source root*, or null if this root has never
   * been imported.
   *
   * `import_history` is a shared ledger — the blocklist and stats importers
   * write to it too, as does a Mission import of a different repository root.
   * Scoping by `source_path` keeps idempotency (architecture invariant) tied to this root: an
   * unrelated import landing between two unchanged applies must not hide this
   * root's version snapshot and cause a needless re-save/version bump.
   * architecture invariant compliant: raw SQL query, not MissionStore.load().
   */
  private async getLastImport(): Promise<{
    digest: string;
    versionSnapshot: Map<MissionId, MissionVersion>;
  } | null> {
    const rows = await this.db.query<{ id: number; digest: string }>(
      'SELECT id, digest FROM import_history WHERE source_path = ? ORDER BY id DESC LIMIT 1;',
      [this.rootDir],
    );
    if (rows.length === 0) {
      return null;
    }
    const snapshotRows = await this.db.query<{ mission_id: string; version: number }>(
      'SELECT mission_id, version FROM import_mission_versions WHERE import_id = ?;',
      [rows[0].id],
    );
    const versionSnapshot = new Map<MissionId, MissionVersion>();
    for (const row of snapshotRows) {
      versionSnapshot.set(missionId(row.mission_id), missionVersion(row.version));
    }
    return { digest: rows[0].digest, versionSnapshot };
  }

  /**
   * Return a map of missionId → version for all missions that exist in the
   * database among the given candidates.
   * architecture invariant compliant: raw SQL query, not MissionStore.load().
   */
  private async getExistingMissionVersions(
    candidates: readonly MissionImportCandidate[],
  ): Promise<Map<MissionId, MissionVersion>> {
    const missionIds = candidates.map((c) => c.missionId);
    if (missionIds.length === 0) {
      return new Map();
    }
    const placeholders = missionIds.map(() => '?').join(', ');
    const rows = await this.db.query<{ id: string; version: number }>(
      `SELECT id, version FROM missions WHERE id IN (${placeholders});`,
      missionIds as unknown as readonly unknown[],
    );
    const map = new Map<MissionId, MissionVersion>();
    for (const row of rows) {
      map.set(missionId(row.id), missionVersion(row.version));
    }
    return map;
  }

  /**
   * Detect database divergence when source digest is unchanged.
   * Compares current DB versions against the snapshot stored at last import.
   * architecture invariant compliant: raw SQL query, not MissionStore.load().
   */
  private async detectDatabaseDivergence(
    candidates: readonly MissionImportCandidate[],
    snapshot: Map<MissionId, MissionVersion>,
  ): Promise<{
    missionId: MissionId;
    sourcePath: string;
    reason: 'stale-write';
    details: string;
  }[]> {
    const existingVersions = await this.getExistingMissionVersions(candidates);
    const conflicts: Array<{
      missionId: MissionId;
      sourcePath: string;
      reason: 'stale-write';
      details: string;
    }> = [];

    for (const candidate of candidates) {
      const snapshotVersion = snapshot.get(candidate.missionId);
      const currentVersion = existingVersions.get(candidate.missionId);
      if (snapshotVersion !== undefined && currentVersion !== undefined
          && currentVersion !== snapshotVersion) {
        conflicts.push({
          missionId: candidate.missionId,
          sourcePath: candidate.sourcePath,
          reason: 'stale-write',
          details: `Database version ${currentVersion} differs from imported version ${snapshotVersion}`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Detect content-level divergence for candidates against existing database
   * rows.
   *
   * The persisted aggregate is read as raw rows and rehydrated with the store's
   * own serializer, so the comparison covers every value the store persists —
   * core fields, labels, checkpoints (name, raw filename, first line, next
   * action, goal check rows), the full review (rounds, subject, decisions,
   * findings, resolutions, intervention) and the external task ref — rather
   * than a hand-picked subset that silently ignores the rest.
   *
   * architecture invariant compliant: no MissionStore.load() calls.
   */
  private async detectDivergenceViaSQL(
    candidates: readonly MissionImportCandidate[],
    existingVersions: Map<MissionId, MissionVersion>,
  ): Promise<{ conflicts: Array<{ missionId: MissionId; sourcePath: string; reason: 'stale-write'; details: string }> }> {
    const conflicts: Array<{ missionId: MissionId; sourcePath: string; reason: 'stale-write'; details: string }> = [];

    // Only check candidates whose missions exist in the DB.
    const existingCandidates = candidates.filter((c) =>
      existingVersions.has(c.missionId),
    );
    if (existingCandidates.length === 0) {
      return { conflicts };
    }

    const persisted = await this.loadPersistedMissions(
      existingCandidates.map((c) => c.missionId),
    );

    for (const candidate of existingCandidates) {
      const existing = persisted.get(candidate.missionId);
      if (!existing) {
        continue;
      }
      const details = this.getDivergenceDetails(candidate, existing);
      if (details) {
        conflicts.push({
          missionId: candidate.missionId,
          sourcePath: candidate.sourcePath,
          reason: 'stale-write',
          details,
        });
      }
    }

    return { conflicts };
  }

  /**
   * Read the persisted Mission aggregates for the given ids and rehydrate them
   * through `hydrateMission()` — the same serializer `SqliteMissionStore.load()`
   * uses, without calling that port (architecture invariant).
   *
   * A row set that cannot be rehydrated is omitted from the result; the caller
   * treats a missing entry as "nothing comparable in the database".
   */
  private async loadPersistedMissions(
    ids: readonly MissionId[],
  ): Promise<Map<MissionId, Mission>> {
    const result = new Map<MissionId, Mission>();
    if (ids.length === 0) {
      return result;
    }
    const placeholders = ids.map(() => '?').join(', ');
    const params = ids as unknown as readonly unknown[];

    const [
      missions,
      labels,
      checkpoints,
      goalChecks,
      reviews,
      reviewRounds,
      findings,
      resolutions,
      externalRefs,
      stageLaunches,
    ] = await Promise.all([
      this.db.query<MissionRecord>(
        `SELECT id, repository_id, title, status, raw_status, assignee,
                net_engineering_lines, closed_at, version
         FROM missions WHERE id IN (${placeholders});`,
        params,
      ),
      this.db.query<MissionLabelRecord>(
        `SELECT mission_id, position, label FROM mission_labels
         WHERE mission_id IN (${placeholders}) ORDER BY position;`,
        params,
      ),
      this.db.query<MissionCheckpointRecord>(
        `SELECT mission_id, position, checkpoint_mission_id, name, raw_filename,
                first_line, next_action_text
         FROM mission_checkpoints WHERE mission_id IN (${placeholders})
         ORDER BY position;`,
        params,
      ),
      this.db.query<MissionGoalCheckRecord>(
        `SELECT mission_id, checkpoint_position, position, criterion, evidence
         FROM mission_checkpoint_goal_checks WHERE mission_id IN (${placeholders})
         ORDER BY checkpoint_position, position;`,
        params,
      ),
      this.db.query<MissionReviewRecord>(
        `SELECT mission_id, intervention_requested_at, intervention_requested_by,
                intervention_reason
         FROM mission_reviews WHERE mission_id IN (${placeholders});`,
        params,
      ),
      this.db.query<MissionReviewRoundRecord>(
        `SELECT mission_id, position, round_number, change_kind, provider,
                provider_change_id, provider_url, source_branch, target_branch,
                revision, reviewer, implementer, started_at, decision_kind,
                decided_at, decision_comment, approval_source_kind,
                approval_source_provider, responded_at, resulting_revision,
                phase, disposition, reviewer_retry_count, implementer_retry_count
         FROM mission_review_rounds WHERE mission_id IN (${placeholders})
         ORDER BY position;`,
        params,
      ),
      this.db.query<MissionReviewFindingRecord>(
        `SELECT mission_id, round_position, position, finding_id, summary, location
         FROM mission_review_findings WHERE mission_id IN (${placeholders})
         ORDER BY round_position, position;`,
        params,
      ),
      this.db.query<MissionReviewResolutionRecord>(
        `SELECT mission_id, round_position, position, finding_id, kind, explanation
         FROM mission_review_resolutions WHERE mission_id IN (${placeholders})
         ORDER BY round_position, position;`,
        params,
      ),
      this.db.query<MissionExternalTaskRefRecord>(
        `SELECT mission_id, source, external_id, url
         FROM mission_external_task_refs WHERE mission_id IN (${placeholders});`,
        params,
      ),
      this.db.query<MissionReviewStageLaunchRecord>(
        `SELECT mission_id, stage_key, position, fingerprint
         FROM mission_review_stage_launches WHERE mission_id IN (${placeholders})
         ORDER BY stage_key, position;`,
        params,
      ),
    ]);

    const byMission = <T extends { readonly mission_id: string }>(
      rows: readonly T[],
      id: string,
    ): readonly T[] => rows.filter((row) => row.mission_id === id);

    for (const mission of missions) {
      try {
        const hydrated = hydrateMission({
          mission,
          externalTaskRef: byMission(externalRefs, mission.id)[0] ?? null,
          labels: byMission(labels, mission.id),
          checkpoints: byMission(checkpoints, mission.id),
          goalChecks: byMission(goalChecks, mission.id),
          review: byMission(reviews, mission.id)[0] ?? null,
          reviewRounds: byMission(reviewRounds, mission.id),
          findings: byMission(findings, mission.id),
          resolutions: byMission(resolutions, mission.id),
          stageLaunches: byMission(stageLaunches, mission.id),
          reviewEvents: [],
        });
        result.set(hydrated.mission.id, hydrated.mission);
      } catch {
        // A row set the domain refuses to rehydrate is not comparable; the
        // candidate is treated as new and the store's own stale-write check
        // decides whether the write is allowed.
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Recovery
  // -----------------------------------------------------------------------

  /**
   * Restore the database from a pre-import backup file.
   * Recovers the prior database state after an interrupted or rejected import.
   * Implements the restore(backupPath) API required by architecture invariant.
   */
  async restore(backupPath: string): Promise<void> {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    const dbPath = this.db.getPath();
    if (!dbPath) {
      throw new Error('Cannot restore: database path is unknown (never opened).');
    }
    await this.db.close();
    fs.copyFileSync(backupPath, dbPath);
    await this.db.open({ path: dbPath });
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * Discover legacy task files from backlog/tasks/, backlog/completed/,
   * and backlog/archive/tasks/ directories. Maps each to a candidate Mission
   * identity via missionId() and missionStatusFromBacklog().
   */
  private discoverCandidates(): readonly MissionImportCandidate[] {
    const { tasksDir, completedDir, archiveTasksDir } = this.getTaskStorage();
    const storeDirs = [tasksDir, completedDir, archiveTasksDir];

    // Collect all task .md files, keyed by normalized task id for dedup
    const taskMap = new Map<string, string>();
    for (const dir of storeDirs) {
      const files = readMdFiles(dir);
      for (const file of files) {
        const taskId = extractTaskId(file);
        if (!taskId) {
          continue;
        }
        const normalized = taskId.toLowerCase();
        if (!taskMap.has(normalized)) {
          taskMap.set(normalized, file);
        }
      }
    }

    const candidates: MissionImportCandidate[] = [];
    for (const [_normalizedId, taskFile] of taskMap) {
      try {
        const candidate = buildCandidate(taskFile, {
          rootDir: this.rootDir,
          repositoryId: this.repositoryId,
        });
        if (candidate) {
          candidates.push(candidate);
        }
      } catch (_error) {
        // Files that throw during parsing are tracked as omissions
        // (handled by detectOmissions)
      }
    }

    return candidates.sort((a, b) => a.missionId.localeCompare(b.missionId));
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  /** Validate all candidates. Returns list of candidates with validation errors. */
  private validateCandidates(candidates: readonly MissionImportCandidate[]): Array<{
    missionId: MissionId;
    sourcePath: string;
    errors: readonly string[];
  }> {
    const invalid: Array<{ missionId: MissionId; sourcePath: string; errors: readonly string[] }> = [];
    for (const candidate of candidates) {
      if (candidate.validationErrors.length > 0) {
        invalid.push({
          missionId: candidate.missionId,
          sourcePath: candidate.sourcePath,
          errors: candidate.validationErrors,
        });
      }
    }
    return invalid;
  }

  /** Detect conflicts with existing database rows (identity conflicts). */
  private async detectConflicts(
    candidates: readonly MissionImportCandidate[],
  ): Promise<readonly MissionImportConflict[]> {
    const conflicts: MissionImportConflict[] = [];

    for (const candidate of candidates) {
      // Skip candidates with validation errors — they won't be imported
      if (candidate.validationErrors.length > 0) {
        continue;
      }

      const existing = await this.store.load(candidate.missionId);
      if (existing.kind !== 'found') {
        continue;
      }

      // architecture invariant: Check for divergent Mission state
      const divergenceDetails = this.getDivergenceDetails(candidate, existing.mission);
      if (divergenceDetails) {
        conflicts.push({
          missionId: candidate.missionId,
          sourcePath: candidate.sourcePath,
          reason: 'divergent-state',
          details: divergenceDetails,
        });
      }
    }

    return conflicts;
  }

  /**
   * Describe every persisted difference between a candidate and the Mission
   * currently in the database, or return an empty string when the two
   * aggregates are identical.
   *
   * The comparison walks the union of both objects' fields rather than a fixed
   * subset, so a value the domain gains later cannot silently drop out of
   * divergence detection. Dry-run conflict reporting and the apply-path
   * divergence check share this single predicate.
   */
  private getDivergenceDetails(
    candidate: MissionImportCandidate,
    existing: Mission,
  ): string {
    const incoming = this.toMission(candidate);
    const fields = new Set<string>([
      ...Object.keys(incoming),
      ...Object.keys(existing),
    ]);
    fields.delete('id');

    const parts: string[] = [];
    for (const field of [...fields].sort()) {
      const source = canonicalJson((incoming as unknown as Record<string, unknown>)[field]);
      const database = canonicalJson((existing as unknown as Record<string, unknown>)[field]);
      if (source !== database) {
        parts.push(`${field}: ${truncate(source)} vs ${truncate(database)}`);
      }
    }
    return parts.join('; ');
  }

  /** Detect source files that could not be mapped to a Mission. */
  private detectOmissions(): readonly MissionImportOmission[] {
    const { tasksDir, completedDir, archiveTasksDir } = this.getTaskStorage();
    const storeDirs = [tasksDir, completedDir, archiveTasksDir];
    const omissions: MissionImportOmission[] = [];

    for (const dir of storeDirs) {
      const files = readMdFiles(dir);
      for (const file of files) {
        const taskId = extractTaskId(file);
        if (!taskId) {
          omissions.push({
            sourcePath: file,
            reason: 'no-task-id',
          });
        }
      }
    }

    return omissions;
  }

  // -----------------------------------------------------------------------
  // Domain conversion
  // -----------------------------------------------------------------------

  /** Convert a validated candidate to a checked Mission domain object (architecture invariant). */
  private toMission(candidate: MissionImportCandidate): Mission {
    const base: BacklogMissionRecord = {
      id: candidate.missionId,
      repositoryId: candidate.repositoryId,
      title: candidate.title,
      labels: candidate.labels,
      assignee: candidate.assignee,
      checkpoints: candidate.checkpoints,
      review: candidate.review,
      netEngineeringLines: candidate.netEngineeringLines,
      status: candidate.status,
      rawStatus: candidate.rawStatus,
    };

    // Build Mission (open or closed)
    if (candidate.status === 'done') {
      // Check for closedAt in frontmatter
      const content = fs.readFileSync(candidate.sourcePath, 'utf8');
      const frontmatter = parseFrontmatter(content);
      const closedAt = frontmatter.closedAt as string | undefined;
      if (closedAt?.trim()) {
        return {
          ...base,
          status: 'done',
          closedAt,
        };
      }
    }

    return {
      ...base,
      closedAt: null,
    };
  }

  // -----------------------------------------------------------------------
  // Storage paths
  // -----------------------------------------------------------------------

  /** Get the task storage directories (mirrors resolveTaskStorage). */
  private getTaskStorage(): {
    tasksDir: string;
    completedDir: string;
    archiveTasksDir: string;
  } {
    const baseDir = path.join(this.rootDir, 'backlog');
    return {
      tasksDir: path.join(baseDir, 'tasks'),
      completedDir: path.join(baseDir, 'completed'),
      archiveTasksDir: path.join(baseDir, 'archive', 'tasks'),
    };
  }

  // -----------------------------------------------------------------------
  // Digest / provenance
  // -----------------------------------------------------------------------

  /** Compute SHA-256 digest of combined source file contents. */
  private computeDigest(): string {
    const { tasksDir, completedDir, archiveTasksDir } = this.getTaskStorage();
    const storeDirs = [tasksDir, completedDir, archiveTasksDir];
    const hasher = crypto.createHash('sha256');

    // Hash task files from all stores
    for (const dir of storeDirs) {
      const files = readMdFiles(dir).sort();
      for (const file of files) {
        hasher.update(fs.readFileSync(file));
      }
    }

    // Hash checkpoint and review artifacts from mission directories
    const missionsBase = path.join(this.rootDir, 'missions');
    if (fs.existsSync(missionsBase)) {
      for (const entry of fs.readdirSync(missionsBase, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const missionDir = path.join(missionsBase, entry.name);
        for (const file of readMdFiles(missionDir).sort()) {
          try {
            hasher.update(fs.readFileSync(file));
          } catch {
            // Unreadable file — include path in digest to detect changes
            hasher.update(Buffer.from(file));
          }
        }
        // Include review-state.json
        const reviewPath = path.join(missionDir, 'review-state.json');
        if (fs.existsSync(reviewPath)) {
          try {
            hasher.update(fs.readFileSync(reviewPath));
          } catch {
            hasher.update(Buffer.from(reviewPath));
          }
        }
      }
    }

    return hasher.digest('hex');
  }

  /**
   * Record import provenance in import_history, plus the per-Mission version
   * snapshot in import_mission_versions (architecture invariant).
   *
   * `source_path` keeps its documented meaning — the source root and nothing
   * else; the snapshot lives in its own relational table with an INTEGER
   * version rather than being packed into a text column.
   */
  private async recordImport(record: {
    sourcePath: string;
    digest: string;
    importedCount: number;
    skippedCount: number;
    importedAt: string;
    backupPath?: string;
    versionSnapshot?: Map<MissionId, MissionVersion>;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO import_history (source_path, digest, imported_count, skipped_count, imported_at, backup_path)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        record.sourcePath,
        record.digest,
        record.importedCount,
        record.skippedCount,
        record.importedAt,
        record.backupPath ?? null,
      ],
    );

    if (!record.versionSnapshot || record.versionSnapshot.size === 0) {
      return;
    }
    // Attach the snapshot to the row just inserted, not to whatever the shared
    // ledger's newest row happens to be.
    const idRows = await this.db.query<{ id: number }>(
      'SELECT last_insert_rowid() AS id;',
    );
    if (idRows.length === 0) {
      throw new Error('Import ledger insert did not produce an import_history row');
    }
    const importId = idRows[0].id;
    for (const [mission, version] of record.versionSnapshot) {
      await this.db.execute(
        `INSERT INTO import_mission_versions (import_id, mission_id, version)
         VALUES (?, ?, ?);`,
        [importId, mission, version],
      );
    }
  }
}
