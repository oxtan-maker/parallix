// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'node:child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const postIntegrateHookModule = mockModule<typeof import('../src/adapters/process/post-integrate-hook.js')>('../src/adapters/process/post-integrate-hook.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const integrateCommandModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
const submitReviewRoundModule = mockModule<typeof import('../src/adapters/review/review-commands.js')>('../src/adapters/review/review-commands.js', import.meta.url);
const ReviewStateModule = mockModule<typeof import('../src/adapters/review/review-state.js')>('../src/adapters/review/review-state.js', import.meta.url);
const maybeUpdateGraphifyOnPrimaryModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/adapters/sqlite/database-path-resolver.js')>('../src/adapters/sqlite/database-path-resolver.js', import.meta.url);
const __mm2 = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
await installModuleMocks();
const integrateCommand = integrateCommandModule.default;
const { submitReviewRound } = submitReviewRoundModule;
const { ReviewState } = ReviewStateModule;
const { maybeUpdateGraphifyOnPrimary } = maybeUpdateGraphifyOnPrimaryModule;
const { mock } = test;

const { resolveDatabasePath } = __mm1;
mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');

function installVerificationMocks() {
  mock.method(verification, 'captureVerifiedTreeProof', (area, rootDir) => ({
    ok: true,
    proof: {
      rootDir: path.resolve(rootDir),
      area,
      command: 'mock-verification',
      commit: 'abc123',
      tree: 'tree123',
      verifiedAt: '2026-01-01T00:00:00.000Z'
    }
  }));
  mock.method(verification, 'assertVerifiedTreeProof', (proof, rootDir) => {
    const resolvedRoot = path.resolve(rootDir);
    if (!proof || proof.rootDir !== resolvedRoot) {
      return { ok: false, error: 'verification proof does not match the tree being published' };
    }
    return { ok: true, proof };
  });
}

test.beforeEach(() => {
  installVerificationMocks();
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  process.env.PRIMARY_WORKTREE = FAKE_ROOT;
});

const FAKE_ROOT = `/tmp/mission-${process.pid}`;
test.afterEach(() => {
  if (previousPrimaryWorktree === undefined) delete process.env.PRIMARY_WORKTREE;
  else process.env.PRIMARY_WORKTREE = previousPrimaryWorktree;
  mock.restoreAll();
});

const previousPrimaryWorktree = process.env.PRIMARY_WORKTREE;
process.env.PRIMARY_WORKTREE = FAKE_ROOT;

// Mock getPrimaryBranch BEFORE requiring dependent modules to ensure they use the mock.
if (previousPrimaryWorktree === undefined) delete process.env.PRIMARY_WORKTREE;
else process.env.PRIMARY_WORKTREE = previousPrimaryWorktree;

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

const {
  cleanupMissionWorktree,
  rewriteWorktreePaths,
  buildConflictResolutionPrompt,
  stashMainCheckoutIfNeeded,
  restoreMainCheckoutStash,
  isNoMergeToAbortResult,
  VARIANT_B_AUTOMATION_SUMMARY,
  evaluateTaskStatusForIntegration,
  promoteTaskForIntegrationIfNeeded,
  recoverMissionForIntegration,
  findExistingSquashCommit,
  printIntegrationPreflight,
  buildIntegrationContext,
  resolveForgejoUserForIntegration,
  getUnresolvedIndexConflicts,
  parseStashPopCollisionFiles,
  reportStashPopFailure,
  SYNC_MERGED_DIAGNOSTICS,
  printDiagnosticTable,
  reportSyncMergedFailure,
  recordPostIntegrationStats,
  persistLandedIntegrationOrAbort,
  formatRecordedStatsRow,
  resolveIntegrationVerificationWorktree,
  buildIntegrationVerificationInvocation,
  captureFinalIntegrationTree,
  parseIntegrateArgs,
  runPostIntegrateHookOrAbort,
  prepareNoisePatchForSquash
} = maybeUpdateGraphifyOnPrimaryModule;
const { conventionalWorktreePath, getPrimaryBranch } = missionUtils;

const PRIMARY = getPrimaryBranch();

import { stubMissionServices } from './helpers/stub-mission-services.js';

test('persistLandedIntegrationOrAbort records lifecycle completion and closure', async () => {
  const calls = [];
  const integration = { status: 'integration', closedAt: null, assignee: 'codex' };
  const done = { status: 'done', closedAt: null, assignee: 'codex' };
  const closed = { status: 'done', closedAt: '2026-08-12T12:00:00.000Z', assignee: 'codex' };
  let state = integration;
  const services = {
    store: { load: async () => ({ kind: 'found', mission: state, version: 1 }) },
    integration: {
      decideIntegration: async request => { calls.push(['decide', request]); state = done; return { status: 'completed' }; },
      close: async request => { calls.push(['close', request]); state = closed; return { status: 'completed' }; },
    },
  };

  await persistLandedIntegrationOrAbort('task-close', 'abc123', services, { landedAt: '2026-08-12T10:00:00.000Z' });

  assert.deepEqual(calls.map(([kind]) => kind), ['decide', 'close']);
  assert.equal(calls[0][1].occurredAt, '2026-08-12T10:00:00.000Z');
  assert.equal(calls[1][1].expectedVersion, 1);
  assert.equal(calls[1][1].integration.value.completed, true);
});

test('prepareNoisePatchForSquash cleans only its owned patch directory when reset fails', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'integrate-noise-cleanup-'));
  const operatorFile = path.join(tmpRoot, 'operator-note.txt');
  fs.writeFileSync(operatorFile, 'keep');
  const gitRunner = args => {
    if (args.includes('diff')) { return { status: 0, stdout: 'diff --git a/backlog/tasks/a.md b/backlog/tasks/a.md', stderr: '' }; }
    if (args.includes('reset')) { return { status: 1, stdout: '', stderr: 'reset failed' }; }
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  };
  try {
    const result = prepareNoisePatchForSquash('/fake-worktree', { gitRunner, tmpDir: tmpRoot });
    assert.equal(result.ok, false);
    assert.match(result.error, /reset failed/);
    assert.deepEqual(fs.readdirSync(tmpRoot), ['operator-note.txt']);
    assert.equal(fs.readFileSync(operatorFile, 'utf8'), 'keep');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('integration verification resolves the candidate mission worktree, not the primary checkout', () => {
  const primaryWorktree = '/tmp/primary-checkout';
  const candidateWorktree = '/tmp/task-1253-candidate';
  const observed = [];

  const resolved = resolveIntegrationVerificationWorktree('task-1253', {
    baseWorktree: primaryWorktree,
    resolveWorktreeFn(slug, options) {
      observed.push({ slug, options });
      return candidateWorktree;
    },
    conventionalWorktreePathFn() {
      throw new Error('fallback should not be used');
    }
  });

  assert.equal(resolved, candidateWorktree);
  assert.deepEqual(observed, [{
    slug: 'task-1253',
    options: { cwd: primaryWorktree }
  }]);
});

test('integration verification command and cwd are both derived from the candidate worktree', () => {
  const primaryWorktree = '/tmp/primary-checkout';
  const candidateWorktree = '/tmp/task-1253-candidate';
  const commandRoots = [];

  const invocation = buildIntegrationVerificationInvocation('task-1253', {
    baseWorktree: primaryWorktree,
    resolveWorktreeFn: () => candidateWorktree,
    conventionalWorktreePathFn() {
      throw new Error('fallback should not be used');
    },
    formatVerificationCommandFn(area, rootDir) {
      commandRoots.push({ area, rootDir });
      return rootDir === candidateWorktree ? 'candidate-verify integrate' : 'primary-verify integrate';
    }
  });

  assert.deepEqual(invocation, {
    command: 'candidate-verify integrate',
    cwd: candidateWorktree
  });
  assert.deepEqual(commandRoots, [{
    area: 'integrate',
    rootDir: candidateWorktree
  }]);
});

test('final integration gate identity rejects a dirty or wrong selected root before side effects (task-2300)', () => {
  const root = path.join(import.meta.dirname, '..');
  const dirty = captureFinalIntegrationTree(root, {
    gitRunner(args) {
      assert.deepEqual(args.slice(1), [path.resolve(root), 'status', '--porcelain']);
      return { status: 0, stdout: ' M src/adapters/cli/commands/integrate.ts', stderr: '' };
    }
  });
  assert.equal(dirty.ok, false);
  assert.match(dirty.error, /not finalized \(dirty tree\)/);

  const final = captureFinalIntegrationTree(root, {
    gitRunner(args) {
      if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('HEAD^{tree}')) return { status: 0, stdout: 'tree-final\n', stderr: '' };
      return { status: 0, stdout: 'commit-final\n', stderr: '' };
    }
  });
  assert.deepEqual(final, { ok: true, rootDir: path.resolve(root), commit: 'commit-final', tree: 'tree-final' });
});

test('px integrate rejects the normal integration-gate bypass (task-2300)', () => {
  const prior = process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS;
  delete process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS;
  try {
    assert.throws(() => parseIntegrateArgs(['task-2300', '--no-integration-gates']), /final integration gates are mandatory/);
  } finally {
    if (prior === undefined) delete process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS;
    else process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = prior;
  }
});

test('px integrate parses the paired Codex real-agent override without placing values in a command string', () => {
  const parsed = parseIntegrateArgs(['task-2269', '--real-agent', 'codex', '--real-agent-model', 'gpt-5.6-luna']);
  assert.deepEqual(parsed, {
    explicitSlug: 'task-2269', dryRun: false, noIntegrationGates: false, noGate: false,
    realAgent: 'codex', realAgentModel: 'gpt-5.6-luna'
  });
});

test('px integrate rejects malformed real-agent options before preflight or gate execution', () => {
  /** @type {Array<[string[], RegExp]>} */
  const malformedCases = [
    [['task-2269', '--real-agent', 'codex'], /must be supplied together/],
    [['task-2269', '--real-agent'], /requires a value/],
    [['task-2269', '--real-agent', 'codex', '--real-agent', 'codex', '--real-agent-model', 'gpt-5.6-luna'], /only once/],
    [['task-2269', '--real-agent', 'claude', '--real-agent-model', 'gpt-5.6-luna'], /Unsupported real agent/],
    [['task-2269', '--real-agent', 'codex', '--real-agent-model', 'not-gpt'], /Unsupported Codex real-agent model/],
    [['task-2269', '--not-real'], /Unknown integrate option/]
  ];
  for (const [args, message] of malformedCases) {
    assert.throws(() => parseIntegrateArgs(args), message);
  }
});

