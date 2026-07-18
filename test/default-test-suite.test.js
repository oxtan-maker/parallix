// @ts-nocheck -- VM callback state is not represented by the generated dist declarations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const expectedIntegrationFiles = [
  'active.test.js', 'agents-limit-hit.test.js', 'agents.test.js', 'backlog.test.js',
  'bootstrap-isolation.test.js', 'draft-command.test.js', 'draft.test.js',
  'draft_preflight_modern.test.js', 'durable-state-policy.test.js',
  'external-target-resolution.test.js', 'forgejo-independence.test.js',
  'forgejo.test.js', 'handoff.test.js', 'install.test.js',
  'integrate-task-1410-stash-pop-corruption.test.js', 'integrate-workflow-gate.test.js',
  'integrate.test.js', 'integration-pipelines.test.js', 'mission-start.test.js',
  'mission-utils-worktree.test.js', 'mistral.test.js', 'nels.test.js',
  'noise-reduction.test.js', 'opencode-export.test.js', 'package-persistent-data.test.js',
  'product-config.test.js',
  'px-runner.test.js', 'px-runtime-smoke.test.js', 'px-shell-init.test.js',
  'rebase.test.js', 'rebase_diagnostics.test.js', 'rebase_hardening.test.js',
  'refresh-global-px-script.test.js', 'resolve-conflict.test.js',
  'review-artifacts.test.js', 'review-autoderive.test.js',
  'review-commands-additional.test.js', 'review-commands-supplemental.test.js',
  'review-identity-placeholder.test.js', 'review-identity.test.js',
  'review-prompts.test.js', 'review-state-class.test.js', 'review-state.test.js',
  'review.test.js', 'runtime-matrix.test.js', 'setup-review.test.js',
  'stats-backfill.test.js', 'status.test.js', 'task-1048-regression.test.js',
  'task-1049-force-push.test.js', 'task-1080-sync-merged-hardening.test.js',
  'task-1104-rebase-cleanup.test.js', 'task-1209-consume-artifacts.test.js',
  'task-1272-standalone-cycle.test.js', 'task-1272-standalone-rebase.test.js',
  'task-1390-shell-init-shebang.test.js', 'task-1413-stale-build.test.js',
  'task-1415-closed-mission-counts.test.js', 'task-1416-repro.test.js',
  'task-1417-stale-publish-build-check.test.js',
  'task-1424-post-integrate-publish-reinstall.test.js',
  'task-1429-review-publish-failure.test.js',
  'task-2203-publish-proof-refresh-order.test.js',
  'task-2206-post-integrate-hook-errors.test.js', 'task-2212-repro.test.js',
  'task-2231-unit-tests-hang-repro.test.js',
  'task-2234-push-to-reviewer-autobounce.test.js',
  'task-2273-review-gate-ownership.test.js', 'verification.test.js',
  'verify-local-integrate.test.js'
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
  assert.ok(!integrationFiles.includes('e2e-mission-lifecycle.test.js'));
  assert.ok(!integrationFiles.includes('e2e-real-agent-smoke.test.js'));
  assert.match(runner, /runsIntegrationSuite/);
  assert.ok(defaultRun.args.includes('--test-force-exit'));
  assert.ok(!selectedFiles([], 'v20.13.1').args.includes('--test-force-exit'));
  assert.ok(selectedFiles([], 'v20.14.0').args.includes('--test-force-exit'));
  assert.equal(pkg.scripts['test:integration'], 'FORCE_COLOR=0 node test/run-default-tests.js --integration');
});
