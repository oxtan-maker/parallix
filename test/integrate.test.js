const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stats = require('../lib/commands/stats');
const backlog = require('../lib/tools/backlog');
const verification = require('../lib/core/verification');
mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
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

process.env.PRIMARY_WORKTREE = '/tmp/mission';
const FAKE_ROOT = '/tmp/mission';

// Mock getPrimaryBranch BEFORE requiring dependent modules to ensure they use the mock.
const missionUtils = require('../lib/core/mission-utils');
mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

const {
  cleanupMissionWorktree,
  rewriteWorktreePaths,
  buildConflictResolutionPrompt,
  finalizeVariantACloseout,
  stashMainCheckoutIfNeeded,
  restoreMainCheckoutStash,
  isNoMergeToAbortResult,
  VARIANT_B_AUTOMATION_SUMMARY,
  evaluateTaskStatusForIntegration,
  promoteTaskForIntegrationIfNeeded,
  findExistingSquashCommit,
  printIntegrationPreflight,
  resolveForgejoUserForIntegration,
  getUnresolvedIndexConflicts,
  parseStashPopCollisionFiles,
  reportStashPopFailure,
  SYNC_MERGED_DIAGNOSTICS,
  printDiagnosticTable,
  reportSyncMergedFailure,
  recordPostIntegrationStats,
  formatRecordedStatsRow,
  resolveIntegrationVerificationWorktree,
  buildIntegrationVerificationInvocation
} = require('../lib/commands/integrate');
const { conventionalWorktreePath, getPrimaryBranch } = missionUtils;

const PRIMARY = getPrimaryBranch();

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

test('recordPostIntegrationStats logs the persisted stats row including pr_fix_rounds', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(message);
  try {
    const outcome = recordPostIntegrationStats('task-2000', {
      rootDir: FAKE_ROOT,
      gitRunner(args) {
        if (args.slice(-2).join(' ') === 'log -1' || args.join(' ') === `-C ${FAKE_ROOT} log -1 --format=%cs`) {
          return { status: 0, stdout: '2026-05-18\n', stderr: '' };
        }
        throw new Error(`unexpected git args: ${JSON.stringify(args)}`);
      },
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
});

test('recordPostIntegrationStats records an unknown classification row for a missing-task mission', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(message);
  try {
    const outcome = recordPostIntegrationStats('task-unknown', {
      rootDir: FAKE_ROOT,
      gitRunner(args) {
        if (args.join(' ') === `-C ${FAKE_ROOT} log -1 --format=%cs`) {
          return { status: 0, stdout: '2026-06-24\n', stderr: '' };
        }
        throw new Error(`unexpected git args: ${JSON.stringify(args)}`);
      },
      recordIntegrationStatsFn({ slug, rootDir, filePath, date }) {
        assert.equal(slug, 'task-unknown');
        assert.equal(rootDir, FAKE_ROOT);
        assert.ok(filePath.includes('stats.csv'));
        assert.equal(date, '2026-06-24');
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
        };
      },
    });

    assert.equal(outcome.row.classification, 'unknown');
  } finally {
    console.log = originalLog;
  }

  assert.match(logs.join('\n'), /\[INFO\] Workflow stats recorded: task-unknown: implementer=unknown, pr_fix_rounds=0, classification=unknown, date=2026-06-24/);
});

test('recordPostIntegrationStats routes stats through PARALLIX_HOME, not a consuming-repo path', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'px-runtime-root-'));
  const parallixHome = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-home-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = parallixHome;
  const originalResolveStatsFilePath = stats.resolveStatsFilePath;
  const resolverRoots = [];
  stats.resolveStatsFilePath = (rootDir) => {
    resolverRoots.push(rootDir);
    return originalResolveStatsFilePath(rootDir);
  };
  try {
    const capturedFilePaths = [];
    const runOnce = () => recordPostIntegrationStats('task-2046', {
      rootDir: runtimeRoot,
      gitRunner(args) {
        if (args.join(' ') === `-C ${runtimeRoot} log -1 --format=%cs`) {
          return { status: 0, stdout: '2026-05-18\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      recordIntegrationStatsFn({ filePath }) {
        capturedFilePaths.push(filePath);
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

    assert.equal(capturedFilePaths.length, 2);
    assert.deepEqual(resolverRoots, [runtimeRoot, runtimeRoot]);
    assert.equal(capturedFilePaths[0], capturedFilePaths[1]);
    assert.equal(capturedFilePaths[0], stats.resolveStatsFilePath(runtimeRoot));
    assert.equal(capturedFilePaths[0], path.join(parallixHome, 'stats.csv'));
  } finally {
    stats.resolveStatsFilePath = originalResolveStatsFilePath;
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(parallixHome, { recursive: true, force: true });
  }
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

test('provider-backed approval repair leaves integration preflight with review instead of stale active', () => {
  const { execFileSync } = require('node:child_process');
  const { submitReviewRound } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
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

    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'task-1327@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Task 1327'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

    submitReviewRound('task-2199', 'approve', 'LGTM', {
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
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

test('evaluateTaskStatusForIntegration accepts review when the Forgejo PR is already merged', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: true },
    approval: { ok: false, reviewState: null }
  });

  assert.equal(result.ok, true);
  assert.equal(result.level, 'warn');
  assert.match(result.message, /already merged/i);
});

test('evaluateTaskStatusForIntegration rejects review without an approved or merged PR', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'COMMENT' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, 'fail');
  assert.match(result.message, /expected approved, or review with an approved\/merged Forgejo PR/i);
});

test('evaluateTaskStatusForIntegration accepts review when default user approved but latest is REQUEST_CHANGES', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: true }
  });

  assert.equal(result.ok, true);
  assert.equal(result.level, 'warn');
  assert.match(result.message, /default user approved for integration/i);
});

