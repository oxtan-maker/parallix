// TASK-2554 guard verification: proves the runner-level default-database
// guard (test/lib/default-db-guard.ts, armed by both test bootstrap preloads)
// fails a test process when the database the process would have resolved by
// default gains mission, board_lane_events, or session_markers rows during
// the run, and stays silent when it does not.
//
// The probe runs the real e2e preload chain (package.json script import flags
// for test:lifecycle-e2e) against a scratch database pointed at by PARALLIX_HOME,
// so the guard under test is the one production test entries actually load.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const executionRoot = path.resolve(
  process.env.PARALLIX_EXECUTION_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
);
const packageJson = JSON.parse(fs.readFileSync(path.join(executionRoot, 'package.json'), 'utf8'));

function e2eImportFlags(scriptName: string): string[] {
  const tokens = String(packageJson.scripts?.[scriptName]).trim().split(/\s+/);
  const flags: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === '--import') { flags.push('--import', tokens[i + 1]); i++; }
    else if (!tokens[i].startsWith('-')) { break; }
  }
  return flags;
}

function makeScratchDb(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2554-guard-home-'));
  const dbPath = path.join(home, 'parallix.db');
  // Minimal guard-surface schema: the guard reads exactly these columns.
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE missions (
      id TEXT PRIMARY KEY NOT NULL,
      repository_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE board_lane_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id TEXT NOT NULL,
      mission_id TEXT
    );
    CREATE TABLE session_markers (
      repository_id TEXT NOT NULL,
      mission_id TEXT,
      session_id TEXT
    );
  `);
  db.close();
  return dbPath;
}

function runProbe(dbPath: string, probeCode: string): { status: number; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [...e2eImportFlags('test:lifecycle-e2e'), '--input-type=module', '-e', probeCode],
    {
      encoding: 'utf8',
      cwd: executionRoot,
      timeout: 30_000,
      env: {
        ...process.env,
        PARALLIX_HOME: path.dirname(dbPath),
        GUARD_TEST_DB: dbPath,
      },
    }
  );
  return { status: result.status ?? -1, stderr: result.stderr ?? '' };
}

/**
 * Run the e2e preload chain with the operator default database living under a
 * scratch HOME (PARALLIX_HOME removed), so the armed guard watches the shared
 * default database — the one a concurrent operator px session would write.
 */
function runSharedDefaultProbe(scratchHome: string, probeCode: string): { status: number; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [...e2eImportFlags('test:lifecycle-e2e'), '--input-type=module', '-e', probeCode],
    {
      encoding: 'utf8',
      cwd: executionRoot,
      timeout: 30_000,
      env: {
        ...process.env,
        HOME: scratchHome,
        PARALLIX_HOME: '',
        GUARD_TEST_DB: path.join(scratchHome, '.local', 'state', 'parallix', 'parallix.db'),
      },
    }
  );
  return { status: result.status ?? -1, stderr: result.stderr ?? '' };
}

test('default-db guard fails the run when the operator database gains mission rows (task-2554)', (t) => {
  const dbPath = makeScratchDb();
  t.after(() => { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); });

  const clean = runProbe(dbPath, 'process.stdout.write("clean")');
  assert.equal(clean.status, 0, `clean probe should pass: ${clean.stderr}`);
  assert.ok(!clean.stderr.includes('default-db-guard'), `clean probe must not trip the guard: ${clean.stderr}`);

  const leak = runProbe(dbPath, `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.env.GUARD_TEST_DB);
    db.exec("INSERT INTO missions (id, repository_id, title, status, version) VALUES ('task-guard-leak', 'guard-leak-repo', 'leak', 'active', 1)");
    db.exec("INSERT INTO board_lane_events (repository_id, mission_id) VALUES ('guard-leak-repo', 'task-guard-leak')");
    db.exec("INSERT INTO session_markers (repository_id, mission_id, session_id) VALUES ('guard-leak-repo', 'task-guard-leak', 's1')");
    db.close();
    process.stdout.write("leaked");
  `);
  assert.equal(leak.status, 1, `leaking probe must exit 1; stderr: ${leak.stderr}`);
  assert.match(leak.stderr, /default-db-guard/);
  assert.match(leak.stderr, /task-guard-leak/);
  assert.match(leak.stderr, /guard-leak-repo/);
});

test('default-db guard warns, not fails, when the shared default database gains rows (task-2554)', (t) => {
  // A concurrent operator px session (sibling worktree, running `px web`) writes
  // the shared default database. All worktrees of one repo share one
  // repository_id, so a gain there cannot be attributed to the test process:
  // the guard must report it as a warning, not fail the run (the flaky
  // integration-suite false positive this guards against).
  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2554-guard-shared-'));
  t.after(() => { fs.rmSync(scratchHome, { recursive: true, force: true }); });
  const defaultDb = path.join(scratchHome, '.local', 'state', 'parallix', 'parallix.db');
  fs.mkdirSync(path.dirname(defaultDb), { recursive: true });
  const db = new DatabaseSync(defaultDb);
  db.exec(`
    CREATE TABLE missions (
      id TEXT PRIMARY KEY NOT NULL,
      repository_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE board_lane_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id TEXT NOT NULL,
      mission_id TEXT
    );
    CREATE TABLE session_markers (
      repository_id TEXT NOT NULL,
      mission_id TEXT,
      session_id TEXT
    );
  `);
  db.close();

  const result = runSharedDefaultProbe(scratchHome, `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.env.GUARD_TEST_DB);
    db.exec("INSERT INTO missions (id, repository_id, title, status, version) VALUES ('shared-default-row', 'parallix', 'op', 'active', 1)");
    db.exec("INSERT INTO board_lane_events (repository_id, mission_id) VALUES ('parallix', 'shared-default-row')");
    db.exec("INSERT INTO session_markers (repository_id, mission_id, session_id) VALUES ('parallix', 'shared-default-row', 's1')");
    db.close();
    process.stdout.write("shared");
  `);
  assert.equal(result.status, 0, `a shared-default gain must not fail the run; stderr: ${result.stderr}`);
  assert.match(result.stderr, /default-db-guard/);
  assert.match(result.stderr, /WARNING/);
  assert.match(result.stderr, /shared-default-row/);
});
