


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTestRunPlan } from './lib/test-run-plan.js';
const expectedIntegrationFiles = [
  'active.test.ts', 'agents-limit-hit.test.ts', 'agents.test.ts', 'backlog.test.ts',
  // Real SQL databases (even temp files) and process boundaries do not run in
  // the hermetic unit suite; see knownIntegrationTestFiles in test-run-plan.ts.
  'board-event-metrics-fixture.test.ts', 'board-event-recorder.test.ts',
  'board-lane-events-migration.test.ts', 'e2e-mission-sqlite-cutover.test.ts',
  'review-backfill.test.ts', 'review-events.test.ts', 'session-marker-repository.test.ts',
  'sqlite-adapter-cp1.test.ts', 'sqlite-async-cascade-cp3.test.ts',
  'sqlite-importer-cp4.test.ts', 'sqlite-ports-cp2.test.ts', 'stats.test.ts',
  'task-2220-repro.test.ts', 'task-2241-tmp-cleanup-repro.test.ts',
  'task-2322-05-mission-sqlite-fixture.test.ts', 'task-2322-05-mission-use-cases.test.ts',
  'task-2322.11-operator-state.test.ts',
  'task-2322.12-stray-persistence.test.ts', 'task-2339-aggregate-read-during-write.test.ts',
  'task-2339-writes-outlive-close.test.ts', 'task-2345-repro.test.ts',
  'task-2347-01-repository-identity-repro.test.ts', 'task-2347.02-lifecycle-history.test.ts',
  'task-2347.02-repro.test.ts', 'task-2348-implementer-attribution.test.ts',
  'task-2350-reconcile-interrupted-handoff.test.ts', 'task-2357-certification.test.ts',
  'task-2357.a-historical-intake.test.ts', 'task-2357.c-unknown-review-fix-rounds.test.ts',
  'task-2357.d-completion-population.test.ts', 'task-2357.e-legacy-history-scope.test.ts',
  'task-2357.f-measured-zero-throughput.test.ts', 'task-2357.g-per-metric-evidence.test.ts',
  'task-2363-repository-identity.test.ts', 'task-2363-review-fix-rounds.test.ts',
  'task-2363-windowed-cohorts.test.ts', 'task-2367-certification.test.ts',
  'task-2367-regressions.test.ts', 'task-2367-repair.test.ts',
  'task-2367-telemetry-schema.test.ts', 'task-2369-regressions.test.ts',
  'task-2373-shutdown.test.ts', 'task-2375-active-invocation-overlap.test.ts',
  'task-2375-current-work-operation-repro.test.ts',
  'task-2468-adhoc-lifecycle-repro.test.ts',
  'bubblewrap-worktree-git.test.ts',
  'bootstrap-isolation.test.ts', 'documentation-verification.test.ts',
  'draft-command.test.ts', 'draft.test.ts',
  'draft_preflight_modern.test.ts', 'durable-state-policy.test.ts',
  'external-target-resolution.test.ts', 'forgejo-independence.test.ts',
  'forgejo-pr-round-sync.test.ts', 'forgejo.test.ts', 'handoff.test.ts', 'install.test.ts',
  'integrate-task-1410-stash-pop-corruption.test.ts', 'integrate-workflow-gate.test.ts',
  'integrate.test.ts', 'integration-pipelines.test.ts', 'mission-start.test.ts',
  'mission-utils-worktree.test.ts', 'mistral.test.ts', 'nels.test.ts',
  'noise-reduction.test.ts', 'opencode-export.test.ts', 'package-persistent-data.test.ts',
  'product-config.test.ts',
  'px-runner.test.ts', 'px-runtime-smoke.test.ts', 'px-shell-init.test.ts',
  'rebase-use-case.test.ts', 'rebase.test.ts', 'rebase_diagnostics.test.ts', 'rebase_hardening.test.ts',
  'refresh-global-px-script.test.ts', 'resolve-conflict.test.ts',
  'review-artifacts.test.ts', 'review-autoderive.test.ts',
  'review-commands-additional.test.ts', 'review-commands-supplemental.test.ts',
  'review-identity-placeholder.test.ts', 'review-identity.test.ts',
  'review-prompts.test.ts', 'review-state-class.test.ts', 'review-state.test.ts',
  'review.test.ts', 'runtime-matrix.test.ts', 'setup-review.test.ts',
  'sqlite-mission-store.integration.test.ts', 'sqlite-recovery-cp5.test.ts',
  'stats-backfill.test.ts', 'status.test.ts',
  'task-1048-regression.test.ts',
  'task-1049-force-push.test.ts', 'task-1080-sync-merged-hardening.test.ts',
  'task-1104-rebase-cleanup.test.ts',
  'task-1209-consume-artifacts.test.ts',
  'task-1272-standalone-cycle.test.ts', 'task-1272-standalone-rebase.test.ts',
  'task-1390-shell-init-shebang.test.ts',
  'task-1415-closed-mission-counts.test.ts', 'task-1416-repro.test.ts',
  'task-1424-post-integrate-publish-reinstall.test.ts',
  'task-2203-publish-proof-refresh-order.test.ts',
  'task-2206-post-integrate-hook-errors.test.ts', 'task-2212-repro.test.ts',
  'task-2231-unit-tests-hang-repro.test.ts',
  'task-2285-pack-install-smoke.test.ts',
  'task-2286-native-sea-smoke.test.ts',
  'task-2455-config-exit-status-repro.test.ts',
  'task-2234-push-to-reviewer-autobounce.test.ts',
  'task-2270-graphify-exclusion.test.ts',
  'task-2322.12-review-recovery.integration.test.ts',
  'task-2273-review-gate-ownership.test.ts',
  'task-2312-label-sync.test.ts',
  'task-2318-temp-directory-leaks.test.ts',
  'task-2319-notices-git-tracking.test.ts',
  'task-2327-coverage-gate-tmp-leaks.test.ts',
  'task-2347.10-repro.test.ts',
  'task-2349-integrate-stage-commit-race.test.ts',
  // Builds a real Git primary checkout and a real linked worktree, because the
  // canonical repository identity it certifies is resolved by shelling out to
  // Git (TASK-2357 defect B).
  'task-2357.b-canonical-repository-identity.test.ts',
  'task-2363-production-certification.test.ts',
  // TASK-2376 CP-2: drives a real temporary Git repository through the
  // lifecycle transitions, so it crosses the process boundary and runs only
  // in the integration layer.
  'task-2376-lifecycle-timing.test.ts',
  // TASK-2378: seeds a real temporary Git repository plus a migrated operator
  // database for the authoritative stats / approval-boundary reproduction,
  // so it crosses the process boundary and runs only in the integration layer.
  'task-2378-authoritative-stats.test.ts',
  // TASK-2379: seeds a real temporary Git repository plus a migrated operator
  // database for the delayed approval-boundary reproduction (review dwell /
  // integration dwell), so it crosses the process boundary and runs only in
  // the integration layer.
  'task-2379-approval-boundary-repro.test.ts',
  'task-2397-integrate-active-approved-recovery.test.ts',
  // TASK-2413: seeds real temporary Git repositories to reproduce the
  // exit-code-only verifier loss and pin proof-reuse/invalidation, so they
  // cross the process boundary and run only in the integration layer.
  'task-2413-proof-reuse.test.ts', 'task-2413-publication-seam.test.ts', 'task-2413-repro.test.ts',
  // TASK-2420: integrate recovery repro by the assigned reviewer. It builds
  // throwaway git repos in a temp dir to stage the stranded-lane scenario, so
  // it crosses a real git boundary like task-2397 and runs only in integration.
  'task-2420-integrate-recovery-assigned-reviewer.test.ts',
  'task-2424-repro.test.ts',
  // TASK-2438 composes concrete board readers over temporary repository files
  // and the worktree/Git topology boundary.
  'task-2438-worktree-board-repro.test.ts',
  // TASK-2440: drives a temporary Git repository and migrated SQLite database
  // through an external lifecycle update before reading the board.
  'task-2440-repro.test.ts',
  // TASK-2441: board title repro. Seeds a temporary Git repository and a
  // migrated SQLite database, then renders the composed board, so it crosses
  // the same real git/database boundary as task-2438 and task-2440.
      'task-2441-mission-title-repro.test.ts',
      'task-2443-repro.test.ts',
  // TASK-2433: real-socket proof of the guarded mutation route (schema,
  // advertised gate, stale guard wiring, security rejections, safe bodies).
  // Loopback-only with injected dispatcher spy and projection builder.
  'task-2433-web-mutation.integration.test.ts',
      'test-hygiene.test.ts',
  'tui-pty-smoke.test.ts', 'task-2313-repro.test.ts', 'task-2370-repro.test.ts',
  'tui-command-flow.test.ts',
  'tui-spawn.test.ts',
  'unit-test-timeout-guard.test.ts',
  'verification.test.ts', 'verify-local-integrate.test.ts',
  // TASK-2431: real-socket loopback web host proof (bind, Host, Origin,
  // session, CSRF, method, body-size, traversal). Runs only in integration.
  'web-host.integration.test.ts',
  // TASK-2431: package-mode smoke — packs the real artifact and serves the
  // shell from the packaged built assets. Crosses the npm-pack boundary, so
  // it runs only in integration.
  'web-package-smoke.integration.test.ts'
].sort();