test('evaluateTaskStatusForIntegration rejects review when default user did not approve and latest is not APPROVED', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: false }
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, 'fail');
  assert.match(result.message, /expected approved, or review with an approved\/merged Forgejo PR/i);
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
  const { maybeUpdateGraphifyOnPrimary } = require('../lib/commands/integrate');
  const logs = [];

  const result = maybeUpdateGraphifyOnPrimary('/tmp/visualBoard', {
    commandRunner() {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    log(message) {
      logs.push(message);
    }
  });

  assert.deepEqual(result, {
    updated: false,
    skipped: true,
    reason: 'missing-command'
  });
  assert.ok(logs.some(line => line.includes('graphify not found')));
});

test('maybeUpdateGraphifyOnPrimary runs graphify update in the primary worktree when available', () => {
  const { maybeUpdateGraphifyOnPrimary } = require('../lib/commands/integrate');
  const calls = [];
  const logs = [];

  const result = maybeUpdateGraphifyOnPrimary('/tmp/visualBoard', {
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
        cwd: '/tmp/visualBoard',
        stdio: 'inherit'
      }
    }
  ]);
  assert.ok(logs.some(line => line.includes(`Updating graphify knowledge graph on ${PRIMARY}...`)));
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

test('promoteTaskForIntegrationIfNeeded logs the dry-run auto-promotion without mutating status', () => {
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
    const result = promoteTaskForIntegrationIfNeeded(context, { dryRun: true });
    assert.deepEqual(result, { changed: false, dryRun: true });
    assert.equal(context.taskStatus, 'review');
    assert.match(lines.join('\n'), /would promote Backlog status from review to approved/i);
  } finally {
    console.log = originalLog;
  }
});

test('promoteTaskForIntegrationIfNeeded updates the task file on a real integration run', () => {
  const taskFile = path.join(os.tmpdir(), `integrate-promote-${process.pid}.md`);
  fs.writeFileSync(taskFile, 'Status: ○ review\n');

  try {
    const context = {
      task: { ok: true, taskFile },
      taskStatus: 'review',
      pr: { merged: false },
      approval: { ok: true, reviewState: 'APPROVED' }
    };
    const result = promoteTaskForIntegrationIfNeeded(context);

    assert.deepEqual(result, { changed: true, dryRun: false });
    assert.equal(context.taskStatus, 'ready-for-integration');
    assert.match(fs.readFileSync(taskFile, 'utf8'), /Status: ○ ready-for-integration/); // actual backlog.md state
  } finally {
    fs.rmSync(taskFile, { force: true });
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
    'pop'
  ]]);
});

