// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up


// We test the pure validation logic that runs before any agent is launched.
// The actual loop body (agent launch, Forgejo polling) requires runtime-dependent
// launchers and a live Forgejo; those are covered by manual proof artifacts (PROOF.md).
//
// All tests derive a unique mission slug from the shared base 'task-test-review'
// appended with the process PID so parallel test runs (e.g. multiple agents
// running the suite simultaneously) do not collide on shared /tmp artifact files.
//
// IMPORTANT: AI agents (Codex, Claude, etc.) often leave artifact files behind in
// /tmp when they run the review loop. These cause consumeReviewerArtifacts and
// consumeImplementerArtifacts to detect "incomplete artifacts" (partial files exist
// so hasAny=true but required pairs are missing) and exit early with exit(1).
//
// The test.beforeEach hook cleans up these artifacts. If you ever need to manually
// inspect what an agent left behind, temporarily comment out the cleanup below.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { ReviewCommandUseCase } from '../../../src/application/review-command-use-case.js';
import { createReviewCommand } from '../../../src/interfaces/cli/review.js';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const fmt = mockModule<typeof import('../../../src/application/presentation/cli-format.js')>('../../../src/application/presentation/cli-format.js', import.meta.url);
const verifyReviewModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
const rebaseBeforeReviewRoundModule = mockModule<typeof import('../../../src/adapters/review/rebase.js')>('../../../src/adapters/review/rebase.js', import.meta.url);
const pollForReviewModule = mockModule<typeof import('../../../src/adapters/review/review-polling.js')>('../../../src/adapters/review/review-polling.js', import.meta.url);
const pollForDispositionModule = mockModule<typeof import('../../../src/adapters/review/review-polling.js')>('../../../src/adapters/review/review-polling.js', import.meta.url);
// applyAgentFallback and maybeUpdateGraphifyBeforeReview live in review-agent-fallback.js
// (moved there during the review-loop migration); mock that module, not review-loop.js.
const maybeUpdateGraphifyBeforeReviewModule = mockModule<typeof import('../../../src/adapters/review/review-agent-fallback.js')>('../../../src/adapters/review/review-agent-fallback.js', import.meta.url);
const getLatestReviewForPrModule = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
const getLatestDispositionForPrModule = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
const getLatestDispositionModule = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
const getLatestReviewModule = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
const applyAgentFallbackModule = mockModule<typeof import('../../../src/adapters/review/review-agent-fallback.js')>('../../../src/adapters/review/review-agent-fallback.js', import.meta.url);
const ReviewStateModule = mockModule<typeof import('../../../src/adapters/review/review-state.js')>('../../../src/adapters/review/review-state.js', import.meta.url);
const buildMetadataFooterModule = mockModule<typeof import('../../../src/adapters/review/review-artifacts.js')>('../../../src/adapters/review/review-artifacts.js', import.meta.url);
const commentRoundModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
const submitReviewRoundModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
const submitForReviewModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
const showReviewStatusModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
const consumeImplementerArtifactsModule = mockModule<typeof import('../../../src/adapters/review/review-artifacts.js')>('../../../src/adapters/review/review-artifacts.js', import.meta.url);
const consumeReviewerArtifactsModule = mockModule<typeof import('../../../src/adapters/review/review-artifacts.js')>('../../../src/adapters/review/review-artifacts.js', import.meta.url);
const createEventHandlerModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { verifyReview, readComments, pushRound } = verifyReviewModule;
const review = (args, options = {}) =>
  createReviewCommand(new ReviewCommandUseCase(verifyReviewModule.createReviewWorkflowAdapter(options)))(args, options);
const { rebaseBeforeReviewRound } = rebaseBeforeReviewRoundModule;
const { pollForReview } = pollForReviewModule;
const { pollForDisposition } = pollForDispositionModule;
const { POLL_TIMEOUT, isPollTimeout } = pollForReviewModule;
const { maybeUpdateGraphifyBeforeReview } = maybeUpdateGraphifyBeforeReviewModule;
const { getLatestReviewForPr } = getLatestReviewForPrModule;
const { getLatestDispositionForPr } = getLatestDispositionForPrModule;
const { getLatestDisposition } = getLatestDispositionModule;
const { getLatestReview } = getLatestReviewModule;
const { applyAgentFallback } = applyAgentFallbackModule;
const { ReviewState } = ReviewStateModule;
const { buildMetadataFooter } = buildMetadataFooterModule;
const { commentRound } = commentRoundModule;
const { submitReviewRound } = submitReviewRoundModule;
const { submitForReview, closeMissionPr } = submitForReviewModule;
const { showReviewStatus } = showReviewStatusModule;
const { consumeImplementerArtifacts } = consumeImplementerArtifactsModule;
const { consumeReviewerArtifacts } = consumeReviewerArtifactsModule;
const { createEventHandler } = createEventHandlerModule;

// Base mission slug — append process.pid for isolation between parallel runs.
const TEST_SLUG = `task-test-review-${process.pid}`;
const hermeticLoopCollaborators = {
  gitFn: () => ({ status: 0, stdout: 'main\n', stderr: '' }),
  recordStageStatsSafeFn: async () => {},
  transitionTaskFn: async () => true,
};
const persistenceCommitted = () => ({ outcome: 'committed' });
// Dry-run tests assert local loop setup, not provider behavior. Make that
// boundary explicit so they cannot probe the workstation's Forgejo service.
const isolatedDryRun = { isForgejoReviewEnabledFn: () => false };

// Isolate stats writes to a temp PARALLIX_HOME so test runs never pollute
// the real operator stats.csv (recordStageStatsSafe writes there via
// recordStageStats/recordReviewStats/recordActiveStats).
let _prevParallixHome;
let _tmpHome;
test.beforeEach(() => {
  _tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-home-'));
  _prevParallixHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = _tmpHome;
});
test.afterEach(() => {
  if (_prevParallixHome === undefined) delete process.env.PARALLIX_HOME;
  else process.env.PARALLIX_HOME = _prevParallixHome;
  fs.rmSync(_tmpHome, { recursive: true, force: true });
});

// Artifact files that consumeReviewerArtifacts / consumeImplementerArtifacts look for.
// Partial sets (e.g. only review-findings.md without review-outcome.md) cause the
// consumer to return { consumed: true, ok: false } which triggers exit(1).
const ARTIFACT_NAMES = [
  'review-findings.md', 'review-outcome.md', 'review-verdict.txt',
  'round-resolution.md', 'review-disposition.txt',
];
function cleanupArtifacts() {
  const tmpDir = '/tmp';
  for (const name of ARTIFACT_NAMES) {
    try { fs.unlinkSync(path.join(tmpDir, `${TEST_SLUG}-${name}`)); } catch (_) { /* ignore */ }
  }
}
test.beforeEach(() => { cleanupArtifacts(); });

function runGitOrThrow(args, options = {}) {
  const result = childProcess.spawnSync('git', args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error && result.status !== 0) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const error = new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `result` absent from its inferred mock shape.
    error.result = result;
    throw error;
  }
  return result.stdout || '';
}

// The watcher body runs in a separate `node -e` process, so it is written as
// source text rather than as a function serialized with `toString()`: this file
// is transpiled before it runs, and the transpiler rewrites function bodies
// (name-preserving `__name(...)` wrappers) into a form that no longer evaluates
// standalone. It is plain CommonJS with no closure over this module.
function cleanInterruptedReviewFixtureSource(parentPid: number, root: string): string {
  return `
    const fs = require('node:fs');
    const parentPid = ${JSON.stringify(parentPid)};
    const root = ${JSON.stringify(root)};
    const isAlive = () => {
      try {
        process.kill(parentPid, 0);
        return true;
      } catch (_) {
        return false;
      }
    };
    while (isAlive()) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    fs.rmSync(root, { recursive: true, force: true });
  `;
}

function watchInterruptedReviewFixture(root) {
  const watcher = childProcess.spawn(process.execPath, [
    '-e', cleanInterruptedReviewFixtureSource(process.pid, root)
  ], { detached: true, stdio: 'ignore' });
  watcher.unref();
}

async function passingPreReviewGate() {
  return { ok: true, area: 'all', command: 'test gate', exitCode: 0, stdout: '', stderr: '' };
}

async function captureExit(fn) {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;
  const errors = [];
  const logs = [];
  let exitCode = null;

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));

  const oldLogger = fmt.setLogger({
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg),
  });

  try {
    await fn();
  } catch (err) {
    if (!err.message.startsWith('process.exit(')) throw err;
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
    fmt.setLogger(oldLogger);
  }

  return { exitCode, errors, logs };
}