test('buildIntegrationContext reads task file and status from the base worktree only', async (t) => {
  const worktree = '/tmp/project-task-2200';
  const baseWorktree = '/tmp/project-main';
  const worktreeTask = `${worktree}/backlog/tasks/task-2200 - fix.md`;
  const baseTask = `${baseWorktree}/backlog/tasks/task-2200 - fix.md`;

  const mockedResolveWorktree = mock.method(missionUtils, 'resolveWorktree', () => worktree);
  const mockedFindMissionDir = mock.method(missionUtils, 'findMissionDir', () => `${worktree}/docs/missions/2026/task-2200`);
  const mockedFindMissionArea = mock.method(missionUtils, 'findMissionArea', () => 'lib');
  const mockedResolveMissionBaseBranch = mock.method(missionUtils, 'resolveMissionBaseBranch', () => 'main');
  const mockedResolveBaseWorktree = mock.method(missionUtils, 'resolveBaseWorktree', () => baseWorktree);
  const mockedGetCurrentBranch = mock.method(__mm2, 'getCurrentBranch', () => 'mission/task-2200');
  const mockedGit = mock.method(__mm2, 'git', (args) => {
    if (args.includes('branch') && args.includes('--show-current')) {
      return { status: 0, stdout: 'main', stderr: '' };
    }
    if (args.includes('status') && args.includes('--short')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  const mockedResolveTaskFile = mock.method(backlog, 'resolveTaskFile', (_slug, rootDir) => {
    if (rootDir === worktree) {
      return { ok: true, taskFile: worktreeTask };
    }
    if (rootDir === baseWorktree) {
      return { ok: true, taskFile: baseTask };
    }
    return { ok: false, reason: 'missing', matches: [] };
  });
  const mockedGetTaskStatus = mock.method(backlog, 'getTaskStatus', (taskFile) => taskFile === worktreeTask ? 'active' : 'ready-for-integration');
  const mockedGetTaskAssignee = mock.method(backlog, 'getTaskAssignee', () => 'claude');
  t.after(() => {
    mockedResolveWorktree.mock.restore();
    mockedFindMissionDir.mock.restore();
    mockedFindMissionArea.mock.restore();
    mockedResolveMissionBaseBranch.mock.restore();
    mockedResolveBaseWorktree.mock.restore();
    mockedGetCurrentBranch.mock.restore();
    mockedGit.mock.restore();
    mockedResolveTaskFile.mock.restore();
    mockedGetTaskStatus.mock.restore();
    mockedGetTaskAssignee.mock.restore();
  });

  const context = await buildIntegrationContext('task-2200', {
    baseBranch: 'main',
    baseWorktree,
    isForgejoReviewEnabledFn: () => false
  });

  // The mission worktree status is a stale 'active'; the base worktree owns the
  // authoritative 'ready-for-integration' status and the task-file path.
  assert.equal(context.task.taskFile, baseTask);
  assert.equal(context.taskStatus, 'ready-for-integration');
});

test('buildIntegrationContext does not let a mission-worktree status replace the base status (task-2244 regression)', async (t) => {
  const worktree = '/tmp/project-task-2244';
  const baseWorktree = '/tmp/project-main-2244';
  const worktreeTask = `${worktree}/backlog/tasks/task-2244 - fix.md`;
  const baseTask = `${baseWorktree}/backlog/tasks/task-2244 - fix.md`;

  const mockedResolveWorktree = mock.method(missionUtils, 'resolveWorktree', () => worktree);
  const mockedFindMissionDir = mock.method(missionUtils, 'findMissionDir', () => `${worktree}/docs/missions/2026/task-2244`);
  const mockedFindMissionArea = mock.method(missionUtils, 'findMissionArea', () => 'lib');
  const mockedResolveMissionBaseBranch = mock.method(missionUtils, 'resolveMissionBaseBranch', () => 'main');
  const mockedResolveBaseWorktree = mock.method(missionUtils, 'resolveBaseWorktree', () => baseWorktree);
  const mockedGetCurrentBranch = mock.method(__mm2, 'getCurrentBranch', () => 'mission/task-2244');
  const mockedGit = mock.method(__mm2, 'git', (args) => {
    if (args.includes('branch') && args.includes('--show-current')) {
      return { status: 0, stdout: 'main', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  const mockedResolveTaskFile = mock.method(backlog, 'resolveTaskFile', (_slug, rootDir) => {
    if (rootDir === worktree) {
      return { ok: true, taskFile: worktreeTask };
    }
    if (rootDir === baseWorktree) {
      return { ok: true, taskFile: baseTask };
    }
    return { ok: false, reason: 'missing', matches: [] };
  });
  // Mission worktree still shows the pre-approval 'active'; base is 'ready-for-integration'.
  const mockedGetTaskStatus = mock.method(backlog, 'getTaskStatus', (taskFile) => taskFile === worktreeTask ? 'active' : 'ready-for-integration');
  const mockedGetTaskAssignee = mock.method(backlog, 'getTaskAssignee', () => 'claude');
  t.after(() => {
    mockedResolveWorktree.mock.restore();
    mockedFindMissionDir.mock.restore();
    mockedFindMissionArea.mock.restore();
    mockedResolveMissionBaseBranch.mock.restore();
    mockedResolveBaseWorktree.mock.restore();
    mockedGetCurrentBranch.mock.restore();
    mockedGit.mock.restore();
    mockedResolveTaskFile.mock.restore();
    mockedGetTaskStatus.mock.restore();
    mockedGetTaskAssignee.mock.restore();
  });

  const context = await buildIntegrationContext('task-2244', {
    baseBranch: 'main',
    baseWorktree,
    isForgejoReviewEnabledFn: () => false
  });

  assert.equal(context.task.taskFile, baseTask, 'context.task.taskFile must be the base worktree task file');
  assert.equal(context.taskStatus, 'ready-for-integration', 'base status must not be replaced by mission-worktree status');
});

test('printIntegrationPreflight reads classification from the selected task file, not by re-resolving in the base checkout', (t) => {
  const logs = [];
  const worktreeTask = '/tmp/project-task-2200/backlog/tasks/task-2200 - fix.md';

  const mockedGetTaskClassification = mock.method(backlog, 'getTaskClassification', (taskFile) => taskFile === worktreeTask ? 'ai_sdlc' : null);
  t.after(() => mockedGetTaskClassification.mock.restore());

  const result = printIntegrationPreflight({
    slug: 'task-2200',
    branch: 'mission/task-2200',
    currentBranch: 'mission/task-2200',
    missionDir: '/tmp/project-task-2200/docs/missions/2026/task-2200',
    area: 'lib',
    task: { ok: true, taskFile: worktreeTask },
    taskStatus: 'review',
    taskAssignee: 'claude',
    forgejoUser: 'claude',
    taskAssigneeWarning: null,
    pr: { exists: false, raw: 'no PR found' },
    siblingPrs: [],
    approval: { ok: true, reviewState: 'APPROVED' },
    baseBranch: 'main',
    baseWorktree: '/tmp/project-main',
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: []
  }, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => '/tmp/token',
    detectRebaseStateFn: () => ({ inProgress: false, rebaseHead: null, unmergedFiles: [] }),
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    findMissionDocInBranchesFn: () => [],
    isForgejoReviewEnabledFn: () => false,
    resolveMissionClassificationFn: () => ({ classification: null, error: 'stale base resolver should not be used' }),
    log: line => logs.push(line)
  });

  assert.ok(!result.failures.includes('classification'));
  assert.match(logs.join('\n'), /Backlog classification: ai_sdlc/);
});

test('cleanupMissionWorktree removes the mission worktree and deletes the branch without shelling to the script helper', () => {
  const gitCalls = [];
  const removed = [];
  let worktreeExists = true;
  const wt = conventionalWorktreePath('task-082', FAKE_ROOT);
  const result = cleanupMissionWorktree('task-082', {
    rootDir: FAKE_ROOT,
    existsSync(target) {
      return target === wt ? worktreeExists : false;
    },
    removeDir(target) {
      removed.push(target);
      worktreeExists = false;
    },
    gitRunner(args) {
      gitCalls.push(args);
      if (args.slice(-2).join(' ') === 'branch --show-current') {
        return { status: 0, stdout: 'main\n', stderr: '' };
      }
      if (args.includes('show-ref')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.slice(-2).join(' ') === 'list --porcelain') {
        return { status: 0, stdout: `worktree ${wt}\nbranch refs/heads/mission/task-082\n`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  assert.deepEqual(removed, [wt]);
  assert.deepEqual(
    gitCalls,
    [
      ['-C', FAKE_ROOT, 'branch', '--show-current'],
      ['-C', FAKE_ROOT, 'show-ref', '--verify', '--quiet', 'refs/heads/mission/task-082'],
      ['-C', FAKE_ROOT, 'worktree', 'list', '--porcelain'],
      ['-C', FAKE_ROOT, 'worktree', 'remove', wt],
      ['-C', FAKE_ROOT, 'worktree', 'prune'],
      ['-C', FAKE_ROOT, 'branch', '-D', 'mission/task-082']
    ]
  );
});

test('cleanupMissionWorktree prunes stale prunable worktrees before deleting the mission branch', () => {
  // Reproduces task-118: a prunable worktree at /tmp/mission-118
  // holds mission/task-118 even though its path is not what
  // integrate wants to delete. Without a prune step `git branch -D`
  // fails because git still thinks the branch is checked out.
  const gitCalls = [];
  let branchDeleteAttempts = 0;
  const result = cleanupMissionWorktree('task-118', {
    rootDir: FAKE_ROOT,
    existsSync: () => false,
    removeDir: () => {},
    gitRunner(args) {
      gitCalls.push(args);
      if (args.slice(-2).join(' ') === 'branch --show-current') {
        return { status: 0, stdout: 'main\n', stderr: '' };
      }
      if (args.includes('show-ref')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.slice(-2).join(' ') === 'list --porcelain') {
        // A worktree (no task- prefix) is registered but prunable; the
        // path the helper queries for is not listed.
        return {
          status: 0,
          stdout: `worktree /tmp/project-118\nHEAD deadbeef\nbranch refs/heads/mission/task-118\nprunable gitdir file points to non-existent location\n\n`,
          stderr: ''
        };
      }
      if (args.slice(-2).join(' ') === 'worktree prune') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[args.length - 2] === '-D') {
        branchDeleteAttempts += 1;
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  const pruneIdx = gitCalls.findIndex(a => a.slice(-2).join(' ') === 'worktree prune');
  const branchDelIdx = gitCalls.findIndex(a => a[a.length - 2] === '-D' && a[a.length - 1] === 'mission/task-118');
  assert.notEqual(pruneIdx, -1, 'expected worktree prune to be invoked');
  assert.notEqual(branchDelIdx, -1, 'expected branch -D to be invoked');
  assert.ok(pruneIdx < branchDelIdx, 'worktree prune must run before branch -D');
  assert.equal(branchDeleteAttempts, 1);
});

test('cleanupMissionWorktree blocks deletion when the mission worktree resolves inside Forgejo home', () => {
  const forgejoHome = '/tmp/visualboard-forgejo';
  const rootDir = `${forgejoHome}/project`;
  const worktreePath = conventionalWorktreePath('task-082', rootDir);
  const previousHome = process.env.FORGEJO_HOME;
  process.env.FORGEJO_HOME = forgejoHome;

  try {
    let thrown = null;
    try {
      cleanupMissionWorktree('task-082', {
        rootDir,
        existsSync(target) {
          return target === worktreePath;
        },
        gitRunner(args) {
          if (args.slice(-2).join(' ') === 'branch --show-current') {
            return { status: 0, stdout: 'main\n', stderr: '' };
          }
          if (args.includes('show-ref')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (args.slice(-2).join(' ') === 'list --porcelain') {
            return {
              status: 0,
              stdout: `worktree ${worktreePath}\nbranch refs/heads/mission/task-082\n`,
              stderr: ''
            };
          }
          if (args.includes('worktree') && args.includes('remove')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (args.slice(-2).join(' ') === 'worktree prune') {
            return { status: 0, stdout: '', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        }
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected forgejo-home deletion attempt to throw');
    assert.match(thrown.message, /CRITICAL SAFETY VIOLATION/);
  } finally {
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('rewriteWorktreePaths rewrites worktree references to the main checkout path', () => {
  const file = path.join(os.tmpdir(), `integrate-rewrite-${process.pid}.md`);
  const wt = conventionalWorktreePath('task-097', FAKE_ROOT);
  fs.writeFileSync(file, `${wt}/docs/missions/2026/task-097/MISSION.md\n`);

  try {
    rewriteWorktreePaths(file, 'task-097', { rootDir: FAKE_ROOT });
    const updated = fs.readFileSync(file, 'utf8');
    assert.equal(
      updated,
      `${FAKE_ROOT}/docs/missions/2026/task-097/MISSION.md\n`
    );
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('buildConflictResolutionPrompt gives explicit rebase-first guidance', () => {
  const wt = conventionalWorktreePath('task-097', FAKE_ROOT);
  const primaryBranch = getPrimaryBranch();
  const prompt = buildConflictResolutionPrompt('task-097', 'docs', { rootDir: FAKE_ROOT }).join('\n');
  assert.doesNotMatch(prompt, new RegExp(`review/${PRIMARY}`));
  assert.match(prompt, new RegExp(`Rebase the mission branch onto the local ${PRIMARY} branch`, 'i'));
  assert.match(prompt, new RegExp(wt));
  assert.match(prompt, new RegExp(`cd "${wt}"`));
  assert.match(prompt, /git status --short/);
  assert.match(prompt, new RegExp(`git fetch review ${PRIMARY}`));
  assert.match(prompt, new RegExp(`git rebase ${PRIMARY}`));
  assert.match(prompt, /no verification gate configured/);
  assert.match(prompt, /px integrate task-097 --dry-run/);
});

test('buildConflictResolutionPrompt targets the recorded feature base branch', () => {
  const prompt = buildConflictResolutionPrompt('task-097', 'docs', { rootDir: FAKE_ROOT, baseBranch: 'feature/foo' }).join('\n');
  assert.match(prompt, /Rebase the mission branch onto the local feature\/foo branch/i);
  assert.match(prompt, /git fetch review feature\/foo/);
  assert.match(prompt, /git rebase feature\/foo/);
  // The primary branch must not leak into feature-branch mission guidance.
  assert.doesNotMatch(prompt, new RegExp(`git rebase ${PRIMARY}\\b`));
});

test('variant B automation summary stays explicit about automated closeout steps', () => {
  assert.match(VARIANT_B_AUTOMATION_SUMMARY, /squash commit/i);
  assert.match(VARIANT_B_AUTOMATION_SUMMARY, /Forgejo sync-merged/);
  assert.doesNotMatch(VARIANT_B_AUTOMATION_SUMMARY, /mission-ledger/);
  assert.doesNotMatch(VARIANT_B_AUTOMATION_SUMMARY, /local gate/i);
});

test('sync-merged diagnostics include stale-info branch push recovery', () => {
  const staleInfoDiagnostic = SYNC_MERGED_DIAGNOSTICS.find(d => /stale info/i.test(d.symptom));

  assert.strictEqual(staleInfoDiagnostic?.symptom, 'git push rejects mission branch with "stale info" or "fetch first"');
  assert.match(staleInfoDiagnostic.cause, /tracking is stale/i);
  assert.match(staleInfoDiagnostic.fix, /fetches review\/<branch>/i);
  assert.match(staleInfoDiagnostic.fix, /force-with-lease/i);
});

test('printDiagnosticTable prominently includes the stale-info diagnostic row', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = message => lines.push(message);
  try {
    printDiagnosticTable();
  } finally {
    console.log = originalLog;
  }

  const output = lines.join('\n');
  assert.match(output, /Node sync-merged Diagnostic Table/);
  assert.match(output, /stale info/);
  assert.match(output, /Automated: sync-merged fetches review\/<branch>/);
});

test('reportSyncMergedFailure prints failure, raw output, and diagnostics table', () => {
  const errors = [];
  const logs = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = message => errors.push(message);
  console.log = message => logs.push(message);
  try {
    reportSyncMergedFailure({
      ok: false,
      error: 'push-branch-failed',
      raw: '! [rejected] abc123 -> mission/task-1062 (stale info)'
    });
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }

  assert.match(errors.join('\n'), /^\[FAIL\] Forgejo sync-merged failed \(push-branch-failed\)\.$/m);
  assert.match(errors.join('\n'), /^! \[rejected\] abc123 -> mission\/task-1062 \(stale info\)$/m);
  assert.match(logs.join('\n'), /^\[INFO\] sync-merged raw output:$/m);
  assert.match(logs.join('\n'), /Node sync-merged Diagnostic Table/);
  assert.match(logs.join('\n'), /fetches review\/<branch>/);
});

test('formatRecordedStatsRow renders the persisted review-round count', () => {
  assert.equal(
    formatRecordedStatsRow({
      mission: 'task-2000',
      implementer: 'claude',
      pr_fix_rounds: '8',
      classification: 'ai_sdlc',
      date: '2026-05-18',
    }),
    'task-2000: implementer=claude, pr_fix_rounds=8, classification=ai_sdlc, date=2026-05-18'
  );
});

test('recordPostIntegrationStats logs the persisted stats row including pr_fix_rounds', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(message);
  try {
    const outcome = await recordPostIntegrationStats('task-2000', {
      rootDir: FAKE_ROOT,
      recordIntegrationStatsFn() {
        return {
          changed: true,
          row: {
            mission: 'task-2000',
            implementer: 'claude',
            pr_fix_rounds: '8',
            classification: 'ai_sdlc',
            date: '2026-05-18',
          },
          report: 'weekly report',
          data: { rows: [] },
        };
      },
    });

    assert.equal(outcome.row.pr_fix_rounds, '8');
  } finally {
    console.log = originalLog;
  }

  assert.match(logs.join('\n'), /\[INFO\] Workflow stats recorded: task-2000: implementer=claude, pr_fix_rounds=8, classification=ai_sdlc, date=2026-05-18/);
  assert.match(logs.join('\n'), /\[INFO\] Workflow stats updated:/);
  assert.match(logs.join('\n'), /weekly report/);
  assert.match(logs.join('\n'), /\[INFO\] Mission telemetry by phase: task-2000/);
});

test('recordPostIntegrationStats records an unknown classification row for a missing-task mission', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(message);
  try {
    const outcome = await recordPostIntegrationStats('task-unknown', {
      rootDir: FAKE_ROOT,
      recordIntegrationStatsFn({ slug, rootDir, filePath, date }) {
        assert.equal(slug, 'task-unknown');
        assert.equal(rootDir, FAKE_ROOT);
        // TASK-2322.08: no stats file path is passed at all.
        assert.equal(filePath, undefined);
        // task-1415: no explicit date is passed anymore — recordIntegrationStats
        // defaults it to "today" itself, rather than trusting a stale
        // `git log -1 --format=%cs` committer date.
        assert.equal(date, undefined);
        return {
          changed: true,
          row: {
            mission: 'task-unknown',
            implementer: 'unknown',
            pr_fix_rounds: '0',
            classification: 'unknown',
            date: '2026-06-24',
          },
          report: 'weekly report',
          data: { rows: [] },
        };
      },
    });

    assert.equal(outcome.row.classification, 'unknown');
  } finally {
    console.log = originalLog;
  }

  assert.match(logs.join('\n'), /\[INFO\] Workflow stats recorded: task-unknown: implementer=unknown, pr_fix_rounds=0, classification=unknown, date=2026-06-24/);
});

// TASK-2322.08: integration no longer resolves any stats file path. It records
// the completed mission through the measurement store, which is anchored to
// PARALLIX_HOME by `resolveDatabasePath`, never to a consuming-repo path.
test('recordPostIntegrationStats passes no file path and stays anchored to PARALLIX_HOME', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'px-runtime-root-'));
  const parallixHome = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-home-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = parallixHome;
  try {
    const capturedOptions = [];
    const runOnce = () => recordPostIntegrationStats('task-2046', {
      rootDir: runtimeRoot,
      recordIntegrationStatsFn(options) {
        capturedOptions.push(options);
        return {
          changed: false,
          row: {
            mission: 'task-2046',
            implementer: 'claude',
            pr_fix_rounds: '0',
            classification: 'ai_sdlc',
            date: '2026-05-18',
          },
          report: 'weekly report',
          data: { rows: [] },
        };
      },
    });

    const originalLog = console.log;
    console.log = () => {};
    try {
      runOnce();
      runOnce();
    } finally {
      console.log = originalLog;
    }

    assert.equal(capturedOptions.length, 2);
    // No `filePath` is supplied and no stats CSV is created anywhere.
    assert.equal(capturedOptions[0].filePath, undefined);
    assert.equal(capturedOptions[1].filePath, undefined);
    assert.deepEqual(capturedOptions.map(o => o.rootDir), [runtimeRoot, runtimeRoot]);
    assert.deepEqual(fs.readdirSync(parallixHome).filter(name => name.endsWith('.csv')), []);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'stats.csv')), false);
    // The measurement database resolves under PARALLIX_HOME, not the repo root.
    assert.equal(resolveDatabasePath({}), path.join(parallixHome, 'parallix.db'));
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(parallixHome, { recursive: true, force: true });
  }
});

test('recordPostIntegrationStats prints mission-phase telemetry after weekly stats', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(message);
  try {
    const missionPhaseRows = [
      { mission: 'task-3000', stage: 'draft', provider: 'openai', model: 'gpt-4', implementer: 'claude', input_tokens: '1000', output_tokens: '500', cached_tokens: '100', tool_calls: '50', duration_minutes: '10', cost_usd: '1.50' },
      { mission: 'task-3000', stage: 'execute', provider: 'openai', model: 'gpt-4', implementer: 'claude', input_tokens: '2000', output_tokens: '1000', cached_tokens: '200', tool_calls: '100', duration_minutes: '20', cost_usd: '3.00' },
    ];
    await recordPostIntegrationStats('task-3000', {
      rootDir: FAKE_ROOT,
      recordIntegrationStatsFn() {
        return {
          changed: true,
          row: {
            mission: 'task-3000',
            implementer: 'claude',
            pr_fix_rounds: '2',
            classification: 'ai_sdlc',
            date: '2026-05-18',
          },
          report: 'weekly report',
          data: { rows: missionPhaseRows },
        };
      },
    });

    const combined = logs.join('\n');
    assert.match(combined, /\[INFO\] Workflow stats updated:/);
    assert.match(combined, /weekly report/);
    assert.match(combined, /\[INFO\] Mission telemetry by phase: task-3000/);
    assert.match(combined, /draft/);
    assert.match(combined, /execute/);
  } finally {
    console.log = originalLog;
  }
});

test('recordPostIntegrationStats handles empty mission-phase rows gracefully', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(message);
  try {
    await recordPostIntegrationStats('task-4000', {
      rootDir: FAKE_ROOT,
      recordIntegrationStatsFn() {
        return {
          changed: false,
          row: {
            mission: 'task-4000',
            implementer: 'claude',
            pr_fix_rounds: '0',
            classification: 'ai_sdlc',
            date: '2026-05-18',
          },
          report: 'weekly report',
          data: { rows: [] },
        };
      },
    });

    const combined = logs.join('\n');
    assert.match(combined, /\[INFO\] Workflow stats updated:/);
    assert.match(combined, /weekly report/);
    assert.match(combined, /\[INFO\] Mission telemetry by phase: task-4000/);
    assert.match(combined, /No telemetry rows recorded for mission "task-4000"/);
  } finally {
    console.log = originalLog;
  }
});

test('runPostIntegrateHookOrAbort no-ops silently when no hook is configured (SC1: unchanged behavior)', () => {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = message => logs.push(message);
  console.error = message => errors.push(message);
  try {
    const result = runPostIntegrateHookOrAbort('task-1402', {
      baseWorktree: FAKE_ROOT,
      baseBranch: 'main',
      variant: 'variant-b',
      runPostIntegrateHookFn: () => ({ ran: false, ok: true })
    });

    assert.deepEqual(result, { ran: false, ok: true });
    assert.deepEqual(logs, []);
    assert.deepEqual(errors, []);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test('runPostIntegrateHookOrAbort passes slug, base worktree/branch, and variant to the hook (SC2/SC3)', () => {
  let received;
  runPostIntegrateHookOrAbort('task-1402', {
    baseWorktree: FAKE_ROOT,
    baseBranch: 'main',
    variant: 'variant-b',
    runPostIntegrateHookFn: (params) => {
      received = params;
      return { ran: true, ok: true, command: './scripts/refresh-px.sh', output: 'ok', exitCode: 0 };
    }
  });

  assert.deepEqual(received, {
    slug: 'task-1402',
    baseWorktree: FAKE_ROOT,
    baseBranch: 'main',
    variant: 'variant-b'
  });
});

test('runPostIntegrateHookOrAbort logs a pass and the hook output on success', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(message);
  try {
    runPostIntegrateHookOrAbort('task-1402', {
      baseWorktree: FAKE_ROOT,
      baseBranch: 'main',
      variant: 'variant-b',
      runPostIntegrateHookFn: () => ({ ran: true, ok: true, command: './scripts/refresh-px.sh', output: 'bumped to 1.3.5', exitCode: 0 })
    });

    const combined = logs.join('\n');
    assert.match(combined, /\[PASS\] Post-integrate hook completed: \.\/scripts\/refresh-px\.sh/);
    assert.match(combined, /bumped to 1\.3\.5/);
  } finally {
    console.log = originalLog;
  }
});

test('runPostIntegrateHookOrAbort throws IntegrationAbort and surfaces a distinct failure with hook output (SC5)', () => {
  const errors = [];
  const originalError = console.error;
  console.error = message => errors.push(message);
  try {
    assert.throws(() => {
      runPostIntegrateHookOrAbort('task-1402', {
        baseWorktree: FAKE_ROOT,
        baseBranch: 'main',
        variant: 'variant-b-resumed',
        runPostIntegrateHookFn: () => ({ ran: true, ok: false, command: './scripts/refresh-px.sh', output: 'permission denied', exitCode: 3 })
      });
    });

    const combined = errors.join('\n');
    assert.match(combined, /\[FAIL\] Post-integrate hook failed \(exit code 3\): \.\/scripts\/refresh-px\.sh/);
    assert.match(combined, /permission denied/);
  } finally {
    console.error = originalError;
  }
});

test('px integrate --dry-run never invokes the post-integrate hook (SC4)', async () => {
  const hookSpy = mock.method(postIntegrateHookModule, 'runPostIntegrateHook');
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;
  process.exit = () => { throw new Error('process.exit called'); };
  console.error = () => {};
  console.log = () => {};
  try {
    try {
      await integrateCommand(['task-integrate-hook-dry-run-does-not-exist', '--dry-run'], { missionServicesFn: stubMissionServices() });
    } catch (err) {
      if (err.message !== 'process.exit called') throw err;
    }
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
    hookSpy.mock.restore();
  }

  assert.equal(hookSpy.mock.callCount(), 0);
});

test('px integrate never invokes the post-integrate hook when preflight fails (SC4)', async () => {
  const hookSpy = mock.method(postIntegrateHookModule, 'runPostIntegrateHook');
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;
  process.exit = () => { throw new Error('process.exit called'); };
  console.error = () => {};
  console.log = () => {};
  try {
    try {
      await integrateCommand(['task-integrate-hook-preflight-fails-does-not-exist'], { missionServicesFn: stubMissionServices() });
    } catch (err) {
      if (err.message !== 'process.exit called') throw err;
    }
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
    hookSpy.mock.restore();
  }

  assert.equal(hookSpy.mock.callCount(), 0);
});

test('evaluateTaskStatusForIntegration accepts approved (ready-for-integration) without extra conditions', () => {
  assert.deepEqual(
    evaluateTaskStatusForIntegration({
      taskStatus: 'ready-for-integration',
      pr: { merged: false },
      approval: { ok: false, reviewState: null }
    }),
    {
      ok: true,
      level: 'pass',
      message: 'Backlog status: approved'
    }
  );
});

test('evaluateTaskStatusForIntegration accepts review when the latest formal review is approved', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'APPROVED' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.level, 'warn');
  assert.match(result.message, /review accepted for integration/i);
  assert.match(result.message, /APPROVED/);
});

test('provider-backed approval repair leaves integration preflight with review instead of stale active', async () => {
  const { submitReviewRound } = submitReviewRoundModule;
  const { ReviewState } = ReviewStateModule;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1327-integrate-preflight-'));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task-2199 - stale-active.md');
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2199',
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

    await submitReviewRound('task-2199', 'approve', 'LGTM', {
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      writeReviewStateFn: () => ({ outcome: 'committed' }),
      readReviewStateFn: () => new ReviewState('task-2199', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      worktree: root,
      log: () => {},
      error: () => {},
      exit: () => {}
    });

    const result = evaluateTaskStatusForIntegration({
      taskStatus: backlog.getTaskStatus(taskFile),
      pr: { merged: false },
      approval: { ok: true, reviewState: 'APPROVED' }
    });

    assert.equal(result.ok, true);
    assert.equal(result.level, 'warn');
    assert.match(result.message, /review accepted for integration/i);
  } finally {
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('evaluateTaskStatusForIntegration rejects review when the Forgejo PR is already merged', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { state: 'merged', merged: true },
    approval: { ok: false, reviewState: null }
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, 'fail');
  assert.match(result.message, /approved Forgejo PR/i);
});

test('evaluateTaskStatusForIntegration rejects review without an approved Forgejo PR', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'COMMENT' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, 'fail');
  assert.match(result.message, /expected approved, or review with an approved Forgejo PR/i);
});

// TASK-2379: the defaultUserApproved boolean is no longer an approval
// authority. The override becomes a real ReviewerDecision through recovery
// (which moves the Mission lifecycle), and the lifecycle — not the boolean —
// is what the preflight accepts.
test('evaluateTaskStatusForIntegration rejects a raw defaultUserApproved boolean without the Mission lifecycle', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: true }
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, 'fail');
  assert.match(result.message, /expected approved, or review with an approved Forgejo PR/i);
});

test('evaluateTaskStatusForIntegration accepts review once the Mission lifecycle left it', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    missionStatus: 'integration',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: true }
  });

  assert.equal(result.ok, true);
  assert.equal(result.level, 'pass');
  assert.match(result.message, /Mission lifecycle/i);
});

test('evaluateTaskStatusForIntegration rejects review when default user did not approve and latest is not APPROVED', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: false }
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, 'fail');
  assert.match(result.message, /expected approved, or review with an approved Forgejo PR/i);
});

test('resolveForgejoUserForIntegration uses known task assignees directly', () => {
  assert.deepEqual(resolveForgejoUserForIntegration('codex'), {
    forgejoUser: 'codex',
    warning: null
  });
});

test('resolveForgejoUserForIntegration uses task assignee directly even for unknown agents', () => {
  // Hardened behavior: always use the task assignee if set, regardless of whether
  // it is in the known agent list. This ensures consistent identity resolution
  // for all Forgejo operations using the task's assignee/implementer.
  const originalUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'gemini';

  try {
    const result = resolveForgejoUserForIntegration('[nonstandard]');
    assert.equal(result.forgejoUser, '[nonstandard]');
    assert.equal(result.warning, null);
  } finally {
    process.env.FORGEJO_USER = originalUser;
  }
});

test('printIntegrationPreflight reports token resolution and detached-head recovery command', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-113',
      branch: 'mission/task-113',
      currentBranch: 'mission/task-113',
      missionDir: '/tmp/docs/missions/2026/task-113',
      baseWorktree: FAKE_ROOT,
      task: { ok: true, taskFile: '/tmp/task-113.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 113 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: '',
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    assert.ok(result.failures.includes('main-branch'));
    const output = lines.join('\n');
    assert.match(output, /Forgejo token: resolved for codex \(\/tmp\/tokens\/codex\)/);
    assert.match(output, new RegExp(`expected ${PRIMARY}, found \\(detached HEAD\\)`));
    assert.match(output, new RegExp(`Retry with: git -C ${FAKE_ROOT} checkout ${PRIMARY}`));
  } finally {
    console.log = originalLog;
  }
});

test('printIntegrationPreflight fails when no Forgejo token is available', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-113',
      branch: 'mission/task-113',
      currentBranch: 'mission/task-113',
      missionDir: '/tmp/docs/missions/2026/task-113',
      baseWorktree: FAKE_ROOT,
      task: { ok: true, taskFile: '/tmp/task-113.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 113 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainAheadCount: 0,
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    assert.ok(result.failures.includes('forgejo-token'));
    const output = lines.join('\n');
    assert.match(output, /Forgejo token: no token file found for codex/);
  } finally {
    console.log = originalLog;
  }
});

test('printIntegrationPreflight reads an adhoc mission from the Mission store instead of warning about a missing task file', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'parallix-adhoc-0001',
      branch: 'mission/parallix-adhoc-0001',
      currentBranch: 'mission/parallix-adhoc-0001',
      missionDir: '/tmp/project-parallix-adhoc-0001/missions/parallix-adhoc-0001',
      task: { ok: false, reason: 'missing' },
      taskStatus: null,
      taskAssignee: null,
      missionStatus: 'integration',
      missionLabels: ['user_value', 'bug'],
      forgejoUser: null,
      taskAssigneeWarning: null,
      pr: { exists: false, raw: 'no PR found' },
      approval: { ok: true, reviewState: 'APPROVED' },
      baseWorktree: '/tmp/project',
      mainBranch: 'main',
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => '/tmp/token',
      isForgejoReviewEnabledFn: () => false,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    const output = lines.join('\n');
    assert.doesNotMatch(output, /no task file found/);
    assert.doesNotMatch(output, /synthetic\/unknown task metadata/);
    assert.match(output, /Backlog task: none — adhoc mission, Mission store is authoritative/);
    assert.match(output, /Mission classification: user_value/);
    assert.ok(!result.failures.includes('classification'), 'mission labels supply the classification');
    assert.ok(!result.failures.includes('task-status'), 'mission lifecycle supplies the status');
  } finally {
    console.log = originalLog;
  }
});