test('finalizeVariantACloseout performs housekeeping then commits and pushes main closeout', () => {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-integrate-variant-a-'));
  process.chdir(root);

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-097 - cleanup.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    const wt = conventionalWorktreePath('task-097', root);
    fs.writeFileSync(
      taskFile,
      [
        'Status: ○ ready-for-integration',
        `References: ${wt}/docs/missions/2026/task-097/MISSION.md`
      ].join('\n')
    );

    const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-097');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Clean up integrate workflow\n');

    const gitCalls = [];
    const result = finalizeVariantACloseout({
      slug: 'task-097',
      summary: 'Clean up integrate workflow',
      mainTaskFile: taskFile,
      rootDir: root,
      gitRunner(args) {
        gitCalls.push(args);
        if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
        if (args.includes('rev-parse') && args.includes('HEAD')) {
          return { status: 0, stdout: 'dummy-sha', stderr: '' };
        }
        if (args.slice(-3).join(' ') === 'diff --cached --quiet') {
          return { status: 1, stdout: '', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
    }, { rootDir: root });

    const updatedTaskFile = path.join(root, 'backlog', 'completed', 'task-097 - cleanup.md');
    const taskContent = fs.readFileSync(updatedTaskFile, 'utf8');
    const projectName = path.basename(root);
    assert.deepEqual(result, { ok: true, changed: true });
    assert.match(taskContent, /Status: ○ done/);
    assert.doesNotMatch(taskContent, new RegExp(`${projectName}-task-097`));
    assert.deepEqual(
      gitCalls,
      [
        ['-C', root, 'status', '--porcelain'],
        ['-C', root, 'rev-parse', '--symbolic-full-name', 'HEAD'],
        ['-C', root, 'rev-parse', 'HEAD'],
        ['-C', root, 'branch', '-a', '--contains', 'dummy-sha', '--format=%(refname)'],
        ['-C', root, 'log', '-1', '--format=%s', 'HEAD'],
        ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
        ['-C', root, 'rev-parse', 'HEAD'],
        ['-C', root, 'rev-parse', 'HEAD'],
        ['-C', root, 'add', '-A'],
        ['-C', root, 'diff', '--cached', '--quiet'],
        ['-C', root, 'commit', '-m', 'mission/task-097: Clean up integrate workflow integration closeout'],
        ['-C', root, 'push', 'review', 'main']
      ]
    );
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('finalizeVariantACloseout rejects a stale verification proof before pushing main closeout', () => {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-integrate-variant-a-proof-'));
  process.chdir(root);

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-097 - cleanup.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, 'Status: ○ ready-for-integration\n');

    const gitCalls = [];
    const result = finalizeVariantACloseout({
      slug: 'task-097',
      summary: 'Clean up integrate workflow',
      mainTaskFile: taskFile,
      rootDir: root,
      gitRunner(args) {
        gitCalls.push(args);
        if (args.includes('rev-parse') && args.includes('HEAD')) {
          return { status: 0, stdout: 'dummy-sha\n', stderr: '' };
        }
        if (args.slice(-3).join(' ') === 'diff --cached --quiet') {
          return { status: 1, stdout: '', stderr: '' };
        }
        if (args[2] === 'commit') {
          return { status: 0, stdout: '', stderr: '' };
        }
        if (args[2] === 'push') {
          throw new Error('push should not run when verification proof is stale');
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      captureVerifiedTreeProofFn: () => ({
        ok: true,
        proof: {
          rootDir: '/tmp/different-checkout',
          area: 'integrate',
          command: 'mock-verification',
          commit: 'stale-commit',
          tree: 'stale-tree',
          verifiedAt: '2026-01-01T00:00:00.000Z'
        }
      })
    });

    assert.deepEqual(result, {
      ok: false,
      error: 'verification-proof-mismatch',
      detail: 'verification proof does not match the tree being published'
    });
    assert.equal(gitCalls.some(args => args[2] === 'push'), false);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('finalizeVariantACloseout returns hook output when the closeout commit fails', () => {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-integrate-variant-a-fail-'));
  process.chdir(root);

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-097 - cleanup.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, 'Status: ○ ready-for-integration\n');

    const gitCalls = [];
    const result = finalizeVariantACloseout({
      slug: 'task-097',
      summary: 'Clean up integrate workflow',
      mainTaskFile: taskFile,
      rootDir: root,
      gitRunner(args) {
        gitCalls.push(args);
        if (args.includes('rev-parse') && args.includes('HEAD')) {
          return { status: 0, stdout: 'dummy-sha', stderr: '' };
        }
        if (args.slice(-3).join(' ') === 'diff --cached --quiet') {
          return { status: 1, stdout: '', stderr: '' };
        }
        if (args[2] === 'commit') {
          return { status: 1, stdout: '', stderr: '[pre-commit] ERROR: docs changed but docs/index.md was not updated.' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
    });

    assert.deepEqual(result, {
      ok: false,
      error: 'commit-failed',
      detail: '[pre-commit] ERROR: docs changed but docs/index.md was not updated.'
    });
    assert.deepEqual(
      gitCalls,
      [
        ['-C', root, 'status', '--porcelain'],
        ['-C', root, 'rev-parse', '--symbolic-full-name', 'HEAD'],
        ['-C', root, 'rev-parse', 'HEAD'],
        ['-C', root, 'branch', '-a', '--contains', 'dummy-sha', '--format=%(refname)'],
        ['-C', root, 'log', '-1', '--format=%s', 'HEAD'],
        ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
        ['-C', root, 'rev-parse', 'HEAD'],
        ['-C', root, 'rev-parse', 'HEAD'],
        ['-C', root, 'add', '-A'],
        ['-C', root, 'diff', '--cached', '--quiet'],
        ['-C', root, 'commit', '-m', 'mission/task-097: Clean up integrate workflow integration closeout']
      ]
    );
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test('finalizeVariantACloseout pushes the recorded feature-branch base when baseBranch is provided', () => {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-integrate-variant-a-base-'));
  process.chdir(root);

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-098 - cleanup.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, 'Status: ○ ready-for-integration\n');

    const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-098');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Clean up integrate workflow\n');

    const gitCalls = [];
    const result = finalizeVariantACloseout({
      slug: 'task-098',
      summary: 'Clean up integrate workflow',
      mainTaskFile: taskFile,
      rootDir: root,
      baseBranch: 'develop',
      gitRunner(args) {
        gitCalls.push(args);
        if (args.includes('rev-parse') && args.includes('HEAD')) {
          return { status: 0, stdout: 'dummy-sha', stderr: '' };
        }
        if (args.slice(-3).join(' ') === 'diff --cached --quiet') {
          return { status: 1, stdout: '', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
    }, { rootDir: root });

    const pushCall = gitCalls.find(a => a.includes('push'));
    assert.ok(pushCall, 'push call should exist');
    assert.deepEqual(pushCall, ['-C', root, 'push', 'review', 'develop']);
    assert.deepEqual(result, { ok: true, changed: true });
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
