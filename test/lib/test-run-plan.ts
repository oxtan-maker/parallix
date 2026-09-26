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
import { UNIT_TEST_BUDGET_MS, UNIT_TEST_HEADROOM_MS, onGitHubActions } from './unit-test-budget-reporter.js';
import { selectTierFiles } from './test-tier-selection.js';
// Re-export so the test/lib surface stays the single authority entry point for
// coverage and the regression test.
export { selectTierFiles };


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
  runsIntegrationCiSuite: boolean;
  unitTestBudgetMs: number;
  unitTestTimeoutMs: number;
  unitTestHeadroomMs: number | null;
}

function defaultProbeNodeVersion(executable: string): string | null {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '') : null;
}

const testConcurrencySupport = new Map<string, boolean>();

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
    const cached = testConcurrencySupport.get(executable);
    if (cached !== undefined) { return cached; }
    const result = spawnSync(executable, ['--test', '--test-concurrency=1', '--help'], { stdio: 'ignore' });
    const supported = result.status === 0;
    testConcurrencySupport.set(executable, supported);
    return supported;
  }

  const tierFiles = selectTierFiles(executionRoot);
  // Verification-tier selectors (TASK-2500.04). `--integration` keeps running
  // the whole integration layer so the existing local gate is unchanged, while
  // `--integration-ci` and `--integration-local` select POSITIVELY from the
  // registry in test/lib/test-categories.ts. A newly authored integration test
  // that nobody classified therefore reaches neither tier command, instead of
  // silently inheriting GitHub-CI membership. Membership comes from the shared
  // selectTierFiles() authority (test/lib/test-tier-selection.ts, extracted
  // from here), never a glob.
  const SUITE_FLAGS = new Set(['--integration', '--integration-ci', '--integration-local', '--unit-test-headroom']);
  const runsIntegrationCiSuite = requestedArgs.includes('--integration-ci');
  const runsIntegrationLocalSuite = requestedArgs.includes('--integration-local');
  const runsIntegrationSuite = requestedArgs.includes('--integration')
    || runsIntegrationCiSuite
    || runsIntegrationLocalSuite;
  const enforcesUnitTestHeadroom = requestedArgs.includes('--unit-test-headroom');
  const requestedTestFiles = requestedArgs.filter(arg => !SUITE_FLAGS.has(arg));
  const testFiles = runsIntegrationCiSuite
    ? tierFiles.integrationCi
    : runsIntegrationLocalSuite
      ? tierFiles.integrationLocal
      : runsIntegrationSuite
        ? tierFiles.allIntegration
        : (requestedTestFiles.length > 0 ? requestedTestFiles : tierFiles.unit);
  // The real-agent smoke test deliberately reads the operator's configured Pi
  // model/auth files and then copies them into its own disposable state root.
  // The tui-spawn test, when explicitly requested as the sole file, also benefits
  // from running without the bootstrap's temp HOME and curl shim.
  // Do not preload the full unit-test HOME isolation shim for these e2e runs.
  // TASK-2554: they still get the PARALLIX_HOME-only isolation preload so the
  // test process never resolves the operator's default database.
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
  const e2eBootstrapFile = runsIntegrationE2E ? 'bootstrap-e2e-parallix-home.ts' : 'bootstrap-parallix-home.ts';
  const bootstrapArgs = [
    '--import', pathToFileURL(path.join(testRoot, e2eBootstrapFile)).href
  ];
  // TASK-2288: the source-runtime-alias.js shim is retired. TASK-2328 removed the
  // transpiled compatibility tree as well. Test files now name modules under
  // src/ directly instead of relying on a runtime resolver hook.
  const typeScriptLoaderArgs = testFiles.some(file => file.endsWith('.ts'))
    ? ['--import', 'tsx']
    : [];
  // TASK-2328: mock.module() requires the experimental flag in Node 22+
  const moduleMockArgs = ['--experimental-test-module-mocks'];
  // Integration files spawn real children; task-2318/2327/2212 showed that
  // unrestricted concurrency can starve their startup past internal deadlines.
  const INTEGRATION_TEST_CONCURRENCY = 4;
  // Unit-test timing is per test, so avoid worker contention turning hermetic
  // tests into false budget failures on a shared developer machine.
  const UNIT_TEST_CONCURRENCY = 4;
  const testNode = compatibleTestNode();
  const testConcurrencyArgs = supportsTestConcurrency(testNode)
    ? [`--test-concurrency=${runsIntegrationSuite ? INTEGRATION_TEST_CONCURRENCY : UNIT_TEST_CONCURRENCY}`]
    : [];

  // Unit tests are hermetic and must complete within one second. Integration
  // tests run via --integration and are exempt because they cross real boundaries.
  // Suite-level budget: 180 s for the full default suite on a typical developer
  // workstation. Adjust PARALLIX_UNIT_TEST_BUDGET_MS to override.
  // TASK-2542: on GitHub-hosted runners the budget reporter is not executed at
  // all. The per-test --test-timeout safety net stays (it is not a timing test
  // nor a reporter); only the runtime timing reporter is dropped. The
  // `--unit-test-headroom` authoring path is local-only and never carries the
  // GitHub flag, so its reporter is unaffected.
  const githubTimingSuspended = onGitHubActions();
  const testTimeoutArgs = runsIntegrationSuite ? [] : [
    '--test-timeout=' + UNIT_TEST_BUDGET_MS,
    ...(githubTimingSuspended ? [] : [
      '--test-reporter=' + pathToFileURL(path.join(testRoot, 'lib', 'unit-test-budget-reporter.ts')).href,
    ]),
  ];

  return {
    testNode,
    testFiles,
    runsIntegrationSuite,
    runsIntegrationCiSuite,
    unitTestBudgetMs: Number(process.env.PARALLIX_UNIT_TEST_BUDGET_MS) || 180_000,
    unitTestTimeoutMs: UNIT_TEST_BUDGET_MS,
    unitTestHeadroomMs: enforcesUnitTestHeadroom ? UNIT_TEST_HEADROOM_MS : null,
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
