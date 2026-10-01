// task-2554-fixture-cleanup.ts — explicit, backed-up removal of the fixture
// rows that leaked into the operator database (TASK-2554).
//
// Usage:
//   tsx scripts/task-2554-fixture-cleanup.ts            # backup + remove + verify
//   tsx scripts/task-2554-fixture-cleanup.ts --dry-run  # list, change nothing
//
// Idempotent: when no fixture rows remain the script reports nothing to do and
// exits 0. It removes ONLY rows whose repository id is one of the fixture
// repository ids below (and the child rows of the missions that own them);
// operator data is never touched. Every removal is preceded by an
// integrity-checked backup in the same state directory.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { resolveParallixHome } from '../src/adapters/storage/storage.js';

// The fixture repository ids are the throwaway tmp-dir / worktree names the
// test fixtures created (mkdtemp prefixes or draft worktree names). Sources:
//   handoff-fallback-, nel-capture-, nel-capture-fail-, nel-capture-bucket- → test/handoff.test.ts
//   px-board-test-                                                          → test/adapters/board-projection-builder-cp3.test.ts
//   workflow-stats-fixture-                                                 → test/stats.test.ts
//   parallix-pty-ui-fixture-                                                → test/tui-pty-smoke.test.ts
//   parallix-tui-spawn-                                                     → test/tui-spawn.test.ts
//   main-task-1038 (worktree name)                                          → test/draft-command-boundary-contract.test.ts
//   main-task-fail, main-task-fix, parallix-first-value-*, task-1209-consume-,
//   adhoc-create-a-hello-world-program, repo                                → earlier fixture runs (same tmp-dir naming scheme)
const FIXTURE_REPOS = [
  'parallix-pty-ui-fixture-HiHkpE',
  'adhoc-create-a-hello-world-program',
  'handoff-fallback-umHnJC',
  'main-task-1038',
  'main-task-fail',
  'main-task-fix',
  'nel-capture-bucket-aimXQW',
  'nel-capture-fail-OnhTTe',
  'parallix-first-value-HRQT6O',
  'parallix-first-value-t82xoq',
  'parallix-tui-spawn-HdPi72',
  'px-board-test-QjzERN',
  'px-board-test-TYqTWw',
  'repo',
  'task-1209-consume-2aRwPD',
  'workflow-stats-fixture-BkHis6',
  'workflow-stats-fixture-sFXiau',
];

const CHILD_TABLES_BY_MISSION = [
  'mission_briefs',
  'mission_checkpoints',
  'mission_checkpoint_goal_checks',
  'mission_success_criteria',
  'mission_brief_out_of_scope',
  'mission_external_task_refs',
  'mission_labels',
  'mission_dependencies',
  'mission_execution_contexts',
  'mission_execution_context_items',
  'mission_review_rounds',
  'mission_reviews',
  'mission_review_events',
  'mission_review_findings',
  'mission_review_resolutions',
  'mission_review_stage_launches',
  'mission_declared_gates',
];

const dryRun = process.argv.includes('--dry-run');
const home = resolveParallixHome({ ensureDir: false });
const dbPath = path.join(home, 'parallix.db');
if (!fs.existsSync(dbPath)) {
  console.log(`No operator database at ${dbPath}; nothing to do.`);
  process.exit(0);
}

const db = new DatabaseSync(dbPath, { readOnly: dryRun });
const ph = FIXTURE_REPOS.map(() => '?').join(',');
const fixtureMissions = db.prepare(`SELECT id FROM missions WHERE repository_id IN (${ph})`).all(...FIXTURE_REPOS)
  .map((row: { id: string }) => row.id);

