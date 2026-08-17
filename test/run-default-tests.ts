import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTestRunPlan } from './lib/test-run-plan.js';
import { defaultManifestDir, ensureManifestDir, recoverRecordedTempRoots } from '../src/adapters/verification/temp-root-registry.js';
import { cleanupRunnerTempRoots, signalExitCode } from './lib/test-runner-temp-roots.js';

// A verifier may be launched from an operator checkout while it is validating
// a mission worktree. Capture that selected root once and use it for every
// build, test discovery, and nested Node process.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executionRoot = path.resolve(process.env.PARALLIX_EXECUTION_ROOT || path.join(__dirname, '..'));
const testRoot = path.join(executionRoot, 'test');
if (!fs.existsSync(path.join(executionRoot, 'package.json')) || !fs.existsSync(testRoot)) {
  throw new Error(`PARALLIX_EXECUTION_ROOT is not a Parallix checkout: ${executionRoot}`);
}

const plan = buildTestRunPlan({ executionRoot, requestedArgs: process.argv.slice(2) });
const { testNode, nodeArgs, runsIntegrationSuite } = plan;
const UNIT_TEST_BUDGET_MS = plan.unitTestBudgetMs; // PARALLIX_UNIT_TEST_BUDGET_MS
const UNIT_TEST_TIMEOUT_MS = 30_000;
const testTimeoutArgs = runsIntegrationSuite ? [] : ['--test-timeout=' + UNIT_TEST_TIMEOUT_MS];

// Build the canonical bundle before every suite so a direct runner invocation
// also catches bundle regressions in the current checkout.
const buildResult = spawnSync('npm', ['run', 'build'], { cwd: executionRoot, stdio: 'inherit' });
if (buildResult.error) {
  throw buildResult.error;
}
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

// Unit tests import production modules directly from `src/` and replace
// dependencies through the ESM-native seam in `test/lib/module-mock.ts`
// (node:test module mocking). There is no transpiled compatibility tree.


// Per-worker manifest directory for SIGKILL orphan cleanup.
// The runner creates a PID-scoped directory and passes its path to the child
// process via PARALLIX_TEST_MANIFEST_DIR. Each worker (including the main child
// process) writes its own <worker-PID>.json file inside the directory, so
// concurrent workers do not overwrite each other's root lists (task-2326 round 5).
// After the suite completes, the runner reads all files and unions the roots.
const tempManifestDir = ensureManifestDir(defaultManifestDir());
const testManifestDir = path.join(tempManifestDir, `test-run-${process.pid}`);
recoverRecordedTempRoots({ manifestDir: tempManifestDir });
fs.mkdirSync(testManifestDir, { recursive: true });

// The suite runs in its own process group (detached) so the watchdog and the
// signal handler can terminate the whole tree — node --test, its per-file
// workers, and their spawned git/tsx children — with one call. Terminating
// only the node --test parent is not enough: it exits without killing its
// own workers, which leak forever once a test file holds a handle. If this
// runner itself is killed abnormally the detached suite outlives it; that is
// acceptable because healthy workers self-clean their temp roots on exit and
// finish their file, and a worker that would hang is exactly the case the
// watchdog turns into a loud failure.
const child = spawn(testNode, nodeArgs, {
  stdio: 'inherit',
  cwd: executionRoot,
  env: {
    ...process.env,
    PARALLIX_EXECUTION_ROOT: executionRoot,
    PARALLIX_TEST_MANIFEST_DIR: testManifestDir,
  },
  detached: process.platform !== 'win32'
});

function killSuite(signal: NodeJS.Signals) {
  try {
    if (process.platform === 'win32' || child.pid === undefined) {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (_) {
    // The suite may already be gone.
  }
}

// Without `--test-force-exit` a test file that leaks a handle (uncleared
// timer, unclosed socket) keeps its worker alive forever and node --test
// waits for that file indefinitely. The watchdog terminates the group and
// fails the suite loudly instead of hanging the gate. Healthy runs finish
// well under this bound (observed: < 5 min for the full integration suite).
const SUITE_HANG_TIMEOUT_MS = Number(process.env.PARALLIX_SUITE_HANG_TIMEOUT_MS) || 10 * 60 * 1000;
let suiteSettled = false;
let exitCodeAfterKill = 1;
const watchdog = setTimeout(() => {
  if (suiteSettled) { return; }
  console.error(`[suite-watchdog] test suite did not finish within ${Math.round(SUITE_HANG_TIMEOUT_MS / 1000)}s; killing the test process group (a test file likely leaked a handle)`);
  killSuite('SIGTERM');
  setTimeout(() => killSuite('SIGKILL'), 5000).unref();
}, SUITE_HANG_TIMEOUT_MS);
watchdog.unref();

let forwardingSignal = false;
function forwardSignal(signal: NodeJS.Signals) {
  if (forwardingSignal) { return; }
  forwardingSignal = true;
  exitCodeAfterKill = signalExitCode(signal);
  killSuite('SIGTERM');
  setTimeout(() => killSuite('SIGKILL'), 5000).unref();
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

// Measure elapsed time for the suite-level budget check.
const suiteStart = process.hrtime.bigint();
child.on('error', (error) => {
  if (suiteSettled) { return; }
  suiteSettled = true;
  clearTimeout(watchdog);
  cleanupRunnerTempRoots(testManifestDir);
  throw error;
});
child.on('close', (code, signal) => {
  if (suiteSettled) { return; }
  suiteSettled = true;
  clearTimeout(watchdog);
  const suiteElapsedMs = Number(process.hrtime.bigint() - suiteStart) / 1e6;

  if (signal !== null) {
    // The group was terminated by the watchdog or a forwarded signal; a
    // terminated suite is a failed suite.
    cleanupRunnerTempRoots(testManifestDir);
    process.exit(exitCodeAfterKill);
  }

  // Suite-level budget enforcement (unit suite only).
  // Compare measured elapsed time against the configured budget.
  // If exceeded, the suite fails even if all individual tests passed.
  let suiteExceeded = false;
  if (!runsIntegrationSuite) {
    const actualBudget = UNIT_TEST_BUDGET_MS;
    console.error(`[unit-test-budget] timeout=${UNIT_TEST_TIMEOUT_MS}ms per test, suite budget=${actualBudget}ms, elapsed=${Math.round(suiteElapsedMs)}ms`);
    if (code === 0 && suiteElapsedMs > actualBudget) {
      console.error(`[unit-test-budget] SUITE BUDGET EXCEEDED: ${Math.round(suiteElapsedMs)}ms > ${actualBudget}ms`);
      suiteExceeded = true;
    }
  }

  // Clean up roots before propagating failure status.
  cleanupRunnerTempRoots(testManifestDir);

  process.exit((code ?? 0) || (suiteExceeded ? 1 : 0));
});
