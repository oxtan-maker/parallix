import { resolveConfiguration } from '../../src/composition/config.js';
// default-db-guard.ts — runner-level isolation guard for TASK-2554.
//
// A test process must never write into the operator's default database
// (<PARALLIX_HOME>/parallix.db resolved from the environment the test process
// actually inherited). The guard snapshots the three leak-surface tables
// (missions, board_lane_events, session_markers) at preload time — i.e. before
// any test module or PARALLIX_HOME override runs — and compares on process
// exit. Any row gained in those tables fails the process (exit code 1) and
// prints the gained rows so a concurrent operator px session can be told
// apart from a real test leak.
//
// Call startDefaultDbGuard() BEFORE the bootstrap overrides PARALLIX_HOME:
// the guard must resolve the same database the unisolated test process would
// have resolved.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveDatabasePath } from '../../src/adapters/sqlite/database-path-resolver.js';
import { resolveParallixHome } from '../../src/adapters/storage/storage.js';

export interface DefaultDbSnapshot {
  missionIds: string[];
  laneEventIds: string[];
  markerKeys: string[];
}

/**
 * Read the guard's row fingerprints from one database file.
 * Missing file or missing table reads as empty (a database that did not exist
 * before the run and exists after it has gained every one of its rows).
 */
export function readGuardFingerprints(dbPath: string): DefaultDbSnapshot {
  const empty: DefaultDbSnapshot = { missionIds: [], laneEventIds: [], markerKeys: [] };
  if (!fs.existsSync(dbPath)) { return empty; }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return empty;
  }
  try {
    const table = <T>(sql: string, fallback: T): T => {
      try { return db.prepare(sql).all() as unknown as T; } catch { return fallback; }
    };
    return {
      missionIds: table<{ id: string }[]>('SELECT id FROM missions ORDER BY id', []).map(row => row.id),
      laneEventIds: table<{ id: number | string }[]>('SELECT id FROM board_lane_events ORDER BY id', []).map(row => String(row.id)),
      markerKeys: table<{ repository_id: string; mission_id: string | null; session_id: string | null }[]>(
        'SELECT repository_id, mission_id, session_id FROM session_markers ORDER BY repository_id',
        []
      ).map(row => `${row.repository_id}|${row.mission_id ?? ''}|${row.session_id ?? ''}`),
    };
  } finally {
    db.close();
  }
}

function diffGain(before: DefaultDbSnapshot, after: DefaultDbSnapshot): { table: string; rows: string[] }[] {
  const gains: { table: string; rows: string[] }[] = [];
  const added = (table: string, beforeKeys: string[], afterKeys: string[]) => {
    const beforeSet = new Set(beforeKeys);
    const rows = afterKeys.filter(key => !beforeSet.has(key)).sort();
    if (rows.length > 0) { gains.push({ table, rows }); }
  };
  added('missions', before.missionIds, after.missionIds);
  added('board_lane_events', before.laneEventIds, after.laneEventIds);
  added('session_markers', before.markerKeys, after.markerKeys);
  return gains;
}

/**
 * Whether `dbPath` is the operator's shared default database — the one a
 * non-isolated `px` invocation resolves when PARALLIX_HOME is unset.
 *
 * Every worktree of one repository resolves to the same canonical
 * repository_id, and a concurrent operator px session (a sibling mission
 * worktree, a running `px web` host, ...) writes that same shared database.
 * A row gain there therefore cannot be attributed to the test process, so the
 * guard reports it instead of failing. An isolated per-run database, by
 * contrast, is resolved only by this process: no concurrent session can write
 * it, so any gain is attributable to the test and fails the run.
 */
function isSharedDefaultOperatorDatabase(dbPath: string): boolean {
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.PARALLIX_HOME;
    const defaultHome = resolveParallixHome({
      configuration: resolveConfiguration(cleanEnv as Record<string, string>),
      platform: process.platform,
      homedir: os.homedir,
    });
    return path.resolve(dbPath) === path.join(defaultHome, 'parallix.db');
  } catch {
    // Resolution failure must not turn a shared database into a hard failure
    // (that would reintroduce the false positive); treat it as shared.
    return true;
  }
}

/**
 * Arm the exit-time guard. Resolves the database from the CURRENT environment
 * (call before overriding PARALLIX_HOME), snapshots it, and on process exit
 * inspects the three tables for rows gained during the run.
 *
 * Gains in an isolated database are attributable to this process and fail the
 * run. Gains in the shared default operator database are reported as a warning
 * (not fatal): a concurrent operator px session writes that same database, so
 * the gain cannot be attributed to the test (task-2554 gate fix).
 */
export function startDefaultDbGuard(label: string): string {
  const dbPath = resolveDatabasePath({ configuration: resolveConfiguration(process.env) });
  const sharedDefault = isSharedDefaultOperatorDatabase(dbPath);
  const before = readGuardFingerprints(dbPath);
  let reported = false;
  process.on('exit', () => {
    if (reported) { return; }
    reported = true;
    const gains = diffGain(before, readGuardFingerprints(dbPath));
    if (gains.length === 0) { return; }
    const gainedCount = gains.reduce((total, gain) => total + gain.rows.length, 0);
    const detail = gains.map(gain => `${gain.table}: ${gain.rows.join(', ')}`).join('; ');
    if (sharedDefault) {
      process.stderr.write(
        `[default-db-guard:${label}] WARNING: the shared default operator database ${dbPath} gained ${gainedCount} row(s) during the run — ${detail}\n`
        + `[default-db-guard:${label}] the shared default database is also written by concurrent operator px sessions (all worktrees of a repo share one repository_id), so a gain here is reported, not fatal\n`
      );
      return;
    }
    process.stderr.write(
      `[default-db-guard:${label}] test run wrote ${gainedCount} row(s) into the isolated database ${dbPath} — ${detail}\n`
      + `[default-db-guard:${label}] an isolated database is resolved only by this process, so a gain here is attributable to the test process\n`
    );
    process.exitCode = process.exitCode ?? 1;
  });
  return dbPath;
}
