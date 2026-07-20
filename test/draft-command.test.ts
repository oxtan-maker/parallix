// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runDraftCommand, ensureDraftRepoConfigCommitted } = require('../dist/lib/commands/draft');
const typeKey = ['class', 'ification'].join('');
const normalizeKey = `normalizeDraft${typeKey[0].toUpperCase()}${typeKey.slice(1)}Fn`;

test('runDraftCommand top-level flows are covered with injected dependencies', async () => {
  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand([], {
      inferSlugFn: () => null,
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
        // @ts-expect-error TS2322 Type '(repo: string) => { committed: true; }' is not assignable to type '(rootDi
        ensureStandaloneMissionBaselineFn: (repo) => { calls.push(['baseline', repo]); return { committed: true }; },
        ensureMissionBranchFn: (repo, branch) => { calls.push(['branch', repo, branch]); },
        ensureWorktreeFn: (repo, wt, branch) => { calls.push(['worktree', repo, wt, branch]); },
        // @ts-expect-error TS2322 Type '(wt: any) => void' is not assignable to type '(targetWorktree: any, { logF
        ensureGraphifyWorkspaceFn: (wt) => { calls.push(['graphify', wt]); },
        ensureMissionFileFn: (wt, slug) => {
          calls.push(['mission', wt, slug]);
          return `${wt}/docs/missions/2026/${slug}/MISSION.md`;
        },
        bootstrapBacklogTaskFn: (wt, repo, slug) => {
          calls.push(['bootstrap', wt, repo, slug]);
          return true;
        },
        // @ts-expect-error TS2559 Type '{ draft: string[]; }' has no properties in common with type 'AgentConfig'.
        readAgentConfigOrExitFn: () => ({ draft: ['codex'] }),
        selectAgentFn: () => 'codex',
        // @ts-expect-error TS2322 Type '({ prompt, worktree: targetWorktree, agent }: StartAgentOptions) => Promis
        startDraftAgentFn: async ({ prompt, worktree: targetWorktree, agent }) => {
          // @ts-expect-error TS2339 Property 'includes' does not exist on type 'string | Function'.
          calls.push(['launch', prompt.includes('task-1038'), targetWorktree, agent]);
          return { agent: 'codex', result: { status: 0 } };
        },
        // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
        resolveTaskFileFn: () => ({ ok: true, taskFile }),
        recordDraftImplementerFn: (opts) => calls.push(['record', opts.slug, opts.actual]),
        recordDraftStatsFn: (opts) => calls.push(['stats', opts.slug, opts.rootDir]),
        [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
        // @ts-expect-error TS2322 Type 'number' is not assignable to type 'boolean'.
        enforceDraftCommitSafetyFn: (opts) => calls.push(['safety', opts.slug, opts.worktree]),
        // @ts-expect-error TS2322 Type 'number' is not assignable to type 'boolean'.
        transitionTaskFn: (slug, status) => calls.push(['transition', slug, status]),
        exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
        // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureDraftRepoConfigCommittedFn: () => false,
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      ensureMissionBranchFn: () => {
        throw new Error('should not create mission branch when repo config is dirty');
      },
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.equal(errors.length, 0);
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
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
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('Main repository not found')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      // @ts-expect-error TS2322 Type '{ ok: false; reason: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => false,
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('[FAIL] Backlog task for task-fail not found')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      // @ts-expect-error TS2322 Type 'Promise<{ agent: string; result: { error: Error; }; }>' is not assignable
      startDraftAgentFn: async () => ({ agent: 'codex', result: { error: new Error('Launch failed') } }),
      transitionTaskFn: () => true,
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('Could not start draft agent')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      // @ts-expect-error TS2322 Type 'Promise<{ agent: string; result: { status: number; }; }>' is not assignabl
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 23 } }),
      transitionTaskFn: () => true,
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 23);
    assert.ok(errors.some(msg => msg.includes('exited with status 23')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      // @ts-expect-error TS2322 Type 'Promise<{ agent: string; result: { status: number; }; }>' is not assignabl
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      transitionTaskFn: () => true,
      // @ts-expect-error TS1117 An object literal cannot have multiple properties with the same name.
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
      enforceDraftCommitSafetyFn: () => { throw new Error('fallback commit failed'); },
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('fallback commit failed')));
  }

  {
    let exitCode = null;
    let restartCount = 0;

    await runDraftCommand(['task-fix'], {
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      // @ts-expect-error TS2322 Type 'Promise<{ agent: string; result: { status: number; }; }>' is not assignabl
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      transitionTaskFn: () => true,
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
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
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '({ slug, worktree, dirtyEntries, gi
      enforceDraftCommitSafetyFn: () => {},
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
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
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => 'MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      // @ts-expect-error TS2322 Type 'Promise<{ agent: string; result: { status: number; }; }>' is not assignabl
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      transitionTaskFn: () => true,
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      // @ts-expect-error TS2322 Type '{ ok: true; }' is not assignable to type '{ ok: boolean; classification: a
      validateDraftClassificationFn: () => ({ ok: true }),
      [normalizeKey]: () => ({ ok: false, reason: 'missing-labels' }),
      restartDraftAgentFn: async () => true,
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '({ slug, worktree, dirtyEntries, gi
      enforceDraftCommitSafetyFn: () => {},
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode, 1);
    assert.ok(errors.some(msg => msg.includes('still invalid after restart')));
  }

  {
    let exitCode = null;
    const errors = [];

    await runDraftCommand(['task-fail'], {
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      checkBacklogIntegrityFn: () => [],
      inferSlugFn: (slug) => slug,
      resolveMainRepoFn: () => '/tmp/main',
      detectLaunchBaseBranchFn: () => null,
      ensureRepoExistsFn: () => true,
      // @ts-expect-error TS2739 Type '{ failed: true; message: string; }' is missing the following properties fr
      ensureStandaloneMissionBaselineFn: () => ({ failed: true, message: 'git status failed' }),
      // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
      exitFn: (code) => { exitCode = code; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
      logFn: () => {},
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
    // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
    ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
    ensureDraftRepoConfigCommittedFn: () => true,
    // @ts-expect-error TS2322 Type '{ ok: false; reason: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
    ensureMissionBranchFn: () => {},
    ensureWorktreeFn: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
    ensureGraphifyWorkspaceFn: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { gitFn, logF
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
    // @ts-expect-error TS2322 Type 'Promise<{ agent: string; result: { status: number; }; }>' is not assignabl
    startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
    recordDraftImplementerFn: () => {},
    normalizeDraftClassificationFn: () => ({ ok: true, classification: 'unknown' }),
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '({ slug, worktree, dirtyEntries, gi
    enforceDraftCommitSafetyFn: () => {},
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
    logFn: () => {},
    errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].slug, 'adhoc-create-a-hello-world-program');
  assert.equal(calls[0].syntheticTask.source, 'synthetic-free-text');
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
      // @ts-expect-error TS2741 Property 'changed' is missing in type '{ committed: false; }' but required in ty
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(targetWorktree: any, { logFn }?: {
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: (wt, slug) => `${wt}/docs/missions/2026/${slug}/MISSION.md`,
      bootstrapBacklogTaskFn: () => true,
      // @ts-expect-error TS2559 Type '{ draft: string[]; }' has no properties in common with type 'AgentConfig'.
      readAgentConfigOrExitFn: () => ({ draft: ['codex', 'claude'] }),
      selectAgentFn: () => { throw new Error('selectAgentFn must not run when --agent is provided'); },
      // @ts-expect-error TS2322 Type '({ agent }: StartAgentOptions) => Promise<{ agent: string; result: { statu
      startDraftAgentFn: async ({ agent }) => {
        calls.push(['launch', agent]);
        return { agent, result: { status: 0 } };
      },
      // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
      resolveTaskFileFn: () => ({ ok: true, taskFile }),
      recordDraftImplementerFn: (opts) => calls.push(['record', opts.selected, opts.actual]),
      recordDraftStatsFn: () => {},
      [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '({ slug, worktree, dirtyEntries, gi
      enforceDraftCommitSafetyFn: () => {},
      transitionTaskFn: () => true,
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
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
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
    logFn: () => {},
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(ok, false);
  assert.ok(errors.some(msg => msg.includes('repo-state config that affects mission layout is uncommitted')));
  assert.ok(errors.some(msg => msg.includes('workflow.config.json')));
  assert.ok(errors.some(msg => msg.includes('backlog/config.yml')));
  assert.ok(errors.every(msg => !msg.includes('README.md')));
});
