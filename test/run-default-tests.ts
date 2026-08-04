'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// A verifier may be launched from an operator checkout while it is validating
// a mission worktree. Capture that selected root once and use it for every
// build, test-runtime generation, test discovery, and nested Node process.
const executionRoot = path.resolve(process.env.PARALLIX_EXECUTION_ROOT || path.join(__dirname, '..'));
const testRoot = path.join(executionRoot, 'test');
if (!fs.existsSync(path.join(executionRoot, 'package.json')) || !fs.existsSync(testRoot)) {
  throw new Error(`PARALLIX_EXECUTION_ROOT is not a Parallix checkout: ${executionRoot}`);
}

const MINIMUM_TEST_NODE_MAJOR = 20;
const MINIMUM_TEST_NODE_MINOR = 6;

function supportsTestImports(executable: string): boolean {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  const match = result.status === 0 && String(result.stdout || '').match(/^v(\d+)\.(\d+)\./);
  if (!match) { return false; }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > MINIMUM_TEST_NODE_MAJOR
    || (major === MINIMUM_TEST_NODE_MAJOR && minor >= MINIMUM_TEST_NODE_MINOR);
}

function compatibleTestNode(): string {
  const candidates: Array<string | undefined> = [process.env.PARALLIX_TEST_NODE, process.execPath];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) { candidates.push(path.join(dir, 'node')); }
  }
  const nvmNodeRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    for (const version of fs.readdirSync(nvmNodeRoot)) {
      candidates.push(path.join(nvmNodeRoot, version, 'bin', 'node'));
    }
  } catch (_) {
    // nvm is optional; PATH and the current executable remain valid sources.
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) { continue; }
    seen.add(candidate);
    if (supportsTestImports(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Node ${MINIMUM_TEST_NODE_MAJOR}.${MINIMUM_TEST_NODE_MINOR}+ is required for TypeScript tests; set PARALLIX_TEST_NODE to a compatible executable.`);
}

function supportsTestForceExit(command: string): boolean {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  const match = probe.status === 0 && /v(\d+)\.(\d+)\./.exec(probe.stdout || '');
  if (!match) {return false;}
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 22 || (major === 20 && minor >= 14);
}

const allRootTestFiles = fs.readdirSync(testRoot)
  .sort()
  .filter(file => /\.test\.(?:js|ts)$/.test(file))
  // Lifecycle E2E is an integration gate. Keeping it out of the fast default
  // suite prevents review/checkpoint verification from repeatedly running it.
  .filter(file => file !== 'e2e-mission-lifecycle.test.ts')
  // This suite exercises a real agent runner and is likewise integration-only.
  .filter(file => file !== 'e2e-real-agent-smoke.test.ts');

// Discover test files from known subdirectories.
function findSubdirTests(subdir: string): string[] {
  const dirPath = path.join(testRoot, subdir);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }
  return fs.readdirSync(dirPath)
    .sort()
    .filter(file => /\.test\.(?:js|ts)$/.test(file))
    .map(file => path.join(testRoot, subdir, file));
}
const allSubdirTestFiles = findSubdirTests('adapters');

// These markers identify tests that cross a real process, Git/worktree,
// package, or network boundary. Keep that coverage intact, but run it only
// through the explicit integration command rather than the hermetic default.
const boundaryDependencyPattern = /\b(?:\w+\.)?(?:spawnSync|spawn|execSync|execFileSync|fork)\s*\(|git\s+(?:init|worktree|clone|commit|checkout|rebase|merge)|npm\s+(?:pack|install)|createServer|\bfetch\s*\(/;
const knownIntegrationTestFiles = new Set([
  // Measured at 55.7s in the CP-1 uncontended run; it drives draft workflow
  // fixtures across the command boundary even though its process launcher is
  // dependency-injected in the source.
  'draft.test.ts',
  'draft-command.test.ts',
  'draft_preflight_modern.test.ts',
  'durable-state-policy.test.ts',
  'mission-start.test.ts',
  // The final CP-3 timing capture found these groups still crossing the
  // Forgejo/worktree, agent-launcher, rebase, or review-artifact boundary.
  // Their fakes protect assertions but do not make the groups hermetic.
  'forgejo.test.ts',
  'forgejo-independence.test.ts',
  'mission-utils-worktree.test.ts',
  'mistral.test.ts',
  // This suite injects its launcher but deliberately invokes a real Node
  // child process to verify stdout and pipe-buffer behavior.
  'opencode-export.test.ts',
  'runtime-matrix.test.ts',
  'rebase_hardening.test.ts',
  'review-artifacts.test.ts',
  'review-commands-additional.test.ts',
  'review-commands-supplemental.test.ts',
  'review-identity.test.ts',
  'review-identity-placeholder.test.ts',
  'review.test.ts',
  'review-prompts.test.ts',
  // TASK-2322.12: review state moved onto the operator database, so these open
  // a real migrated SQLite file and a real git worktree. Their boundary markers
  // live in test/fixtures/review-state-db.js, which the content heuristic above
  // does not scan, so they are declared here instead.
  'review-state.test.ts',
  'review-state-class.test.ts',
  'task-1416-repro.test.ts',
  // TASK-2326: relocated from default suite — these cross a real process,
  // Git, or packaging boundary and are not hermetic unit tests.
  'task-2285-pack-install-smoke.test.ts',
  'task-2286-native-sea-smoke.test.ts',
  'task-2312-label-sync.test.ts',
  'task-2318-temp-directory-leaks.test.js',
  'task-2319-notices-git-tracking.test.ts',
  // TASK-2327: subprocess-based regression for SIGKILL orphan recovery
  'task-2327-coverage-gate-tmp-leaks.test.js',
  // TASK-2326 round 2: tui-spawn uses execFileSync (real process boundary)
  // and was relocated from the default suite to integration.
  'tui-spawn.test.ts',
  // TASK-2326 round 3: tests exceeding 1 s per test in the unit suite.
  // These are heavy (Ink render cycles, full status command, SDK sessions)
  // but do not necessarily cross a process boundary.
  'pi-runner.test.ts',
  'task-1104-call-order.test.ts',
  'task-1268-pre-review-gate-per-round.test.ts',
  'task-2311-console-empty-repro.test.ts',
  'task-2313-repro.test.ts',
  'tui-action-bar.test.ts',
  'tui-confirmation.test.ts',
  'tui-lane-columns.test.ts',
  'tui-outcome-banner.test.ts',
  'tui-pty-smoke.test.ts',
  'tui-responsive-layout.test.ts',
  // Subdir: status-characterization exercises the full status command
  // (BoardProjectionBuilder + projection pipeline) and is 15–23 s per test.
  'adapters/status-characterization-cp4.test.ts'
]);

// Classify subdir tests through the same boundary filter as root-level tests,
// plus any explicitly registered in knownIntegrationTestFiles (relative path).
const subdirIntegrationFiles = allSubdirTestFiles.filter(fp => {
  const relativePath = path.relative(testRoot, fp);
  return knownIntegrationTestFiles.has(relativePath)
    || boundaryDependencyPattern.test(fs.readFileSync(fp, 'utf8'));
});
const subdirUnitFiles = allSubdirTestFiles.filter(fp => !subdirIntegrationFiles.includes(fp));

// tui-spawn.test.ts uses execFileSync (artifact-verification test that
// spawns build/px.mjs). It crosses a real process boundary and was
// relocated to the integration layer in task-2326 round 2.
// When explicitly requested as the sole file, the bootstrap preload is
// bypassed so the child runs with the real environment.
const artifactSpawnTestFiles = new Set();
const integrationTestFiles = allRootTestFiles
  .filter(file => {
    // New boundary tests declare their category in the filename. This avoids
    // silently activating real databases/filesystems/processes in `npm test`
    // merely because a heuristic did not recognize their dependency.
    return file.endsWith('.integration.test.ts')
      || knownIntegrationTestFiles.has(file)
      || boundaryDependencyPattern.test(fs.readFileSync(path.join(testRoot, file), 'utf8'));
  })
  .map(file => path.join(testRoot, file));
const defaultTestFiles = [
  ...allRootTestFiles
    .filter(file => !integrationTestFiles.includes(path.join(testRoot, file)))
    .map(file => path.join(testRoot, file)),
  ...subdirUnitFiles,
];
const requestedArgs = process.argv.slice(2);
const runsIntegrationSuite = requestedArgs.includes('--integration');
const requestedTestFiles = requestedArgs.filter(arg => arg !== '--integration');
const testFiles = runsIntegrationSuite
  ? [...integrationTestFiles, ...subdirIntegrationFiles]
  : (requestedTestFiles.length > 0 ? requestedTestFiles : defaultTestFiles);

// Build the canonical bundle before every suite so a direct runner invocation
// also catches bundle regressions in the current checkout.
const buildResult = spawnSync('npm', ['run', 'build'], { cwd: executionRoot, stdio: 'inherit' });
if (buildResult.error) {
  throw buildResult.error;
}
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

// The product build is a bundled ESM artifact, whose exports are read-only.
// Most unit tests replace dependencies with node:test method mocks, which need
// writable CommonJS exports, so they import from .test-runtime/ instead.
// Generate that ignored, test-only tree here; keeping it separate from build/
// means concurrent product builds cannot race with test module loading.
const testRuntimeBuild = spawnSync(
  process.execPath,
  ['--import', 'tsx', path.join(executionRoot, 'scripts', 'build-test-runtime.ts')],
  { cwd: executionRoot, stdio: 'inherit' },
);
if (testRuntimeBuild.error) {
  throw testRuntimeBuild.error;
}
if (testRuntimeBuild.status !== 0) {
  process.exit(testRuntimeBuild.status ?? 1);
}

// The real-agent smoke test deliberately reads the operator's configured Pi
// model/auth files and then copies them into its own disposable state root.
// The tui-spawn test, when explicitly requested as the sole file, also benefits
// from running without the bootstrap's temp HOME and curl shim.
// Do not preload the unit-test HOME isolation shim for these e2e runs.
// When tui-spawn is batched with other files the bootstrap stays active — the
// 30 s timeout and marker unlink in the test handle the shim impact.
const runsRealAgentSmoke = requestedTestFiles.some(
  file => path.basename(file) === 'e2e-real-agent-smoke.test.ts'
);
const runsLifecycleE2E = requestedTestFiles.some(
  file => path.basename(file) === 'e2e-mission-lifecycle.test.ts'
);
const runsTuiSpawnSolo = requestedTestFiles.length === 1 &&
  requestedTestFiles.some(file => path.basename(file) === 'tui-spawn.test.ts');
const runsIntegrationE2E = runsRealAgentSmoke || runsLifecycleE2E || runsTuiSpawnSolo;
const bootstrapArgs = runsIntegrationE2E
  ? []
  : [
    '--require', path.join(testRoot, 'bootstrap-parallix-home.js')
  ];
// TASK-2288: the source-runtime-alias.js shim is retired. Test files now name
// .test-runtime/ (or src/) directly instead of relying on a runtime resolver
// hook to rewrite ../dist/ paths.
const typeScriptLoaderArgs = testFiles.some(file => file.endsWith('.ts'))
  ? ['--import', 'tsx']
  : [];
const testNode = compatibleTestNode();
const testForceExitArgs = supportsTestForceExit(testNode)
  // This flag was added in Node 20.14 and Node 22.0. Keep the declared Node
  // >=20 range runnable while still ensuring supported newer runtimes return
  // control once the test runner has printed its final result.
  ? ['--test-force-exit']
  : [];

// TASK-2326: enforceable unit-test timing guard.
// Per-test timeout: 30 s catches tests that should be hermetic but cross a
// process boundary (real Git, npm, agent launch). Integration tests run via
// --integration and are exempt from this bound.
// Suite-level budget: 180 s for the full default suite on a typical developer
// workstation. Adjust PARALLIX_UNIT_TEST_BUDGET_MS to override.
const UNIT_TEST_TIMEOUT_MS = 30_000;
const UNIT_TEST_BUDGET_MS = Number(process.env.PARALLIX_UNIT_TEST_BUDGET_MS) || 180_000;
const testTimeoutArgs = runsIntegrationSuite ? [] : ['--test-timeout=' + UNIT_TEST_TIMEOUT_MS];

// Per-worker manifest directory for SIGKILL orphan cleanup.
// The runner creates a PID-scoped directory and passes its path to the child
// process via PARALLIX_TEST_MANIFEST_DIR. Each worker (including the main child
// process) writes its own <worker-PID>.json file inside the directory, so
// concurrent workers do not overwrite each other's root lists (task-2326 round 5).
// After the suite completes, the runner reads all files and unions the roots.
const testManifestDir = path.join(os.tmpdir(), `parallix-test-run-${process.pid}`);
fs.mkdirSync(testManifestDir, { recursive: true });

// Measure elapsed time for the suite-level budget check.
// process.hrtime may be undefined in vm.runInNewContext (default-test-suite test sandbox).
const suiteStart = typeof process.hrtime === 'function' ? process.hrtime.bigint() : 0n;
const result = spawnSync(
  testNode,
  [
    ...bootstrapArgs,
    ...typeScriptLoaderArgs,
    ...testForceExitArgs,
    ...testTimeoutArgs,
    '--test',
    ...testFiles
  ],
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
const suiteElapsedMs = suiteStart !== 0n
  ? Number(process.hrtime.bigint() - suiteStart) / 1e6
  : 0;

if (result.error) {
  throw result.error;
}

// SIGKILL cleanup: child test workers cannot catch SIGKILL, so their
// bootstrap temp directories (parallix-test-*) persist after forced exit.
// The runner reads per-worker manifest files from the manifest directory
// and unions all roots — safely ignoring roots from concurrent test runs.
// This is the safe owner/boundary for the SIGKILL artifact class (task-2326).
function cleanupOrphanedTempDirs() {
  try {
    if (!fs.existsSync(testManifestDir)) return;
    const ownedRoots = new Set();
    for (const entry of fs.readdirSync(testManifestDir)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const roots = JSON.parse(fs.readFileSync(path.join(testManifestDir, entry), 'utf8'));
        if (Array.isArray(roots)) roots.forEach(r => ownedRoots.add(r));
      } catch (_) { /* best-effort */ }
    }
    for (const dir of ownedRoots) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
    try { fs.rmSync(testManifestDir, { recursive: true, force: true }); } catch (_) {}
  } catch (_) {
    // best-effort cleanup only
  }
}

if (result.signal) {
  process.kill(process.pid, result.signal);
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

// Clean up orphaned temp directories from SIGKILL'd child processes.
cleanupOrphanedTempDirs();

process.exit(result.status || (suiteExceeded ? 1 : 0));
