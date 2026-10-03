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
import { cpuSupervisor, readCpuReport } from './lib/cpu-supervisor.js';
import { childCpuUsageModule } from './lib/child-cpu-usage.js';
import { readCpuBudgetPolicy, suiteCpuBudget } from './lib/test-cpu-policy.mjs';
import { checkoutTestTmpdir } from './lib/test-tmpdir.js';

// A verifier may be launched from an operator checkout while it is validating
// a mission worktree. Capture that selected root once and use it for every
// build, test discovery, and nested Node process.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executionRoot = path.resolve(process.env.PARALLIX_EXECUTION_ROOT || path.join(__dirname, '..'));
const testRoot = path.join(executionRoot, 'test');
if (!fs.existsSync(path.join(executionRoot, 'package.json')) || !fs.existsSync(testRoot)) {
  throw new Error(`PARALLIX_EXECUTION_ROOT is not a Parallix checkout: ${executionRoot}`);
}

// TASK-2547: coverage is a reporting mode of the CI-safe execution, not a
// second test pass. When PARALLIX_TEST_COVERAGE is set (GitHub ci-required or
// the local pre-integration gates),
// enable Node's built-in coverage and emit one lcov per tier so `npm run
// coverage:merge` can union them. Unit and integration-ci stay separate Node
// invocations (their execution semantics require it) but each selected test
// still runs at most once; the two fragments are merged with LCOV semantics.
// TASK-2591 (ADR 0062): coverage runs select Node 26.7+ for the native
// include-all contract that replaced c8.
const coverageEnabled = process.env.PARALLIX_TEST_COVERAGE === '1'
  || process.env.PARALLIX_TEST_COVERAGE === 'true';
const plan = buildTestRunPlan({ executionRoot, requestedArgs: process.argv.slice(2), coverage: coverageEnabled });
const { testNode, nodeArgs, runsIntegrationSuite, runsIntegrationCiSuite, unitTestHeadroomMs } = plan;

const coverageDestination = runsIntegrationCiSuite
  ? path.join(executionRoot, 'coverage', '.lcov-integration-ci.info')
  : path.join(executionRoot, 'coverage', '.lcov-unit.info');
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
const fastUnit = process.env.PARALLIX_FAST_UNIT === '1';
if (fastUnit && (runsIntegrationSuite || process.argv.slice(2).some(arg => arg !== '--unit-test-headroom'))) {
  throw new Error('PARALLIX_FAST_UNIT is only supported for the complete unit tier');
}
if (fastUnit && fileTimingProfile) {
  throw new Error('PARALLIX_FAST_UNIT cannot share a per-file timing profile');
}
const executedNodeArgs = fastUnit
  ? ['--import', 'tsx', path.join(testRoot, 'run-fast-unit-tests.ts')]
  : suiteNodeArgs;