test('printIntegrationPreflight tolerates a missing task file and reports unknown classification', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-unknown',
      branch: 'mission/task-unknown',
      currentBranch: 'mission/task-unknown',
      missionDir: '/tmp/docs/missions/2026/task-unknown',
      task: { ok: false, reason: 'missing' },
      taskStatus: null,
      taskAssignee: null,
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: false, raw: 'no PR found' },
      approval: { ok: false, error: 'pr-missing', reviewState: null },
      mainBranch: 'main',
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => false,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    const output = lines.join('\n');
    assert.ok(!result.failures.includes('task-missing'));
    assert.match(output, /no task file found for task-unknown/);
    assert.match(output, /Backlog classification: unknown/);
  } finally {
    console.log = originalLog;
  }
});

test('getUnresolvedIndexConflicts deduplicates conflicted paths from git ls-files -u', () => {
  const result = getUnresolvedIndexConflicts('/tmp/main-checkout', {
    gitRunner(args) {
      assert.deepEqual(args, ['-C', '/tmp/main-checkout', 'ls-files', '-u']);
      return {
        status: 0,
        stdout: [
          '100644 aaaaa 1\tserver/src/App.java',
          '100644 bbbbb 2\tserver/src/App.java',
          '100644 ccccc 3\tworkflow/lib/commands/integrate.js'
        ].join('\n'),
        stderr: ''
      };
    }
  });

  assert.deepEqual(result, {
    ok: true,
    files: ['server/src/App.java', 'workflow/lib/commands/integrate.js']
  });
});