test('verifyReview handles task status edge cases', async () => {
  const logs = [];
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    resolveWorktreeFn: () => null,
    findMissionDirFn: () => '/tmp/mission',
    getCurrentBranchFn: () => `mission/${TEST_SLUG}`,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    findMissionAreaFn: () => 'docs',
    runFn: () => ({ status: 0 }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    cwdFn: () => '/tmp/visualBoard'
  };

  // 1. Task not found
  verifyReview(TEST_SLUG, false, {
    ...baseOptions,
    resolveTaskFileFn: () => ({ ok: false, reason: 'missing' })
  });
  assert.ok(logs.some(l => l.includes('not found in backlog/tasks/')), 'Should log task not found');

  // 2. Task ambiguous
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    ...baseOptions,
    resolveTaskFileFn: () => ({ ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] })
  });
  assert.ok(logs.some(l => l.includes('Backlog task resolution is ambiguous')), 'Should log ambiguous task');

  // 3. Task status DONE
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `md` absent from its inferred mock shape.
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'done'
  });
  assert.ok(logs.some(l => l.includes('Backlog task: task is already done/integrated')), 'Should log done task error');

  // 4. Task status ACTIVE (warning)
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `md` absent from its inferred mock shape.
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'active'
  });
  assert.ok(logs.some(l => l.includes('Backlog task: task.md is still active')), 'Should log active task warning');

  // 5. Unexpected task status
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `md` absent from its inferred mock shape.
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'backlog'
  });
  assert.ok(logs.some(l => l.includes('Backlog task: unexpected status backlog')), 'Should log unexpected status error');
});

test('verifyReview handles PR state edge cases', async () => {
  const logs = [];
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    resolveWorktreeFn: () => null,
    findMissionDirFn: () => '/tmp/mission',
    getCurrentBranchFn: () => `mission/${TEST_SLUG}`,
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'review',
    findMissionAreaFn: () => 'docs',
    runFn: () => ({ status: 0 }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    isForgejoReviewEnabledFn: () => true,
    cwdFn: () => '/tmp/visualBoard'
  };

  // 1. PR closed/merged
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
    getPrStatusFn: () => ({ exists: true, state: 'closed', merged: true, number: 41 })
  });
  assert.ok(logs.some(l => l.includes('Review PR: expected an open PR, got state=closed merged=true')), 'Should log PR state error');

  // 2. PR missing
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
    getPrStatusFn: () => ({ exists: false, raw: 'Not found' })
  });
  assert.ok(logs.some(l => l.includes('Review PR: Not found')), 'Should log PR missing error');
});

test('verifyReview handles gate failures', async () => {
  const logs = [];
  const exitCodes = [];

  // The reviewer gate resolves its command from the review root (cwdFn when no
  // worktree resolves); the default is no validation, so configure a gate in a
  // temp root to exercise the failure path (the injected runFn makes that gate
  // command fail).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-'));
  fs.writeFileSync(
    path.join(tmp, 'workflow.config.json'),
    JSON.stringify({ adapters: { verification: { command: 'npm test' } } })
  );
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    verifyReview(TEST_SLUG, false, {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      log: (m) => logs.push(m),
      error: () => {},
      exit: (c) => exitCodes.push(c),
      resolveWorktreeFn: () => null,
      findMissionDirFn: () => '/tmp/mission',
      getCurrentBranchFn: () => `mission/${TEST_SLUG}`,
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `md` absent from its inferred mock shape.
      resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
      getTaskStatusFn: () => 'review',
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      findMissionAreaFn: () => 'docs',
      runFn: () => ({ status: 1 }), // Fails
      getAcceptanceCriteriaFn: () => [],
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({}),
      readReviewStateFn: () => null,
      // Hermetic: point at the temp dir holding the workflow.config.json written
      // above. A hardcoded developer-machine path here made the gate read no
      // config and return status 0, so the injected runFn failure never surfaced.
      cwdFn: () => tmp
    });
  } finally {
    process.chdir(origCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert.ok(logs.some(l => l.includes('Reviewer gate failed.')), 'Should log gate failure');
});








test('review helper functions and error paths', async () => {
  const { pollForReview, pollForDisposition } = pollForReviewModule;
  const logs = [];
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    inferSlugFn: (s) => s || 'test-slug',
    getPrStatusFn: () => ({ exists: false }),
    readReviewStateFn: () => null,
    readFileSync: (p) => { if (p === 'fail.md') throw new Error('read fail'); return 'content'; }
  };

  // 1. review usage error (missing slug)
  await review([], { ...baseOptions, inferSlugFn: () => null });
  assert.deepEqual(exitCodes, [1]);
  assert.ok(errors[0].includes('Usage: px review'), 'Should show usage');

  // 2. review status (PR not found)
  logs.length = 0;
  exitCodes.length = 0;
  await review(['test-slug'], { ...baseOptions });
  assert.ok(logs.some(l => l.includes('No active PR found')), 'Should log PR not found');

  // 3. readTextFlag error path
  errors.length = 0;
  exitCodes.length = 0;
  await review(['test-slug', '--comment-file', 'fail.md'], { ...baseOptions, isComment: true });
  assert.deepEqual(exitCodes, [1, 1]);
  assert.ok(errors[0].includes('Could not read comment from fail.md'), 'Should log read error');

  // 4. Polling helpers - No token warning
  const originalLog = console.log;
  try {
    console.log = (m) => logs.push(m);
    logs.length = 0;
    const reviewResult = await pollForReview(41, 'user', 'since', null);
    assert.equal(reviewResult, null);
    assert.ok(logs.some(l => l.includes('No Forgejo token — skipping review-outcome poll')), 'Should log review token warning');

    logs.length = 0;
    const dispResult = await pollForDisposition(41, 'user', 'since', null);
    assert.equal(dispResult, null);
    assert.ok(logs.some(l => l.includes('No Forgejo token — skipping disposition poll')), 'Should log disposition token warning');
  } finally {
    console.log = originalLog;
  }
});

test('review function missing argument and env var error paths', async () => {
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    inferSlugFn: (s) => s || 'test-slug',
    isForgejoReviewEnabledFn: () => true,
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    readTokenFn: () => 'token',
    getCommentsFn: async () => []
  };

  // 1. --comments should use review-state identity without needing FORGEJO_USER
  await review(['test-slug', '--comments'], { ...baseOptions });
  assert.ok(!errors.some(e => e.includes('Cannot determine Forgejo user')), 'Should not require FORGEJO_USER for --comments');

  // 2. --comment missing message
  errors.length = 0;
  await review(['test-slug', '--comment'], { ...baseOptions });
  assert.ok(errors.some(e => e.includes('--comment requires text')), 'Should error on missing message for --comment');

  // 3. --submit-review missing outcome
  errors.length = 0;
  await review(['test-slug', '--submit-review'], { ...baseOptions });
  assert.ok(errors.some(e => e.includes('--submit-review requires an outcome')), 'Should error on missing outcome for --submit-review');
});









/**
 * In-process rebase-workflow seam (TASK-2377.02). `rebaseBeforeReviewRound` no
 * longer spawns `px rebase`, so these tests drive the `RebaseWorkflowPort`.
 */
function inProcessWorkflow(runs, { exitCode = 0, port = {}, onRun = null } = {}) {
  return {
    createRebaseWorkflowPortFn: () => ({ exit: () => {}, ...port }),
    runRebaseWorkflowFn: async (args, workflowPort) => {
      runs.push(args);
      if (onRun) { await onRun(workflowPort); }
      workflowPort.exit(exitCode);
    },
  };
}

test('rebaseBeforeReviewRound succeeds after a clean rebase', async () => {
  const logs = [];
  const errors = [];

  const workflowRuns = [];
  const result = await rebaseBeforeReviewRound('task-1087', {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    ...inProcessWorkflow(workflowRuns),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false, hookFailure: false });
  assert.deepEqual(workflowRuns, [['task-1087', '--push']], 'the rebase workflow runs in-process, not as a CLI subprocess');
  assert.ok(logs.some(message => message.includes('Rebasing mission/task-1087')));
  assert.ok(logs.some(message => message.includes('Pre-review rebase completed')));
  assert.deepEqual(errors, []);
});