// The covered fast unit tier writes its group LCOV fragments and bootstrap
// homes under a scratch root this runner owns, so the root is removed even
// when the watchdog kills the child. The unit and integration-ci gates may run
// concurrently, so the root is unique per invocation. No raw V8 payload
// directory is set: Node's test runner always records coverage in its own
// temporary directory and would only copy the ~1.5 GB payload into a preset
// NODE_V8_COVERAGE after reporting (ADR 0062).
let fastUnitScratchDir: string | null = null;
if (fastUnit && coverageEnabled) {
  fs.mkdirSync(path.join(executionRoot, 'tmp'), { recursive: true });
  fastUnitScratchDir = fs.mkdtempSync(path.join(executionRoot, 'tmp', 'fast-unit-scratch-'));
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
const cpuReportPath = path.join(testManifestDir, 'suite-cpu.json');
const meter = !onGitHubActions() ? cpuSupervisor(executionRoot) : null;
const childCpuModule = runsIntegrationSuite && !onGitHubActions() ? childCpuUsageModule(executionRoot, testNode) : null;

// The suite runs in its own process group (detached) so the watchdog and the
// signal handler can terminate the whole tree — node --test, its per-file
// workers, and their spawned git/tsx children — with one call. Terminating
// only the node --test parent is not enough: it exits without killing its
// own workers, which leak forever once a test file holds a handle. If this
// runner itself is killed abnormally the detached suite outlives it; that is
// acceptable because healthy workers self-clean their temp roots on exit and
// finish their file, and a worker that would hang is exactly the case the
// watchdog turns into a loud failure.
const child = spawn(meter ?? testNode, meter ? ['--cpu-report', cpuReportPath, testNode, ...executedNodeArgs] : executedNodeArgs, {
  stdio: ['inherit', 'pipe', 'pipe'],
  cwd: executionRoot,
  env: {
    ...process.env,
    // Coverage is a reporting profile for the pre-integration population.
    // Its instrumentation timing is not a hermetic per-test performance
    // measurement; ordinary unit runs retain the explicit 500 ms headroom.
    ...(unitTestHeadroomMs === null || coverageEnabled ? {} : { PARALLIX_UNIT_TEST_CPU_HEADROOM_US: String(unitTestHeadroomMs * 1_000) }),
    ...(childCpuModule ? { PARALLIX_CHILD_CPU_USAGE_MODULE: childCpuModule } : {}),
    PARALLIX_EXECUTION_ROOT: executionRoot,
    PARALLIX_TEST_MANIFEST_DIR: testManifestDir,
    // Keeps tsx's transpile cache per checkout; see test/lib/test-tmpdir.ts.
    TMPDIR: checkoutTestTmpdir(executionRoot),
    ...(fastUnitScratchDir ? { PARALLIX_FAST_UNIT_SCRATCH_DIR: fastUnitScratchDir } : {}),
    // The profile belongs to this invocation only: runners that tests spawn as
    // fixtures keep their unprofiled argv and write no profile of their own.
    ...(fileTimingProfile ? { ...fileTimingProfile.env, [PROFILE_ENV]: '' } : {}),
  },
  detached: process.platform !== 'win32'
});
let outputBytes = 0;
child.stdout.on('data', (chunk: Buffer) => {
  outputBytes += chunk.length;
  process.stdout.write(chunk);
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

// Every exit path (spawn error, watchdog or forwarded signal, normal close)
// reclaims the worker manifests and the runner-owned fast unit scratch root.
function cleanupRunnerOwnedRoots() {
  cleanupRunnerTempRoots(testManifestDir);
  if (fastUnitScratchDir) { fs.rmSync(fastUnitScratchDir, { recursive: true, force: true }); }
}

// Measure elapsed time for the suite-level budget check.
const suiteStart = process.hrtime.bigint();
child.on('error', (error) => {
  if (suiteSettled) { return; }
  suiteSettled = true;
  clearTimeout(watchdog);
  cleanupRunnerOwnedRoots();
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
    console.error(`[suite-process] test runner terminated by ${signal} after ${Math.round(suiteElapsedMs)}ms`);
    cleanupRunnerOwnedRoots();
    process.exit(exitCodeAfterKill);
  }

  if (code !== 0 && outputBytes === 0) {
    console.error(`[suite-process] test runner exited ${code} after ${Math.round(suiteElapsedMs)}ms without stdout`);
  }

  // Suite cost is user+system CPU of the waited process tree. Elapsed time is
  // diagnostic only; the separate watchdog remains the liveness bound.
  let suiteExceeded = false;
  // On GitHub-hosted runners the suite-level budget is disabled: runner
  // speed is uncontrollable, so the suite must not fail on the timing gate
  // there. Local runs keep enforcing it. Gated independently of the reporter
  // (task-2531).
  if (!onGitHubActions()) {
    try {
      const cpu = readCpuReport(cpuReportPath);
      const cpuMs = (cpu.userUs + cpu.systemUs) / 1_000;
      const actualBudget = suiteCpuBudget(readCpuBudgetPolicy(executionRoot), {
        integration: runsIntegrationSuite, ci: runsIntegrationCiSuite,
        local: plan.runsIntegrationLocalSuite, fast: fastUnit, covered: coverageEnabled,
      });
      const label = runsIntegrationSuite ? 'integration-test-cpu' : 'unit-test-cpu';
      console.error(`[${label}] suite budget=${actualBudget}ms CPU, used=${Math.round(cpuMs)}ms CPU, elapsed=${Math.round(suiteElapsedMs)}ms`);
      if (cpuMs > actualBudget) {
        console.error(`[${label}] SUITE CPU BUDGET EXCEEDED: ${Math.round(cpuMs)}ms > ${actualBudget}ms`);
        suiteExceeded = true;
      }
    } catch (error) {
      console.error(`[test-suite-cpu] measurement unavailable: ${error instanceof Error ? error.message : String(error)}`);
      suiteExceeded = true;
    }
  }

  if (fileTimingProfile) { printFileTimingSummary(fileTimingProfile.destination); }

  // Clean up roots before propagating failure status.
  cleanupRunnerOwnedRoots();

  process.exit((code ?? 0) || (suiteExceeded ? 1 : 0));
});
