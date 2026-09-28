import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTestRunPlan, withCoverageReporters } from './lib/test-run-plan.js';
import { defaultManifestDir, ensureManifestDir, recoverRecordedTempRoots } from '../src/adapters/verification/temp-root-registry.js';
import { cleanupRunnerTempRoots, signalExitCode } from './lib/test-runner-temp-roots.js';
import { onGitHubActions } from './lib/unit-test-budget-reporter.mjs';
import { resolveFileTimingProfile, printFileTimingSummary } from './lib/file-timing-profile.js';
import { PROFILE_ENV } from './lib/file-timing-reporter.js';

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
const { testNode, nodeArgs, runsIntegrationSuite, runsIntegrationCiSuite, unitTestHeadroomMs } = plan;
const UNIT_TEST_BUDGET_MS = plan.unitTestBudgetMs; // PARALLIX_UNIT_TEST_BUDGET_MS
const UNIT_TEST_TIMEOUT_MS = plan.unitTestTimeoutMs;
// V8 instrumentation is intentionally enabled for the one unit execution in
// pre-integration. It makes the complete suite materially slower without
// relaxing the per-test timeout or headroom contracts below.
const COVERAGE_UNIT_TEST_SUITE_BUDGET_MS = 300_000;

// TASK-2547: coverage is a reporting mode of the CI-safe execution, not a
// second test pass. When PARALLIX_TEST_COVERAGE is set (GitHub ci-required or
// the local pre-integration gates),
// enable Node's built-in coverage and emit one lcov per tier so `npm run
// coverage:merge` can union them. Unit and integration-ci stay separate Node
// invocations (their execution semantics require it) but each selected test
// still runs at most once; the two fragments are merged with LCOV semantics.
const coverageEnabled = process.env.PARALLIX_TEST_COVERAGE === '1'
  || process.env.PARALLIX_TEST_COVERAGE === 'true';
const coverageDestination = runsIntegrationCiSuite
  ? path.join(executionRoot, 'coverage', '.lcov-integration-ci.info')
  : path.join(executionRoot, 'coverage', '.lcov-unit.info');
const coverageTier = runsIntegrationCiSuite ? 'integration-ci' : 'unit';
// The unit and integration-ci gates may run concurrently. Give each invocation
// a unique repo-local V8 payload directory; the LCOV destinations above remain
// the deliberate per-tier hand-off consumed by coverage:merge.
let coverageScratchDir: string | null = null;
if (coverageEnabled) {
  fs.mkdirSync(path.join(executionRoot, 'tmp'), { recursive: true });
  coverageScratchDir = fs.mkdtempSync(path.join(executionRoot, 'tmp', `coverage-v8-${coverageTier}-`));
}
const nodeArgsWithCoverage = coverageEnabled
  ? withCoverageReporters(nodeArgs, coverageDestination)
  : nodeArgs;
if (coverageEnabled) {
  fs.mkdirSync(path.dirname(coverageDestination), { recursive: true });
}
// TASK-2590: opt-in per-file wall-time profile (PARALLIX_TEST_PROFILE). When
// unset the argv above is used unchanged.
const fileTimingProfile = resolveFileTimingProfile({
  executionRoot,
  requestedArgs: process.argv.slice(2),
  nodeArgs: nodeArgsWithCoverage,
});
const suiteNodeArgs = fileTimingProfile?.nodeArgs ?? nodeArgsWithCoverage;

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
const child = spawn(testNode, suiteNodeArgs, {
  stdio: ['inherit', 'pipe', 'pipe'],
  cwd: executionRoot,
  env: {
    ...process.env,
    // Coverage is a reporting profile for the pre-integration population.
    // Its instrumentation timing is not a hermetic per-test performance
    // measurement; ordinary unit runs retain the explicit 500 ms headroom.
    ...(unitTestHeadroomMs === null || coverageEnabled ? {} : { PARALLIX_UNIT_TEST_HEADROOM: '1' }),
    PARALLIX_EXECUTION_ROOT: executionRoot,
    PARALLIX_TEST_MANIFEST_DIR: testManifestDir,
    // V8 coverage payload lives repo-locally (not the shared tmpfs) so the
    // per-tier fragments survive into the coverage:merge step.
    ...(coverageScratchDir ? { NODE_V8_COVERAGE: coverageScratchDir } : {}),
    // The profile belongs to this invocation only: runners that tests spawn as
    // fixtures keep their unprofiled argv and write no profile of their own.
    ...(fileTimingProfile ? { ...fileTimingProfile.env, [PROFILE_ENV]: '' } : {}),
  },
  detached: process.platform !== 'win32'
});
let unitTestExceeded = false;
let reporterOutput = '';
child.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (!runsIntegrationSuite) {
    reporterOutput = (reporterOutput + chunk.toString()).slice(-4096);
    unitTestExceeded ||= reporterOutput.includes('[unit-test-budget:exceeded]')
      || reporterOutput.includes('[unit-test-budget:headroom]');
  }
});
child.stderr.pipe(process.stderr);

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
  if (coverageScratchDir) { fs.rmSync(coverageScratchDir, { recursive: true, force: true }); }
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
  // On GitHub-hosted runners the suite-level budget is disabled: runner
  // speed is uncontrollable, so the suite must not fail on the timing gate
  // there. Local runs keep enforcing it. Gated independently of the reporter
  // (task-2531).
  if (!runsIntegrationSuite && !onGitHubActions()) {
    const actualBudget = coverageEnabled ? COVERAGE_UNIT_TEST_SUITE_BUDGET_MS : UNIT_TEST_BUDGET_MS;
    console.error(`[unit-test-budget] timeout=${UNIT_TEST_TIMEOUT_MS}ms per test, suite budget=${actualBudget}ms, elapsed=${Math.round(suiteElapsedMs)}ms`);
    if (code === 0 && suiteElapsedMs > actualBudget) {
      console.error(`[unit-test-budget] SUITE BUDGET EXCEEDED: ${Math.round(suiteElapsedMs)}ms > ${actualBudget}ms`);
      suiteExceeded = true;
    }
  }

  if (fileTimingProfile) { printFileTimingSummary(fileTimingProfile.destination); }

  // Clean up roots before propagating failure status.
  cleanupRunnerTempRoots(testManifestDir);
  if (coverageScratchDir) { fs.rmSync(coverageScratchDir, { recursive: true, force: true }); }

  process.exit((code ?? 0) || (suiteExceeded || unitTestExceeded ? 1 : 0));
});