test('printIntegrationPreflight reports unresolved index conflicts with recovery commands', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-113',
      branch: 'mission/task-113',
      currentBranch: 'mission/task-113',
      missionDir: '/tmp/docs/missions/2026/task-113',
      baseWorktree: FAKE_ROOT,
      task: { ok: true, taskFile: '/tmp/task-113.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 113 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainAheadCount: 0,
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({
        ok: true,
        files: ['workflow/lib/commands/integrate.js', 'backlog/tasks/task-113.md']
      })
    });

    assert.ok(result.failures.includes('main-index-conflicts'));
    const output = lines.join('\n');
    assert.match(output, /Integration checkout conflicts: unresolved merge entries detected/i);
    assert.match(output, new RegExp(`git -C ${FAKE_ROOT} rm "workflow/lib/commands/integrate\\.js"`));
    assert.match(output, new RegExp(`git -C ${FAKE_ROOT} add "backlog/tasks/task-113\\.md"`));
    assert.match(output, new RegExp(`git -C ${FAKE_ROOT} stash drop`));
    assert.match(output, /Retry with: px integrate task-113 --dry-run/);
  } finally {
    console.log = originalLog;
  }
});

test('printIntegrationPreflight fails fast on an in-progress rebase in the integration checkout', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1322',
      branch: 'mission/task-1322',
      currentBranch: 'mission/task-1322',
      missionDir: '/tmp/docs/missions/2026/task-1322',
      baseWorktree: FAKE_ROOT,
      task: { ok: true, taskFile: '/tmp/task-1322.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1322 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainAheadCount: 0,
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      detectRebaseStateFn: target => {
        assert.equal(target, FAKE_ROOT);
        return {
          inProgress: true,
          detached: true,
          rebaseHead: 'abc123def456',
          unmergedFiles: [
            'backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md',
            'missions/task-1322/review-state.json',
            'missions/task-1322/CP-4.md'
          ]
        };
      },
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    assert.ok(result.failures.includes('rebase-in-progress'));
    const output = lines.join('\n');
    assert.match(output, /Integration checkout rebase: rebase in progress/i);
    assert.match(output, /Current rebase head: abc123def456/);
    assert.match(output, /backlog\/tasks\/task-1322 - prevent-backlog-task-id-recycling-collision\.md/);
    assert.match(output, new RegExp(`git -C ${FAKE_ROOT} rebase --continue`));
    assert.match(output, new RegExp(`git -C ${FAKE_ROOT} rebase --abort`));
    assert.match(output, new RegExp(`git -C ${FAKE_ROOT} rebase --skip`));
    assert.match(output, /Retry with: px integrate task-1322 --dry-run/);
  } finally {
    console.log = originalLog;
  }
});

