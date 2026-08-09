

// ---------------------------------------------------------------------------
// Tier 1: Classification tests (areAllBacklogOnlyConflicts)
// ---------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const areAllBacklogOnlyConflictsModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const productConfig = mockModule<typeof import('../src/adapters/config/product-config.js')>('../src/adapters/config/product-config.js', import.meta.url);
const runtimeMatrix = mockModule<typeof import('../src/adapters/agents/runtime-matrix.js')>('../src/adapters/agents/runtime-matrix.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
await installModuleMocks();
const { areAllBacklogOnlyConflicts } = areAllBacklogOnlyConflictsModule;

test('areAllBacklogOnlyConflicts returns true for empty file list', () => {
  assert.equal(areAllBacklogOnlyConflicts([]), true);
});

test('areAllBacklogOnlyConflicts returns true when all files are under backlog/', () => {
  assert.equal(
    areAllBacklogOnlyConflicts([
      'backlog/tasks/task-100 - feature.md',
      'backlog/completed/task-99 - old.md',
    ]),
    true
  );
});

test('areAllBacklogOnlyConflicts returns false when a non-backlog file is present', () => {
  assert.equal(
    areAllBacklogOnlyConflicts([
      'backlog/tasks/task-100 - feature.md',
      'src/adapters/cli/commands/handoff.ts',
    ]),
    false
  );
});

test('areAllBacklogOnlyConflicts is case-sensitive on the backlog/ prefix', () => {
  assert.equal(
    areAllBacklogOnlyConflicts(['Backlog/tasks/task-100 - feature.md']),
    false
  );
});

test('areAllBacklogOnlyConflicts handles nested backlog paths', () => {
  assert.equal(
    areAllBacklogOnlyConflicts([
      'backlog/tasks/task-2242 - backlog.md-changes-fast.md',
      'backlog/completed/task-2200 - done.md',
    ]),
    true
  );
});

// ---------------------------------------------------------------------------
// Tier 2: Integration-level tests via deterministic git runner
// Simulates the Step 2 probe-merge flow from integrate.ts (lines 747-862)
// and asserts the actual command sequence for each SC2 scenario.
// ---------------------------------------------------------------------------

// Helper: deterministic git runner with per-operation counters.
// Mirrors the control flow in integrate.ts Step 2.
function createGitRunner(scenario) {
  const calls = [];
  const counters = { mergeNoCommit: 0, mergeAbort: 0, resetHard: 0, fetch: 0, pull: 0 };

  return {
    calls,
    run(args) {
      calls.push(args.join(' '));
      const fullCmd = args.join(' ');

      if (fullCmd.includes('merge') && fullCmd.includes('--no-commit')) {
        counters.mergeNoCommit++;
        return scenario.onMergeNoCommit(counters.mergeNoCommit);
      }
      if (fullCmd.includes('merge --abort')) {
        counters.mergeAbort++;
        return scenario.onMergeAbort(counters.mergeAbort);
      }
      if (fullCmd.includes('reset --hard')) {
        counters.resetHard++;
        return scenario.onResetHard?.(counters.resetHard) ?? { status: 0, stdout: '', stderr: '' };
      }
      if (fullCmd.includes('fetch')) {
        counters.fetch++;
        return scenario.onFetch?.(counters.fetch) ?? { status: 0, stdout: '', stderr: '' };
      }
      if (fullCmd.includes('pull')) {
        counters.pull++;
        return scenario.onPull?.(counters.pull) ?? { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

// Simulate the Step 2 probe-merge flow from integrate.ts.
// Reproduces the exact control flow: merge, abort, classify, reset/fetch/pull/retry.
function simulateStep2Probe(gitRunner, conflictOutput) {
  const { calls, run } = gitRunner;

  // Initial probe merge (integrate.ts:747-748)
  const dryMerge = run(['-C', '/tmp/base', 'merge', '--no-commit', '--no-ff', 'mission/task-2242']);
  const abortResult = run(['-C', '/tmp/base', 'merge', '--abort']);

  // Classify conflicts (integrate.ts:761-764)
  const conflictFiles = missionUtils.parseConflictFilesFromMergeOutput(conflictOutput);
  const isBacklogOnly = areAllBacklogOnlyConflicts(conflictFiles) && conflictFiles.length > 0;
  const abortFailed = abortResult.status !== 0;

  let proceedToSquash = false;

  if (dryMerge.status !== 0 && isBacklogOnly) {
    // Backlog-only retry path (integrate.ts:766-808)

    // Safe cleanup if abort failed (integrate.ts:769-774)
    if (abortFailed) {
      const resetResult = run(['-C', '/tmp/base', 'reset', '--hard', 'HEAD']);
      if (resetResult.status !== 0) {
        return { ok: false, error: 'reset-failed', proceedToSquash: false, calls };
      }
    }

    // Fetch and advance local base (integrate.ts:777-786)
    const fetchResult = run(['-C', '/tmp/base', 'fetch', '--all', '--prune']);
    if (fetchResult.status !== 0) {
      return { ok: false, error: 'fetch-failed', proceedToSquash: false, calls };
    }
    const pullResult = run(['-C', '/tmp/base', 'pull', '--ff-only']);
    if (pullResult.status !== 0) {
      return { ok: false, error: 'pull-failed', proceedToSquash: false, calls };
    }

    // Retry probe merge (integrate.ts:789-796)
    const retryMerge = run(['-C', '/tmp/base', 'merge', '--no-commit', '--no-ff', 'mission/task-2242']);
    run(['-C', '/tmp/base', 'merge', '--abort']);

    if (retryMerge.status === 0) {
      proceedToSquash = true;
    }
  }

  return { ok: true, proceedToSquash, calls };
}

// SC2(a): Backlog-only conflict files trigger retry with fetch + pull --ff-only
test('backlog-only conflict files trigger retry with fetch, pull --ff-only, and proceed to squash', () => {
  const gitRunner = createGitRunner({
    onMergeNoCommit: (count) => {
      if (count === 1) {
        return {
          status: 1,
          stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-100 - feature.md\n',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    onMergeAbort: () => ({ status: 0, stdout: '', stderr: '' }),
  });

  const result = simulateStep2Probe(
    gitRunner,
    'CONFLICT (content): Merge conflict in backlog/tasks/task-100 - feature.md\n'
  );

  assert.equal(result.ok, true, 'simulation completed');
  assert.equal(result.proceedToSquash, true, 'retry succeeded, proceed to squash');
  assert.equal(result.calls.filter(c => c.includes('merge') && c.includes('--no-commit')).length, 2, 'two merge --no-commit calls');
  assert.ok(result.calls.some(c => c.includes('fetch --all --prune')), 'fetch was called');
  assert.ok(result.calls.some(c => c.includes('pull --ff-only')), 'pull --ff-only was called');
  assert.ok(!result.calls.some(c => c.includes('reset --hard')), 'reset NOT called (abort succeeded)');
});

// SC2(b): Non-backlog conflict fails without retry
test('non-backlog conflict fails without retry and skips fetch/pull', () => {
  const gitRunner = createGitRunner({
    onMergeNoCommit: () => ({
      status: 1,
      stdout: 'CONFLICT (content): Merge conflict in src/adapters/cli/commands/handoff.ts\n',
      stderr: '',
    }),
    onMergeAbort: () => ({ status: 0, stdout: '', stderr: '' }),
  });

  const result = simulateStep2Probe(
    gitRunner,
    'CONFLICT (content): Merge conflict in src/adapters/cli/commands/handoff.ts\n'
  );

  assert.equal(result.ok, true, 'simulation completed');
  assert.equal(result.proceedToSquash, false, 'did not proceed to squash (non-backlog)');
  assert.equal(result.calls.filter(c => c.includes('merge') && c.includes('--no-commit')).length, 1, 'one merge --no-commit call (no retry)');
  assert.ok(!result.calls.some(c => c.includes('fetch')), 'fetch NOT called');
  assert.ok(!result.calls.some(c => c.includes('pull')), 'pull NOT called');
});

// SC2(c): Mission backlog task file triggers retry path
test('mission backlog task file conflict triggers retry path', () => {
  const gitRunner = createGitRunner({
    onMergeNoCommit: () => ({
      status: 1,
      stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-2242 - backlog.md-changes-fast.md\n',
      stderr: '',
    }),
    onMergeAbort: () => ({ status: 0, stdout: '', stderr: '' }),
  });

  const result = simulateStep2Probe(
    gitRunner,
    'CONFLICT (content): Merge conflict in backlog/tasks/task-2242 - backlog.md-changes-fast.md\n'
  );

  assert.equal(result.ok, true, 'simulation completed');
  // Both initial and retry conflict (real overlap), so proceedToSquash is false
  assert.equal(result.proceedToSquash, false, 'retry also conflicted (real overlap), fall through to fail-closed');
  assert.equal(result.calls.filter(c => c.includes('merge') && c.includes('--no-commit')).length, 2, 'two merge --no-commit calls (retry attempted)');
});

// Fetch failure aborts integration (P1 finding)
test('fetch failure during retry aborts integration without retry merge', () => {
  const gitRunner = createGitRunner({
    onMergeNoCommit: () => ({
      status: 1,
      stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n',
      stderr: '',
    }),
    onMergeAbort: () => ({ status: 0, stdout: '', stderr: '' }),
    onFetch: () => ({ status: 1, stdout: '', stderr: 'fatal: fetch failed' }),
  });

  const result = simulateStep2Probe(
    gitRunner,
    'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n'
  );

  assert.equal(result.ok, false, 'simulation aborted');
  assert.equal(result.error, 'fetch-failed', 'aborted due to fetch failure');
  assert.equal(result.calls.filter(c => c.includes('merge') && c.includes('--no-commit')).length, 1, 'only initial merge (no retry after fetch failure)');
});

// Pull --ff-only failure aborts integration (P1 finding)
test('pull --ff-only failure during retry aborts integration without retry merge', () => {
  const gitRunner = createGitRunner({
    onMergeNoCommit: () => ({
      status: 1,
      stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n',
      stderr: '',
    }),
    onMergeAbort: () => ({ status: 0, stdout: '', stderr: '' }),
    onFetch: () => ({ status: 0, stdout: '', stderr: '' }),
    onPull: () => ({ status: 1, stdout: '', stderr: 'fatal: not possible to fast-forward' }),
  });

  const result = simulateStep2Probe(
    gitRunner,
    'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n'
  );

  assert.equal(result.ok, false, 'simulation aborted');
  assert.equal(result.error, 'pull-failed', 'aborted due to pull --ff-only failure');
  assert.equal(result.calls.filter(c => c.includes('merge') && c.includes('--no-commit')).length, 1, 'only initial merge (no retry after pull failure)');
});

// Unabortable merge rescued by reset --hard (P1 finding)
test('unabortable initial merge is rescued by reset --hard for backlog-only conflicts', () => {
  const gitRunner = createGitRunner({
    onMergeNoCommit: (count) => {
      if (count === 1) {
        return {
          status: 1,
          stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    onMergeAbort: (count) => {
      if (count === 1) return { status: 1, stdout: 'error', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    onResetHard: () => ({ status: 0, stdout: '', stderr: '' }),
  });

  const result = simulateStep2Probe(
    gitRunner,
    'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n'
  );

  assert.equal(result.ok, true, 'simulation completed');
  assert.equal(result.proceedToSquash, true, 'retry succeeded after reset --hard');
  assert.ok(result.calls.some(c => c.includes('reset --hard')), 'reset --hard was called');
  assert.equal(result.calls.filter(c => c.includes('merge') && c.includes('--no-commit')).length, 2, 'two merge calls');
});

// Happy path: no conflicts
test('happy path: probe merge succeeds on first try with no conflicts', () => {
  const conflictFiles = missionUtils.parseConflictFilesFromMergeOutput('');
  assert.equal(conflictFiles.length, 0, 'no conflict files');
  assert.equal(areAllBacklogOnlyConflicts(conflictFiles), true, 'empty list classified as backlog-only');
});

// ---------------------------------------------------------------------------
// Tier 3: Production integration tests (load integrate with mocked git)
// Verifies the actual control flow, logged output, and exit behavior.
// ---------------------------------------------------------------------------

const { mock } = test;
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const gitCjs = git;
const missionUtilsCjs = missionUtils;
const backlogCjs = backlog;
const forgejoCjs = forgejo;
const productConfigCjs = productConfig;
const runtimeMatrixCjs = runtimeMatrix;
const statsCjs = stats;
const compositionCjs = __mm1;

const TEST_SLUG = 'task-2242';
const FAKE_ROOT = '/tmp/task-2242-integrate-root';

// The integrate command entry point is the module's default export; its helpers
// are named exports. Expose both through the ESM mock facade.
function loadIntegrate() {
  return Object.assign(
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    (...args) => areAllBacklogOnlyConflictsModule.default(...args),
    areAllBacklogOnlyConflictsModule,
  );
}

// Base git responses shared by all production integration tests.
// Test-specific overrides layer on top of this.
function baseGitFn(args) {
  if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
  if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
  if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
  if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
  if (args.includes('diff')) return { status: 0, stdout: '', stderr: '' };
  if (args.includes('log')) return { status: 0, stdout: '', stderr: '' };
  return { status: 0, stdout: '', stderr: '' };
}

function setupBaseMocks(gitMockFn) {
  mock.method(backlogCjs, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(missionUtilsCjs, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtilsCjs, 'inferSlug', (s) => s || TEST_SLUG);
  mock.method(missionUtilsCjs, 'findMissionDir', () => path.join(FAKE_ROOT, 'missions', TEST_SLUG));
  mock.method(missionUtilsCjs, 'findMissionArea', () => 'lib');
  mock.method(missionUtilsCjs, 'getPrimaryWorktree', () => FAKE_ROOT);
  mock.method(missionUtilsCjs, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
  mock.method(missionUtilsCjs, 'resolveMainRepo', () => FAKE_ROOT);
  mock.method(missionUtilsCjs, 'missionTitle', () => 'Test Mission');
  mock.method(missionUtilsCjs, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(gitCjs, 'getCurrentBranch', () => 'mission/' + TEST_SLUG);
  mock.method(gitCjs, 'git', gitMockFn);
  mock.method(backlogCjs, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
  mock.method(backlogCjs, 'getTaskStatus', () => 'ready-for-integration');
  mock.method(backlogCjs, 'getTaskAssignee', () => 'agent');
  mock.method(backlogCjs, 'setTaskStatus', () => true);
  mock.method(backlogCjs, 'completeTask', () => true);
  mock.method(forgejoCjs, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 41 }));
  mock.method(forgejoCjs, 'listOpenPrsForSlug', () => []);
  mock.method(forgejoCjs, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejoCjs, 'readToken', () => 'token');
  mock.method(forgejoCjs, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejoCjs, 'syncMerged', () => ({ ok: true }));
  mock.method(statsCjs, 'recordIntegrationStats', () => ({ changed: false, row: { mission: TEST_SLUG } }));
  mock.method(productConfigCjs, 'isForgejoReviewEnabled', () => false);
  mock.method(runtimeMatrixCjs, 'buildAutonomousReviewMatrix', () => ({}));
  mock.method(runtimeMatrixCjs, 'formatMatrixSummary', () => ['matrix-line']);
  mock.method(compositionCjs, 'createMissionApplicationServices', async () => ({
    store: {
      _repoId: 'default',
      load: async () => ({ kind: 'found', mission: { status: 'review', review: null }, version: 1 }),
    },
    lifecycle: {
      transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }),
    },
    handoff: {
      recordNel: async () => ({}),
    },
  }));
}

test('integrate SC2b: non-backlog conflict exits with conflict files and helper path', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);

  const mergeNoCommitCalls = [];
  const gitMockFn = (args) => {
    if (args.includes('merge') && args.includes('--no-commit')) {
      mergeNoCommitCalls.push(args);
      return { status: 1, stdout: 'CONFLICT (content): Merge conflict in src/adapters/cli/commands/handoff.ts\n', stderr: '' };
    }
    if (args.includes('merge') && args.includes('--abort')) return { status: 0, stdout: '', stderr: '' };
    return baseGitFn(args);
  };

  setupBaseMocks(gitMockFn);
  mock.method(process, 'exit', () => {});
  const integrate = loadIntegrate();

  await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: compositionCjs.createMissionApplicationServices });

  console.log = originalLog;
  mock.reset();

  const conflictLog = logs.find(l => typeof l === 'string' && l.includes('Conflicting files'));
  assert.ok(conflictLog, 'conflicting files info was logged');
  const helperLog = logs.find(l => typeof l === 'string' && l.includes('Conflict helper'));
  assert.ok(helperLog, 'conflict helper path was logged');
});

test('integrate SC2c: mission backlog task overlap retries and falls through with conflict details', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);

  let mergeNoCommitCount = 0;
  const gitMockFn = (args) => {
    if (args.includes('merge') && args.includes('--no-commit')) {
      mergeNoCommitCount++;
      return { status: 1, stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-2242 - backlog.md-changes-fast.md\n', stderr: '' };
    }
    if (args.includes('merge') && args.includes('--abort')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('pull --ff-only')) return { status: 0, stdout: '', stderr: '' };
    return baseGitFn(args);
  };

  setupBaseMocks(gitMockFn);
  mock.method(process, 'exit', () => {});
  const integrate = loadIntegrate();

  await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: compositionCjs.createMissionApplicationServices });

  console.log = originalLog;
  mock.reset();

  assert.equal(mergeNoCommitCount, 2, 'retry merge was attempted (two merge --no-commit calls)');
  const retryInfo = logs.find(l => typeof l === 'string' && l.includes('Backlog-only conflicts'));
  assert.ok(retryInfo, 'backlog-only retry info was logged');
  const conflictLog = logs.find(l => typeof l === 'string' && l.includes('Conflicting files'));
  assert.ok(conflictLog, 'conflicting files info was logged after retry fall-through');
});

test('integrate P1: recovered abort failure uses normal conflict output after reset', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);

  let mergeNoCommitCount = 0;
  let mergeAbortCount = 0;
  const gitMockFn = (args) => {
    if (args.includes('merge') && args.includes('--no-commit')) {
      mergeNoCommitCount++;
      return { status: 1, stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n', stderr: '' };
    }
    if (args.includes('merge') && args.includes('--abort')) {
      mergeAbortCount++;
      // First abort fails (unabortable), second abort succeeds
      if (mergeAbortCount === 1) return { status: 1, stdout: 'error', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('reset --hard')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('pull --ff-only')) return { status: 0, stdout: '', stderr: '' };
    return baseGitFn(args);
  };

  setupBaseMocks(gitMockFn);
  mock.method(process, 'exit', () => {});
  const integrate = loadIntegrate();

  await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: compositionCjs.createMissionApplicationServices });

  console.log = originalLog;
  mock.reset();

  assert.equal(mergeNoCommitCount, 2, 'retry merge was attempted');
  // After reset clears abortFailed, the normal conflict-resolution path is used
  const conflictLog = logs.find(l => typeof l === 'string' && l.includes('Conflicting files'));
  assert.ok(conflictLog, 'normal conflicting files output (not generic abort-failure message)');
  const abortFailLog = logs.find(l => typeof l === 'string' && l.includes('could not be aborted'));
  assert.equal(abortFailLog, undefined, 'generic abort-failure message NOT emitted after reset recovery');
});

test('integrate P1: retry abort failure routes to inspect-checkout path (not rebase guidance)', async () => {
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (msg) => logs.push(msg);
  console.error = (msg) => logs.push(msg);

  let mergeNoCommitCount = 0;
  let mergeAbortCount = 0;
  const gitMockFn = (args) => {
    if (args.includes('merge') && args.includes('--no-commit')) {
      mergeNoCommitCount++;
      // Both initial and retry conflict
      return { status: 1, stdout: 'CONFLICT (content): Merge conflict in backlog/tasks/task-100.md\n', stderr: '' };
    }
    if (args.includes('merge') && args.includes('--abort')) {
      mergeAbortCount++;
      // First abort fails (unabortable), second (retry) abort ALSO fails
      return { status: 1, stdout: 'error', stderr: '' };
    }
    if (args.includes('reset --hard')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('pull --ff-only')) return { status: 0, stdout: '', stderr: '' };
    return baseGitFn(args);
  };

  setupBaseMocks(gitMockFn);
  mock.method(process, 'exit', () => {});
  const integrate = loadIntegrate();

  await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: compositionCjs.createMissionApplicationServices });

  console.log = originalLog;
  console.error = originalError;
  mock.reset();

  assert.equal(mergeNoCommitCount, 2, 'retry merge was attempted');
  // Retry abort failure should route to "inspect the local integration checkout" path
  const inspectLog = logs.find(l => typeof l === 'string' && l.includes('Inspect the local integration checkout'));
  assert.ok(inspectLog, 'inspect-checkout failure message emitted (not ordinary rebase guidance)');
  // Should NOT emit ordinary rebase guidance
  const rebaseLog = logs.find(l => typeof l === 'string' && l.includes('Rebase the mission branch'));
  assert.equal(rebaseLog, undefined, 'ordinary rebase guidance NOT emitted when retry abort fails');
});