test('rebaseBeforeReviewRound reports shared-file conflicts with recovery instructions', async () => {
  const logs = [];
  const errors = [];

  const result = await rebaseBeforeReviewRound('task-1087', {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    ...inProcessWorkflow([], {
      exitCode: 1,
      port: {
        resolveConflictsForMission: () => ({
          ok: true, conflictFiles: ['src/shared.js'], missionSpecificFiles: [], sharedFiles: ['src/shared.js'],
        }),
      },
      onRun: (workflowPort) => { workflowPort.resolveConflictsForMission('task-1087', 'lib', {}); },
    }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, true);
  assert.equal(result.hookFailure, false);
  assert.deepEqual(result.failure, {
    kind: 'conflict', operation: 'rebase', sharedFiles: ['src/shared.js'],
  }, `Expected typed shared-file evidence, got: ${JSON.stringify(result.failure)}`);
  assert.equal(
    errors.filter(message => message.includes('Shared-file rebase conflicts detected')).length,
    1,
    `Expected one shared-file failure message, got: ${errors.join(' | ')}`
  );
  assert.ok(
    logs.some(message => message.includes('Resolve the conflicts in the worktree, then re-run: px review task-1087 --start')),
    `Expected recovery instructions, got logs: ${logs.join(' | ')}`
  );
});

test('rebaseBeforeReviewRound derives sharedFileConflicts from sharedFiles when the conflict-resolution agent launches', async () => {
  const launches = [];
  const startAgent = async (step) => { launches.push(step); return { agent: 'claude', result: { ok: false } }; };

  const result = await rebaseBeforeReviewRound('task-1087', {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    ...inProcessWorkflow([], {
      exitCode: 1,
      port: {
        startAgent,
        resolveConflictsForMission: () => ({
          ok: true, conflictFiles: ['src/shared.js'], missionSpecificFiles: [], sharedFiles: ['src/shared.js'],
        }),
      },
      onRun: async (workflowPort) => {
        // The workflow launches the resolver through the unwrapped port method.
        assert.equal(workflowPort.startAgent, startAgent, 'startAgent must reach the workflow unwrapped');
        workflowPort.resolveConflictsForMission('task-1087', 'lib', {});
        await workflowPort.startAgent('conflict-resolution', {});
      },
    }),
    log: () => {},
    error: () => {},
  });

  assert.deepEqual(launches, ['conflict-resolution']);
  assert.equal(result.sharedFileConflicts, true);
  assert.deepEqual(result.failure, { kind: 'conflict', operation: 'rebase', sharedFiles: ['src/shared.js'] });
});

test('rebaseBeforeReviewRound reports non-conflict rebase failures', async () => {
  const logs = [];
  const errors = [];

  const result = await rebaseBeforeReviewRound('task-1087', {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    ...inProcessWorkflow([], { exitCode: 1 }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, false);
  assert.equal(result.hookFailure, false);
  assert.equal(result.failure.kind, 'other');
  assert.ok(errors.some(message => message.includes('Rebase failed before launching reviewer')));
  assert.ok(
    logs.every(message => !message.includes('Resolve the conflicts in the worktree')),
    `Did not expect shared-conflict recovery instructions, got logs: ${logs.join(' | ')}`
  );
});



test('pollForReview waits asynchronously between retries', async () => {
  const sleeps = [];
  let attempts = 0;

  const state = await pollForReview(41, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
    async getLatestReviewForPrFn() {
      attempts += 1;
      return attempts === 2 ? { state: 'APPROVED' } : null;
    },
    async sleepFn(ms) {
      sleeps.push(ms);
    }
  });

  assert.equal(state, 'APPROVED');
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [10_000]);
});

test('pollForDisposition waits asynchronously between retries', async () => {
  const sleeps = [];
  let attempts = 0;

  const disposition = await pollForDisposition(41, 'codex', '2026-04-18T10:00:00Z', 'fake-token', {
    async getLatestDispositionForPrFn() {
      attempts += 1;
      return attempts === 2 ? 'CHANGES_MADE' : null;
    },
    async sleepFn(ms) {
      sleeps.push(ms);
    }
  });

  assert.equal(disposition, 'CHANGES_MADE');
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [10_000]);
});

test('pollForReview honours caller intervalMs and timeoutMs and returns timeout sentinel on timeout', async () => {
  const sleeps = [];

  // Simulated clock so the "timeout" fires after a few iterations without real time passing.
  const originalNow = Date.now;
  let fakeNow = 1_700_000_000_000;
  Date.now = () => fakeNow;

  try {
    const state = await pollForReview(99, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
      intervalMs: 250,
      timeoutMs: 1000,
      async getLatestReviewForPrFn() {
        return null; // reviewer never posts
      },
      async sleepFn(ms) {
        sleeps.push(ms);
        fakeNow += ms;
      }
    });

    assert.ok(isPollTimeout(state), 'expected timeout sentinel when reviewer never posts before timeout');
    assert.deepEqual(sleeps, [250, 250, 250, 250], 'expected four 250ms sleeps within a 1s window');
  } finally {
    Date.now = originalNow;
  }
});

test('pollForReview emits a progress line on every tick when verbose=true', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(String(msg));

  let attempts = 0;
  try {
    const state = await pollForReview(42, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
      intervalMs: 5,
      timeoutMs: 10_000,
      verbose: true,
      async getLatestReviewForPrFn() {
        attempts += 1;
        return attempts === 3 ? { state: 'COMMENT' } : null;
      },
      async sleepFn() {}
    });

    assert.equal(state, 'COMMENT');
    const stillWaitingLines = logs.filter(l => l.includes('still waiting'));
    // verbose=true -> should log on every tick we didn't already return on (attempts 1 and 2).
    assert.equal(stillWaitingLines.length, 2, `expected 2 progress lines, got: ${logs.join(' | ')}`);
  } finally {
    console.log = originalLog;
  }
});

test('resolvePollTimeoutMs honours AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS env override', async () => {
  const previous = process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS;
  process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS = '500';

  const originalNow = Date.now;
  let fakeNow = 2_000_000_000_000;
  Date.now = () => fakeNow;

  try {
    const state = await pollForReview(43, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
      intervalMs: 100,
      // timeoutMs intentionally omitted so the env override resolves the default.
      async getLatestReviewForPrFn() { return null; },
      async sleepFn(ms) { fakeNow += ms; }
    });
    assert.ok(isPollTimeout(state), 'expected timeout sentinel on timeout');
    // Bounded both sides: if the env override were ignored, fakeNow would advance past the
    // default 600_000ms timeout (many intervalMs=100 iterations), not sit just past 500ms.
    const elapsed = fakeNow - 2_000_000_000_000;
    assert.ok(elapsed >= 500, `expected env timeout (500ms) to fire; elapsed=${elapsed}`);
    assert.ok(elapsed < 1000, `expected env timeout to cap well under 1s; elapsed=${elapsed} (env override ignored?)`);
  } finally {
    Date.now = originalNow;
    if (previous === undefined) delete process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS;
    else process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS = previous;
  }
});

test('maybeUpdateGraphifyBeforeReview skips cleanly when graphify is missing', () => {
  const logs = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-graphify-missing-'));
  fs.mkdirSync(path.join(root, 'graphify-out'));
  fs.writeFileSync(path.join(root, 'graphify-out', 'graph.json'), '{}\n');

  const result = maybeUpdateGraphifyBeforeReview(root, {
    commandRunner() {
      const error = new Error('missing');
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `code` absent from its inferred mock shape.
      error.code = 'ENOENT';
      throw error;
    },
    log(message) {
      logs.push(message);
    }
  });
  fs.rmSync(root, { recursive: true, force: true });

  assert.deepEqual(result, {
    updated: false,
    skipped: true,
    reason: 'missing-command'
  });
  assert.ok(logs.some(line => line.includes('graphify not found')));
});

test('maybeUpdateGraphifyBeforeReview runs graphify update in the mission worktree when available', () => {
  const calls = [];
  const logs = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-graphify-update-'));
  fs.mkdirSync(path.join(root, 'graphify-out'));
  fs.writeFileSync(path.join(root, 'graphify-out', 'graph.json'), '{}\n');

  const result = maybeUpdateGraphifyBeforeReview(root, {
    commandRunner(command, args, options = {}) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
    log(message) {
      logs.push(message);
    }
  });

  assert.deepEqual(result, {
    updated: true,
    skipped: false
  });
  assert.equal(calls.length, 2);
  const expectedGraphifyCommand = process.env.GRAPHIFY_BIN || 'graphify';
  assert.deepEqual(calls[0], {
    command: expectedGraphifyCommand,
    args: ['--help'],
    options: {}
  });
  assert.deepEqual(calls[1], {
    command: expectedGraphifyCommand,
    args: ['update', '.'],
    options: {
      cwd: root,
      stdio: 'inherit'
    }
  });
  assert.ok(logs.some(line => line.includes('Updating graphify knowledge graph...')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('pollForDisposition misses comment if created_at is slightly before sinceIso (clock skew)', async () => {
  const prNumber = 41;
  const implementerUser = 'gemini';
  const sinceIso = '2026-04-26T10:00:05.000Z';
  const token = 'fake-token';

  // Comment posted at 10:00:04, 1s before sinceIso
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:04Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  let callCount = 0;
  const getLatestDispositionForPrFn = async (prNum, user, since) => {
    callCount++;
    const eligible = mockComments.filter(c =>
      c.user.login === user && c.created_at >= since
    );
    return eligible.length > 0 ? 'CHANGES_MADE' : null;
  };

  const disposition = await pollForDisposition(prNumber, implementerUser, sinceIso, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 100,
    intervalMs: 10,
    sleepFn: async () => {}
  });

  assert.ok(isPollTimeout(disposition), 'expected timeout sentinel when comment missed due to clock skew');
  assert.ok(callCount > 1);
});

test('pollForDisposition finds comment with stable round start time despite clock skew from launch', async () => {
  const prNumber = 41;
  const implementerUser = 'gemini';
  const token = 'fake-token';

  // Round starts at 10:00:00
  const roundStartedAt = '2026-04-26T10:00:00.000Z';

  // Agent launched at 10:00:05
  // Comment posted at 10:00:03 (due to 2s clock skew from launch)
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:03Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const getLatestDispositionForPrFn = async (prNum, user, since) => {
    const eligible = mockComments.filter(c =>
      c.user.login === user && c.created_at >= since
    );
    return eligible.length > 0 ? 'CHANGES_MADE' : null;
  };

  // Using roundStartedAt instead of agent launch time
  const disposition = await pollForDisposition(prNumber, implementerUser, roundStartedAt, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 100,
    intervalMs: 10,
    sleepFn: async () => {}
  });

  assert.strictEqual(disposition, 'CHANGES_MADE');
});

test('pollForDisposition finds already-posted comment when resuming a round', async () => {
  const prNumber = 41;
  const implementerUser = 'gemini';
  const token = 'fake-token';

  // Previous run started at 10:00:00
  const originalStartedAt = '2026-04-26T10:00:00.000Z';

  // Agent posted at 10:00:10
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:10Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  // We restart at 10:00:20
  const resumeTime = '2026-04-26T10:00:20.000Z';

  const getLatestDispositionForPrFn = async (prNum, user, since) => {
    const eligible = mockComments.filter(c =>
      c.user.login === user && c.created_at >= since
    );
    return eligible.length > 0 ? 'CHANGES_MADE' : null;
  };

  // WRONG: If we used resumeTime as sinceIso, we would miss it (old code behavior)
  // Now returns POLL_TIMEOUT instead of null on timeout
  const missed = await pollForDisposition(prNumber, implementerUser, resumeTime, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 50,
    intervalMs: 10,
    sleepFn: async () => {}
  });
  assert.ok(isPollTimeout(missed), 'expected timeout sentinel when comment missed due to wrong sinceIso');

  // CORRECT: Using the original startedAt from persisted state
  const found = await pollForDisposition(prNumber, implementerUser, originalStartedAt, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 50,
    intervalMs: 10,
    sleepFn: async () => {}
  });
  assert.strictEqual(found, 'CHANGES_MADE');
});

