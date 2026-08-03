import fs from 'node:fs';
import path from 'node:path';
import { agentFamily } from '../../domain/agents.js';
import type { AgentFamily } from '../../domain/agents.js';
import { missionId } from '../../domain/mission.js';
import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import { ConcreteGitReadAdapter } from '../backlog/concrete-git-read-adapter.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteSessionMarkerRepository } from './session-marker-repository.js';
import type { SessionMarkerEntry, SessionMarkerWrite } from '../../application/ports/mission-store.js';

// ---------------------------------------------------------------------------
// Types for import results
// ---------------------------------------------------------------------------

/** A single file-based session marker parsed from `.workflow/sessions/`. */
export interface FileSessionMarker {
  /** Mission slug extracted from filename. */
  readonly missionId: MissionId;
  /** Role extracted from filename. */
  readonly role: string;
  /** Agent family from file body. */
  readonly agent: AgentFamily;
  /** Last-launched timestamp from file body (or current time if missing). */
  readonly lastLaunched: string;
  /** Provider session ID from file body (or null). */
  readonly sessionId: string | null;
  /** Absolute path of the source file. */
  readonly sourcePath: string;
}

/** A conflict between a file marker and an existing database marker. */
export interface ImportConflict {
  /** The (missionId, role) pair in conflict. */
  readonly missionId: string;
  readonly role: string;
  /** The marker currently in the database. */
  readonly database: SessionMarkerEntry;
  /** The marker read from the worktree file. */
  readonly file: FileSessionMarker;
  /** Reason for the conflict. */
  readonly reason: 'db-newer' | 'db-exists' | 'unknown-role';
}

/** A single import entry (successfully imported marker). */
export interface ImportEntry {
  readonly missionId: string;
  readonly role: string;
  readonly sourcePath: string;
}