function count(table: string, clause: string, params: (string | number | null)[]): number | null {
  try { return (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${clause}`).get(...params) as { c: number }).c; }
  catch { return null; }
}

const scope = {
  missions: count('missions', `repository_id IN (${ph})`, FIXTURE_REPOS),
  board_lane_events: count('board_lane_events', `repository_id IN (${ph})`, FIXTURE_REPOS),
  session_markers: count('session_markers', `repository_id IN (${ph})`, FIXTURE_REPOS),
  usage_statistics: count('usage_statistics', `repo IN (${ph})`, FIXTURE_REPOS),
  known_repositories: count('known_repositories', `repository_id IN (${ph})`, FIXTURE_REPOS),
};
console.log(`Operator database: ${dbPath}`);
console.log(`Fixture repository ids: ${FIXTURE_REPOS.length}; fixture mission ids: ${fixtureMissions.length}`);
console.log(`Rows in scope: missions=${scope.missions}, board_lane_events=${scope.board_lane_events}, session_markers=${scope.session_markers}, usage_statistics=${scope.usage_statistics}, known_repositories=${scope.known_repositories ?? 'n/a'}`);

const total = Object.values(scope).reduce((sum, value) => sum + (value ?? 0), 0);
if (total === 0) {
  console.log('No fixture rows remain; nothing to do.');
  db.close();
  process.exit(0);
}

if (dryRun) {
  console.log('Dry run: no changes made.');
  for (const mission of fixtureMissions) {
    for (const table of CHILD_TABLES_BY_MISSION) {
      const c = count(table, 'mission_id = ?', [mission]);
      if (c && c > 0) { console.log(`  ${table}: ${mission} (${c} row(s))`); }
    }
  }
  db.close();
  process.exit(0);
}

// ---- integrity-checked backup before any mutation ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(home, `parallix.db.bak-${stamp}-task-2554`);
const sqlite3 = spawnSync('sqlite3', [dbPath, `.backup '${backupPath}'`], { encoding: 'utf8' });
if (sqlite3.status !== 0 || !fs.existsSync(backupPath)) {
  // Fallback: raw copy of the database file and its live WAL/SHM sidecars.
  fs.copyFileSync(dbPath, backupPath);
  for (const sidecar of ['wal', 'shm']) {
    if (fs.existsSync(`${dbPath}-${sidecar}`)) { fs.copyFileSync(`${dbPath}-${sidecar}`, `${backupPath}-${sidecar}`); }
  }
  console.log(`Backup via file copy (sqlite3 CLI unavailable): ${backupPath}`);
} else {
  console.log(`Backup via sqlite3 .backup: ${backupPath}`);
}
const backupDb = new DatabaseSync(backupPath, { readOnly: true });
const integrity = backupDb.prepare('PRAGMA integrity_check').all().map((row: Record<string, string>) => Object.values(row)[0]);
backupDb.close();
if (integrity.length !== 1 || integrity[0] !== 'ok') {
  console.error(`Backup integrity check FAILED: ${integrity.join(', ')} — aborting, no rows removed.`);
  process.exit(1);
}
console.log('Backup integrity check: ok');

// ---- remove only the fixture-scoped rows in one transaction ----
const missionPh = fixtureMissions.map(() => '?').join(',');
const childTotals: string[] = [];
db.exec('BEGIN');
try {
  for (const table of CHILD_TABLES_BY_MISSION) {
    const result = db.prepare(`DELETE FROM ${table} WHERE mission_id IN (${missionPh})`).run(...fixtureMissions);
    if (result.changes > 0) { childTotals.push(`${table}=${result.changes}`); }
  }
  const deleted = (sql: string, params: (string | number | null)[]) => db.prepare(sql).run(...params).changes;
  const removed = {
    missions: deleted(`DELETE FROM missions WHERE repository_id IN (${ph})`, FIXTURE_REPOS),
    board_lane_events: deleted(`DELETE FROM board_lane_events WHERE repository_id IN (${ph})`, FIXTURE_REPOS),
    session_markers: deleted(`DELETE FROM session_markers WHERE repository_id IN (${ph})`, FIXTURE_REPOS),
    usage_statistics: deleted(`DELETE FROM usage_statistics WHERE repo IN (${ph})`, FIXTURE_REPOS),
    known_repositories: scope.known_repositories === null ? 0 : deleted(`DELETE FROM known_repositories WHERE repository_id IN (${ph})`, FIXTURE_REPOS),
  };
  db.exec('COMMIT');
  console.log(`Removed: missions=${removed.missions}, board_lane_events=${removed.board_lane_events}, session_markers=${removed.session_markers}, usage_statistics=${removed.usage_statistics}, known_repositories=${removed.known_repositories}${childTotals.length ? ', child rows: ' + childTotals.join(', ') : ''}`);
} catch (error) {
  db.exec('ROLLBACK');
  console.error(`Removal failed, transaction rolled back: ${error}`);
  process.exit(1);
}

// ---- verify the scope is empty ----
const remaining = count('missions', `repository_id IN (${ph})`, FIXTURE_REPOS);
if (remaining !== 0) {
  console.error(`Verification failed: ${remaining} fixture mission row(s) remain.`);
  process.exit(1);
}
console.log('Verification: 0 fixture rows remain. Backup: ' + backupPath);
db.close();