test('maybeUpdateGraphifyOnPrimary skips cleanly when graphify is missing', () => {
  const logs = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrate-graphify-missing-'));
  fs.mkdirSync(path.join(root, 'graphify-out'));
  fs.writeFileSync(path.join(root, 'graphify-out', 'graph.json'), '{}\n');

  const result = maybeUpdateGraphifyOnPrimary(root, {
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

test('maybeUpdateGraphifyOnPrimary runs graphify update in the primary worktree when available', () => {
  const calls = [];
  const logs = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrate-graphify-update-'));
  fs.mkdirSync(path.join(root, 'graphify-out'));
  fs.writeFileSync(path.join(root, 'graphify-out', 'graph.json'), '{}\n');

  const result = maybeUpdateGraphifyOnPrimary(root, {
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
  const expectedGraphifyCommand = process.env.GRAPHIFY_BIN || 'graphify';
  assert.deepEqual(calls, [
    {
      command: expectedGraphifyCommand,
      args: ['--help'],
      options: {}
    },
    {
      command: expectedGraphifyCommand,
      args: ['update', '.'],
      options: {
        cwd: root,
        stdio: 'inherit'
      }
    }
  ]);
  assert.ok(logs.some(line => line.includes(`Updating graphify knowledge graph on ${PRIMARY}...`)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('parseStashPopCollisionFiles extracts already-exists paths from stash pop output', () => {
  const files = parseStashPopCollisionFiles([
    'foo.txt already exists, no checkout',
    'nested/bar.md already exists, no checkout',
    'error: could not restore untracked files from stash'
  ].join('\n'));

  assert.deepEqual(files, ['foo.txt', 'nested/bar.md']);
});

test('reportStashPopFailure confirms landed integration and prints merge-conflict recovery steps', () => {
  const lines = [];
  const originalError = console.error;
  console.error = line => lines.push(line);

  try {
    reportStashPopFailure('task-113', { status: 1, stdout: '', stderr: 'conflict output' }, {
      rootDir: '/tmp/main-checkout',
      gitRunner(args) {
        assert.deepEqual(args, ['-C', '/tmp/main-checkout', 'log', '-1', '--oneline']);
        return { status: 0, stdout: 'abc123 mission/task-113: harden integrate preflight\n', stderr: '' };
      },
      getUnresolvedIndexConflictsFn: () => ({
        ok: true,
        files: ['workflow/lib/commands/integrate.js']
      })
    });

    const output = lines.join('\n');
    assert.match(output, /Integration commit landed: abc123 mission\/task-113: harden integrate preflight/);
    assert.match(output, /Stash restore failure type: merge-conflict/);
    assert.match(output, /Resolve workflow\/lib\/commands\/integrate\.js, then run git add "workflow\/lib\/commands\/integrate\.js" or git rm "workflow\/lib\/commands\/integrate\.js"/);
    assert.match(output, /git stash drop/);
  } finally {
    console.error = originalError;
  }
});

test('reportStashPopFailure prints file-collision recovery steps when no merge entries remain', () => {
  const lines = [];
  const originalError = console.error;
  console.error = line => lines.push(line);

  try {
    reportStashPopFailure('task-113', {
      status: 1,
      stdout: 'docs/index.md already exists, no checkout',
      stderr: 'error: could not restore untracked files from stash'
    }, {
      rootDir: '/tmp/main-checkout',
      gitRunner() {
        return { status: 0, stdout: 'def456 unrelated latest commit\n', stderr: '' };
      },
      getUnresolvedIndexConflictsFn: () => ({
        ok: true,
        files: []
      })
    });

    const output = lines.join('\n');
    assert.match(output, /Integration landing not confirmed by HEAD: def456 unrelated latest commit/);
    assert.match(output, /Stash restore failure type: file-collision/);
    assert.match(output, /git -C \/tmp\/main-checkout stash show --name-only stash@\{0\}/);
    assert.match(output, /mv \/tmp\/main-checkout\/docs\/index\.md \/tmp\/main-checkout\/docs\/index\.md\.pre-stash-pop/);
    assert.match(output, /git -C \/tmp\/main-checkout stash pop/);
  } finally {
    console.error = originalError;
  }
});

test('promoteTaskForIntegrationIfNeeded logs the dry-run auto-promotion without mutating status', async () => {
  const context = {
    task: { ok: true, taskFile: '/tmp/task-097.md' },
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'APPROVED' }
  };
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = await promoteTaskForIntegrationIfNeeded(context, { dryRun: true });
    assert.deepEqual(result, { changed: false, dryRun: true });
    assert.equal(context.taskStatus, 'review');
    assert.match(lines.join('\n'), /would promote Backlog status from review to approved/i);
  } finally {
    console.log = originalLog;
  }
});

test('recovery promotes an approved Review with its original decidedAt before integration', async () => {
  const decidedAt = '2026-01-01T10:30:00Z';
  const calls = [];
  let state = {
    status: 'review', assignee: 'codex', review: {
      rounds: [{ decision: { kind: 'approved', decidedAt } }],
    },
  };
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: {
      async transition(request) {
        calls.push(request);
        state = { ...state, status: 'integration' };
        return { status: 'completed' };
      },
    },
  };

  const result = await recoverMissionForIntegration({ slug: 'task-2376' }, { missionServices });
  assert.deepEqual(result, { recovered: true, status: 'integration', occurredAt: decidedAt });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.type, 'approve');
  assert.equal(calls[0].occurredAt, decidedAt);
});

test('recovery refuses an active Mission without authoritative Review facts', async () => {
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: { status: 'active' }, version: 7 }; } },
    lifecycle: { async transition() { throw new Error('must not transition'); } },
  };
  await assert.rejects(
    () => recoverMissionForIntegration({ slug: 'task-2376' }, { missionServices }),
    error => error.constructor.name === 'IntegrationAbort',
  );
});

// R4 — stale `active` with an already-approved Review round: recovery must not
// re-submit the decided round (AC #2) but must still chain active → review →
// integration and run the approve at the original decidedAt, never patching
// Mission.status directly. The active → review move is a direct submit-for-review
// that the workflow guard recognises as a decided round and advances without
// rewriting the round; the handoff submitForReviewFn replay is skipped.
test('R4: stale active approved recovery skips submit-for-review replay, then approves at original decidedAt', async () => {
  const decidedAt = '2026-01-01T10:30:00Z';
  const reviewEntryAt = '2026-01-01T10:00:00Z';
  const calls: string[][] = [];
  let submitForReviewCalled = false;
  const state = {
    status: 'active', assignee: 'codex',
    review: { rounds: [{ startedAt: reviewEntryAt, decision: { kind: 'approved', decidedAt } }] },
  };
  const submitForReviewFn = async () => {
    submitForReviewCalled = true;
  };
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: {
      async transition(request) {
        calls.push([request.command.type, request.occurredAt]);
        // mirror the workflow guard: a decided round moves active → review, then
        // approve moves review → integration
        if (request.command.type === 'submit-for-review') { state.status = 'review'; }
        else if (request.command.type === 'approve') { state.status = 'integration'; }
        return { status: 'completed' };
      },
    },
  };

  const result = await recoverMissionForIntegration(
    {
      slug: 'task-2376',
      approval: {
        ok: true,
        defaultUserApproved: true,
        defaultUserApprovedAt: decidedAt,
      },
    },
    { missionServices, submitForReviewFn },
  );

  assert.equal(submitForReviewCalled, false, 'recovery skips the submit-for-review handoff replay for an already-approved round');
  assert.deepEqual(
    calls,
    // The active → review move carries the Review round's own startedAt, never
    // the recovery wall clock (review round 1, F1); approve runs at decidedAt.
    [['submit-for-review', reviewEntryAt], ['approve', decidedAt]],
    'recovery moves active → review then approves at the original decidedAt',
  );
  assert.deepEqual(result, { recovered: true, status: 'integration', occurredAt: decidedAt });
});

test('R4b: stale active approved recovery requires the provider approval', async () => {
  const state = {
    status: 'active', assignee: 'codex',
    review: {
      rounds: [{
        startedAt: '2026-01-01T10:00:00Z',
        decision: { kind: 'approved', decidedAt: '2026-01-01T10:30:00Z' },
      }],
    },
  };
  const transitionCalls = [];
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: { async transition(request) { transitionCalls.push(request); return { status: 'completed' }; } },
  };

  await assert.rejects(
    () => recoverMissionForIntegration({ slug: 'task-2397' }, { missionServices }),
    error => error.constructor.name === 'IntegrationAbort',
  );
  assert.equal(transitionCalls.length, 0, 'a stored approval alone cannot move the Mission');
  assert.equal(state.status, 'active');
});