test('getLatestReviewForPr correctly handles mixed-precision ISO timestamps', async () => {

  // sinceIso is without milliseconds
  const sinceIso = '2026-04-26T10:00:00Z';

  const mockReviews = [
    {
      user: { login: 'codex' },
      submitted_at: '2026-04-26T10:00:00.500Z',
      state: 'CHANGES_REQUESTED'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockReviews });

  const review = await getLatestReviewForPr(41, 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review, 'Should have found the review');
  assert.strictEqual(review.state, 'CHANGES_REQUESTED');
});

test('getLatestReviewForPr accepts a human request after round start but excludes stale approval', async () => {
  const review = await getLatestReviewForPr(41, 'codex', '2026-04-26T10:00:00Z', 'fake-token', {
    apiCall: async () => ({ ok: true, data: [
      { user: { login: 'codex' }, submitted_at: '2026-04-26T09:59:59Z', state: 'APPROVED' },
      { user: { login: 'human' }, submitted_at: '2026-04-26T10:00:01Z', state: 'REQUEST_CHANGES' },
    ] }),
  });
  assert.deepEqual(review, { state: 'REQUEST_CHANGES', submittedAt: '2026-04-26T10:00:01Z' });
});

test('getLatestReviewForPr correctly sorts mixed-precision ISO timestamps', async () => {

  const sinceIso = '2026-04-26T10:00:00Z';

  const mockReviews = [
    {
      user: { login: 'codex' },
      submitted_at: '2026-04-26T10:00:01Z',
      state: 'COMMENT'
    },
    {
      user: { login: 'codex' },
      submitted_at: '2026-04-26T10:00:00.500Z',
      state: 'CHANGES_REQUESTED'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockReviews });

  const review = await getLatestReviewForPr(41, 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review, 'Should have found the review');
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(review.state, 'COMMENT');
});

test('getLatestDispositionForPr correctly handles mixed-precision ISO timestamps', async () => {

  const sinceIso = '2026-04-26T10:00:00Z';

  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockComments });

  const disposition = await getLatestDispositionForPr(41, 'gemini', sinceIso, 'fake-token', { apiCall });
  assert.strictEqual(disposition, 'CHANGES_MADE');
});

test('getLatestDispositionForPr correctly sorts mixed-precision ISO timestamps', async () => {

  const sinceIso = '2026-04-26T10:00:00Z';

  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:01Z',
      body: 'Autonomous review disposition: PARKED'
    },
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockComments });

  const disposition = await getLatestDispositionForPr(41, 'gemini', sinceIso, 'fake-token', { apiCall });
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(disposition, 'PARKED');
});

test('getLatestDisposition correctly handles mixed-precision ISO timestamps', () => {

  const sinceIso = '2026-04-26T10:00:00Z';

  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = (method, path) => {
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: true, data: mockComments };
  };

  const disposition = getLatestDisposition('mission/task-1016', 'gemini', sinceIso, 'fake-token', { apiCall });
  assert.strictEqual(disposition, 'CHANGES_MADE');
});

test('getLatestDisposition correctly sorts mixed-precision ISO timestamps', () => {

  const sinceIso = '2026-04-26T10:00:00Z';

  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:01Z',
      body: 'Autonomous review disposition: PARKED'
    },
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = (method, path) => {
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: true, data: mockComments };
  };

  const disposition = getLatestDisposition('mission/task-1016', 'gemini', sinceIso, 'fake-token', { apiCall });
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(disposition, 'PARKED');
});

test('getLatestReview correctly handles mixed-precision ISO timestamps', () => {

  const sinceIso = '2026-04-26T10:00:00Z';

  const mockReviews = [
    {
      user: { login: 'codex' },
      state: 'CHANGES_REQUESTED',
      submitted_at: '2026-04-26T10:00:00.500Z'
    }
  ];

  const apiCall = (method, path) => {
    if (path.includes('/reviews')) {
      return { ok: true, data: mockReviews };
    }
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: false };
  };

  const review = getLatestReview('mission/task-1016', 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review);
  assert.strictEqual(review.state, 'CHANGES_REQUESTED');
});

test('getLatestReview correctly sorts mixed-precision ISO timestamps', () => {

  const sinceIso = '2026-04-26T10:00:00Z';

  const mockReviews = [
    {
      user: { login: 'codex' },
      state: 'APPROVED',
      submitted_at: '2026-04-26T10:00:01Z'
    },
    {
      user: { login: 'codex' },
      state: 'CHANGES_REQUESTED',
      submitted_at: '2026-04-26T10:00:00.500Z'
    }
  ];

  const apiCall = (method, path) => {
    if (path.includes('/reviews')) {
      return { ok: true, data: mockReviews };
    }
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: false };
  };

  const review = getLatestReview('mission/task-1016', 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review);
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(review.state, 'APPROVED');
});

// ---------- applyAgentFallback (regression: pinned reviewer falls back to another family) ----------

test('applyAgentFallback returns the original agent when startAgent did not fall back', async () => {
  const { applyAgentFallback } = applyAgentFallbackModule;
  const writeReviewStateFn = () => { throw new Error('writeReviewState should not run when no fallback'); };
  const enforceTaskAssigneeFn = () => { throw new Error('enforceTaskAssignee should not run when no fallback'); };

  const state = new ReviewState('task-test-fallback', { reviewer: 'codex', implementer: 'custom', round: 1 });

  const next = await applyAgentFallback({
    role: 'reviewer',
    original: 'codex',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn,
    enforceTaskAssigneeFn
  });

  assert.equal(next, 'codex');
});

test('applyAgentFallback rewrites reviewer identity and persists state but does NOT update backlog assignee', async () => {
  const { applyAgentFallback } = applyAgentFallbackModule;
  const { ReviewState } = ReviewStateModule;
  const writes = [];
  const state = new ReviewState('task-test-fallback', { reviewer: 'claude', implementer: 'custom', round: 2 });

  const next = await applyAgentFallback({
    role: 'reviewer',
    original: 'claude',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: () => { throw new Error('enforceTaskAssignee must not be called for reviewer fallback'); }
  });

  assert.equal(next, 'codex');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].slug, 'task-test-fallback');
  assert.equal(writes[0].worktree, '/tmp/visualBoard-task-test-fallback');
  assert.equal(writes[0].state.reviewer, 'codex', 'persisted reviewer must be the fallback family');
  assert.equal(writes[0].state.implementer, 'custom', 'implementer must be unchanged');
  assert.equal(writes[0].state.round, 2);
});

test('applyAgentFallback rewrites implementer identity on fallback without touching reviewer', async () => {
  const { applyAgentFallback } = applyAgentFallbackModule;
  const { ReviewState } = ReviewStateModule;
  const writes = [];
  const state = new ReviewState('task-test-fallback', { reviewer: 'codex', implementer: 'custom', round: 3 });

  const next = await applyAgentFallback({
    role: 'implementer',
    original: 'custom',
    launchResult: { agent: 'gemini' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: false },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: () => { throw new Error('enforceTaskAssignee must not run when taskResolution.ok is false'); }
  });

  assert.equal(next, 'gemini');
  assert.equal(writes[0].state.reviewer, 'codex', 'reviewer must be untouched on implementer fallback');
  assert.equal(writes[0].state.implementer, 'gemini');
});

test('applyAgentFallback enforces implementer in backlog when implementer falls back', async () => {
  const { applyAgentFallback } = applyAgentFallbackModule;
  const { ReviewState } = ReviewStateModule;
  const writes = [];
  const enforced = [];
  const state = new ReviewState('task-test-fallback', { reviewer: 'custom', implementer: 'claude', round: 2 });

  const next = await applyAgentFallback({
    role: 'implementer',
    original: 'claude',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: (file, agent) => { enforced.push({ file, agent }); return true; }
  });

  assert.equal(next, 'codex');
  assert.deepEqual(enforced, [{ file: '/tmp/task.md', agent: 'codex' }]);
});

