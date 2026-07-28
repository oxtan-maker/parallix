
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const expectedIntegrationFiles = [
  'active.test.ts', 'agents-limit-hit.test.ts', 'agents.test.ts', 'backlog.test.ts',
  'bootstrap-isolation.test.ts', 'draft-command.test.ts', 'draft.test.ts',
  'draft_preflight_modern.test.ts', 'durable-state-policy.test.ts',
  'external-target-resolution.test.ts', 'forgejo-independence.test.ts',
  'forgejo-pr-round-sync.test.js', 'forgejo.test.ts', 'handoff.test.ts', 'install.test.ts',
  'integrate-task-1410-stash-pop-corruption.test.ts', 'integrate-workflow-gate.test.ts',
  'integrate.test.ts', 'integration-pipelines.test.ts', 'mission-start.test.ts',
  'mission-utils-worktree.test.ts', 'mistral.test.ts', 'nels.test.ts',
  'noise-reduction.test.ts', 'opencode-export.test.ts', 'package-persistent-data.test.ts',
  'product-config.test.ts',
  'px-runner.test.ts', 'px-runtime-smoke.test.ts', 'px-shell-init.test.ts',
  'rebase.test.ts', 'rebase_diagnostics.test.ts', 'rebase_hardening.test.ts',
  'refresh-global-px-script.test.ts', 'resolve-conflict.test.ts',
  'review-artifacts.test.ts', 'review-autoderive.test.ts',
  'review-commands-additional.test.ts', 'review-commands-supplemental.test.ts',
  'review-identity-placeholder.test.ts', 'review-identity.test.ts',
  'review-prompts.test.ts', 'review-state-class.test.ts', 'review-state.test.ts',
  'review.test.ts', 'runtime-matrix.test.ts', 'setup-review.test.ts', 'sqlite-recovery-cp5.test.ts',
  'stats-backfill.test.ts', 'status.test.ts', 'task-1048-regression.test.ts',
  'task-1049-force-push.test.ts', 'task-1080-sync-merged-hardening.test.ts',
  'task-1104-rebase-cleanup.test.ts', 'task-1209-consume-artifacts.test.ts',
  'task-1272-standalone-cycle.test.ts', 'task-1272-standalone-rebase.test.ts',
  'task-1390-shell-init-shebang.test.ts',
  'task-1415-closed-mission-counts.test.ts', 'task-1416-repro.test.ts',
  'task-1424-post-integrate-publish-reinstall.test.ts',
  'task-2203-publish-proof-refresh-order.test.ts',
  'task-2206-post-integrate-hook-errors.test.ts', 'task-2212-repro.test.ts',
  'task-2231-unit-tests-hang-repro.test.ts',
  'task-2285-pack-install-smoke.test.ts', 'task-2285-rollback.test.ts',
  'task-2286-native-sea-smoke.test.ts',
  'task-2234-push-to-reviewer-autobounce.test.ts',
  'task-2270-graphify-exclusion.test.js',
  'task-2273-review-gate-ownership.test.ts', 'task-2312-label-sync.test.ts',
  'task-2319-notices-git-tracking.test.ts',
  'task-2318-temp-directory-leaks.test.js',
  'test-hygiene.test.ts',
  'verification.test.ts', 'verify-local-integrate.test.ts'
].sort();

function selectedFiles(args, version = process.version) {
  const runnerPath = path.join(__dirname, 'run-default-tests.js');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  /** @type {string[] | undefined} */
  let spawnedTestArgs;
  const childProcess = {
    ['spawn' + 'Sync'](command, commandArgs) {
      if (commandArgs[0] === '--version') {
        return { status: 0, stdout: version };
      }
      spawnedTestArgs = commandArgs;
      return { status: 0 };
    }
  };
  const sandbox = {
    __dirname,
    require(id) {
      if (id === 'node:child_process') return childProcess;
      return require(id);
    },
    process: {
      argv: ['node', runnerPath, ...args],
      env: process.env,
      execPath: process.execPath,
      exit() {},
      kill() {}
    }
  };
  vm.runInNewContext(runner, sandbox, { filename: runnerPath });
  if (!spawnedTestArgs) {
    throw new Error('Expected the default test runner to spawn a test process');
  }
  return {
    files: Array.from(spawnedTestArgs.slice(spawnedTestArgs.indexOf('--test') + 1), file => path.basename(file)).sort(),
    args: spawnedTestArgs
  };
}

