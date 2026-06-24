const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runDraftCommand, ensureDraftRepoConfigCommitted } = require('../lib/commands/draft');
const typeKey = ['class', 'ification'].join('');
const normalizeKey = `normalizeDraft${typeKey[0].toUpperCase()}${typeKey.slice(1)}Fn`;

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
        [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
        enforceDraftCommitSafetyFn: (opts) => calls.push(['safety', opts.slug, opts.worktree]),
        transitionTaskFn: (slug, status) => calls.push(['transition', slug, status]),
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
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      recordDraftImplementerFn: () => {},
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
      recordDraftImplementerFn: () => {},
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
      recordDraftImplementerFn: () => {},
      validateDraftClassificationFn: () => ({ ok: true }),
      [normalizeKey]: () => ({ ok: false, reason: 'missing-labels' }),
      restartDraftAgentFn: async () => true,
      enforceDraftCommitSafetyFn: () => {},
      exitFn: (code) => { exitCode = code; },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('still invalid after restart')));
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
    ensureMissionBranchFn: () => {},
    ensureWorktreeFn: () => {},
    ensureGraphifyWorkspaceFn: () => {},
    ensureGraphifyIgnoreFn: () => {},
    ensureMissionFileFn: () => '/tmp/adhoc-create-a-hello-world-program/MISSION.md',
    bootstrapBacklogTaskFn: (_wt, _repo, slug, options) => {
      calls.push({ slug, syntheticTask: options.syntheticTask });
      return true;
    },
    validateDraftClassificationFn: () => ({ ok: true, classification: 'unknown' }),
    transitionTaskFn: () => true,
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
  assert.equal(calls[0].slug, 'adhoc-create-a-hello-world-program');
  assert.equal(calls[0].syntheticTask.source, 'synthetic-free-text');
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