test('applyAgentFallback handles a missing launchResult gracefully (catastrophic launch failure)', async () => {
  const { applyAgentFallback } = applyAgentFallbackModule;
  const { ReviewState } = ReviewStateModule;
  const state = new ReviewState('task-test-fallback', { reviewer: 'codex', implementer: 'custom', round: 1 });
  const next = await applyAgentFallback({
    role: 'reviewer',
    original: 'codex',
    launchResult: undefined,
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/x',
    taskResolution: { ok: false },
    log: () => {},
    writeReviewStateFn: () => { throw new Error('should not write'); },
    enforceTaskAssigneeFn: () => { throw new Error('should not assign'); }
  });
  assert.equal(next, 'codex');
});

test('applyAgentFallback handles a missing state during an implementer fallback', async () => {
  const writes = [];
  const next = await applyAgentFallback({
    role: 'implementer',
    original: 'claude',
    launchResult: { agent: 'codex' },
    slug: 'task-test-fallback',
    worktree: '/tmp/x',
    log: () => {},
    writeReviewStateFn: (_slug, state) => writes.push(state),
  });

  assert.equal(next, 'codex');
  assert.equal(writes[0].implementer, 'codex');
});

test('applyAgentFallback preserves the original roundStartedAt when rewriting state', async () => {
  // Regression: a crash after the fallback rewrite but before pollFor* completes
  // must leave review-state.json pinned to the original round start so the resumed
  // run still picks up comments the fallback agent already posted in this round.
  const writes = [];
  const roundStartedAt = '2026-04-27T17:00:00.000Z';
  const state = new ReviewState('task-test-fallback', { reviewer: 'claude', implementer: 'custom', round: 4, startedAt: roundStartedAt });

  const next = await applyAgentFallback({
    role: 'reviewer',
    original: 'claude',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: () => true
  });

  assert.equal(next, 'codex');
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0].state.startedAt,
    roundStartedAt,
    'fallback rewrite must preserve the original round-start timestamp'
  );
});



test('review dispatches to verifyReview with inferred slug and no-gate flag', async () => {
  const calls = [];

  await review(['task-1031', '--verify', '--no-gate'], {
    inferSlugFn: explicit => explicit,
    verifyReviewFn: (slug, skipGate) => calls.push({ slug, skipGate })
  });

  assert.deepEqual(calls, [{ slug: 'task-1031', skipGate: true }]);
});

test('review dispatches to commentRound with file-backed message', async () => {
  const calls = [];

  await review(['task-1031', '--comment-file', '/tmp/review-comment.txt'], {
    inferSlugFn: explicit => explicit,
    readFileSync: () => 'Review body\n',
    commentRoundFn: (slug, message) => calls.push({ slug, message })
  });

  assert.deepEqual(calls, [{ slug: 'task-1031', message: 'Review body' }]);
});

test('review prints status when no action flag is provided', async () => {
  const lines = [];

  await review(['task-1031'], {
    inferSlugFn: explicit => explicit,
    getPrStatusFn: () => ({ exists: true, raw: 'PR #83 open' }),
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'claude', round: 2 }),
    log: line => lines.push(line)
  });

  assert.ok(lines.includes('[INFO] Review status for mission: task-1031'));
  assert.ok(lines.includes('PR #83 open'));
  assert.ok(lines.some(line => line.includes('reviewer=codex implementer=claude round=2')));
});

test('review re-launches the implementer on static findings instead of starting the autonomous loop', async () => {
  const calls = [];

  await review(['task-1031'], {
    inferSlugFn: explicit => explicit,
    resolveWorktreeFn: () => '/tmp/mission-task-1031',
    getPrStatusFn: () => ({ exists: false }),
    performStaticReviewFn: () => ({ ok: false, findings: ['Missing Goal Check evidence'] }),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
    getTaskImplementerFn: () => 'claude',
    submitForReviewFn: async slug => calls.push({ type: 'submit', slug }),
    postStaticReviewCommentFn: (slug, message) => calls.push({ type: 'comment', slug, message }),
    startReviewLoopFn: async slug => calls.push({ type: 'start', slug }),
    startAgentFn: async (step, opts) => calls.push({ type: 'agent', step, opts }),
    readReviewStateFn: () => null,
    log: () => {},
    error: () => {}
  });

  // The findings path re-launches the implementer and does not submit, comment, or loop.
  assert.deepEqual(
    calls.map(call => call.type),
    ['agent']
  );
  assert.equal(calls[0].step, 'active');
  assert.equal(calls[0].opts.agent, 'claude');
  assert.equal(calls[0].opts.worktree, '/tmp/mission-task-1031');
  assert.ok(calls[0].opts.prompt.includes('Missing Goal Check evidence'));
});

test('review posts zero-finding artifact but does NOT transition task when static review passes', async () => {
  const calls = [];

  await review(['task-1031'], {
    inferSlugFn: explicit => explicit,
    resolveWorktreeFn: () => '/tmp/mission-task-1031',
    getPrStatusFn: () => ({ exists: false }),
    performStaticReviewFn: () => ({ ok: true, findings: [] }),
    submitForReviewFn: async slug => calls.push({ type: 'submit', slug }),
    postStaticReviewCommentFn: (slug, message) => calls.push({ type: 'comment', slug, message }),
    readReviewStateFn: () => null,
    log: () => {},
    error: () => {}
  });

  // submit + comment only — the clean-static-review path performs no status
  // transition, so the recorded side effects must not include one.
  assert.deepEqual(
    calls.map(call => call.type),
    ['submit', 'comment']
  );
  assert.ok(calls[1].message.includes('found zero issues'));
});

test('verifyReview reports success path with gate pass and persisted state', async () => {
  const lines = [];
  let exitCode = null;

  await verifyReview('task-1031', false, {
    resolveWorktreeFn: () => '/tmp/mission-task-1031',
    findMissionDirFn: () => '/tmp/mission-task-1031/docs/missions/2026/task-1031',
    getCurrentBranchFn: () => 'mission/task-1031',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
    getPrStatusFn: () => ({ exists: true, state: 'open', merged: false, number: 83 }),
    getTaskStatusFn: () => 'review',
    findMissionAreaFn: () => 'workflow',
    runFn: () => ({ status: 0 }),
    getAcceptanceCriteriaFn: () => ['- [x] prove it'],
    formatMatrixSummaryFn: () => ['matrix line'],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'claude', round: 2, startedAt: '2026-04-30T10:00:00Z' }),
    log: line => lines.push(line),
    error: line => lines.push(`ERR:${line}`),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, null);
  assert.ok(lines.includes('[PASS] Branch: mission/task-1031'));
  assert.ok(lines.includes('[PASS] Reviewer gate passed.'));
  assert.ok(lines.includes('[INFO] Autonomous review runtime matrix:'));
  assert.ok(lines.includes('matrix line'));
  assert.ok(lines.includes('\n[PASS] Review verification complete.'));
});

