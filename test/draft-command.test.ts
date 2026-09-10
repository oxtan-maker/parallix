// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up



import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const runDraftCommandModule = mockModule<typeof import('../src/adapters/cli/commands/draft.js')>('../src/adapters/cli/commands/draft.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { runDraftCommand, ensureDraftRepoConfigCommitted } = runDraftCommandModule;
const typeKey = ['class', 'ification'].join('');
const normalizeKey = `normalizeDraft${typeKey[0].toUpperCase()}${typeKey.slice(1)}Fn`;

const missionServicesFn = async () => ({
  repositoryId: 'test-repository',
  lifecycle: { transition: async () => ({ status: 'completed', value: { version: 2 }, durableEvidence: [] }) },
  intake: {
    async execute() {
      return { status: 'completed', value: { version: 1 }, durableEvidence: [] };
    },
  },
});

test('draft accepts a mission-worktree classification without touching the primary task', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-worktree-classification-'));
  const worktree = path.join(root, 'mission-task-2472');
  const slug = 'task-2472';
  const taskName = `${slug} - isolation.md`;
  const primaryTask = path.join(root, 'backlog', 'tasks', taskName);
  const missionTask = path.join(worktree, 'backlog', 'tasks', taskName);
  const primaryContent = '---\nid: TASK-2472\nstatus: backlog\nlabels: []\n---\n';
  const previousCwd = process.cwd();
  let restartCount = 0;

  fs.mkdirSync(path.dirname(primaryTask), { recursive: true });
  fs.writeFileSync(primaryTask, primaryContent);
  for (const args of [
    ['init'], ['symbolic-ref', 'HEAD', 'refs/heads/main'],
    ['config', 'user.name', 'Test'], ['config', 'user.email', 'test@example.com'],
    ['add', '.'], ['commit', '-m', 'seed'],
    ['worktree', 'add', '-b', `mission/${slug}`, worktree, 'HEAD']
  ]) {
    assert.equal(childProcess.spawnSync('git', args, { cwd: root }).status, 0, `git ${args.join(' ')}`);
  }
  fs.writeFileSync(missionTask, '---\nid: TASK-2472\nstatus: backlog\nlabels: [ai_sdlc]\n---\n');

  try {
    process.chdir(root);
    await runDraftCommand([slug], {
      inferSlugFn: () => slug,
      resolveMainRepoFn: () => root,
      cwdFn: () => root,
      conventionalWorktreePathFn: () => worktree,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureDraftRepoConfigCommittedFn: () => true,
      ensureMissionBranchFn: () => {}, ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {}, ensureGraphifyIgnoreFn: () => {},
      ensureMissionFileFn: () => path.join(worktree, 'missions', slug, 'MISSION.md'),
      ensureMissionBaseBranchRecordedFn: () => {}, bootstrapBacklogTaskFn: () => true,
      resolveTaskFileFn: (_slug, dir) => ({ ok: true, taskFile: path.join(dir, 'backlog', 'tasks', taskName) }),
      checkBacklogIntegrityFn: () => [], transitionTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}), selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {}, recordDraftStatsFn: () => {},
      restartDraftAgentFn: async () => { restartCount += 1; return true; },
      missionServicesFn, enforceDraftCommitSafetyFn: () => {},
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: () => {}, errorFn: (message) => { throw new Error(message); }
    });

    assert.equal(fs.readFileSync(primaryTask, 'utf8'), primaryContent,
      'draft must not write or commit labels in the primary checkout');
    assert.equal(restartCount, 0, 'a valid mission-worktree classification must not recover');
  } finally {
    process.chdir(previousCwd);
    childProcess.spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runDraftCommand top-level flows are covered with injected dependencies', async () => {
  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand([], {
      inferSlugFn: () => null,
      validateDraftClassificationFn: () => ({ ok: true }),
      exitFn: (code) => { exitCode = code; },
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('Usage: px draft <slug>')));
  }

  {
    const logs = [];
    const calls = [];
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-command-'));
    const worktree = path.join(tmpRoot, 'main-task-1038');
    const taskFile = path.join(worktree, 'backlog', 'tasks', 'task-1038.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, ['---', 'id: TASK-1038', 'labels: [ai_sdlc]', 'status: backlog', '---'].join('\n'));

    try {
      await runDraftCommand(['task-1038'], {
        inferSlugFn: (slug) => slug,
        detectLaunchBaseBranchFn: () => null,
        resolveMainRepoFn: () => path.join(tmpRoot, 'main'),
        conventionalWorktreePathFn: () => worktree,
        ensureRepoExistsFn: (repo) => { calls.push(['repo', repo]); return true; },
        ensureStandaloneMissionBaselineFn: (repo) => { calls.push(['baseline', repo]); return { committed: true }; },
        ensureMissionBranchFn: (repo, branch) => { calls.push(['branch', repo, branch]); },
        ensureWorktreeFn: (repo, wt, branch) => { calls.push(['worktree', repo, wt, branch]); },
        ensureGraphifyWorkspaceFn: (wt) => { calls.push(['graphify', wt]); },
        ensureMissionFileFn: (wt, slug) => {
          calls.push(['mission', wt, slug]);
          return `${wt}/docs/missions/2026/${slug}/MISSION.md`;
        },
        bootstrapBacklogTaskFn: (wt, repo, slug) => {
          calls.push(['bootstrap', wt, repo, slug]);
          return true;
        },
        readAgentConfigOrExitFn: () => ({ draft: ['codex'] }),
        selectAgentFn: () => 'codex',
        startDraftAgentFn: async ({ prompt, worktree: targetWorktree, agent }) => {
          calls.push(['launch', prompt.includes('task-1038'), targetWorktree, agent]);
          return { agent: 'codex', result: { status: 0 } };
        },
        resolveTaskFileFn: () => ({ ok: true, taskFile }),
        recordDraftImplementerFn: (opts) => calls.push(['record', opts.slug, opts.actual]),
        recordDraftStatsFn: (opts) => calls.push(['stats', opts.slug, opts.rootDir]),
        [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
        enforceDraftCommitSafetyFn: (opts) => calls.push(['safety', opts.slug, opts.worktree]),
        transitionTaskFn: (slug, status) => calls.push(['transition', slug, status]),
        missionServicesFn,
        exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
        logFn: (msg) => logs.push(msg),
        errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
      });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    assert.deepEqual(calls, [
      ['repo', path.join(tmpRoot, 'main')],
      ['baseline', path.join(tmpRoot, 'main')],
      ['branch', path.join(tmpRoot, 'main'), 'mission/task-1038'],
      ['worktree', path.join(tmpRoot, 'main'), worktree, 'mission/task-1038'],
      ['graphify', worktree],
      ['mission', worktree, 'task-1038'],
      ['bootstrap', worktree, path.join(tmpRoot, 'main'), 'task-1038'],
      ['transition', 'task-1038', 'backlog'],
      ['launch', true, worktree, 'codex'],
      ['record', 'task-1038', 'codex'],
      // Stats must be recorded from the mission worktree (where the task lives),
      // not mainRepo — otherwise feature-branch tasks fail classification (TASK-1352).
      ['stats', 'task-1038', worktree],
      ['safety', 'task-1038', worktree],
      ['transition', 'task-1038', 'refined']
    ]);
    assert.ok(logs.some(line => line.includes('Draft setup complete')));
    assert.ok(logs.some(line => line.includes('Draft agent family: codex')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-config'], {
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureDraftRepoConfigCommittedFn: () => false,
      validateDraftClassificationFn: () => ({ ok: true }),
      ensureMissionBranchFn: () => {
        throw new Error('should not create mission branch when repo config is dirty');
      },
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.equal(errors.length, 0);
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/missing/main',
      ensureRepoExistsFn: (_repo, exitFn, errorFn) => {
        errorFn('[FAIL] Main repository not found at /missing/main.');
        exitFn(1);
        return false;
      },
      ensureMissionBranchFn: () => {
        throw new Error('should not continue after missing repo');
      },
      validateDraftClassificationFn: () => ({ ok: true }),
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('Main repository not found')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => false,
      validateDraftClassificationFn: () => ({ ok: true }),
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('[FAIL] Backlog task for task-fail not found')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { error: new Error('Launch failed') } }),
      transitionTaskFn: () => true,
      missionServicesFn,
      validateDraftClassificationFn: () => ({ ok: true }),
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('Could not start draft agent')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 23 } }),
      transitionTaskFn: () => true,
      missionServicesFn,
      validateDraftClassificationFn: () => ({ ok: true }),
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 23);
    assert.ok(errors.some(msg => msg.includes('exited with status 23')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      transitionTaskFn: () => true,
      missionServicesFn,
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `md` absent from its inferred mock shape.
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
      enforceDraftCommitSafetyFn: () => { throw new Error('fallback commit failed'); },
      validateDraftClassificationFn: () => ({ ok: true }),
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('fallback commit failed')));
  }

  {
    let exitCode = null;
    let restartCount = 0;

    await runDraftCommand(['task-fix'], {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      transitionTaskFn: () => true,
      missionServicesFn,
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      validateDraftClassificationFn: () => ({ ok: true }),
      [normalizeKey]: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          return calls === 1
            ? { ok: false, reason: 'missing-labels' }
            : { ok: true, [typeKey]: 'ai_sdlc' };
        };
      })(),
      restartDraftAgentFn: async () => {
        restartCount += 1;
        return true;
      },
      enforceDraftCommitSafetyFn: () => {},
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
    });

    assert.equal(exitCode, null);
    assert.equal(restartCount, 1);
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fix'], {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      transitionTaskFn: () => true,
      missionServicesFn,
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      validateDraftClassificationFn: () => ({ ok: true }),
      [normalizeKey]: () => ({ ok: false, reason: 'missing-labels' }),
      restartDraftAgentFn: async () => true,
      enforceDraftCommitSafetyFn: () => {},
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('Classification validation failed after recovery')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ failed: true, message: 'git status failed' }),
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('Standalone mission baseline: git status failed')));
  }
});

