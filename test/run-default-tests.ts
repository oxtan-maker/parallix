import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

let forwardingSignal = false;
function forwardSignal(signal: NodeJS.Signals) {
  if (forwardingSignal) return;
  forwardingSignal = true;
  cleanupRunnerTempRoots(testManifestDir);
  process.exit(signalExitCode(signal));
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

// Measure elapsed time for the suite-level budget check.
const suiteStart = process.hrtime.bigint();
const result = spawnSync(
  testNode,
  nodeArgs,
  {
    stdio: 'inherit',
    cwd: executionRoot,
    env: {
      ...process.env,
      PARALLIX_EXECUTION_ROOT: executionRoot,
      PARALLIX_TEST_MANIFEST_DIR: testManifestDir,
    }
  }
);
const suiteElapsedMs = Number(process.hrtime.bigint() - suiteStart) / 1e6;

if (result.error) {
  throw result.error;
}

if (result.signal) {
  cleanupRunnerTempRoots(testManifestDir);
  process.exit(signalExitCode(result.signal));
}

// Suite-level budget enforcement (unit suite only).
// Compare measured elapsed time against the configured budget.
// If exceeded, the suite fails even if all individual tests passed.
let suiteExceeded = false;
if (!runsIntegrationSuite) {
  const actualBudget = UNIT_TEST_BUDGET_MS;
  console.error(`[unit-test-budget] timeout=${UNIT_TEST_TIMEOUT_MS}ms per test, suite budget=${actualBudget}ms, elapsed=${Math.round(suiteElapsedMs)}ms`);
  if (result.status === 0 && suiteElapsedMs > actualBudget) {
    console.error(`[unit-test-budget] SUITE BUDGET EXCEEDED: ${Math.round(suiteElapsedMs)}ms > ${actualBudget}ms`);
    suiteExceeded = true;
  }
}

// Clean up roots before propagating failure status.
cleanupRunnerTempRoots(testManifestDir);

process.exit(result.status || (suiteExceeded ? 1 : 0));