function selectedFiles(args, version = process.version) {
  // TASK-2328: the runner's suite selection and argv assembly live in
  // test/lib/test-run-plan.ts, so this guard calls the same ESM module the
  // runner calls instead of transpiling the runner into a CommonJS vm sandbox.
  const plan = buildTestRunPlan({
    executionRoot: path.join(import.meta.dirname, '..'),
    requestedArgs: args,
    probeNodeVersion: () => version,
  });
  return {
    files: Array.from(plan.nodeArgs.slice(plan.nodeArgs.indexOf('--test') + 1), file => path.basename(file)).sort(),
    args: plan.nodeArgs,
  };
}

test('default test runner routes every moved group to integration and excludes it from default', () => {
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'run-default-tests.ts'), 'utf8')
    + fs.readFileSync(path.join(import.meta.dirname, 'lib', 'test-run-plan.ts'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));

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
    'the runner must build this checkout before tests load the canonical bundle');
  assert.equal(pkg.scripts.pretest, undefined,
    'building belongs to the runner so direct and npm-invoked suites have the same protection');
  // --test-force-exit makes file workers exit before their result stream is
  // flushed, silently dropping trailing tests while the file reports success.
  // The runner's process-group watchdog covers the hang case instead.
  assert.ok(!defaultRun.args.includes('--test-force-exit'));
  assert.ok(!integrationRun.args.includes('--test-force-exit'));
  // Integration files spawn real children; cap their parallelism so host
  // contention cannot starve child startup past test-internal deadlines.
  assert.ok(integrationRun.args.some(a => a.startsWith('--test-concurrency=')));
  assert.ok(defaultRun.args.some(a => a === '--test-concurrency=4'),
    'unit concurrency is bounded so measured durations are not host-oversubscription artifacts');
  assert.equal(pkg.scripts['test:integration'], 'FORCE_COLOR=0 tsx test/run-default-tests.ts --integration');
  assert.match(runner, /file\.endsWith\('\.integration\.test\.ts'\)/,
    'integration suffix must provide an explicit category independent of dependency heuristics');
});