test('default test runner routes every moved group to integration and excludes it from default', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'run-default-tests.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  const defaultRun = selectedFiles([]);
  const integrationRun = selectedFiles(['--integration']);
  const defaultFiles = defaultRun.files;
  const integrationFiles = integrationRun.files;

  assert.deepEqual(integrationFiles, expectedIntegrationFiles);
  for (const file of expectedIntegrationFiles) {
    assert.ok(!defaultFiles.includes(file), `${file} must be excluded from npm test`);
  }
  assert.ok(!integrationFiles.includes('e2e-mission-lifecycle.test.ts'));
  assert.ok(!integrationFiles.includes('e2e-real-agent-smoke.test.ts'));
  assert.match(runner, /runsIntegrationSuite/);
  assert.match(runner, /spawnSync\('npm', \['run', 'build'\]/,
    'the runner must compile this checkout before tests import dist/');
  assert.equal(pkg.scripts.pretest, undefined,
    'building belongs to the runner so direct and npm-invoked suites have the same protection');
  assert.ok(defaultRun.args.includes('--test-force-exit'));
  assert.ok(!selectedFiles([], 'v20.13.1').args.includes('--test-force-exit'));
  assert.ok(selectedFiles([], 'v20.14.0').args.includes('--test-force-exit'));
  assert.equal(pkg.scripts['test:integration'], 'FORCE_COLOR=0 node test/run-default-tests.js --integration');
});

test('default test runner selects a Node version that supports node:test', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'run-default-tests.js'), 'utf8');
  assert.match(runner, /MINIMUM_TEST_NODE_MAJOR = 20/);
  assert.match(runner, /MINIMUM_TEST_NODE_MINOR = 6/);
  assert.match(runner, /PARALLIX_TEST_NODE/);
  assert.match(runner, /compatibleTestNode\(\)/);
  assert.throws(
    () => selectedFiles([], 'v20.5.0'),
    /Node 20\.6\+ is required for TypeScript tests/
  );
});

test('default test runner preserves an explicitly selected execution root for every child process', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'run-default-tests.js'), 'utf8');
  assert.match(runner, /PARALLIX_EXECUTION_ROOT/);
  assert.match(runner, /cwd: executionRoot/);
  assert.match(runner, /env: \{ \.\.\.process\.env, PARALLIX_EXECUTION_ROOT: executionRoot \}/);
});

test('default test runner classifies tui-spawn as default (not integration) and pins bootstrap bypass', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'run-default-tests.js'), 'utf8');
  const defaultRun = selectedFiles([]);
  const defaultFiles = defaultRun.files;

  // tui-spawn must be in the default suite (artifactSpawnTestFiles carve-out)
  assert.ok(defaultFiles.includes('tui-spawn.test.ts'),
    'tui-spawn.test.ts must be in the default (unit) suite');

  // Bootstrap bypass: solo run skips preload so child CLI gets real environment
  const soloRun = selectedFiles(['test/tui-spawn.test.ts']);
  assert.ok(!soloRun.args.some(a => typeof a === 'string' && a.includes('bootstrap-parallix-home')),
    'solo tui-spawn run must bypass the bootstrap preload');

  // Bootstrap bypass must NOT leak to co-requested files (finding-2 regression guard)
  const batchedRun = selectedFiles(['test/tui-spawn.test.ts', 'test/foo.test.ts']);
  assert.ok(batchedRun.args.some(a => typeof a === 'string' && a.includes('bootstrap-parallix-home')),
    'batched tui-spawn run must keep the bootstrap preload for co-requested files');
});