// R4b2 — no review provider configured (`review.provider !== 'forgejo'`): there
// is no provider approval that could ever exist, so the stored ReviewerDecision
// is the only approval authority and recovery must proceed. The R4b guard stays
// fail-closed whenever a provider is configured.
test('R4b2: stale active approved recovery proceeds when no review provider is configured', async () => {
  const decidedAt = '2026-01-01T10:30:00Z';
  const reviewEntryAt = '2026-01-01T10:00:00Z';
  const calls: string[][] = [];
  const state = {
    status: 'active', assignee: 'codex',
    review: { rounds: [{ startedAt: reviewEntryAt, decision: { kind: 'approved', decidedAt } }] },
  };
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: {
      async transition(request) {
        calls.push([request.command.type, request.occurredAt]);
        if (request.command.type === 'submit-for-review') { state.status = 'review'; }
        else if (request.command.type === 'approve') { state.status = 'integration'; }
        return { status: 'completed' };
      },
    },
  };

  const result = await recoverMissionForIntegration(
    {
      slug: 'task-2460',
      approval: { ok: true, reviewState: 'APPROVED', source: 'mission-store', providerDisabled: true },
    },
    { missionServices },
  );

  assert.deepEqual(calls, [['submit-for-review', reviewEntryAt], ['approve', decidedAt]]);
  assert.deepEqual(result, { recovered: true, status: 'integration', occurredAt: decidedAt });
});

test('R4c: fresh awaiting-review recovery still uses the handoff operation', async () => {
  const state = {
    status: 'active', assignee: 'codex',
    review: { rounds: [{ startedAt: '2026-01-01T10:00:00Z', decision: null }] },
  };
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: { async transition() { throw new Error('no direct transition expected'); } },
  };
  let submitForReviewCalled = false;

  await assert.rejects(
    () => recoverMissionForIntegration({ slug: 'task-2397' }, {
      missionServices,
      submitForReviewFn: async () => {
        submitForReviewCalled = true;
        state.status = 'review';
      },
    }),
    error => error.constructor.name === 'IntegrationAbort',
  );
  assert.equal(submitForReviewCalled, true, 'fresh rounds still route through submitForReview');
  assert.equal(state.status, 'review', 'the fresh handoff still advances active to review');
});

// R5 — stale `active` with no Review facts and an explicit human override:
// recovery must persist a real ReviewerDecision(kind=approved, decidedAt=T)
// through the Review domain, then chain the existing `submit-for-review`
// and `approve` operations. No direct status patches, no wall-clock stamp.
test('R5: stale active recovery with human override persists a real ReviewerDecision, then chains existing operations', async () => {
  const fsMod = await import('node:fs');
  const osMod = await import('node:os');
  const pathMod = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { agentFamily } = await import('../src/domain/agents.js');
  const { missionId } = await import('../src/domain/mission.js');
  const { repositoryId } = await import('../src/domain/repository.js');
  const { ConfiguredReviewerEligibility, changeRevision, startReview } = await import('../src/domain/review.js');
  const { MissionLifecycleService } = await import('../src/application/mission-lifecycle-service.js');
  const { SqliteDatabaseAdapter } = await import('../src/adapters/sqlite/database-adapter.js');
  const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../src/adapters/sqlite/migration-runner.js');
  const { SqliteMissionStore } = await import('../src/adapters/sqlite/mission-store.js');
  const { clearOperatorStateCache } = await import('../src/adapters/sqlite/adapter-factory.js');

  const decidedAt = '2026-01-01T10:30:00Z';
  const submittedAt = '2026-01-01T10:00:00Z';
  const implementer = agentFamily('configured-implementer');
  const reviewer = agentFamily('configured-reviewer');
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const pullRequest = { kind: 'pull-request', provider: 'forgejo', id: '2379-r5', url: null, sourceBranch: 'mission/task-2379-r5', targetBranch: 'main' };

  const root = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'task-2379-r5-'));
  fsMod.mkdirSync(pathMod.join(root, 'missions'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: root });

  const home = pathMod.join(root, 'parallix-home');
  fsMod.mkdirSync(home, { recursive: true });
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  await clearOperatorStateCache();

  const database = new SqliteDatabaseAdapter();
  await database.open({ path: pathMod.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  const lifecycle = new MissionLifecycleService(store);

  const slug = 'task-2379-r5';
  const mission = {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: 'R5 active override',
    labels: [],
    assignee: implementer,
    status: 'active',
    rawStatus: 'active',
    checkpoints: [{
      missionId: missionId(slug),
      name: 'CP-0',
      rawFilename: 'CP-0.md',
      firstLine: 'CP-0',
      goalCheck: [{ criterion: 'c', evidence: 'e' }],
      nextActionText: 'review',
    }],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: null,
  };
  await store.save(mission, null);

  try {
    const calls = [];
    // The existing handoff operation owns active → review: it creates the
    // awaiting Review aggregate and persists it through the domain.
    // Mirrors the production contract (review round 1, F1): the handoff
    // stamps the authoritative timestamp recovery passes, its own wall clock
    // when nothing is passed — so this test stays red if recovery forgets to
    // forward the entry time.
    const stamp = (options: any) => options?.occurredAt || new Date().toISOString();
    const submitForReviewFn = async (submittedSlug, isContinue, options: any = {}) => {
      calls.push(['submit-for-review', submittedSlug, isContinue, options?.occurredAt ?? null]);
      const loaded = await store.load(missionId(submittedSlug));
      const review = startReview(
        { change: pullRequest, revision: changeRevision('abc123') },
        reviewer,
        implementer,
        stamp(options),
        reviewerEligibility,
      );
      const result = await lifecycle.transition({
        operationId: `r5-submit:${submittedSlug}`,
        missionId: missionId(submittedSlug),
        expectedVersion: loaded.kind === 'found' ? loaded.version : null,
        capabilities: new Set(['mission:transition']),
        command: { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility },
        actor: implementer,
        occurredAt: stamp(options),
      });
      if (result.status !== 'completed') {
        throw new Error(`submit-for-review failed: ${result.error?.message ?? 'unknown'}`);
      }
    };

    const context = {
      slug,
      // The provider approval was recorded on this PR; its creation time is
      // the authoritative review-entry point for the recovered transition.
      pr: {
        exists: true,
        state: 'open',
        number: 1,
        createdAt: submittedAt,
      },
      approval: {
        ok: true,
        reviewState: 'REQUEST_CHANGES',
        defaultUserApproved: true,
        defaultUserApprovedAt: decidedAt,
      },
    };

    const result = await recoverMissionForIntegration(context, {
      missionServices: { store, lifecycle },
      submitForReviewFn,
    });

    assert.deepEqual(result, { recovered: true, status: 'integration', occurredAt: decidedAt });
    assert.deepEqual(
      calls,
      [['submit-for-review', slug, false, submittedAt]],
      'recovery invokes the existing handoff operation with the authoritative entry timestamp, never patches status',
    );

    const loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    assert.equal(loaded.mission.status, 'integration');
    const round = loaded.mission.review.rounds[loaded.mission.review.rounds.length - 1];
    assert.equal(round.decision.kind, 'approved', 'an authoritative ReviewerDecision exists');
    assert.equal(round.decision.decidedAt, decidedAt, 'decidedAt is the human approval time, not the integration start');

    const events = await database.query(
      'SELECT from_status, to_status, trigger, occurred_at FROM board_lane_events WHERE mission_id = ?',
      [missionId(slug)],
    );
    const submitEvents = events.filter((e) => e.from_status === 'active' && e.to_status === 'review');
    const approveEvents = events.filter((e) => e.from_status === 'review' && e.to_status === 'integration');
    assert.equal(submitEvents.length, 1, 'exactly one active → review event');
    assert.equal(approveEvents.length, 1, 'exactly one review → integration event');
    assert.equal(approveEvents[0].occurred_at, decidedAt, 'approve transition uses the stored decidedAt');
    assert.equal(submitEvents[0].occurred_at, submittedAt, 'recovered active → review uses the authoritative review-entry timestamp, not the recovery wall clock');
    assert.ok(submitEvents[0].occurred_at <= approveEvents[0].occurred_at, 'lane events stay ordered: review entry does not postdate review exit');
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fsMod.rmSync(root, { recursive: true, force: true });
  }
});