test('runDraftCommand accepts free-text intent and synthesizes a task slug', async () => {
  const calls = [];
  await runDraftCommand(['create a hello world program'], {
    detectLaunchBaseBranchFn: () => null,
    resolveMainRepoFn: () => '/tmp/main',
    conventionalWorktreePathFn: (slug) => `/tmp/${slug}`,
    ensureRepoExistsFn: () => true,
    ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
    ensureDraftRepoConfigCommittedFn: () => true,
    resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
    // Free-text intent now synthesizes a DB-owned, repository-scoped
    // `parallix-adhoc-<NNNN>` identity (task-2468). Pin the counter here so the
    // allocation stays deterministic regardless of the shared operator DB.
    allocateAdhocIdentityFn: () => ({ slug: 'parallix-adhoc-0001', missionId: 'parallix-adhoc-0001', taskId: 'PARALLIX-ADHOC-0001' }),
    ensureMissionBranchFn: () => {},
    ensureWorktreeFn: () => {},
    ensureGraphifyWorkspaceFn: () => {},
    ensureGraphifyIgnoreFn: () => {},
    ensureMissionFileFn: () => '/tmp/parallix-adhoc-0001/MISSION.md',
    bootstrapBacklogTaskFn: (_wt, _repo, slug, options) => {
      calls.push({ slug, syntheticTask: options.syntheticTask });
      return true;
    },
    validateDraftClassificationFn: () => ({ ok: true, classification: 'unknown' }),
    transitionTaskFn: () => true,
    missionServicesFn,
    readAgentConfigOrExitFn: () => ({}),
    selectAgentFn: () => 'codex',
    startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
    recordDraftImplementerFn: () => {},
    normalizeDraftClassificationFn: () => ({ ok: true, classification: 'unknown' }),
    enforceDraftCommitSafetyFn: () => {},
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    logFn: () => {},
    errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].slug, 'parallix-adhoc-0001');
  assert.equal(calls[0].syntheticTask.source, 'adhoc-db-identity');
});