/** The complete result of an import operation. */
export interface ImportResult {
  /** Markers successfully imported (or would be in dry-run). */
  readonly imported: readonly ImportEntry[];
  /** Conflicts detected (database has marker, file differs). */
  readonly conflicts: readonly ImportConflict[];
  /** Files skipped due to unknown role names. */
  readonly skippedUnknownRole: readonly FileSessionMarker[];
  /** Total number of .json files examined. */
  readonly filesExamined: number;
  /** Whether the import was a dry-run (no writes). */
  readonly dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Known roles that the database schema accepts
// ---------------------------------------------------------------------------

const KNOWN_ROLES = new Set(['execute', 'draft', 'review']);

// ---------------------------------------------------------------------------
// Filename parsing: `<slug>-<role>.json`
// ---------------------------------------------------------------------------

/**
 * Parse a session filename into (slug, role) components.
 * Returns null if the filename does not match the `<slug>-<role>.json` pattern.
 *
 * The slug is everything before the last hyphen-separated role token.
 * Known roles: execute, draft, review.
 */
function parseSessionFilename(filename: string): { slug: string; role: string } | null {
  if (!filename.endsWith('.json')) {
    return null;
  }
  const base = filename.slice(0, -5); // remove .json
  const lastHyphen = base.lastIndexOf('-');
  if (lastHyphen < 1) {
    return null; // need at least one char for slug and one for role
  }
  return {
    slug: base.slice(0, lastHyphen),
    role: base.slice(lastHyphen + 1),
  };
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

/**
 * Read and parse a single `.workflow/sessions/<slug>-<role>.json` file.
 * Returns null if the file is missing, malformed, or has no agent field.
 */
function readSessionFile(dirPath: string, filename: string): FileSessionMarker | null {
  const parsed = parseSessionFilename(filename);
  if (!parsed) {
    return null;
  }

  const filePath = path.join(dirPath, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const body = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!body || typeof body.agent !== 'string') {
      return null;
    }
    const lastLaunched = body.lastLaunched ?? new Date().toISOString();
    if (
      typeof lastLaunched !== 'string'
      || !Number.isFinite(Date.parse(lastLaunched))
      || (body.sessionId !== null
        && body.sessionId !== undefined
        && typeof body.sessionId !== 'string')
    ) {
      return null;
    }
    return {
      missionId: missionId(parsed.slug),
      role: parsed.role,
      agent: agentFamily(body.agent),
      lastLaunched,
      sessionId: body.sessionId ?? null,
      sourcePath: filePath,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core import logic
// ---------------------------------------------------------------------------

/**
 * Discover all session marker files in `.workflow/sessions/` directory.
 */
function discoverSessionFiles(worktree: string): FileSessionMarker[] {
  const sessionsDir = path.join(worktree, '.workflow', 'sessions');
  if (!fs.existsSync(sessionsDir) || !fs.statSync(sessionsDir).isDirectory()) {
    return [];
  }

  const markers: FileSessionMarker[] = [];
  for (const filename of fs.readdirSync(sessionsDir)) {
    const marker = readSessionFile(sessionsDir, filename);
    if (marker) {
      markers.push(marker);
    }
  }
  return markers;
}

/**
 * Import session markers from `.workflow/sessions/` files into the SQLite database.
 *
 * Supports two modes:
 * - **dry-run** (`dryRun: true`): scans files, detects conflicts, returns report without writing.
 * - **atomic commit** (`dryRun: false`): all-or-nothing transaction — either all
 *   importable markers are written or none are (rollback on any failure).
 *
 * Conflict detection:
 * - If the database already has a marker for the same (missionId, role), compare
 *   `updated_at` (database) vs `lastLaunched` (file). If the database marker is
 *   newer (has a later timestamp), report as `db-newer` conflict. Otherwise report
 *   as `db-exists` conflict. In both cases, neither side is overwritten.
 * - If the file's role is not in the known set (`execute`, `draft`, `review`),
 *   report as `unknown-role` conflict and skip the file.
 *
 * Source `.workflow/sessions/` files are never modified or deleted by this function.
 *
 * @param db - Open SQLite database adapter (must have session_markers table)
 * @param worktree - Root of the worktree containing `.workflow/sessions/`
 * @param options - Import options
 * @returns ImportResult with imported entries, conflicts, and skipped files
 */
export async function importSessionMarkers(
  db: SqliteDatabaseAdapter,
  worktree: string,
  options: {
    readonly dryRun?: boolean;
    readonly repositoryId?: RepositoryId;
  } = {},
): Promise<ImportResult> {
  const dryRun = options.dryRun === true;
  const owningRepositoryId = options.repositoryId
    ?? await new ConcreteGitReadAdapter({ rootDir: worktree }).loadRepositoryId();
  const repo = new SqliteSessionMarkerRepository(db, owningRepositoryId);

  // Discover all file-based markers
  const fileMarkers = discoverSessionFiles(worktree);
  const filesExamined = fileMarkers.length;

  const imported: ImportEntry[] = [];
  const conflicts: ImportConflict[] = [];
  const skippedUnknownRole: FileSessionMarker[] = [];

  // Separate into importable and conflicting
  const toImport: FileSessionMarker[] = [];

  for (const file of fileMarkers) {
    // Check for unknown role
    if (!KNOWN_ROLES.has(file.role)) {
      skippedUnknownRole.push(file);
      continue;
    }

    // Check for database conflict
    const existing = await repo.findByMissionAndRole(
      file.missionId,
      file.role as SessionMarkerEntry['role'],
    );
    if (existing !== undefined) {
      // Conflict: database has a marker for this (missionId, role)
      const dbTs = new Date(existing.updatedAt).getTime();
      const fileTs = new Date(file.lastLaunched).getTime();
      const reason = dbTs > fileTs ? 'db-newer' : 'db-exists';

      conflicts.push({
        missionId: file.missionId,
        role: file.role,
        database: existing,
        file,
        reason,
      });
      continue;
    }

    toImport.push(file);
  }

  if (dryRun) {
    // Dry-run: report what would be imported without writing
    for (const file of toImport) {
      imported.push({
        missionId: file.missionId,
        role: file.role,
        sourcePath: file.sourcePath,
      });
    }
    return {
      imported: Object.freeze(imported),
      conflicts: Object.freeze(conflicts),
      skippedUnknownRole: Object.freeze(skippedUnknownRole),
      filesExamined,
      dryRun: true,
    };
  }

  // Atomic commit: all-or-nothing transaction
  await db.beginTransaction();
  try {
    for (const file of toImport) {
      const entry: SessionMarkerWrite = {
        missionId: file.missionId,
        role: file.role as SessionMarkerEntry['role'],
        agent: file.agent,
        lastLaunched: file.lastLaunched,
        sessionId: file.sessionId,
      };
      await repo.save(entry);
      imported.push({
        missionId: file.missionId,
        role: file.role,
        sourcePath: file.sourcePath,
      });
    }
    await db.commitTransaction();
  } catch (error) {
    await db.rollbackTransaction();
    throw new Error(
      `Session marker import failed and was rolled back: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  return {
    imported: Object.freeze(imported),
    conflicts: Object.freeze(conflicts),
    skippedUnknownRole: Object.freeze(skippedUnknownRole),
    filesExamined,
    dryRun: false,
  };
}