// Review round 1 (F1): without an authoritative review-entry timestamp the
// recovery must stop — it may not fall back to the recovery wall clock (that
// is the divergence this mission removes) and it may not persist an
// out-of-order lane event from inverted data.
test('R5b: override recovery stops without an authoritative review-entry timestamp', async () => {
  const makeState = () => ({ status: 'active', assignee: 'codex', review: null });
  const baseContext = {
    slug: 'task-2376',
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: true, defaultUserApprovedAt: '2026-01-01T10:30:00Z' },
  };
  const makeServices = (state) => {
    const transitionCalls = [];
    const services = {
      store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
      lifecycle: { async transition(request) { transitionCalls.push(request); return { status: 'completed' }; } },
    };
    return { services, transitionCalls };
  };

  // No PR creation time and no Review round: no authoritative entry exists.
  {
    const state = makeState();
    const { services, transitionCalls } = makeServices(state);
    const submitCalls = [];
    await assert.rejects(
      () => recoverMissionForIntegration({ ...baseContext, pr: { exists: true, state: 'open' } }, {
        missionServices: services,
        submitForReviewFn: async () => { submitCalls.push(1); },
      }),
      error => error.constructor.name === 'IntegrationAbort',
    );
    assert.equal(submitCalls.length, 0, 'no handoff operation runs on missing entry data');
    assert.equal(transitionCalls.length, 0, 'no transition is invented');
    assert.equal(state.status, 'active', 'Mission is not done');
  }

  // Inverted data: the entry postdates the approval — persisting it would
  // emit an out-of-order lane event the projection silently drops.
  {
    const state = makeState();
    const { services, transitionCalls } = makeServices(state);
    const submitCalls = [];
    await assert.rejects(
      () => recoverMissionForIntegration({ ...baseContext, pr: { exists: true, state: 'open', createdAt: '2026-01-01T12:00:00Z' } }, {
        missionServices: services,
        submitForReviewFn: async () => { submitCalls.push(1); },
      }),
      error => error.constructor.name === 'IntegrationAbort',
    );
    assert.equal(submitCalls.length, 0, 'inverted timestamps never reach the handoff operation');
    assert.equal(transitionCalls.length, 0, 'no transition is invented');
    assert.equal(state.status, 'active', 'Mission is not done');
  }
});

// Review round 1 (F3): `--dry-run` skips recovery, so preflight must predict
// the authority the real run would establish. The override case the real run
// accepts must not fail the dry-run preflight; the no-override control must
// still fail.
test('F3: dry-run preflight accepts the override case the real run accepts', () => {
  const logs = [];
  const makeContext = (approval) => ({
    slug: 'task-2379-f3',
    branch: 'mission/task-2379-f3',
    currentBranch: 'mission/task-2379-f3',
    missionDir: '/tmp/task-2379-f3/missions/task-2379-f3',
    area: 'all',
    task: { ok: true, taskFile: '/tmp/task-2379-f3/backlog/tasks/task-2379-f3.md' },
    taskStatus: 'review',
    taskAssignee: 'custom',
    forgejoUser: 'default',
    forgejoToken: 'test-token',
    pr: { exists: true, state: 'open', number: 1, createdAt: '2026-01-01T10:00:00Z' },
    siblingPrs: [],
    approval,
    missionStatus: 'review',
    missionReview: { rounds: [{ decision: null }] },
    baseBranch: 'main',
    baseWorktree: '/tmp/task-2379-f3',
    mainBranch: 'main',
    mainDirtyEntries: [],
    mainDirty: false,
  });
  const options = {
    readTokenFn: () => 'test-token',
    resolveTokenFileFn: () => '/tmp/token-file',
    detectRebaseStateFn: () => ({ inProgress: false, rebaseHead: null, unmergedFiles: [] }),
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    findMissionDocInBranchesFn: () => null,
    isForgejoReviewEnabledFn: () => true,
    log: (message) => { logs.push(message); },
  };

  const { failures } = printIntegrationPreflight(
    makeContext({ ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: true, defaultUserApprovedAt: '2026-01-01T10:30:00Z' }),
    options,
  );
  assert.ok(!failures.includes('task-status'), `dry-run must not fail task-status for the override case: ${failures.join(', ')}`);
  assert.ok(!failures.includes('pr-approval'), `dry-run must not fail pr-approval for the override case: ${failures.join(', ')}`);
  assert.ok(logs.some((line) => line.includes('recovery would establish')), 'dry-run reports the authority the real run would record');

  logs.length = 0;
  const control = printIntegrationPreflight(
    makeContext({ ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: false }),
    options,
  );
  assert.ok(control.failures.includes('task-status'), 'control: without override task-status still fails');
  assert.ok(control.failures.includes('pr-approval'), 'control: without override pr-approval still fails');
});

// R6 — stale `active` with no sufficient Review facts and no override: recovery
// stops with an actionable error and the Mission is not `done`. No Git/PR/
// task-text inference is allowed to fill the gap.
test('R6: stale active without Review facts and without override stops — Mission not done', async () => {
  const state = { status: 'active', assignee: 'codex' };
  const transitionCalls = [];
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: { async transition(request) { transitionCalls.push(request); return { status: 'completed' }; } },
  };
  const context = {
    slug: 'task-2376',
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: false },
  };

  await assert.rejects(
    () => recoverMissionForIntegration(context, { missionServices }),
    error => error.constructor.name === 'IntegrationAbort',
  );
  assert.equal(transitionCalls.length, 0, 'no transition is invented without authoritative facts');
  assert.equal(state.status, 'active', 'Mission is not done');
});

// R7 — `review` without an authoritative approval and no override: recovery
// must stop and the Mission must remain in `review` (no invented transition).
test('R7: review without approval stops — Mission remains review', async () => {
  const transitionCalls = [];
  const state = {
    status: 'review', assignee: 'codex',
    review: { rounds: [{ decision: { kind: 'changes-requested', decidedAt: '2026-01-01T11:00:00Z' } }] },
  };
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: { async transition(request) { transitionCalls.push(request); return { status: 'completed' }; } },
  };

  await assert.rejects(
    () => recoverMissionForIntegration({ slug: 'task-2376' }, { missionServices }),
    error => error.constructor.name === 'IntegrationAbort',
  );
  assert.equal(transitionCalls.length, 0, 'no approval transition is invented');
  assert.equal(state.status, 'review', 'Mission remains in review');
});

// R9 — normal `integration` state: recovery proceeds without rerunning
// review/approval logic and creates no duplicate approval event.
test('R9: normal integration state proceeds without rerunning approval', async () => {
  const transitionCalls = [];
  const state = { status: 'integration', assignee: 'codex' };
  const missionServices = {
    store: { async load() { return { kind: 'found', mission: state, version: 7 }; } },
    lifecycle: { async transition(request) { transitionCalls.push(request); return { status: 'completed' }; } },
  };

  const result = await recoverMissionForIntegration({ slug: 'task-2376' }, { missionServices });

  assert.deepEqual(result, { recovered: false, status: 'integration' });
  assert.equal(transitionCalls.length, 0, 'no duplicate approval event is created');
});

test('promoteTaskForIntegrationIfNeeded updates the task file on a real integration run', async () => {
  const taskFile = path.join(os.tmpdir(), `integrate-promote-${process.pid}.md`);
  fs.writeFileSync(taskFile, 'Status: ○ review\n');

  try {
    const context = {
      slug: 'task-2229',
      task: { ok: true, taskFile },
      taskStatus: 'review',
      pr: { merged: false },
      approval: { ok: true, reviewState: 'APPROVED' }
    };
    const result = await promoteTaskForIntegrationIfNeeded(context, {
      missionServicesFn: stubMissionServices({
        store: { async load() { return { kind: 'found', mission: { status: 'integration' }, version: 1 }; } },
      }),
    });

    assert.deepEqual(result, { changed: true, dryRun: false });
    assert.equal(context.taskStatus, 'ready-for-integration');
    assert.match(fs.readFileSync(taskFile, 'utf8'), /Status: ○ ready-for-integration/); // actual backlog.md state
  } finally {
    fs.rmSync(taskFile, { force: true });
  }
});

