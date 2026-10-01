/**
 * TASK-2577 — regression checks for recurring project test-fixture leaks in
 * `os.tmpdir()`.
 *
 * On 2026-09-25 leaked test scratch directories filled the 16 GiB tmpfs and
 * the agent-smoke gate failed with ENOSPC. The confirmed leaking families and
 * their creators/cleanup owners, with one focused run's residual measured on
 * the parent commit (2026-09-26):
 *
 *   px-measure-*       test/measurement-store-cutover.test.ts (tempDbPath + the
 *                      px-measure-fail- scenario) — closed the store but never
 *                      removed the fixture root; 8 dirs, ~34 MB per run
 *   task-2521.04-*     test/legacy-mission-import.test.ts
 *                      (workspace(), 27 dirs),
 *                      test/task-2521.04-imported-mission-board-path.test.ts
 *                      (workspace(), 3 dirs), and
 *                      test/legacy-import-trace.integration.test.ts
 *                      (1 dir) — raw mkdtempSync, no cleanup owner;
 *                      ~31 dirs, ~4 KB per focused run
 *   qwen-*             test/qwen-telemetry.test.ts, test/qwen-launcher.test.ts
 *                      (qwen-tel-*, qwen-home-test-, qwen-user-,
 *                      qwen-approval-test-, qwen-session-test-,
 *                      qwen-launch-tel-, qwen-launch-notel-) — inline
 *                      mkdtempSync, no cleanup; 26 dirs, ~30 KB per run
 *   px-target-home-*   test/px-runner.test.ts (seedTargetReview) — the seeded
 *                      PARALLIX_HOME was never removed (only target.root);
 *                      4 dirs, ~5 MB per run
 *   task-2339-*        test/task-2339-aggregate-read-during-write.test.ts
 *                      (openStore) and the drain scenario in
 *                      test/task-2339-writes-outlive-close.test.ts — closed the
 *                      database but never removed the fixture root;
 *                      4 dirs, ~5 MB per run. The task-2339-stats- scenario
 *                      already self-cleans and is not a leak; no family
 *                      creates migration backups or other live artifacts.
 *
 * Every check here runs the implicated fixture scenario in a child process
 * under a private TMPDIR, so it observes what a focused run actually leaves
 * on disk and attributes leftovers by construction: every fixture the child
 * creates lands in that directory, so a concurrent worker's live fixture can
 * never be misclassified or removed. It reports the offending prefix when a
 * regression reintroduces the leak.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { mkdtemp } from './helpers/temp-dir.js';
import { cleanupRunnerTempRoots } from './lib/test-runner-temp-roots.js';

const REPO_ROOT = path.join(import.meta.dirname, '..');

const CUTOVER_FILE = path.join('test', 'measurement-store-cutover.test.ts');
const DRAIN_FILE = path.join('test', 'task-2339-writes-outlive-close.test.ts');
const TASK_2521_04_FILES = [
  path.join('test', 'legacy-mission-import.test.ts'),
  path.join('test', 'task-2521.04-imported-mission-board-path.test.ts'),
  path.join('test', 'legacy-import-trace.integration.test.ts'),
] as const;

/** Confirmed leaking family prefixes (see the file header inventory). */
const FIXTURE_PREFIXES = [
  'px-measure-',
  'task-2521.04-',
  'qwen-',
  'px-target-home-',
  'task-2339-',
] as const;

