import { missionLabels } from '../../../src/domain/mission.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { draftMissionServicesFixture } from '../../helpers/draft-mission-services.js';

import { repositoryId as fixtureRepositoryId } from '../../../src/domain/repository.js';
import { missionVersion as fixtureVersion } from '../../../src/application/domain-ports.js';
import type { DraftSyntheticTask } from "../../../src/application/ports/cli-workflows.js";
// Draft command boundary contract: runDraftCommand and preflight across the process and persistence
// boundary.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Draft command: no task ID in the legacy file
//   Draft preflight: no task ID in the legacy file

import { resolveConfiguration } from '../../../src/composition/config.js';
import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { seedStoredMissionClassification } from '../../fixtures/stored-mission-classification.js';

const runDraftCommandModule = mockModule<typeof import('../../../src/adapters/cli/commands/draft.js')>('../../../src/adapters/cli/commands/draft.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

// no task ID in the legacy file (was test/draft-command.test.ts)
describe('Draft command', () => {



  const { runDraftCommand, ensureDraftRepoConfigCommitted } = runDraftCommandModule;
  const typeKey = 'classification';
  const normalizeKey = 'normalizeDraftClassificationFn';

  const missionServicesFn: NonNullable<NonNullable<Parameters<typeof runDraftCommand>[1]>["missionServicesFn"]> = async () => (draftMissionServicesFixture({
    repositoryId: fixtureRepositoryId('test-repository'),
    lifecycle: { transition: async request => ({ status: 'completed' as const, value: { version: fixtureVersion(2), mission: fixtureMission(request.missionId, { status: 'refined' }), previousAssignee: null, from: 'backlog', to: 'refined', laneChanged: true }, durableEvidence: [] }) },
    intake: {
      async execute(request) {
        return { status: 'completed' as const, value: { version: fixtureVersion(1), mission: fixtureMission(request.missionId, { status: 'backlog', repositoryId: request.repositoryId, title: request.title }) }, durableEvidence: [] };
      },
    },
  }));

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
    await seedStoredMissionClassification(slug);

    try {
      process.chdir(root);
      await runDraftCommand([slug], { configuration: resolveConfiguration(process.env),
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
         bootstrapBacklogTaskFn: () => true,
        resolveTaskFileFn: (_slug, dir = root) => ({ matches: [path.join(dir, 'backlog', 'tasks', taskName)],  ok: true as const, taskFile: path.join(dir, 'backlog', 'tasks', taskName) }),
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
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand([], { configuration: resolveConfiguration(process.env),
        inferSlugFn: () => null,
        validateDraftClassificationFn: () => ({ ok: true as const }),
        exitFn: (code) => { exitCode.value = code; },
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.ok(errors.some(msg => msg.includes('Usage: px draft <slug>')));
    }

    {
      const logs: string[] = [];
      const calls: (string | boolean | undefined)[][] = [];
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-command-'));
      const worktree = path.join(tmpRoot, 'main-task-1038');
      const taskFile = path.join(worktree, 'backlog', 'tasks', 'task-1038.md');
      fs.mkdirSync(path.dirname(taskFile), { recursive: true });
      fs.writeFileSync(taskFile, ['---', 'id: TASK-1038', 'labels: [ai_sdlc]', 'status: backlog', '---'].join('\n'));

      try {
        await runDraftCommand(['task-1038'], { configuration: resolveConfiguration(process.env),
          inferSlugFn: (slug) => slug ?? null,
          detectLaunchBaseBranchFn: () => null,
          resolveMainRepoFn: () => path.join(tmpRoot, 'main'),
          conventionalWorktreePathFn: () => worktree,
          ensureRepoExistsFn: (repo) => { calls.push(['repo', repo] as const); return true; },
          ensureStandaloneMissionBaselineFn: (repo) => { calls.push(['baseline', repo] as const); return { committed: true }; },
          ensureMissionBranchFn: (repo, branch) => { calls.push(['branch', repo, branch] as const); },
          ensureWorktreeFn: (repo, wt, branch) => { calls.push(['worktree', repo, wt, branch] as const); },
          ensureGraphifyWorkspaceFn: (wt) => { calls.push(['graphify', wt] as const); },
          ensureMissionFileFn: (wt, slug) => {
            calls.push(['mission', wt, slug] as const);
            return `${wt}/docs/missions/2026/${slug}/MISSION.md`;
          },
          bootstrapBacklogTaskFn: (wt, repo, slug) => {
            calls.push(['bootstrap', wt, repo, slug] as const);
            return true;
          },
          readAgentConfigOrExitFn: () => ({ steps: { draft: { eligible: ['codex'], selection: 'first' } } }),
          selectAgentFn: () => 'codex',
          startDraftAgentFn: async ({ prompt, worktree: targetWorktree, agent }) => {
            assert.ok(typeof prompt === 'string');
            calls.push(['launch', prompt.includes('task-1038'), targetWorktree, agent] as const);
            return { agent: 'codex', result: { status: 0 } };
          },
          resolveTaskFileFn: () => ({ matches: [],  ok: true as const, taskFile }),
          recordDraftImplementerFn: (opts) => calls.push(['record', opts.slug, opts.actual] as const),
          recordDraftStatsFn: (opts) => calls.push(['stats', opts.slug, opts.rootDir] as const),
          [normalizeKey]: () => ({ ok: true as const, [typeKey]: 'ai_sdlc' }),
          validateDraftClassificationFn: () => ({ ok: true as const, classification: 'ai_sdlc' }),
          enforceDraftCommitSafetyFn: (opts) => calls.push(['safety', opts.slug, opts.worktree] as const),
          transitionTaskFn: (slug, status) => { calls.push(['transition', slug, status] as const); return true; },
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
      // TASK-2471: setup plumbing and the trailing `Draft agent family:` line are
      // internal and now appear only under DEBUG; the default happy path opens
      // with the mission header, names the agent once before it runs, and ends
      // with the mission summary.
      assert.ok(!logs.some(line => line.includes('Draft setup complete')));
      assert.ok(!logs.some(line => line.includes('Draft agent family: codex')));
      assert.ok(logs.some(line => line.includes('Drafting mission task-1038')));
      assert.ok(logs.some(line => line.includes('Running codex to write the mission contract')));
      assert.ok(logs.some(line => line.includes('Drafted task-1038 in')));
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-config'], { configuration: resolveConfiguration(process.env),
        inferSlugFn: (slug) => slug ?? null,
        resolveMainRepoFn: () => '/tmp/main',
        detectLaunchBaseBranchFn: () => null,
        ensureRepoExistsFn: () => true,
        ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
        ensureDraftRepoConfigCommittedFn: () => false,
        validateDraftClassificationFn: () => ({ ok: true as const }),
        ensureMissionBranchFn: () => {
          throw new Error('should not create mission branch when repo config is dirty');
        },
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.equal(errors.length, 0);
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-fail'], { configuration: resolveConfiguration(process.env),
        resolveTaskFileFn: () => ({ matches: ['/tmp/task.md'],  ok: true as const, taskFile: '/tmp/task.md' }),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
        resolveMainRepoFn: () => '/missing/main',
        ensureRepoExistsFn: (_repo, exitFn, errorFn) => {
          assert.ok(exitFn);
          assert.ok(errorFn);
          errorFn('[FAIL] Main repository not found at /missing/main.');
          exitFn(1);
          return false;
        },
        ensureMissionBranchFn: () => {
          throw new Error('should not continue after missing repo');
        },
        validateDraftClassificationFn: () => ({ ok: true as const }),
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.ok(errors.some(msg => msg.includes('Main repository not found')));
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-fail'], { configuration: resolveConfiguration(process.env),
        resolveTaskFileFn: () => ({ matches: [],  ok: false as const, reason: 'missing' as const }),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
        resolveMainRepoFn: () => '/tmp/main',
        detectLaunchBaseBranchFn: () => null,
        ensureRepoExistsFn: () => true,
        ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
        ensureMissionBranchFn: () => {},
        ensureWorktreeFn: () => {},
        ensureGraphifyWorkspaceFn: () => {},
        ensureMissionFileFn: () => 'MISSION.md',
        bootstrapBacklogTaskFn: () => false,
        validateDraftClassificationFn: () => ({ ok: true as const }),
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.ok(errors.some(msg => msg.includes('[FAIL] Backlog task for task-fail not found')));
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-fail'], { configuration: resolveConfiguration(process.env),
        resolveTaskFileFn: () => ({ matches: ['/tmp/task.md'],  ok: true as const, taskFile: '/tmp/task.md' }),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
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
        validateDraftClassificationFn: () => ({ ok: true as const }),
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.ok(errors.some(msg => msg.includes('Could not start draft agent')));
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-fail'], { configuration: resolveConfiguration(process.env),
        resolveTaskFileFn: () => ({ matches: ['/tmp/task.md'],  ok: true as const, taskFile: '/tmp/task.md' }),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
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
        validateDraftClassificationFn: () => ({ ok: true as const }),
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 23);
      assert.ok(errors.some(msg => msg.includes('exited with status 23')));
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-fail'], { configuration: resolveConfiguration(process.env),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
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
        resolveTaskFileFn: () => ({ matches: ['/tmp/task.md'],  ok: true as const, taskFile: '/tmp/task.md' }),
        recordDraftImplementerFn: () => {},
        recordDraftStatsFn: () => {},
        [normalizeKey]: () => ({ ok: true as const, [typeKey]: 'ai_sdlc' }),
        enforceDraftCommitSafetyFn: () => { throw new Error('fallback commit failed'); },
        validateDraftClassificationFn: () => ({ ok: true as const }),
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.ok(errors.some(msg => msg.includes('fallback commit failed')));
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      let launchCount = 0;
      const configuration = resolveConfiguration({ PARALLIX_NO_BUBBLEWRAP: '1' });

      await runDraftCommand(['task-fix'], { configuration,
        resolveTaskFileFn: () => ({ matches: ['/tmp/task.md'],  ok: true as const, taskFile: '/tmp/task.md' }),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
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
        startDraftAgentFn: async options => {
          assert.equal(options.configuration, configuration, 'all draft launches keep composed configuration (TASK-2717)');
          launchCount += 1;
          return { agent: 'codex', result: { status: 0 } };
        },
        transitionTaskFn: () => true,
        missionServicesFn,
        recordDraftImplementerFn: () => {},
        recordDraftStatsFn: () => {},
        validateDraftClassificationFn: () => ({ ok: true as const }),
        [normalizeKey]: (() => {
          let calls = 0;
          return () => {
            calls += 1;
            return calls === 1
              ? { ok: false, reason: 'missing-labels' }
              : { ok: true, [typeKey]: 'ai_sdlc' };
          };
        })(),
        enforceDraftCommitSafetyFn: () => {},
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
      });

      assert.equal(exitCode.value, null);
      assert.equal(launchCount, 2, 'classification restart must use the same isolated launcher (TASK-2717)');
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-fix'], { configuration: resolveConfiguration(process.env),
        resolveTaskFileFn: () => ({ matches: ['/tmp/task.md'],  ok: true as const, taskFile: '/tmp/task.md' }),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
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
        validateDraftClassificationFn: () => ({ ok: true as const }),
        [normalizeKey]: () => ({ ok: false as const, reason: 'missing-labels' as const }),
        restartDraftAgentFn: async () => true,
        enforceDraftCommitSafetyFn: () => {},
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.ok(errors.some(msg => msg.includes('Classification validation failed after recovery')));
    }

    {
      let exitCode: { value: number | undefined | null } = { value: null };
      const errors: string[] = [];

      await runDraftCommand(['task-fail'], { configuration: resolveConfiguration(process.env),
        resolveTaskFileFn: () => ({ matches: ['/tmp/task.md'],  ok: true as const, taskFile: '/tmp/task.md' }),
        checkBacklogIntegrityFn: () => [],
        inferSlugFn: (slug) => slug ?? null,
        resolveMainRepoFn: () => '/tmp/main',
        detectLaunchBaseBranchFn: () => null,
        ensureRepoExistsFn: () => true,
        ensureStandaloneMissionBaselineFn: () => ({ failed: true, message: 'git status failed' }),
        exitFn: (code) => { exitCode.value = code; },
        logFn: () => {},
        errorFn: (msg) => errors.push(msg)
      });

      assert.equal(exitCode.value, 1);
      assert.ok(errors.some(msg => msg.includes('Standalone mission baseline: git status failed')));
    }
  });

  test('runDraftCommand accepts free-text intent and synthesizes a task slug', async () => {
    const calls: { slug: string; syntheticTask: DraftSyntheticTask | null | undefined; }[] = [];
    await runDraftCommand(['create a hello world program'], { configuration: resolveConfiguration(process.env),
      detectLaunchBaseBranchFn: () => null,
      resolveMainRepoFn: () => '/tmp/main',
      conventionalWorktreePathFn: (slug) => `/tmp/${slug}`,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureDraftRepoConfigCommittedFn: () => true,
      resolveTaskFileFn: () => ({ matches: [],  ok: false as const, reason: 'missing' as const }),
      // Free-text intent now synthesizes a DB-owned, repository-scoped
      // `px-<NNNN>` identity (task-2468). Pin the counter here so the
      // allocation stays deterministic regardless of the shared operator DB.
      allocateAdhocIdentityFn: () => ({ slug: 'px-0001', missionId: 'px-0001', taskId: 'PX-0001' }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureGraphifyIgnoreFn: () => {},
      ensureMissionFileFn: () => '/tmp/px-0001/MISSION.md',
      bootstrapBacklogTaskFn: (_wt, _repo, slug, options) => {
        calls.push({ slug, syntheticTask: options?.syntheticTask });
        return true;
      },
      validateDraftClassificationFn: () => ({ ok: true as const, classification: 'unknown' }),
      transitionTaskFn: () => true,
      missionServicesFn,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      normalizeDraftClassificationFn: () => ({ ok: true as const, classification: 'unknown' }),
      enforceDraftCommitSafetyFn: () => {},
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: () => {},
      errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].slug, 'px-0001');
    assert.ok(calls[0].syntheticTask != null);
    assert.equal(calls[0].syntheticTask.source, 'adhoc-db-identity');
  });

  test('runDraftCommand announces the allocated adhoc identity, not the free-text placeholder', async () => {
    // The header names the mission the operator will live with. Announcing it
    // before allocation printed `adhoc-create-a-hello-world-program` above a
    // branch called `mission/px-0001`.
    const logs: string[] = [];
    await runDraftCommand(['create a hello world program'], { configuration: resolveConfiguration(process.env),
      detectLaunchBaseBranchFn: () => null,
      resolveMainRepoFn: () => '/tmp/main',
      conventionalWorktreePathFn: (slug) => `/tmp/${slug}`,
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureDraftRepoConfigCommittedFn: () => true,
      resolveTaskFileFn: () => ({ matches: [],  ok: false as const, reason: 'missing' as const }),
      allocateAdhocIdentityFn: () => ({ slug: 'px-0001', missionId: 'px-0001', taskId: 'PX-0001' }),
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureGraphifyIgnoreFn: () => {},
      ensureMissionFileFn: () => '/tmp/px-0001/MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      validateDraftClassificationFn: () => ({ ok: true as const, classification: 'unknown' }),
      transitionTaskFn: () => true,
      missionServicesFn,
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      normalizeDraftClassificationFn: () => ({ ok: true as const, classification: 'unknown' }),
      enforceDraftCommitSafetyFn: () => {},
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: (msg) => logs.push(String(msg)),
      errorFn: (msg) => { throw new Error(`unexpected error ${msg}`); }
    });

    const header = logs.find(line => line.includes('Drafting mission'));
    assert.ok(header, `expected a draft header in output: ${logs.join(' | ')}`);
    assert.ok(header.includes('px-0001'), header);
    assert.ok(!header.includes('hello world program'), header);
  });

  test('runDraftCommand honors an explicit --agent override without consulting selectAgentFn or WORKFLOW_AGENT', async () => {
    const calls: (["launch", string | undefined] | ["record", string, string])[] = [];
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-command-agent-'));
    const worktree = path.join(tmpRoot, 'main-task-1038');
    const taskFile = path.join(worktree, 'backlog', 'tasks', 'task-1038.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, ['---', 'id: TASK-1038', 'labels: [ai_sdlc]', 'status: backlog', '---'].join('\n'));

    const priorWorkflowAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      await runDraftCommand(['task-1038', '--agent', 'claude'], { configuration: resolveConfiguration(process.env),
        inferSlugFn: (slug) => slug ?? null,
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
        readAgentConfigOrExitFn: () => ({ steps: { draft: { eligible: ['codex', 'claude'], selection: 'first' } } }),
        selectAgentFn: () => { throw new Error('selectAgentFn must not run when --agent is provided'); },
        startDraftAgentFn: async ({ agent }) => {
          assert.ok(agent);
          calls.push(['launch', agent] as const);
          return { agent, result: { status: 0 } };
        },
        resolveTaskFileFn: () => ({ matches: [],  ok: true as const, taskFile }),
        recordDraftImplementerFn: (opts) => calls.push(['record', opts.selected, opts.actual] as const),
        recordDraftStatsFn: () => {},
        [normalizeKey]: () => ({ ok: true as const, [typeKey]: 'ai_sdlc' }),
        validateDraftClassificationFn: () => ({ ok: true as const, classification: 'ai_sdlc' }),
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
    let exitCode: { value: number | undefined | null } = { value: null };
    const errors: string[] = [];

    await runDraftCommand(['task-1038', '--agent'], { configuration: resolveConfiguration(process.env),
      inferSlugFn: (slug) => slug ?? null,
      selectAgentFn: () => { throw new Error('must not select an agent when --agent parsing fails'); },
      startDraftAgentFn: async () => { throw new Error('must not launch when --agent parsing fails'); },
      exitFn: (code) => { exitCode.value = code; throw new Error('__stop__'); },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    }).catch(err => { if (err.message !== '__stop__') { throw err; } });

    assert.equal(exitCode.value, 1);
    assert.ok(errors.some(msg => msg.includes('px draft <slug> --agent <family>')));
  });

  test('ensureDraftRepoConfigCommitted blocks dirty mission-layout config before worktree creation', () => {
    const errors: string[] = [];
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
});

// no task ID in the legacy file (was test/draft_preflight_modern.test.ts)
describe('Draft preflight', () => {



  const { runDraftCommand } = runDraftCommandModule;
  test('runDraftCommand bails early if backlog task resolution is not ok', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: { value: number | undefined | null } = { value: null };
    let ensureMissionBranchCalled = false;

    await runDraftCommand(['task-999'], { configuration: resolveConfiguration(process.env),
      inferSlugFn: (s) => s ?? null,
      resolveMainRepoFn: () => '/tmp/main-repo',
      ensureRepoExistsFn: () => true,
      detectLaunchBaseBranchFn: () => null,
      resolveTaskFileFn: () => ({ matches: [],  ok: false as const, reason: 'missing' as const }),
      reportTaskResolutionFn: (res, slug, log) => {
        errors.push(`Reported: ${res.reason} for ${slug}`);
      },
      ensureMissionBranchFn: () => {
        ensureMissionBranchCalled = true;
      },
      exitFn: (code) => {
        exitCode.value = code;
      },
      logFn: (msg) => logs.push(msg),
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode.value, 1);
    assert.equal(ensureMissionBranchCalled, false);
    assert.ok(errors.some(e => e.includes('Reported: missing for task-999')));
  });

  test('runDraftCommand bails early if backlog integrity issues detected for the slug', async () => {
    const errors: string[] = [];
    let exitCode: { value: number | undefined | null } = { value: null };
    let ensureMissionBranchCalled = false;

    await runDraftCommand(['task-093'], { configuration: resolveConfiguration(process.env),
      inferSlugFn: (s) => s ?? null,
      resolveMainRepoFn: () => '/tmp/main-repo',
      ensureRepoExistsFn: () => true,
      detectLaunchBaseBranchFn: () => null,
      resolveTaskFileFn: () => ({ matches: ['/tmp/task-093.md'],  ok: true as const, taskFile: '/tmp/task-093.md' }),
      checkBacklogIntegrityFn: () => [
        { file: 'backlog/tasks/task-093.md', type: 'id-mismatch', filenameId: 'TASK-093', frontmatterId: 'TASK-099' }
      ],
      ensureMissionBranchFn: () => {
        ensureMissionBranchCalled = true;
      },
      exitFn: (code) => {
        exitCode.value = code;
      },
      logFn: () => {},
      errorFn: (msg) => errors.push(msg)
    });

    assert.equal(exitCode.value, 1);
    assert.equal(ensureMissionBranchCalled, false);
    assert.ok(errors.some(e => e.includes('Backlog integrity issues detected for task-093')));
  });

  // TASK-2706: a web/board-created px-XXXX mission already persisted its
  // planning fields in the operator store but has no Backlog task file. Draft
  // preflight must not bail "No Backlog task file"; it proceeds under the same
  // identity with zero allocation and no counter increment.
  test('runDraftCommand drafts a DB-owned px-0004 mission with no Backlog task file', async () => {
    const typeKey = 'classification';
    const normalizeKey = 'normalizeDraftClassificationFn';
    const calls: (["intake", string, string | undefined] | ["branch", string] | ["bootstrap"] | ["transition", string, string])[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: { value: number | undefined | null } = { value: null };
    let allocated = false;

    // The mission already exists in the operator store with planning fields.
    // store.load reports 'found' so preflight marks the mission DB-owned and
    // skips the Backlog task-file requirement.
    const dbOwnedMissionServicesFn: NonNullable<NonNullable<Parameters<typeof runDraftCommand>[1]>["missionServicesFn"]> = async () => (draftMissionServicesFixture({
      repositoryId: fixtureRepositoryId('test-repository'),
      store: {
        load: async (id) => {
          assert.equal(id, 'px-0004', 'the stored identity is preserved, not re-allocated');
          return { kind: 'found' as const, mission: fixtureMission(id, { title: 'px-0004 contract', labels: missionLabels(['ai_sdlc']), brief: { goal: 'fix things', why: 'Test intake', scope: 'Fixture', outOfScope: ['External state'] }, successCriteria: ['c1'], dependencies: [] }), version: fixtureVersion(3) };
        },
      },
      intake: {
        async execute(req) {
          calls.push(['intake', req.missionId, req.rawStatus] as const);
          return { status: 'completed' as const, value: { version: fixtureVersion(4), mission: fixtureMission(req.missionId) }, durableEvidence: [] };
        },
      },
      lifecycle: {
        transition: async request => ({ status: 'completed' as const, value: { version: fixtureVersion(5), mission: fixtureMission(request.missionId, { status: 'refined' }), previousAssignee: null, from: 'backlog', to: 'refined', laneChanged: true }, durableEvidence: [] }),
      },
    }));

    await runDraftCommand(['px-0004'], { configuration: resolveConfiguration(process.env),
      inferSlugFn: (s) => s ?? null,
      resolveMainRepoFn: () => '/tmp/main-repo',
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureDraftRepoConfigCommittedFn: () => true,
      detectLaunchBaseBranchFn: () => null,
      conventionalWorktreePathFn: () => '/tmp/main-repo/mission-px-0004',
      ensureMissionBranchFn: (repo, branch) => { calls.push(['branch', branch] as const); },
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => '/tmp/MISSION.md',
      // No Backlog task file exists for the DB-owned identity.
      resolveTaskFileFn: () => ({ matches: [],  ok: false as const, reason: 'missing' as const }),
      bootstrapBacklogTaskFn: () => { calls.push(['bootstrap'] as const); return true; },
      allocateAdhocIdentityFn: () => { allocated = true; return { slug: 'px-0004', taskId: 'PX-0004' } },
      readAgentConfigOrExitFn: () => ({ steps: { draft: { eligible: ['codex'], selection: 'first' } } }),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      [normalizeKey]: () => ({ ok: true as const, [typeKey]: 'unknown' }),
      validateDraftClassificationFn: () => ({ ok: true as const, classification: 'unknown' }),
      transitionTaskFn: (slug, status) => { calls.push(['transition', slug, status] as const); return true; },
      missionServicesFn: dbOwnedMissionServicesFn,
      exitFn: (code) => { exitCode.value = code; },
      logFn: (msg) => logs.push(msg),
      errorFn: (msg) => errors.push(msg)
    });

    // No fatal exit and, crucially, no "No Backlog task file" refusal.
    assert.equal(exitCode.value, null, `a DB-owned mission with persisted fields must not fail draft preflight: ${errors.join(' | ')}`);
    assert.ok(!errors.some(e => /Backlog task file/i.test(e)), `no Backlog task-file refusal for a DB-owned mission; got: ${errors.join(' | ')}`);
    // Zero identity allocation and no counter increment: the stored identity is reused.
    assert.equal(allocated, false, 'a DB-owned mission must not allocate a new adhoc identity or increment the counter');
    const branchName = calls.find(c => c[0] === 'branch')?.[1];
    assert.ok(branchName && /mission\/px-0004/.test(String(branchName)), 'the branch derives from the same px-0004 identity');
    assert.ok(calls.some(([c, slug]) => c === 'intake' && slug === 'px-0004'), 'intake materializes the mission under px-0004');
    assert.ok(calls.some(([c, slug, status]) => c === 'transition' && slug === 'px-0004' && status === 'backlog'), 'the mission reaches backlog without a Backlog mirror');
    assert.ok(logs.some(l => /px-0004/.test(l)), 'the draft names the px-0004 identity');
  });

  // TASK-2706 negative: a Backlog-backed `task-NNNN` mission already in the
  // operator store must NOT be treated as DB-owned. `isDbOwnedMission` is
  // restricted to `px-<NNNN>` adhoc identities, so a `task-NNNN` still requires
  // its Backlog task file and bails "No Backlog task file" when absent.
  test('runDraftCommand keeps a stored Backlog-backed task-1038 mission on the Backlog path', async () => {
    const typeKey = 'classification';
    const normalizeKey = 'normalizeDraftClassificationFn';
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: { value: number | undefined | null } = { value: null };

    // The mission exists in the operator store (load reports 'found'), but the
    // slug is a Backlog-backed identity, not a DB-owned adhoc identity.
    const storedMissionServicesFn: NonNullable<NonNullable<Parameters<typeof runDraftCommand>[1]>["missionServicesFn"]> = async () => (draftMissionServicesFixture({
      repositoryId: fixtureRepositoryId('test-repository'),
      store: {
        load: async (id) => ({ kind: 'found' as const, mission: fixtureMission(id, { title: 'task-1038' }), version: fixtureVersion(1) }),
      },
      intake: { async execute(request) { return { status: 'completed' as const, value: { version: fixtureVersion(2), mission: fixtureMission(request.missionId) }, durableEvidence: [] }; } },
      lifecycle: { transition: async request => ({ status: 'completed' as const, value: { version: fixtureVersion(2), mission: fixtureMission(request.missionId, { status: 'refined' }), previousAssignee: null, from: 'backlog', to: 'refined', laneChanged: true }, durableEvidence: [] }) },
    }));

    await runDraftCommand(['task-1038'], { configuration: resolveConfiguration(process.env),
      inferSlugFn: (s) => s ?? null,
      resolveMainRepoFn: () => '/tmp/main-repo',
      ensureRepoExistsFn: () => true,
      ensureStandaloneMissionBaselineFn: () => ({ committed: false }),
      ensureDraftRepoConfigCommittedFn: () => true,
      detectLaunchBaseBranchFn: () => null,
      conventionalWorktreePathFn: () => '/tmp/main-repo/mission-task-1038',
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => '/tmp/MISSION.md',
      // No Backlog task file exists for the Backlog-backed identity.
      resolveTaskFileFn: () => ({ matches: [],  ok: false as const, reason: 'missing' as const }),
      bootstrapBacklogTaskFn: () => true,
      allocateAdhocIdentityFn: () => ({ slug: 'task-1038', taskId: 'TASK-1038' }),
      readAgentConfigOrExitFn: () => ({ steps: { draft: { eligible: ['codex'], selection: 'first' } } }),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      recordDraftStatsFn: () => {},
      [normalizeKey]: () => ({ ok: true as const, [typeKey]: 'unknown' }),
      validateDraftClassificationFn: () => ({ ok: true as const, classification: 'unknown' }),
      transitionTaskFn: () => true,
      missionServicesFn: storedMissionServicesFn,
      exitFn: (code) => { exitCode.value = code; },
      logFn: (msg) => logs.push(msg),
      errorFn: (msg) => errors.push(msg)
    });

    // The DB-owned exemption must NOT apply to a Backlog-backed identity: the
    // draft still bails on the missing Backlog task file.
    assert.equal(exitCode.value, 1, 'a stored Backlog-backed task-NNNN mission still requires its Backlog task file');
    assert.ok(errors.some(e => /Backlog task for task-1038 not found/.test(e)), `a stored task-NNNN mission must not take the DB-owned path; got: ${errors.join(' | ')}`);
  });
});