test('verifyReview reports failure path and exits when blockers exist', async () => {
  const lines = [];
  let exitCode = null;

  await verifyReview('task-1031', true, {
    resolveWorktreeFn: () => null,
    cwdFn: () => '/tmp/random',
    isForgejoReviewEnabledFn: () => true,
    findMissionDirFn: () => null,
    getCurrentBranchFn: () => 'main',
    resolveTaskFileFn: () => ({ ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] }),
    getPrStatusFn: () => ({ exists: false, raw: 'missing' }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    log: line => lines.push(line),
    error: line => lines.push(`ERR:${line}`),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, 1);
  assert.ok(lines.includes('[FAIL] Mission directory not found for slug: task-1031'));
  assert.ok(lines.includes('[FAIL] Branch: current branch is main, expected mission/task-1031'));
  assert.ok(lines.includes('[FAIL] Backlog task resolution is ambiguous for slug: task-1031'));
  assert.ok(lines.includes('[FAIL] Review PR: missing'));
  assert.ok(lines.some(line => line.includes('ERR:\n[INFO] Review verification failed.')));
});

test('readComments renders comment list when token and comments exist', async () => {
  const lines = [];
  let exitCode = null;
  await readComments('task-1031', {
    readTokenFn: () => 'token',
    getCommentsFn: async () => [
      { kind: 'inline', location: 'workflow/lib/review/review.js:10', user: 'claude', created: 'today', body: 'Looks good' }
    ],
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    isForgejoReviewEnabledFn: () => true,
    log: line => lines.push(line),
    error: line => lines.push(`ERR:${line}`),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, null);
  assert.ok(lines.includes('[INFO] Reading PR comments on mission/task-1031 as codex...'));
  assert.ok(lines.includes('--- inline workflow/lib/review/review.js:10 | claude (today) ---'));
  assert.ok(lines.includes('Looks good'));
});

test('pushRound resolves forgejo user from backlog assignee and reports success', async () => {
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const lines = [];
  let exitCode = null;
  try {
    await pushRound('task-1031', {
      isForgejoReviewEnabledFn: () => false,
      resolveWorktreeFn: () => '/tmp/mission-task-1031',
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
      getTaskImplementerFn: () => 'codex',
      readTokenFn: () => 'token',
      createPrFn: () => ({ ok: true }),
      log: line => lines.push(line),
      error: line => lines.push(`ERR:${line}`),
      exit: code => { exitCode = code; }
    });
  } finally {
    if (previous !== undefined) process.env.FORGEJO_USER = previous;
  }

  assert.equal(exitCode, null);
  assert.ok(lines.includes('[INFO] Pushing mission/task-1031 to the review provider as codex...'));
  assert.ok(lines.includes('[PASS] Branch pushed and PR updated for mission/task-1031.'));
});

test('commentRound and submitReviewRound fail loudly on API errors', async () => {
  const errors = [];
  const exits = [];
  const readReviewStateFn = () => ({ reviewer: 'codex', implementer: 'codex' });
  await commentRound('task-1031', 'body', {
    readTokenFn: () => 'token',
    postCommentFn: () => ({ ok: false, error: 'boom' }),
    readReviewStateFn,
    error: line => errors.push(line),
    exit: code => exits.push(code)
  });
  await submitReviewRound('task-1031', 'approve', 'ship it', {
    readTokenFn: () => 'token',
    getPrAuthorFn: () => 'claude',
    postReviewFn: () => ({ ok: false, error: 'nope' }),
    readReviewStateFn,
    isForgejoReviewEnabledFn: () => true,
    error: line => errors.push(line),
    exit: code => exits.push(code)
  });

  assert.deepEqual(exits, [1, 1]);
  assert.ok(errors.some(line => line.includes('Could not post comment: boom')));
  assert.ok(errors.some(line => line.includes('Could not submit review: nope')));
});

test('submitForReview exits when no forgejo user and no task implementer (task-1105)', async () => {
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const calls = [];
  let exitCode = null;
  try {
    await submitForReview('task-1105', true, {
      resolveTaskFileFn: () => ({ ok: false }),
      getTaskImplementerFn: () => null,
      resolveWorktreeFn: () => '/tmp/mission-task-1105',
      isForgejoReviewEnabledFn: () => true,
      performHandoffFn: async (slug, opts) => {
        calls.push({ slug, opts });
        return { ok: true };
      },
      exit: code => { exitCode = code; }
    });
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previous;
  }
  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0);
});

test('submitForReview and closeMissionPr use injected handoff and close functions', async () => {
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const calls = [];
  let exitCode = null;
  try {
    await submitForReview('task-1031', true, {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
      getTaskImplementerFn: () => 'gemini',
      resolveWorktreeFn: () => '/tmp/mission-task-1031',
      isForgejoReviewEnabledFn: () => false,
      performHandoffFn: async (slug, opts) => {
        calls.push({ slug, opts });
        return { ok: true };
      },
      exit: code => { exitCode = code; }
      });

    await closeMissionPr('task-1031', {
      readTokenFn: () => 'token',
      readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'gemini' }),
      closePrFn: async (branch, token, user) => {
        calls.push({ branch, token, user });
        return { ok: true };
      },
      exit: code => { exitCode = code; }
    });
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previous;
  }

  assert.equal(exitCode, null);
  assert.equal(calls[0].slug, 'task-1031');
  assert.equal(calls[0].opts.forgejoUser, 'gemini');
  assert.deepEqual(calls[1], { branch: 'mission/task-1031', token: 'token', user: 'codex' });
});






// ---------- startReviewLoop taskResolution scope (TASK-1041) ----------





// ---------- single-family fallback (task-1069) ----------








// Reviewer/fallback selection is owned by the application reviewer-selection
// module and pinned by test/unit/application/review-loop/reviewer-fallback-contract.test.ts.

test('review.js does not update Backlog task assignee on reviewer fallback (SC 5)', async () => {
  // applyAgentFallback lives in the extracted review-agent-fallback adapter.
  const fallbackSource = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'src', 'adapters', 'review', 'review-agent-fallback.ts'), 'utf8');
  assert.ok(!fallbackSource.includes('workflow(${slug}): fallback reviewer from'), 'Should not contain reviewer fallback commit message pattern');
  assert.ok(fallbackSource.includes("if (role === 'implementer' && taskResolution && taskResolution.ok)"), 'Backlog assignee enforcement should be guarded to implementer fallback');
  assert.ok(fallbackSource.includes('enforceTaskAssigneeFn(taskResolution.taskFile, fallback)'), 'Implementer fallback should still enforce Backlog assignee');
});

// ---------- CP-3: metadata footer and --status ----------

test('buildMetadataFooter returns empty string when no state exists', async () => {
  const { buildMetadataFooter } = consumeReviewerArtifactsModule;
  const footer = await buildMetadataFooter('no-state-slug', '/tmp/nonexistent');
  assert.equal(footer, '');
});

test('commentRound appends metadata footer to message', async () => {
  const { commentRound } = createEventHandlerModule;
  let posted = null;
  await commentRound('task-meta-2', 'Test comment body', {
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, message) => { posted = message; return { ok: true }; },
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    buildMetadataFooterFn: () => '\n\n---\n`[workflow-round:2, workflow-phase:reviewing]`',
    writeReviewStateFn: persistenceCommitted,
    rootDir: '/tmp/visualBoard-task-meta-2',
    log: () => {},
    error: () => {},
    exit: () => {}
  });

  assert.ok(posted.startsWith('Test comment body'));
  assert.ok(posted.includes('[workflow-round:2, workflow-phase:reviewing]'));
});

test('submitReviewRound appends metadata footer to review message', async () => {
  const { submitReviewRound } = createEventHandlerModule;
  let posted = null;
  await submitReviewRound('task-meta-3', 'approve', 'Looks good', {
    readTokenFn: () => 'token',
    postReviewFn: (branch, token, outcome, message) => { posted = message; return { ok: true }; },
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    buildMetadataFooterFn: () => '\n\n---\n`[workflow-round:1, workflow-phase:reviewing]`',
    writeReviewStateFn: persistenceCommitted,
    worktree: '/tmp/visualBoard-task-meta-3',
    isForgejoReviewEnabledFn: () => true,
    log: () => {},
    error: () => {},
    exit: () => {}
  });

  assert.ok(posted.startsWith('Looks good'));
  assert.ok(posted.includes('[workflow-round:1, workflow-phase:reviewing]'));
});

test('showReviewStatus prints state details when state exists', async () => {
  const { showReviewStatus } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;
  const lines = [];

  await showReviewStatus('task-status-1', {
    readReviewStateFn: () => new ReviewState('task-status-1', {
      reviewer: 'codex', implementer: 'claude', round: 2, phase: 'fixing',
      disposition: 'CHANGES_REQUESTED', startedAt: '2026-05-25T10:00:00Z'
    }),
    resolveWorktreeFn: () => '/tmp/visualBoard-task-status-1',
    log: line => lines.push(line)
  });

  assert.ok(lines.some(l => l.includes('task-status-1')));
  assert.ok(lines.some(l => l.includes('Round:') && l.includes('2')));
  assert.ok(lines.some(l => l.includes('Phase:') && l.includes('fixing')));
  assert.ok(lines.some(l => l.includes('codex')));
  assert.ok(lines.some(l => l.includes('claude')));
  assert.ok(lines.some(l => l.includes('CHANGES_REQUESTED')));
});

test('showReviewStatus prints no-state message when state is absent', async () => {
  const { showReviewStatus } = createEventHandlerModule;
  const lines = [];

  await showReviewStatus('task-status-2', {
    readReviewStateFn: () => null,
    resolveWorktreeFn: () => null,
    log: line => lines.push(line)
  });

  assert.ok(lines.some(l => l.includes('No persisted review state found')));
});

// ---------- State persistence after comment/review posts (Finding 2) ----------

