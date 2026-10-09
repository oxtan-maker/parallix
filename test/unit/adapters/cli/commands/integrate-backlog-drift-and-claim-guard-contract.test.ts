import { resolveConfiguration } from '../../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
// Historical regression provenance: TASK-2242, TASK-2411.
// Behavior-owned suite (TASK-2622.09): backlog-only conflict drift retry (task-2242), the integrate
// guard, the exclusive per-mission claim, and integrate work detection (task-2411).
// Legacy case names unchanged; Git, Backlog and Forgejo are injected doubles.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';
import type { Mission } from '../../../../../src/domain/mission.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
mockModule('../../../../../src/adapters/git/git.js', import.meta.url);
mockModule('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
mockModule('../../../../../src/adapters/config/product-config.js', import.meta.url);
mockModule('../../../../../src/adapters/agents/runtime-matrix.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/integrate-conflict.js', import.meta.url);
mockModule('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
mockModule('../../../../../src/composition/application-services.js', import.meta.url);
await installModuleMocks();
const { createIntegrateWorkflow } = await import('../../../../../src/application/integrate-workflow.js');
const { BoardProjectionBuilder } = await import('../../../../../src/application/projections/board-readers.js');
const { isWorkInProgress } = await import('../../../../../src/application/projections/current-work.js');
const { processLivenessProbe, processStartIdentity } = await import('../../../../../src/adapters/process/process-liveness.js');
const { agentFamily } = await import('../../../../../src/domain/agents.js');
const { missionId, missionLabels } = await import('../../../../../src/domain/mission.js');
const { repositoryId } = await import('../../../../../src/domain/repository.js');
const { AttentionItems } = await import('../../../../../src/interfaces/tui/shell.js');

// ---- task-2242 backlog drift retry (consolidated from test/task-2242-backlog-drift.test.ts, TASK-2622.09) ----
describe("backlog drift retry", () => {
  // ---------------------------------------------------------------------------
  // Tier 1: Classification tests (areAllBacklogOnlyConflicts)
  // ---------------------------------------------------------------------------

  const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const areAllBacklogOnlyConflictsModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);
  const git = mockModule<typeof import('../../../../../src/adapters/git/git.js')>('../../../../../src/adapters/git/git.js', import.meta.url);
  const backlog = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>('../../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const forgejo = mockModule<typeof import('../../../../../src/adapters/forgejo/forgejo.js')>('../../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
  const productConfig = mockModule<typeof import('../../../../../src/adapters/config/product-config.js')>('../../../../../src/adapters/config/product-config.js', import.meta.url);
  const runtimeMatrix = mockModule<typeof import('../../../../../src/adapters/agents/runtime-matrix.js')>('../../../../../src/adapters/agents/runtime-matrix.js', import.meta.url);
  const integrateConflict = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate-conflict.js')>('../../../../../src/adapters/cli/commands/integrate-conflict.js', import.meta.url);
  const stats = mockModule<typeof import('../../../../../src/adapters/cli/commands/stats.js')>('../../../../../src/adapters/cli/commands/stats.js', import.meta.url);
  const __mm1 = mockModule<typeof import('../../../../../src/composition/application-services.js')>('../../../../../src/composition/application-services.js', import.meta.url);

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
    // Hermetic seams: these resolvers default to the real git CLI (shimmed
    // subprocess per call) and to the operator's live repository when left unmocked.
    mock.method(missionUtilsCjs, 'resolveMissionBaseBranch', () => 'main');
    mock.method(missionUtilsCjs, 'resolveBaseWorktree', () => FAKE_ROOT);
    mock.method(missionUtilsCjs, 'resolveWorktree', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
    mock.method(missionUtilsCjs, 'findMissionDocInBranches', () => []);
    mock.method(gitCjs, 'detectRebaseState', () => ({ inProgress: false, rebaseHead: '', detached: false, unmergedFiles: [], rebaseDir: null }));
    mock.method(integrateConflict, 'getUnresolvedIndexConflicts', () => ({ ok: true, files: [] }));
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
    // The mission carries an authoritative approved Review so integrate's
    // lifecycle recovery reaches the probe-merge flow these tests exercise.
    mock.method(compositionCjs, 'createMissionApplicationServices', async () => ({
      store: {
        _repoId: 'default',
        load: async () => ({ kind: 'found', mission: { status: 'review', review: { rounds: [{ decision: { kind: 'approved', decidedAt: '2026-01-01T10:30:00Z' } }] } }, version: 1 }),
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

    await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration({ ...environment, PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS: '1' }), missionServicesFn: compositionCjs.createMissionApplicationServices });

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

    await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration({ ...environment, PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS: '1' }), missionServicesFn: compositionCjs.createMissionApplicationServices });

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

    await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration({ ...environment, PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS: '1' }), missionServicesFn: compositionCjs.createMissionApplicationServices });

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

    await integrate([TEST_SLUG, '--no-integration-gates'], { configuration: resolveConfiguration({ ...environment, PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS: '1' }), missionServicesFn: compositionCjs.createMissionApplicationServices });

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
});

// ---- integrate guard (consolidated from test/integrate-guard.test.ts, TASK-2622.09) ----
describe("integrate guard", () => {
  const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>('../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const integrate = mockModule<typeof import('../../../../../src/adapters/cli/commands/integrate.js')>('../../../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const previousPrimaryWorktree = environment.PRIMARY_WORKTREE;
  if (previousPrimaryWorktree === undefined) {
    environment.PRIMARY_WORKTREE = `/tmp/visualBoard-${process.pid}`;
  }
  if (previousPrimaryWorktree === undefined) {
    delete environment.PRIMARY_WORKTREE;
  } else {
    environment.PRIMARY_WORKTREE = previousPrimaryWorktree;
  }

  test('integrate guard', async (t) => {
    const originalExit = process.exit;
    const originalError = console.error;
    const originalLog = console.log;

    let exitCode = null;
    let errorOutput = '';

    const stubExit = (code) => {
      exitCode = code;
      throw new Error('process.exit called');
    };

    const stubError = (...args) => {
      errorOutput += args.join(' ') + '\n';
    };

    const stubLog = () => {};

    t.after(() => {
      process.exit = originalExit;
      console.error = originalError;
      console.log = originalLog;
    });

    await t.test('blocks FORGEJO_USER=gemini', async () => {
      process.exit = stubExit;
      console.error = stubError;
      console.log = stubLog;

      const oldUser = environment.FORGEJO_USER;
      const oldAgent = environment.WORKFLOW_AGENT;
      environment.FORGEJO_USER = 'gemini';
      delete environment.WORKFLOW_AGENT;

      exitCode = null;
      errorOutput = '';

      try {
        await integrate.default(['task-1086'], { configuration: resolveConfiguration(environment) });
      } catch (err) {
        if (err.message !== 'process.exit called') throw err;
      } finally {
        environment.FORGEJO_USER = oldUser;
        environment.WORKFLOW_AGENT = oldAgent;
        process.exit = originalExit;
        console.error = originalError;
        console.log = originalLog;
      }

      assert.strictEqual(exitCode, 1);
      assert.ok(errorOutput.includes('[FAIL] Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.'));
    });

    await t.test('blocks WORKFLOW_AGENT=gemini', async () => {
      process.exit = stubExit;
      console.error = stubError;
      console.log = stubLog;

      const oldUser = environment.FORGEJO_USER;
      const oldAgent = environment.WORKFLOW_AGENT;
      delete environment.FORGEJO_USER;
      environment.WORKFLOW_AGENT = 'gemini';

      exitCode = null;
      errorOutput = '';

      try {
        await integrate.default(['task-1086'], { configuration: resolveConfiguration(environment) });
      } catch (err) {
        if (err.message !== 'process.exit called') throw err;
      } finally {
        environment.FORGEJO_USER = oldUser;
        environment.WORKFLOW_AGENT = oldAgent;
        process.exit = originalExit;
        console.error = originalError;
        console.log = originalLog;
      }

      assert.strictEqual(exitCode, 1);
      assert.ok(errorOutput.includes('[FAIL] Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.'));
    });

    await t.test('does not block other agents (e.g. codex)', async () => {
      t.mock.method(missionUtils, 'inferSlug', () => null);
      process.exit = stubExit;
      console.error = stubError;
      console.log = stubLog;

      const oldUser = environment.FORGEJO_USER;
      const oldAgent = environment.WORKFLOW_AGENT;
      environment.FORGEJO_USER = 'codex';
      delete environment.WORKFLOW_AGENT;

      exitCode = null;
      errorOutput = '';

      try {
        // A missing slug reaches the usage guard immediately after the agent
        // authorization check. This test covers authorization only and must not
        // proceed into integration preflight or Forgejo discovery.
        await integrate.default([], { configuration: resolveConfiguration(environment) });
      } catch (err) {
        // It might call process.exit for other reasons (preflight fail), which is fine
      } finally {
        environment.FORGEJO_USER = oldUser;
        environment.WORKFLOW_AGENT = oldAgent;
        process.exit = originalExit;
        console.error = originalError;
        console.log = originalLog;
      }

      assert.ok(!errorOutput.includes('[FAIL] Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.'));
    });
  });
});

// ---- exclusive integrate claim (consolidated from test/integrate-exclusive-claim.test.ts, TASK-2622.09) ----
describe("exclusive integrate claim", () => {
  test('a second integrate for the same mission stops before reading or changing mission state', async () => {
    let held = false;
    let releaseFirst: (() => void) | undefined;
    let enteredFirst: (() => void) | undefined;
    const firstEntered = new Promise<void>(resolve => { enteredFirst = resolve; });
    const finishFirst = new Promise<never>((_resolve, reject) => { releaseFirst = () => reject(new Error('fixture stopped')); });
    let serviceCalls = 0;
    const exits: number[] = [];
    const workflow = createIntegrateWorkflow({
      process: {
        terminate: (code: number) => { exits.push(code); },
        cwd: () => '/tmp/base',
        chdir: () => {},
        claimIntegration: async () => {
          if (held) { return null; }
          held = true;
          return async () => { held = false; };
        },
      },
      missionPaths: { inferSlug: () => 'task-exclusive' },
      git: { git: () => ({ status: 0, stdout: '', stderr: '' }) },
      landing: { isAbort: () => false },
      agents: { startAgent: () => {}, selectAgent: () => null, workflowLauncherStatus: () => null, applyAgentFallback: () => {} },
      backlog: { transitionTask: () => {} },
      gates: { routeIntegrationGateFailure: () => {} },
    } as never);
    const options = {
      missionServicesFn: async () => {
        serviceCalls++;
        enteredFirst?.();
        return finishFirst;
      },
      exitFn: (code: number) => { exits.push(code); },
    };

    const first = workflow.integrate(['task-exclusive'], options);
    await firstEntered;
    const second = await workflow.integrate(['task-exclusive'], options);
    assert.deepEqual(second, { exitCode: 1 });
    assert.equal(serviceCalls, 1);
    assert.equal(held, true);
    releaseFirst?.();
    await first;
    assert.equal(held, false);
    assert.deepEqual(exits, [1, 1]);
  });

  test('repeat integrate reports a landed closed mission without rerunning gates', async () => {
    let gateCalls = 0;
    let released = 0;
    let branchRemains = false;
    const abort = new Error('incomplete closeout');
    const exits: number[] = [];
    const workflow = createIntegrateWorkflow({
      process: {
        terminate: () => {},
        cwd: () => '/tmp/base',
        chdir: () => {},
        claimIntegration: async () => async () => { released++; },
      },
      missionPaths: { inferSlug: () => 'task-closed', getPrimaryWorktree: () => '/tmp/base', missionBranchName: () => 'mission/task-closed', conventionalWorktreePath: () => '/tmp/base-task-closed' },
      fileSystem: { existsSync: () => false },
      git: { git: () => ({ status: branchRemains ? 0 : 1, stdout: '', stderr: '' }) },
      checkout: { findLandedSquashOnBaseBranch: () => 'abc123456789' },
      landing: { isAbort: (error: unknown) => error === abort, createAbort: () => abort },
      agents: { startAgent: () => {}, selectAgent: () => null, workflowLauncherStatus: () => null, applyAgentFallback: () => {} },
      backlog: { transitionTask: () => {} },
      gates: { routeIntegrationGateFailure: () => { gateCalls++; } },
    } as never);
    const result = await workflow.integrate(['task-closed'], {
      missionServicesFn: async () => ({ store: { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt: '2026-09-27T20:50:34Z' } }) } }),
      exitFn: code => { exits.push(code); },
    });
    assert.deepEqual(result, { exitCode: 0 });
    assert.deepEqual(exits, [0]);
    assert.equal(gateCalls, 0);
    assert.equal(released, 1);
    branchRemains = true;
    const incomplete = await workflow.integrate(['task-closed'], {
      missionServicesFn: async () => ({ store: { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt: '2026-09-27T20:50:34Z' } }) } }),
      exitFn: code => { exits.push(code); },
    });
    assert.deepEqual(incomplete, { exitCode: 1 });
    assert.deepEqual(exits, [0, 1]);
    assert.equal(gateCalls, 0);
    assert.equal(released, 2);
  });
});

