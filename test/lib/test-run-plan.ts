/**
 * test-run-plan.ts — pure suite-selection and argv assembly for the Parallix
 * test runner (TASK-2328).
 *
 * `run-default-tests.ts` owns the side effects (bundle build, manifest
 * directory, child spawn, cleanup). Everything that decides *what* runs and
 * *with which flags* lives here so `test/default-test-suite.test.ts` can assert
 * the plan by calling this function directly — no CommonJS transpile and no
 * `vm` sandbox of the runner script.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface TestRunPlanOptions {
  /** Checkout the suite runs against. */
  executionRoot: string;
  /** `process.argv.slice(2)` equivalent. */
  requestedArgs: string[];
  /**
   * Reports a candidate Node executable's version string (`v24.15.0`), or null
   * when the candidate cannot be probed. Injected so the plan can be asserted
   * without spawning a process.
   */
  probeNodeVersion?: (executable: string) => string | null;
}

export interface TestRunPlan {
  testNode: string;
  testFiles: string[];
  nodeArgs: string[];
  runsIntegrationSuite: boolean;
  unitTestBudgetMs: number;
}

function defaultProbeNodeVersion(executable: string): string | null {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '') : null;
}

export function buildTestRunPlan(options: TestRunPlanOptions): TestRunPlan {
  const { executionRoot, requestedArgs } = options;
  const probeNodeVersion = options.probeNodeVersion ?? defaultProbeNodeVersion;
  const testRoot = path.join(executionRoot, 'test');
  const MINIMUM_TEST_NODE_MAJOR = 20;
  const MINIMUM_TEST_NODE_MINOR = 6;

  function supportsTestImports(executable: string): boolean {
    const version = probeNodeVersion(executable);
    const match = version !== null && version.match(/^v(\d+)\.(\d+)\./);
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

  // `--test-concurrency` exists from Node 20.15 on; probe empirically so no
  // version table has to be maintained for older supported runtimes.
  function supportsTestConcurrency(executable: string): boolean {
    const result = spawnSync(executable, ['--test', '--test-concurrency=1', '--help'], { stdio: 'ignore' });
    return result.status === 0;
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
  const boundaryDependencyPattern = /\b(?:\w+\.)?(?:spawnSync|spawn|execSync|execFileSync|execFile|fork)\s*\(|git\s+(?:init|worktree|clone|commit|checkout|rebase|merge)|npm\s+(?:pack|install)|createServer|\bfetch\s*\(/;
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
    'task-2318-temp-directory-leaks.test.ts',
    'task-2319-notices-git-tracking.test.ts',
    // TASK-2327: subprocess-based regression for SIGKILL orphan recovery
    'task-2327-coverage-gate-tmp-leaks.test.ts',
    // TASK-2326 round 2: tui-spawn uses execFileSync (real process boundary)
    // and was relocated from the default suite to integration.
    'tui-spawn.test.ts',
    // Unit tests must not open a real SQL database or cross a process
    // boundary, even when the database is a temp file and the spawn is a
    // tiny script. The content heuristic above cannot see boundaries that
    // live in test/fixtures/* helpers (review-state-db.ts, 
    // task-2357-statistics-fixture.ts) or behind a promisified/execFile 
    // wrapper, so every such file is declared here.
    'board-event-metrics-fixture.test.ts',
    'board-event-recorder.test.ts',
    'board-lane-events-migration.test.ts',
    'e2e-mission-sqlite-cutover.test.ts',
    'review-backfill.test.ts',
    'review-events.test.ts',
    'session-marker-repository.test.ts',
    'sqlite-adapter-cp1.test.ts',
    'sqlite-async-cascade-cp3.test.ts',
    'sqlite-importer-cp4.test.ts',
    'sqlite-ports-cp2.test.ts',
    'stats.test.ts',
    'task-2220-repro.test.ts',
    'task-2241-tmp-cleanup-repro.test.ts',
    'task-2322-05-mission-sqlite-fixture.test.ts',
    'task-2322-05-mission-use-cases.test.ts',
    'task-2322.04-mission-import.test.ts',
    'task-2322.11-operator-state.test.ts',
    'task-2322.12-stray-persistence.test.ts',
    'task-2339-aggregate-read-during-write.test.ts',
    'task-2339-writes-outlive-close.test.ts',
    'task-2345-repro.test.ts',
    'task-2347-01-repository-identity-repro.test.ts',
    'task-2347.02-lifecycle-history.test.ts',
    'task-2347.02-repro.test.ts',
    'task-2348-implementer-attribution.test.ts',
    'task-2350-reconcile-interrupted-handoff.test.ts',
    'task-2357-certification.test.ts',
    'task-2357.a-historical-intake.test.ts',
    'task-2357.c-unknown-review-fix-rounds.test.ts',
    'task-2357.d-completion-population.test.ts',
    'task-2357.e-legacy-history-scope.test.ts',
    'task-2357.f-measured-zero-throughput.test.ts',
    'task-2357.g-per-metric-evidence.test.ts',
    'task-2363-repository-identity.test.ts',
    'task-2363-review-fix-rounds.test.ts',
    'task-2363-windowed-cohorts.test.ts',
    'task-2367-certification.test.ts',
    'task-2367-regressions.test.ts',
    'task-2367-repair.test.ts',
    'task-2367-telemetry-schema.test.ts',
    'task-2369-regressions.test.ts',
    'task-2373-shutdown.test.ts',
    'task-2375-active-invocation-overlap.test.ts',
    'task-2375-current-work-operation-repro.test.ts',
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
  const runsIntegrationSuite = requestedArgs.includes('--integration');
  const requestedTestFiles = requestedArgs.filter(arg => arg !== '--integration');
  const testFiles = runsIntegrationSuite
    ? [...integrationTestFiles, ...subdirIntegrationFiles]
    : (requestedTestFiles.length > 0 ? requestedTestFiles : defaultTestFiles);
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
      '--import', pathToFileURL(path.join(testRoot, 'bootstrap-parallix-home.ts')).href
    ];
  // TASK-2288: the source-runtime-alias.js shim is retired. TASK-2328 removed the
  // transpiled compatibility tree as well. Test files now name modules under
  // src/ directly instead of relying on a runtime resolver hook.
  const typeScriptLoaderArgs = testFiles.some(file => file.endsWith('.ts'))
    ? ['--import', 'tsx']
    : [];
  // TASK-2328: mock.module() requires the experimental flag in Node 22+
  const moduleMockArgs = ['--experimental-test-module-mocks'];
  // Integration files spawn real child processes (tsx, git, npm). The default
  // file concurrency (availableParallelism - 1) oversubscribes multi-core
  // hosts and starves child startup past the tests' internal deadlines
  // (task-2318/2327/2212 flakes). Cap integration file concurrency only; the
  // hermetic unit suite keeps full parallelism.
  const INTEGRATION_TEST_CONCURRENCY = 4;
  const testNode = compatibleTestNode();
  const testConcurrencyArgs = runsIntegrationSuite && supportsTestConcurrency(testNode)
    ? [`--test-concurrency=${INTEGRATION_TEST_CONCURRENCY}`]
    : [];

  // TASK-2326: enforceable unit-test timing guard.
  // Per-test timeout: 30 s catches tests that should be hermetic but cross a
  // process boundary (real Git, npm, agent launch). Integration tests run via
  // --integration and are exempt from this bound.
  // Suite-level budget: 180 s for the full default suite on a typical developer
  // workstation. Adjust PARALLIX_UNIT_TEST_BUDGET_MS to override.
  const UNIT_TEST_TIMEOUT_MS = 30_000;
  const testTimeoutArgs = runsIntegrationSuite ? [] : ['--test-timeout=' + UNIT_TEST_TIMEOUT_MS];

  return {
    testNode,
    testFiles,
    runsIntegrationSuite,
    unitTestBudgetMs: Number(process.env.PARALLIX_UNIT_TEST_BUDGET_MS) || 180_000,
    // Deliberately no `--test-force-exit`: it makes the per-file workers call
    // process.exit() before their result stream is flushed, so trailing test
    // results are silently dropped while the file still reports success
    // (reproduced on Node 24 and 26). Hang protection (a leaked test handle)
    // is provided by the runner's process-group watchdog instead.
    nodeArgs: [
      // tsx must be registered before the bootstrap preload so the TypeScript
      // bootstrap module resolves (--import entries load in argv order).
      ...typeScriptLoaderArgs,
      ...bootstrapArgs,
      ...moduleMockArgs,
      ...testConcurrencyArgs,
      ...testTimeoutArgs,
      '--test',
      ...testFiles,
    ],
  };
}