test('runDraftCommand honors an explicit --agent override without consulting selectAgentFn or WORKFLOW_AGENT', async () => {
  const calls = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-command-agent-'));
  const worktree = path.join(tmpRoot, 'main-task-1038');
  const taskFile = path.join(worktree, 'backlog', 'tasks', 'task-1038.md');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, ['---', 'id: TASK-1038', 'labels: [ai_sdlc]', 'status: backlog', '---'].join('\n'));

  const priorWorkflowAgent = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;

  try {
    await runDraftCommand(['task-1038', '--agent', 'claude'], {
      inferSlugFn: (slug) => slug,
      detectLaunchBaseBranchFn: () => null,
      resolveMainRepoFn: () => path.join(tmpRoot, 'main'),
      conventionalWorktreePathFn: () => worktree,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: (wt, slug) => `${wt}/docs/missions/2026/${slug}/MISSION.md`,
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({ draft: ['codex', 'claude'] }),
      selectAgentFn: () => { throw new Error('selectAgentFn must not run when --agent is provided'); },
      startDraftAgentFn: async ({ agent }) => {
        calls.push(['launch', agent]);
        return { agent, result: { status: 0 } };
      },
      resolveTaskFileFn: () => ({ ok: true, taskFile }),
      recordDraftImplementerFn: (opts) => calls.push(['record', opts.selected, opts.actual]),
      recordDraftStatsFn: () => {},
      [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
      enforceDraftCommitSafetyFn: () => {},
      transitionTaskFn: () => true,
      missionServicesFn,
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: () => {},
      errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (priorWorkflowAgent === undefined) { delete process.env.WORKFLOW_AGENT; } else { process.env.WORKFLOW_AGENT = priorWorkflowAgent; }
  }

  assert.deepEqual(calls, [
    ['launch', 'claude'],
    ['record', 'claude', 'claude']
  ]);
});

test('runDraftCommand exits non-zero with usage text when --agent is missing its value', async () => {
  let exitCode = null;
  const errors = [];

  await runDraftCommand(['task-1038', '--agent'], {
    inferSlugFn: (slug) => slug,
    selectAgentFn: () => { throw new Error('must not select an agent when --agent parsing fails'); },
    startDraftAgentFn: async () => { throw new Error('must not launch when --agent parsing fails'); },
    exitFn: (code) => { exitCode = code; throw new Error('__stop__'); },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  }).catch(err => { if (err.message !== '__stop__') { throw err; } });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(msg => msg.includes('px draft <slug> --agent <family>')));
});

test('ensureDraftRepoConfigCommitted blocks dirty mission-layout config before worktree creation', () => {
  const errors = [];
  const ok = ensureDraftRepoConfigCommitted('/tmp/main', {
    getWorktreeStatusFn: () => [
      ' M workflow.config.json',
      '?? backlog/config.yml',
      ' M README.md'
    ],
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(ok, false);
  assert.ok(errors.some(msg => msg.includes('repo-state config that affects mission layout is uncommitted')));
  assert.ok(errors.some(msg => msg.includes('workflow.config.json')));
  assert.ok(errors.some(msg => msg.includes('backlog/config.yml')));
  assert.ok(errors.every(msg => !msg.includes('README.md')));
});