function runChild(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stderr: string }> {
  // node --test refuses to run files inside an inherited test context
  // ("run() is being called recursively ... skipping running files"), so the
  // child gets a clean context: a real focused run, not a skipped one.
  const childEnv = { ...process.env, ...env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('NODE_TEST_')) { delete childEnv[key]; }
  }
  const child: ChildProcess = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`child did not exit within 60s: ${stderr.slice(-500)}`));
    }, 60_000);
    timer.unref();
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`spawn failed: ${error.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

/**
 * Fixture directories under `base` matching any of the given prefixes.
 * Each check runs its child under a private TMPDIR (`base`), so every fixture
 * the child creates lands there: leftovers are attributed by construction,
 * and no other worker's live fixture can be misclassified or removed under
 * concurrent test activity.
 */
function fixtureDirsIn(base: string, prefixes: readonly string[]): string[] {
  let entries: string[];
  try { entries = fs.readdirSync(base); } catch (_) { return []; }
  return entries
    .filter(name => prefixes.some(prefix => name.startsWith(prefix)))
    .filter(name => {
      try { return fs.statSync(path.join(base, name)).isDirectory(); } catch (_) { return false; }
    })
    .map(name => path.join(base, name));
}

/** Roots recorded in the per-worker manifest files under `manifestDir`. */
function manifestRoots(manifestDir: string): string[] {
  const roots = new Set<string>();
  let entries: string[];
  try { entries = fs.readdirSync(manifestDir); } catch (_) { return []; }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) { continue; }
    try {
      const recorded = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8'));
      if (Array.isArray(recorded)) { recorded.forEach(root => roots.add(root)); }
    } catch (_) {}
  }
  return [...roots];
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) { return; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('measurement store fixture leaves no px-measure-* root after teardown', async () => {
  const privateTmp = mkdtemp('task-2577-private-');
  try {
    const { code, stderr } = await runChild([
      '--import', 'tsx',
      '--test',
      '--test-name-pattern=persists an AgentRunMeasurement',
      CUTOVER_FILE,
    ], { TMPDIR: privateTmp });
    assert.equal(code, 0, `focused measurement store scenario must pass: ${stderr.slice(-500)}`);

    const leaked = fixtureDirsIn(privateTmp, ['px-measure-']);
    assert.equal(
      leaked.length,
      0,
      `px-measure-* fixture directories left behind after teardown: ${leaked.join(', ')}`,
    );
  } finally {
    // The repro must not contribute to the leak it detects.
    fs.rmSync(privateTmp, { recursive: true, force: true });
  }
});

test('repeat focused runs of the measurement store family leave zero new px-measure-* dirs', async () => {
  for (let run = 1; run <= 2; run++) {
    const privateTmp = mkdtemp('task-2577-private-');
    try {
      const { code, stderr } = await runChild(['--import', 'tsx', '--test', CUTOVER_FILE], { TMPDIR: privateTmp });
      assert.equal(code, 0, `focused run ${run} of ${CUTOVER_FILE} must pass: ${stderr.slice(-500)}`);
      const leaked = fixtureDirsIn(privateTmp, ['px-measure-']);
      assert.equal(
        leaked.length,
        0,
        `run ${run}: px-measure-* fixture directories left behind: ${leaked.join(', ')}`,
      );
    } finally {
      fs.rmSync(privateTmp, { recursive: true, force: true });
    }
  }
});

test('a focused run of the task-2521.04 family leaves no task-2521.04-* dirs', async () => {
  const privateTmp = mkdtemp('task-2577-private-');
  try {
    const { code, stderr } = await runChild(['--import', 'tsx', '--test', ...TASK_2521_04_FILES], { TMPDIR: privateTmp });
    assert.equal(code, 0, `focused task-2521.04 family run must pass: ${stderr.slice(-500)}`);

    const leaked = fixtureDirsIn(privateTmp, ['task-2521.04-']);
    assert.equal(
      leaked.length,
      0,
      `task-2521.04-* fixture directories left behind after the focused run: ${leaked.join(', ')}`,
    );
  } finally {
    fs.rmSync(privateTmp, { recursive: true, force: true });
  }
});

test('an interrupted child running the task-2339 drain scenario leaves no orphaned fixture dirs', async () => {
  const manifestDir = mkdtemp('task-2577-manifest-');
  const privateTmp = mkdtemp('task-2577-private-');
  const childEnv = { ...process.env, PARALLIX_TEST_MANIFEST_DIR: manifestDir, TMPDIR: privateTmp };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('NODE_TEST_')) { delete childEnv[key]; }
  }
  // Detached so the whole process group (node --test parent + per-file worker)
  // can be SIGKILL'd in one call, exactly like the runner's hang watchdog does.
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    '--test',
    '--test-name-pattern=drain resolves only',
    DRAIN_FILE,
  ], { cwd: REPO_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  try {
    // The shared creator boundary registers the fixture root with the worker
    // manifest synchronously; waiting for it proves the registration the
    // runner-boundary cleanup relies on (absent at the parent commit, which
    // used a raw mkdtempSync and never registered).
    await waitFor(
      () => manifestRoots(manifestDir).some(root => path.basename(root).startsWith('task-2339-drain-')),
      'task-2339-drain- fixture root in the worker manifest',
    );
    process.kill(-child.pid, 'SIGKILL');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => resolve(), 10_000);
      timer.unref();
      child.on('close', () => { clearTimeout(timer); resolve(); });
    });

    // The same runner-boundary cleanup the suite runner performs on exit.
    cleanupRunnerTempRoots(manifestDir);

    const leaked = fixtureDirsIn(privateTmp, FIXTURE_PREFIXES);
    assert.equal(
      leaked.length,
      0,
      `orphaned fixture directories after interrupted child (runner cleanup ran): ${leaked.join(', ')}`,
    );
  } finally {
    try { if (child.pid !== undefined && child.exitCode === null) { process.kill(-child.pid, 'SIGKILL'); } } catch (_) {}
    fs.rmSync(manifestDir, { recursive: true, force: true });
    fs.rmSync(privateTmp, { recursive: true, force: true });
  }
});