test('default test runner selects a Node version that supports node:test', () => {
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'lib', 'test-run-plan.ts'), 'utf8');
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
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'run-default-tests.ts'), 'utf8');
  assert.match(runner, /PARALLIX_EXECUTION_ROOT/);
  assert.match(runner, /cwd: executionRoot/);
  assert.match(runner, /env: \{[\s\S]*?\.\.\.process\.env[\s\S]*?PARALLIX_EXECUTION_ROOT: executionRoot[\s\S]*?PARALLIX_TEST_MANIFEST_DIR/);
});

test('default test runner classifies tui-spawn as default (not integration) and pins bootstrap bypass', () => {
  const defaultRun = selectedFiles([]);
  const integrationRun = selectedFiles(['--integration']);
  const defaultFiles = defaultRun.files;
  const integrationFiles = integrationRun.files;

  // tui-spawn is in the integration suite (execFileSync process boundary)
  assert.ok(!defaultFiles.includes('tui-spawn.test.ts'),
    'tui-spawn.test.ts must NOT be in the default (unit) suite');
  assert.ok(integrationFiles.includes('tui-spawn.test.ts'),
    'tui-spawn.test.ts must be in the integration suite');

  // Bootstrap bypass: solo run skips preload so child CLI gets real environment
  const soloRun = selectedFiles(['test/tui-spawn.test.ts']);
  assert.ok(!soloRun.args.some(a => typeof a === 'string' && a.includes('bootstrap-parallix-home')),
    'solo tui-spawn run must bypass the bootstrap preload');

  // Bootstrap bypass must NOT leak to co-requested files (finding-2 regression guard)
  const batchedRun = selectedFiles(['test/tui-spawn.test.ts', 'test/foo.test.ts']);
  assert.ok(batchedRun.args.some(a => typeof a === 'string' && a.includes('bootstrap-parallix-home')),
    'batched tui-spawn run must keep the bootstrap preload for co-requested files');
});