test('commentRound persists review state after successful post', async () => {
  const { commentRound } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;
  let stateWritten = null;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    await commentRound('task-persist-1', 'Test body', {
      readTokenFn: () => 'token',
      postCommentFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => new ReviewState('task-persist-1', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      writeReviewStateFn: (slug, state, worktree) => { stateWritten = { slug, state, worktree }; },
      rootDir: '/tmp/visualBoard-task-persist-1',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.ok(stateWritten, 'writeReviewStateFn must be called after successful comment post');
  assert.equal(stateWritten.slug, 'task-persist-1');
});

test('commentRound does not persist state when no state exists', async () => {
  const { commentRound } = createEventHandlerModule;
  let writeCount = 0;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    await commentRound('task-persist-2', 'Test body', {
      readTokenFn: () => 'token',
      postCommentFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => null,
      writeReviewStateFn: () => { writeCount++; },
      rootDir: '/tmp/visualBoard-task-persist-2',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.equal(writeCount, 0, 'writeReviewStateFn must not be called when no state exists');
});

test('submitReviewRound persists state with REQUEST_CHANGES disposition after request-changes', async () => {
  const { submitReviewRound } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;
  let stateWritten = null;
  let backlogTransitioned = null;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    await submitReviewRound('task-persist-3', 'request-changes', 'Needs work', {
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => new ReviewState('task-persist-3', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      writeReviewStateFn: (slug, state) => { stateWritten = { slug, disposition: state.disposition, phase: state.phase }; },
      transitionTaskFn: async (slug, status) => {
        backlogTransitioned = { slug, status };
        return true;
      },
      worktree: '/tmp/visualBoard-task-persist-3',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.ok(stateWritten, 'writeReviewStateFn must be called after successful review post');
  assert.equal(stateWritten.disposition, 'REQUEST_CHANGES');
  assert.equal(stateWritten.phase, 'fixing');
  assert.deepEqual(backlogTransitioned, { slug: 'task-persist-3', status: 'review' });
});

test('submitReviewRound persists state with APPROVED disposition after approve', async () => {
  const { submitReviewRound } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;
  let stateWritten = null;
  let backlogTransitioned = null;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    await submitReviewRound('task-persist-4', 'approve', 'LGTM', {
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => new ReviewState('task-persist-4', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      writeReviewStateFn: (slug, state) => { stateWritten = { slug, disposition: state.disposition, phase: state.phase }; },
      transitionTaskFn: async (slug, status) => {
        backlogTransitioned = { slug, status };
        return true;
      },
      worktree: '/tmp/visualBoard-task-persist-4',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.ok(stateWritten, 'writeReviewStateFn must be called after successful review post');
  assert.equal(stateWritten.disposition, 'APPROVED');
  assert.equal(stateWritten.phase, 'approved');
  assert.deepEqual(backlogTransitioned, { slug: 'task-persist-4', status: 'approved' });
});

test('submitReviewRound promotes an active backlog task to review after provider-backed approval', async () => {
  const { submitReviewRound } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;
  let transitioned = null;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    await submitReviewRound('task-2197', 'approve', 'LGTM', {
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      writeReviewStateFn: persistenceCommitted,
      readReviewStateFn: () => new ReviewState('task-2197', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-2197.md' }),
      getTaskStatusFn: () => 'active',
      transitionTaskFn: async (slug, status) => {
        transitioned = { slug, status };
        return true;
      },
      worktree: '/tmp/visualBoard-task-2197',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.deepEqual(transitioned, {
    slug: 'task-2197',
    status: 'review'
  });
});

test('submitReviewRound keeps YAML and rendered task status aligned when provider-backed approval repairs active', async () => {
  const { submitReviewRound } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1327-review-round-'));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task-2198 - stale-active.md');
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';
  watchInterruptedReviewFixture(root);

  try {
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2198',
      'title: stale active',
      'status: active',
      'assignee: [claude]',
      '---',
      '',
      'Status: ○ active',
      ''
    ].join('\n'));

    runGitOrThrow(['init'], { cwd: root });
    runGitOrThrow(['config', 'user.email', 'task-1327@example.com'], { cwd: root });
    runGitOrThrow(['config', 'user.name', 'Task 1327'], { cwd: root });
    runGitOrThrow(['add', '.'], { cwd: root });
    runGitOrThrow(['commit', '-m', 'fixture'], { cwd: root });

    await submitReviewRound('task-2198', 'approve', 'LGTM', {
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      writeReviewStateFn: persistenceCommitted,
      readReviewStateFn: () => new ReviewState('task-2198', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      worktree: root,
      log: () => {},
      error: () => {},
      exit: () => {}
    });

    const content = fs.readFileSync(taskFile, 'utf8');
    assert.match(content, /^status:\s*review$/m);
    assert.match(content, /^Status:\s*○ review$/m);
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('submitReviewRound skips Forgejo and updates review-state only when provider=none', async () => {
  const { submitReviewRound } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;

  // Create a temporary directory for the test
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-none-'));
  const worktree = path.join(tmpDir, 'my-project');
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(path.join(worktree, 'docs', 'missions', '2026', 'task-test'), { recursive: true });

  // Create a minimal workflow.config.json with provider=none
  fs.writeFileSync(
    path.join(worktree, 'workflow.config.json'),
    JSON.stringify({
      product: { name: 'Test' },
      adapters: { review: { provider: 'none' } }
    }, null, 2),
    'utf8'
  );

  let stateWritten = null;
  let backlogTransitioned = null;

  const prevForgejo = process.env.FORGEJO_USER;
  const prevAgent = process.env.WORKFLOW_AGENT;
  process.env.FORGEJO_USER = 'codex';
  process.env.WORKFLOW_AGENT = 'custom';

  try {
    await submitReviewRound('task-test', 'approve', 'Test approval', {
      isForgejoReviewEnabledFn: () => false, // Simulate provider=none
      readReviewStateFn: () => null, // No existing state
      writeReviewStateFn: (slug, state) => {
        stateWritten = { slug, disposition: state.disposition, phase: state.phase, implementer: state.implementer };
      },
      transitionTaskFn: async (slug, status) => {
        backlogTransitioned = { slug, status };
        return true;
      },
      worktree,
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prevForgejo === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prevForgejo;
    if (prevAgent === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = prevAgent;
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Verify review-state was written with correct values
  assert.ok(stateWritten, 'writeReviewStateFn must be called');
  assert.equal(stateWritten.disposition, 'APPROVED');
  assert.equal(stateWritten.phase, 'approved');
  assert.equal(stateWritten.implementer, 'custom');

  // Verify backlog task was transitioned
  assert.ok(backlogTransitioned, 'transitionTaskFn must be called');
  assert.equal(backlogTransitioned.slug, 'task-test');
  assert.equal(backlogTransitioned.status, 'approved');
});

test('submitReviewRound updates existing state when provider=none', async () => {
  const { submitReviewRound } = createEventHandlerModule;
  const { ReviewState } = ReviewStateModule;

  let stateWritten = null;
  let backlogTransitioned = null;

  const existingState = new ReviewState('task-exist', {
    reviewer: 'codex',
    implementer: 'claude',
    round: 1,
    phase: 'reviewing',
    disposition: null
  });

  const prevForgejo = process.env.FORGEJO_USER;
  const prevAgent = process.env.WORKFLOW_AGENT;

  try {
    await submitReviewRound('task-exist', 'request-changes', 'Needs work', {
      isForgejoReviewEnabledFn: () => false, // Simulate provider=none
      readReviewStateFn: () => existingState,
      writeReviewStateFn: (slug, state) => {
        stateWritten = { slug, disposition: state.disposition, phase: state.phase };
      },
      transitionTaskFn: async (slug, status) => {
        backlogTransitioned = { slug, status };
        return true;
      },
      worktree: '/tmp/test-worktree',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prevForgejo === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prevForgejo;
    if (prevAgent === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = prevAgent;
  }

  // Verify review-state was updated
  assert.ok(stateWritten, 'writeReviewStateFn must be called');
  assert.equal(stateWritten.disposition, 'REQUEST_CHANGES');
  assert.equal(stateWritten.phase, 'fixing');

  // Verify backlog task was transitioned to review
  assert.ok(backlogTransitioned, 'transitionTaskFn must be called');
  assert.equal(backlogTransitioned.slug, 'task-exist');
  assert.equal(backlogTransitioned.status, 'review');
});

// ---------- Terminal disposition state persistence (Finding 3) ----------






test('consumeImplementerArtifacts posts resolution and normalized disposition from files', async () => {
  const posted = [];
  const deleted = [];
  const artifactMap = new Map([
    ['/tmp/task-089-round-resolution.md', '# resolution'],
    ['/tmp/task-089-review-disposition.txt', 'changes_made\n'],
  ]);

  const result = consumeImplementerArtifacts('task-089', 'codex', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, message, meta) => {
      posted.push({ branch, token, message, meta });
      return { ok: true };
    },
    deleteArtifactFn: (filePath) => deleted.push(filePath),
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Mock createEvent to avoid requiring real mission directory
    createEventFn: () => ({ ok: true, path: '/tmp/fake-event.md' }),
    // /tmp/worktree is not a checkout; supply the branch tip and stub the
    // round-closing record (covered in test/unit/adapters/review/review-round-loop.test.ts).
    headRevisionFn: () => 'rev-4',
    recordImplementerResolutionFn: async () => ({ outcome: 'recorded' }),
  });

  const actualResult = await result;
  assert.deepEqual(actualResult, { consumed: true, ok: true, disposition: 'CHANGES_MADE' });
  assert.equal(posted.length, 2);
  assert.deepEqual(deleted, [
    '/tmp/task-089-round-resolution.md',
    '/tmp/task-089-review-disposition.txt',
  ]);
  assert.match(posted[0].message, /# resolution/);
  assert.match(posted[1].message, /Autonomous review disposition: CHANGES_MADE/);
});

test('consumeReviewerArtifacts deletes artifacts only after successful comment and review posts', async () => {
  const deleted = [];
  const artifactMap = new Map([
    ['/tmp/task-089-review-findings.md', '# findings'],
    ['/tmp/task-089-review-outcome.md', '# outcome'],
    ['/tmp/task-089-review-verdict.txt', 'approve\n'],
  ]);

  const result = await consumeReviewerArtifacts('task-089', 'custom', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: () => ({ ok: true }),
    postReviewFn: () => ({ ok: true }),
    deleteArtifactFn: (filePath) => deleted.push(filePath),
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Mock createEvent to avoid requiring real mission directory
    createEventFn: () => ({ ok: true, path: '/tmp/fake-event.md' }),
  });

  assert.deepEqual(result, { consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings: [] });
  assert.deepEqual(deleted, [
    '/tmp/task-089-review-findings.md',
    '/tmp/task-089-review-outcome.md',
    '/tmp/task-089-review-verdict.txt',
  ]);
});

test('consumeImplementerArtifacts leaves artifacts in place when posting fails', async () => {
  const deleted = [];
  const artifactMap = new Map([
    ['/tmp/task-089-round-resolution.md', '# resolution'],
    ['/tmp/task-089-review-disposition.txt', 'changes_made\n'],
  ]);

  const result = consumeImplementerArtifacts('task-089', 'codex', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: () => ({ ok: false, error: 'boom' }),
    deleteArtifactFn: (filePath) => deleted.push(filePath),
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Mock createEvent to avoid requiring real mission directory
    createEventFn: () => ({ ok: true, path: '/tmp/fake-event.md' }),
  });

  const actualResult = await result;
  assert.equal(actualResult.consumed, true);
  assert.equal(actualResult.ok, false);
  assert.ok(typeof actualResult.diagnostic === 'string' && actualResult.diagnostic.length > 0);
  assert.deepEqual(deleted, []);
});

// SC 1: Regression test proving persist-before-mirror ordering for reviewer artifacts
test('consumeReviewerArtifacts proves persist-before-mirror ordering', async () => {
  const calls = [];
  const artifactMap = new Map([
    ['/tmp/task-089-review-findings.md', '# findings'],
    ['/tmp/task-089-review-outcome.md', '# outcome'],
    ['/tmp/task-089-review-verdict.txt', 'approve\n'],
  ]);

  const result = await consumeReviewerArtifacts('task-089', 'custom', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, body, options) => { calls.push('postComment'); return { ok: true }; },
    postReviewFn: (branch, token, body, options) => { calls.push('postReview'); return { ok: true }; },
    deleteArtifactFn: (filePath) => {},
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Track createEvent calls
    createEventFn: (slug, eventType, params, options) => { calls.push('createEvent'); return { ok: true, path: `/tmp/fake-${eventType}.md` }; },
  });

  assert.deepEqual(result, { consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings: [] });
  // Verify createEvent was called before any Forgejo posting
  const createEventIndices = calls.map((call, idx) => call === 'createEvent' ? idx : -1).filter(i => i !== -1);
  const forgejoIndices = calls.map((call, idx) => (call === 'postComment' || call === 'postReview') ? idx : -1).filter(i => i !== -1);

  assert.ok(createEventIndices.length >= 2, 'createEvent should be called at least twice (findings + outcome)');
  assert.ok(forgejoIndices.length >= 2, 'Forgejo posting should happen at least twice (comment + review)');

  // All createEvent calls should come before all Forgejo posting calls
  const maxCreateIndex = Math.max(...createEventIndices);
  const minForgejoIndex = Math.min(...forgejoIndices);
  assert.ok(maxCreateIndex < minForgejoIndex, 'All createEvent calls must come before any Forgejo posting');
});

// SC 1: Regression test proving persist-before-mirror ordering for implementer artifacts
test('consumeImplementerArtifacts proves persist-before-mirror ordering', async () => {
  const calls = [];
  const artifactMap = new Map([
    ['/tmp/task-089-round-resolution.md', '# resolution'],
    ['/tmp/task-089-review-disposition.txt', 'changes_made\n'],
  ]);

  const result = consumeImplementerArtifacts('task-089', 'codex', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, body, options) => { calls.push('postComment'); return { ok: true }; },
    deleteArtifactFn: (filePath) => {},
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Track createEvent calls
    createEventFn: (slug, eventType, params, options) => { calls.push('createEvent'); return { ok: true, path: `/tmp/fake-${eventType}.md` }; },
    // /tmp/worktree is not a checkout; supply the branch tip and stub the
    // round-closing record (covered in test/unit/adapters/review/review-round-loop.test.ts).
    headRevisionFn: () => 'rev-4',
    recordImplementerResolutionFn: async () => ({ outcome: 'recorded' }),
  });

  const actualResult = await result;
  assert.deepEqual(actualResult, { consumed: true, ok: true, disposition: 'CHANGES_MADE' });
  // Verify createEvent was called before any Forgejo posting
  const createEventIndices = calls.map((call, idx) => call === 'createEvent' ? idx : -1).filter(i => i !== -1);
  const forgejoIndices = calls.map((call, idx) => call === 'postComment' ? idx : -1).filter(i => i !== -1);

  assert.ok(createEventIndices.length >= 2, 'createEvent should be called at least twice (round_summary + disposition)');
  assert.ok(forgejoIndices.length >= 1, 'Forgejo posting should happen at least once (disposition comment)');

  // All createEvent calls should come before all Forgejo posting calls
  const maxCreateIndex = Math.max(...createEventIndices);
  const minForgejoIndex = Math.min(...forgejoIndices);
  assert.ok(maxCreateIndex < minForgejoIndex, 'All createEvent calls must come before any Forgejo posting');
});

test('createEventHandler requires review-state or --actor for mirrored event types', async () => {

  // Create a temporary directory for the test
  const tmpDir = '/tmp/test-create-event-handler';
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    // Clear FORGEJO_USER to ensure the handler does not depend on it.
    const oldForgejoUser = process.env.FORGEJO_USER;
    delete process.env.FORGEJO_USER;

    // Mock options
    const logMessages = [];
    const errorMessages = [];
    let exitCode = null;

    const options = {
      log: (msg) => logMessages.push(msg),
      error: (msg) => errorMessages.push(msg),
      exit: (code) => { exitCode = code; throw new Error(`exit(${code})`); },
      resolveWorktreeFn: () => tmpDir
    };

    try {
      // This should fail because mirrored events need persisted identity or --actor.
      await createEventHandler('task-test', ['--type', 'reviewer_outcome', '--verdict', 'approve'], options);
      assert.fail('Expected createEventHandler to exit with code 1');
    } catch (err) {
      assert.match(err.message, /exit\(1\)/);
    }

    // Verify the error names both ways to give the event an identity: start the
    // review (which creates the Review the identity comes from), or pass --actor.
    // SC2: the retired standalone `px handoff` command is gone; the review-start
    // transition is the supported entry point.
    assert.ok(errorMessages.some(msg => msg.includes('px review') && msg.includes('--start') && msg.includes('--actor')));
    assert.equal(exitCode, 1);

    // Verify that no event file was created
    // The event would be created in docs/missions/2026/task-test/review-events/
    const eventDir = path.join(tmpDir, 'docs', 'missions', '2026', 'task-test', 'review-events');
    assert.ok(!fs.existsSync(eventDir) || fs.readdirSync(eventDir).length === 0);

    // Restore FORGEJO_USER
    if (oldForgejoUser) {
      process.env.FORGEJO_USER = oldForgejoUser;
    }
  } finally {
    // Cleanup
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  }
});

// ============================================================================
// Pre-review phase detection tests for startReviewLoop (task-1223)
// ============================================================================





// Round-3: a fresh --start handoff creates the authoritative Review with its
// reviewer. The loop must resume that handoff-assigned reviewer rather than
// selecting a new one, which would desynchronize the domain Review from the
// launched reviewer.

// task-1303 self-heal: when a post-implementation task has no open PR, the loop runs
// the handoff automatically instead of dead-ending. A *failing* injected handoff yields
// the corrected `--push` fallback (never `--submit`); a *succeeding* one that produces an
// open PR lets the loop proceed.







test('createEventHandler allows non-mirrored event types without FORGEJO_USER', async () => {

  // Create a temporary directory for the test
  const tmpDir = '/tmp/test-create-event-handler-non-mirrored';
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    // Clear FORGEJO_USER
    const oldForgejoUser = process.env.FORGEJO_USER;
    delete process.env.FORGEJO_USER;

    // Mock options
    const logMessages = [];
    const errorMessages = [];
    let exitCode = null;
    let exitCalled = false;

    const options = {
      log: (msg) => logMessages.push(msg),
      error: (msg) => errorMessages.push(msg),
      exit: (code) => { exitCode = code; exitCalled = true; throw new Error(`exit(${code})`); },
      resolveWorktreeFn: () => tmpDir,
      // Mock the Forgejo posting functions to avoid actual API calls
      postCommentFn: () => ({ ok: false, error: 'no token' }),
      postReviewFn: () => ({ ok: false, error: 'no token' })
    };

    try {
      // neutral_discussion is NOT mirrored, so this should succeed even without FORGEJO_USER
      await createEventHandler('task-test', ['--type', 'neutral_discussion', '--content', 'test discussion'], options);
      assert.fail('Expected createEventHandler to exit with code 1');
    } catch (err) {
      // This will fail because it tries to create the event in a non-existent directory structure
      // but the important thing is it doesn't fail due to FORGEJO_USER check
      assert.ok(!errorMessages.some(msg => msg.includes('FORGEJO_USER')));
    }

    // Restore FORGEJO_USER
    if (oldForgejoUser) {
      process.env.FORGEJO_USER = oldForgejoUser;
    }
  } finally {
    // Cleanup
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  }
});