// ---- task-2411 integrate work detection (consolidated from test/task-2411-integrate-work-detection.test.ts, TASK-2622.09) ----
describe("integrate work detection", () => {
  const repository = repositoryId('parallix');
  const id = missionId('task-2411');

  function integrationMission(): Mission {
    return {
      id,
      repositoryId: repository,
      title: 'Integration work',
      labels: missionLabels(['bug']),
      status: 'integration',
      closedAt: null,
      assignee: agentFamily('codex'),
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
    } as Mission;
  }

  test('running integrate projects as working, not integrate-lane', async () => {
    const builder = new BoardProjectionBuilder(
      {
        async loadAllMissions() { return [integrationMission()]; },
        async loadMission(requested) { return requested === id ? integrationMission() : null; },
        getSourceFacts() { return []; },
      },
      { async loadReviews() { return new Map([[id, { review: null, approval: null }]]); } },
      { async loadGateStatus() { return 'passed' as const; } },
      {
        async loadAgentAvailability() { return []; },
        async loadAssignedAgent() { return agentFamily('codex'); },
        async loadRunningSessions() { return []; },
      },
      { async loadRepositoryId() { return repository; }, async loadHeadCommit() { return 'head'; } },
      { async loadOperationLog() { return []; } },
      {
        currentWork: {
          async loadCurrentWork() {
            return [{
              missionId: id,
              operationId: 'integrate:task-2411',
              phase: 'integrate' as const,
              state: 'running' as const,
              summary: 'px integrate task-2411',
              agent: null,
              processId: process.pid,
              processIdentity: processStartIdentity(process.pid),
              blockedReason: null,
              occurredAt: new Date().toISOString(),
            }];
          },
        },
        isProcessAlive: processLivenessProbe,
      },
    );

    const projection = await builder.build();
    const card = projection.stages.find((stage) => stage.lane === 'integration')?.cards[0];
    const attention = projection.attentionQueue.find((item) => item.missionId === id);

    assert.ok(isWorkInProgress(card?.currentWork));
    assert.equal(attention, undefined);

    const ink = await import('ink');
    const React = await import('react');
    const output = ink.renderToString(
      React.createElement(AttentionItems, {
        queue: projection.attentionQueue,
        selectedMissionId: null,
        focusedIndex: -1,
        sourceStatusMap: new Map(),
      }),
    );
    assert.doesNotMatch(output, /task-2411/);
  });
});