// TASK-2322.07: after the cutover a Mission that has no SQLite aggregate is not
// a lifecycle state Parallix recognises. Promoting the external task anyway
// would recreate a file-only lifecycle, so a `missing` (or `unavailable`) load
// must abort before the Backlog mutation.
for (const [label, read] of [
  ['missing', { kind: 'missing' }],
  ['unavailable', { kind: 'unavailable', reason: 'database is locked' }],
] as const) {
  test(`promoteTaskForIntegrationIfNeeded refuses to promote the Backlog task when the Mission aggregate is ${label}`, async () => {
    const taskFile = path.join(os.tmpdir(), `integrate-promote-${label}-${process.pid}.md`);
    fs.writeFileSync(taskFile, 'Status: ○ review\n');

    try {
      const context = {
        slug: 'task-2322-07-absent',
        task: { ok: true, taskFile },
        taskStatus: 'review',
        pr: { merged: false },
        approval: { ok: true, reviewState: 'APPROVED' }
      };
      const missionServicesFn = stubMissionServices({
        store: { _repoId: 'test-repo', async load() { return read; } },
      });

      await assert.rejects(
        () => promoteTaskForIntegrationIfNeeded(context, { missionServicesFn }),
        (error: Error) => error.constructor.name === 'IntegrationAbort',
      );
      assert.equal(context.taskStatus, 'review', 'the external task status must be untouched');
      assert.match(fs.readFileSync(taskFile, 'utf8'), /Status: ○ review/);
    } finally {
      fs.rmSync(taskFile, { force: true });
    }
  });
}

test('promoteTaskForIntegrationIfNeeded writes the integration checkout instead of the mission task copy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrate-promote-base-'));
  const baseTask = path.join(root, 'backlog', 'tasks', 'task-2230 - base.md');
  const missionTask = path.join(root, 'mission-task.md');
  fs.mkdirSync(path.dirname(baseTask), { recursive: true });
  fs.writeFileSync(baseTask, 'id: TASK-2230\nstatus: review\n');
  fs.writeFileSync(missionTask, 'id: TASK-2230\nstatus: review\n');
  try {
    const context = {
      slug: 'task-2230', baseWorktree: root,
      task: { ok: true, taskFile: missionTask }, taskStatus: 'review',
      pr: { merged: false }, approval: { ok: true, reviewState: 'APPROVED' }
    };
    assert.deepEqual(
      await promoteTaskForIntegrationIfNeeded(context, {
        missionServicesFn: stubMissionServices({
          store: { async load() { return { kind: 'found', mission: { status: 'integration' }, version: 1 }; } },
        }),
      }),
      { changed: true, dryRun: false },
    );
    assert.match(fs.readFileSync(baseTask, 'utf8'), /^status: ready-for-integration$/m);
    assert.match(fs.readFileSync(missionTask, 'utf8'), /^status: review$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stashMainCheckoutIfNeeded no-ops when the main checkout is already clean', () => {
  const result = stashMainCheckoutIfNeeded({
    slug: 'task-097',
    dirtyEntries: [],
    gitRunner() {
      throw new Error('gitRunner should not be called for a clean checkout');
    }
  });

  assert.deepEqual(result, { created: false });
});

test('stashMainCheckoutIfNeeded creates an explicit include-untracked stash', () => {
  const gitCalls = [];
  const result = stashMainCheckoutIfNeeded({
    slug: 'task-097',
    dirtyEntries: ['?? backlog/tasks/task-099 - fix-act-on-review.md'],
    rootDir: '/tmp/main-checkout',
    gitRunner(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.deepEqual(result, {
    created: true,
    message: 'integrate:task-097: temporary integration checkout stash',
    rootDir: '/tmp/main-checkout'
  });
  assert.deepEqual(gitCalls, [[
    '-C',
    '/tmp/main-checkout',
    'stash',
    'push',
    '--include-untracked',
    '-m',
    'integrate:task-097: temporary integration checkout stash'
  ]]);
});

test('restoreMainCheckoutStash pops the temporary stash back onto the main checkout', () => {
  const gitCalls = [];
  const result = restoreMainCheckoutStash({
    message: 'integrate:task-097: temporary integration checkout stash',
    rootDir: '/tmp/main-checkout',
    gitRunner(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result.status, 0);
  assert.deepEqual(gitCalls, [[
    '-C',
    '/tmp/main-checkout',
    'stash',
    'pop',
    '--index'
  ]]);
});

test('findExistingSquashCommit returns the SHA when a mission squash commit is in the recent log', () => {
  const logOutput = [
    'aabbccdd1234 some unrelated commit',
    'f8e2155f45bf mission/task-103: Fix Codex Sandbox Connectivity',
    '20e409cadfa0 closeout(task-098): move task to completed'
  ].join('\n');
  const slug = 'task-103';
  const prefix = `mission/${slug}:`;
  let found = null;
  for (const line of logOutput.split('\n')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const hash = line.slice(0, spaceIdx);
    const subject = line.slice(spaceIdx + 1);
    if (subject.startsWith(prefix)) { found = hash; break; }
  }
  assert.equal(found, 'f8e2155f45bf');
});

test('findExistingSquashCommit returns null when no squash commit exists for the slug', () => {
  const logOutput = [
    'aabbccdd1234 some unrelated commit',
    'f8e2155f45bf mission/task-099: some other mission',
    '20e409cadfa0 closeout(task-098): move task to completed'
  ].join('\n');
  const slug = 'task-103';
  const prefix = `mission/${slug}:`;
  let found = null;
  for (const line of logOutput.split('\n')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const hash = line.slice(0, spaceIdx);
    const subject = line.slice(spaceIdx + 1);
    if (subject.startsWith(prefix)) { found = hash; break; }
  }
  assert.equal(found, null);
});

test('isNoMergeToAbortResult only ignores the known no-merge case', () => {
  assert.equal(
    isNoMergeToAbortResult({ status: 1, stdout: '', stderr: 'fatal: There is no merge to abort (MERGE_HEAD missing).' }),
    true
  );
  assert.equal(
    isNoMergeToAbortResult({ status: 1, stdout: '', stderr: 'fatal: some other git error' }),
    false
  );
});

test('printIntegrationPreflight prints base-slug path when mission doc is missing and slug has a suffix', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1054-modern',
      branch: 'mission/task-1054-modern',
      currentBranch: 'mission/task-1054-modern',
      missionDir: null,
      task: { ok: true, taskFile: '/tmp/task-1054-modern.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1054 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainAheadCount: 0,
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    assert.ok(result.failures.includes('mission-doc'));
    const output = lines.join('\n');
    assert.match(output, /Mission doc: missions\/task-1054\/MISSION\.md not found/);
    assert.doesNotMatch(output, /task-1054-modern.*MISSION\.md/);
  } finally {
    console.log = originalLog;
  }
});

test('printIntegrationPreflight warns when multiple PRs exist for the same task', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1054-modern',
      branch: 'mission/task-1054-modern',
      currentBranch: 'mission/task-1054-modern',
      missionDir: '/tmp/docs/missions/2026/task-1054',
      task: { ok: true, taskFile: '/tmp/task-1054.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1054 },
      siblingPrs: [
        { number: 1055, head: 'mission/task-1054-old', html_url: 'http://forgejo/pulls/1055' }
      ],
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainAheadCount: 0,
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    assert.ok(result.warnings.includes('sibling-prs'));
    const output = lines.join('\n');
    assert.match(output, /Multiple open PRs detected for task-1054/);
    assert.match(output, /PR #1055 \(mission\/task-1054-old\): http:\/\/forgejo\/pulls\/1055/);
  } finally {
    console.log = originalLog;
  }
});

test('printIntegrationPreflight provides recovery commands when mission doc is missing but found on another branch', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = line => lines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1054-modern',
      branch: 'mission/task-1054-modern',
      currentBranch: 'mission/task-1054-modern',
      missionDir: null,
      task: { ok: true, taskFile: '/tmp/task-1054.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1054 },
      siblingPrs: [],
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainAheadCount: 0,
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      findMissionDocInBranchesFn: () => [
        { branch: 'mission/task-1054', path: 'docs/missions/2026/task-1054/MISSION.md' }
      ]
    });

    assert.ok(result.failures.includes('mission-doc'));
    const output = lines.join('\n');
    assert.match(output, /Mission doc: missions\/task-1054\/MISSION\.md not found/);
    assert.match(output, /Found mission doc candidates on other branches\. To recover, run:/);
    assert.match(output, /git show mission\/task-1054:docs\/missions\/2026\/task-1054\/MISSION\.md > missions\/task-1054\/MISSION\.md/);
  } finally {
    console.log = originalLog;
  }
});

test('maybeDropStashAfterCollision drops the stash on a benign file-collision', async () => {
  const { maybeDropStashAfterCollision } = await import('../src/adapters/cli/commands/integrate-conflict.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-collision-benign-'));
  try {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    // The landed squash commit already restored the file, so it exists on disk.
    fs.writeFileSync(path.join(root, 'config', 'agents.json'), '{"filtered":true}');
    const gitCalls: string[][] = [];
    const gitRunner = (args: string[]) => {
      gitCalls.push(args);
      const cmd = args.join(' ');
      if (cmd.includes('ls-files')) {return { status: 0, stdout: '', stderr: '' };}
      if (cmd.includes('stash') && cmd.includes('drop')) {return { status: 0, stdout: '', stderr: '' };}
      return { status: 1, stdout: '', stderr: '' };
    };
    const result = maybeDropStashAfterCollision(
      { status: 1, stdout: '', stderr: 'config/agents.json already exists, no checkout\n' },
      root,
      { gitRunner }
    );
    assert.deepEqual(result, { ok: true, ref: 'stash@{0}' });
    const dropCall = gitCalls.find((call) => call.includes('stash') && call.includes('drop'));
    assert.ok(dropCall, 'a stash drop should have been issued');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('maybeDropStashAfterCollision does not drop on a real merge conflict', async () => {
  const { maybeDropStashAfterCollision } = await import('../src/adapters/cli/commands/integrate-conflict.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-collision-conflict-'));
  try {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'agents.json'), '{}');
    const gitRunner = (_args: string[]) => ({ status: 0, stdout: '100644,111111122222333344445555666677778888999,2\tconfig/agents.json\n', stderr: '' });
    const result = maybeDropStashAfterCollision(
      { status: 1, stdout: '', stderr: 'config/agents.json already exists, no checkout\n' },
      root,
      { gitRunner }
    );
    assert.equal(result, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('maybeDropStashAfterCollision does not drop when a colliding file is missing', async () => {
  const { maybeDropStashAfterCollision } = await import('../src/adapters/cli/commands/integrate-conflict.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-collision-missing-'));
  try {
    // config/agents.json deliberately absent from disk.
    const gitRunner = (_args: string[]) => ({ status: 0, stdout: '', stderr: '' });
    const result = maybeDropStashAfterCollision(
      { status: 1, stdout: '', stderr: 'config/agents.json already exists, no checkout\n' },
      root,
      { gitRunner }
    );
    assert.equal(result, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
