// TASK-2517: closeout eligibility must be proven before any landing effect.
//
// Red before the fix: `finishLanding` syncs the Forgejo PR before asking the
// lifecycle service whether the rebounded (active) Mission can integrate, and
// the `github-pr` landing observes/merges the PR before the same question.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSquashLanding } from '../src/application/integrate/squash.js';
import { createGithubPrLanding } from '../src/application/integrate/github-pr.js';

test('TASK-2517: rebounded landing aborts before Forgejo sync when the lane is ineligible', async () => {
  const effects: string[] = [];
  const abort = new Error('IntegrationAbort');
  const { finishLanding } = createSquashLanding({
    productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: { syncMerged: () => { effects.push('forgejo-sync'); return { ok: true }; } },
    fileSystem: { existsSync: () => false },
    git: { git: () => ({ status: 0, stdout: '', stderr: '' }) },
    landing: {
      persistLandedIntegrationOrAbort: async () => { effects.push('decision'); },
      createAbort: () => abort,
      reportSyncMergedFailure: () => {},
    },
  } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });

  await assert.rejects(
    finishLanding({
      slug: 'task-2517',
      context: { forgejoUser: 'codex', forgejoToken: 'token', baseBranch: 'main' },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'active' }, version: 1 }) } },
      baseWorktree: '/tmp/task-2517', baseBranch: 'main', seams: {},
      state: { temporaryStash: null, nextActionMessage: null },
    } as never, { branch: 'mission/task-2517', mergedCommit: 'landed-sha', stepLabel: 'test', variant: 'variant-b' }),
    error => error === abort,
  );

  assert.deepEqual(effects, [], 'no Forgejo sync runs for an ineligible lane');
});

test('TASK-2517: finishLanding rejects an approved review lane at the landing boundary', async () => {
  // Round-2 F3: `decideMission('integrate')` requires the `integration` lane,
  // so a `review` lane reaching finishLanding (a future resume/repair entry
  // point that skips the workflow SC1 restore) must abort before the Forgejo
  // sync-merge, never after. The production flow restores `review` to
  // `integration` before landing, so this is defense-in-depth for that path.
  const effects: string[] = [];
  const abort = new Error('IntegrationAbort');
  const { finishLanding } = createSquashLanding({
    productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: { syncMerged: () => { effects.push('forgejo-sync'); return { ok: true }; } },
    fileSystem: { existsSync: () => false },
    git: { git: () => ({ status: 0, stdout: '', stderr: '' }) },
    landing: {
      persistLandedIntegrationOrAbort: async () => { effects.push('decision'); },
      createAbort: () => abort,
      reportSyncMergedFailure: () => {},
    },
  } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });

  await assert.rejects(
    finishLanding({
      slug: 'task-2517',
      context: { forgejoUser: 'codex', forgejoToken: 'token', baseBranch: 'main' },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'review' }, version: 1 }) } },
      baseWorktree: '/tmp/task-2517', baseBranch: 'main', seams: {},
      state: { temporaryStash: null, nextActionMessage: null },
    } as never, { branch: 'mission/task-2517', mergedCommit: 'landed-sha', stepLabel: 'test', variant: 'variant-b' }),
    error => error === abort,
  );

  assert.deepEqual(effects, [], 'no Forgejo sync runs for a review lane the decision rejects');
});

test('TASK-2517: github-pr landing aborts before the PR is observed or merged when the lane is active', async () => {
  const effects: string[] = [];
  const { landThroughGithubPr } = createGithubPrLanding({
    git: { git: () => ({ status: 0, stdout: 'candidate-sha\n', stderr: '' }) },
    github: { submitOrObserveGithubPr: async () => { effects.push('github-pr'); return { kind: 'merged', resultingSha: 'x', number: 1, base: 'main' }; } },
    missionPaths: { missionBranchName: () => 'mission/task-2517' },
  } as never);

  await assert.rejects(
    landThroughGithubPr({
      slug: 'task-2517',
      context: { baseWorktree: '/tmp/task-2517', baseBranch: 'main' },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'active' }, version: 1 }) } },
      strategy: { run: (_step: string, fn: () => unknown) => fn() } as never,
    }),
    /Cannot integrate while task-2517 is active; expected integration/,
  );

  assert.deepEqual(effects, [], 'no GitHub PR submission or merge happens for an ineligible lane');
});

test('TASK-2517: github-pr landing rejects an approved review lane at the landing boundary', async () => {
  // Round-2 F3: a `review` lane reaching landThroughGithubPr (a future entry
  // point that skips the workflow SC1 restore) must abort before any PR
  // submission or merge, never after the merge.
  const effects: string[] = [];
  const { landThroughGithubPr } = createGithubPrLanding({
    git: { git: () => ({ status: 0, stdout: 'candidate-sha\n', stderr: '' }) },
    github: { submitOrObserveGithubPr: async () => { effects.push('github-pr'); return { kind: 'merged', resultingSha: 'x', number: 1, base: 'main' }; } },
    missionPaths: { missionBranchName: () => 'mission/task-2517' },
  } as never);

  await assert.rejects(
    landThroughGithubPr({
      slug: 'task-2517',
      context: { baseWorktree: '/tmp/task-2517', baseBranch: 'main' },
      missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'review' }, version: 1 }) } },
      strategy: { run: (_step: string, fn: () => unknown) => fn() } as never,
    }),
    /Cannot integrate while task-2517 is review; expected integration/,
  );

  assert.deepEqual(effects, [], 'no GitHub PR submission or merge happens for a review lane');
});
