// Historical regression provenance: TASK-2551, TASK-2604, TASK-2605, TASK-2517, TASK-2508, TASK-2515, TASK-2614, TASK-2622.17.
// Behavior-owned suite (TASK-2622.09): recovery and closeout of an already-landed integration —
// post-integrate hook ordering (task-2551), closed-Mission recovery (task-2604, task-2605), landed
// payload guards (task-2517), interrupted landing (task-2508), lifecycle precedence (task-2515) and
// the post-integrate hook (task-2206 unit seams) and the local px refresh before cleanup (task-2614,
// TASK-2622.17). Legacy case names unchanged.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeLandedCloseout } from '../../../../../src/application/integrate/landed-closeout.js';
import { recoverLandedIntegration } from '../../../../../src/application/integrate/landed-recovery.js';
import { createSquashLanding } from '../../../../../src/application/integrate/squash.js';
import { createGithubPrLanding } from '../../../../../src/application/integrate/github-pr.js';
import { printIntegrationPreflight } from '../../../../../src/adapters/cli/commands/integrate.js';
import { cleanupMissionWorktree, persistLandedIntegrationOrAbort, closeLandedIntegrationOrAbort } from '../../../../../src/adapters/cli/commands/integrate-post.js';
import { conventionalWorktreePath } from '../../../../../src/adapters/filesystem/mission-utils.js';
import status from '../../../../../src/adapters/cli/commands/status.js';
import { composeBoardProjection } from '../../../../../src/composition/board-projection.js';
import type { MissionStore } from '../../../../../src/application/domain-ports.js';
import type { Mission, MissionId, MissionStatus } from '../../../../../src/domain/mission.js';
import { missionId } from '../../../../../src/domain/mission.js';
import { repositoryId } from '../../../../../src/domain/repository.js';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';
import { resolvePostIntegrateCommand, resolvePreCommitCommand, buildPostIntegrateHookEnv, runPostIntegrateHook, runPreCommitHook } from '../../../../../src/adapters/process/post-integrate-hook.js';

// ---- task-2551 recovery post-integrate hook (consolidated from test/task-2551-recovery-post-integrate-hook.test.ts, TASK-2622.09) ----
describe("recovery post-integrate hook", () => {
  // TASK-2551: a recovered landed integration persists its confirmation without
  // running the repo post-integrate hook, leaving the mission's SonarQube Cloud
  // branch analysis behind (review round 1 finding). The recovery closeout must
  // run the same post-integrate hook seam as the normal landing path, after the
  // confirmation is persisted, so ADR 0060 cleanup applies to recovered
  // integrations too.

  const missionServices = { store: { load: async () => ({ kind: 'found', mission: {} }) } };

  function baseOptions(overrides: Record<string, unknown> = {}) {
    return {
      findSquashCommit: () => 'abc123',
      recoverMissionForIntegration: async () => ({ status: 'integration' }),
      persistLandedIntegrationOrAbort: async () => {},
      recordPostIntegrationStatsOrAbort: async () => {},
      closeLandedIntegrationOrAbort: async () => {},
      cleanupMissionWorktree: () => true,
      runPostIntegrateHookOrAbort: (_slug: string, _options: unknown) => {},
      createAbort: () => new Error('IntegrationAbort'),
      baseBranch: 'main',
      ...overrides,
    };
  }

  test('recovered landed integration runs the post-integrate hook after persisting, from the base worktree', async () => {
    const calls: Array<{ stage: string, slug?: string, options?: unknown }> = [];
    await recoverLandedIntegration('task-2551', missionServices, '/work/base', baseOptions({
      persistLandedIntegrationOrAbort: async () => { calls.push({ stage: 'persist' }); },
      recordPostIntegrationStatsOrAbort: async () => { calls.push({ stage: 'stats' }); },
      cleanupMissionWorktree: () => { calls.push({ stage: 'cleanup' }); return true; },
      runPostIntegrateHookOrAbort: (slug: string, options: unknown) => { calls.push({ stage: 'hook', slug, options }); },
      closeLandedIntegrationOrAbort: async () => { calls.push({ stage: 'close' }); },
    }));
    assert.deepEqual(calls, [
      { stage: 'persist' },
      { stage: 'stats' },
      { stage: 'hook', slug: 'task-2551', options: { baseWorktree: '/work/base', baseBranch: 'main', variant: 'variant-b-resumed' } },
      { stage: 'cleanup' },
      { stage: 'close' },
    ]);
  });

  test('recovered landed integration surfaces a post-integrate hook failure as an abort', async () => {
    await assert.rejects(
      recoverLandedIntegration('task-2551', missionServices, '/work/base', baseOptions({
        runPostIntegrateHookOrAbort: () => { throw new Error('Post-integrate hook failed (exit code 1)'); },
      })),
      /Post-integrate hook failed/,
    );
  });

  test('recovered landed integration stops before cleanup when statistics cannot be recorded', async () => {
    let cleaned = false;
    await assert.rejects(
      recoverLandedIntegration('task-2551', missionServices, '/work/base', baseOptions({
        recordPostIntegrationStatsOrAbort: async () => { throw new Error('classification missing'); },
        cleanupMissionWorktree: () => { cleaned = true; return true; },
      })),
      /classification missing/,
    );
    assert.equal(cleaned, false);
  });

  for (const interruptedAfter of ['stats', 'hook'] as const) {
    test(`landed closeout resumes after interruption following ${interruptedAfter}`, async () => {
      let closedAt: string | null = null;
      let worktreePresent = true;
      let measurementCount = 0;
      let closeCalls = 0;
      let interrupt = true;
      const effects: string[] = [];
      const options = baseOptions({
        recoverMissionForIntegration: async () => ({ status: 'done' }),
        persistLandedIntegrationOrAbort: async () => { effects.push('decide'); },
        recordPostIntegrationStatsOrAbort: async () => {
          effects.push('stats');
          if (measurementCount === 0) { measurementCount = 1; }
        },
        cleanupMissionWorktree: () => {
          effects.push('cleanup');
          if (interrupt && interruptedAfter === 'stats') { throw new Error('interrupted after stats'); }
          worktreePresent = false;
          return true;
        },
        runPostIntegrateHookOrAbort: () => {
          effects.push('hook');
          if (interrupt && interruptedAfter === 'hook') { throw new Error('interrupted after hook'); }
        },
        closeLandedIntegrationOrAbort: async () => {
          closeCalls++;
          closedAt = '2026-09-28T10:00:00Z';
          effects.push('close');
        },
      });

      await assert.rejects(recoverLandedIntegration('task-2551', missionServices, '/work/base', options), /interrupted after/);
      assert.equal(closedAt, null, 'administrative closure waits for all closeout steps');
      assert.equal(measurementCount, 1);
      assert.equal(worktreePresent, true, 'a pre-cleanup interruption retains the worktree as the retry marker');

      interrupt = false;
      await recoverLandedIntegration('task-2551', missionServices, '/work/base', options);
      assert.equal(measurementCount, 1, 'retry preserves the single integration measurement');
      assert.equal(worktreePresent, false);
      assert.equal(closeCalls, 1);
      assert.ok(closedAt);
      assert.equal(effects.at(-1), 'close');
    });
  }
});

// ---- task-2604 failed closeout resumes (consolidated from test/task-2604-repro.test.ts, TASK-2622.09) ----
describe("failed closeout resumes", () => {
  test('TASK-2604: failed closeout stays open and resumes without another landing transition', async () => {
    const steps: string[] = [];
    let status = 'integration';
    let closedAt: string | null = null;
    let failStats = true;
    let mergeCalls = 0;
    let gateCalls = 0;
    const missionServices = {
      store: { load: async () => ({ kind: 'found' as const, mission: { status, closedAt } }) },
    };
    const options = {
      findSquashCommit: () => 'landed-commit',
      recoverMissionForIntegration: async () => ({ status: 'integration' }),
      persistLandedIntegrationOrAbort: async () => { steps.push('delivered'); status = 'done'; },
      recordPostIntegrationStatsOrAbort: async () => {
        steps.push('stats');
        if (failStats) { throw new Error('statistics unavailable'); }
      },
      cleanupMissionWorktree: () => { steps.push('cleanup'); return true; },
      runPostIntegrateHookOrAbort: () => { steps.push('hook'); },
      closeLandedIntegrationOrAbort: async () => { steps.push('closed'); closedAt = '2026-09-28T12:00:00Z'; },
      createAbort: () => new Error('closeout aborted'),
      baseBranch: 'main',
      merge: () => { mergeCalls++; },
      runGates: () => { gateCalls++; },
    };

    await assert.rejects(recoverLandedIntegration('task-2604', missionServices, '/tmp/base', options), /statistics unavailable/);
    assert.equal(closedAt, null, 'a failed closeout must not administratively close the landed Mission');

    failStats = false;
    await recoverLandedIntegration('task-2604', missionServices, '/tmp/base', options);

    assert.deepEqual(steps, ['delivered', 'stats', 'stats', 'hook', 'cleanup', 'closed']);
    assert.equal(closedAt, '2026-09-28T12:00:00Z');
    assert.equal(mergeCalls, 0, 'a landed retry must never merge again');
    assert.equal(gateCalls, 0, 'a landed retry must never rerun integration gates');
  });

  test('TASK-2604: recovered closeout succeeds after its worktree was already cleaned', async () => {
    let status = 'integration';
    let closedAt: string | null = null;
    let worktreePresent = true;
    let failHook = true;
    const steps: string[] = [];
    const missionServices = {
      store: { load: async () => ({ kind: 'found' as const, mission: { status, closedAt } }) },
    };
    const options = {
      findSquashCommit: () => 'landed-commit',
      recoverMissionForIntegration: async () => ({ status: 'integration' }),
      persistLandedIntegrationOrAbort: async () => { steps.push('delivered'); status = 'done'; },
      recordPostIntegrationStatsOrAbort: async () => { steps.push('stats'); },
      cleanupMissionWorktree: () => { steps.push(worktreePresent ? 'cleanup' : 'cleanup-idempotent'); worktreePresent = false; return true; },
      runPostIntegrateHookOrAbort: () => {
        steps.push('hook');
        if (failHook) { throw new Error('hook unavailable'); }
      },
      closeLandedIntegrationOrAbort: async () => { steps.push('closed'); closedAt = '2026-09-28T12:00:00Z'; },
      createAbort: () => new Error('closeout aborted'),
      baseBranch: 'main',
    };

    await assert.rejects(recoverLandedIntegration('task-2604', missionServices, '/tmp/base', options), /hook unavailable/);
    assert.equal(worktreePresent, true, 'a failed refresh leaves cleanup artifacts as the retry marker');
    assert.equal(closedAt, null);

    failHook = false;
    await recoverLandedIntegration('task-2604', missionServices, '/tmp/base', options);

    assert.deepEqual(steps, ['delivered', 'stats', 'hook', 'stats', 'hook', 'cleanup', 'closed']);
    assert.equal(closedAt, '2026-09-28T12:00:00Z');
  });
});

// ---- task-2605 legacy closed Mission recovery (consolidated from test/task-2605-repro.test.ts, TASK-2622.09) ----
describe("legacy closed Mission recovery", () => {
  test('TASK-2605: explicitly recover legacy closed Mission once without redelivery', async () => {
    const steps: string[] = [];
    const closedAt = '2026-09-27T20:11:10.440Z';
    let hasArtifacts = true;
    let hasStats = false;
    let failHook = true;
    const missionServices = { store: { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt } }) } };
    const options = {
      findSquashCommit: () => 'landed-commit',
      recoverMissionForIntegration: async () => ({ status: 'done' }),
      persistLandedIntegrationOrAbort: async () => { steps.push('redelivered'); },
      recordPostIntegrationStatsOrAbort: async () => { steps.push('stats'); hasStats = true; },
      cleanupMissionWorktree: () => { steps.push('cleanup'); hasArtifacts = false; return true; },
      runPostIntegrateHookOrAbort: () => {
        steps.push('hook');
        if (failHook) { throw new Error('hook unavailable'); }
      },
      closeLandedIntegrationOrAbort: async () => { steps.push('closed-again'); },
      hasIntegrationMeasurement: () => hasStats,
      hasCleanupArtifacts: () => hasArtifacts,
      createAbort: () => new Error('aborted'),
      baseBranch: 'main',
    };

    await assert.rejects(recoverLandedIntegration('task-2595', missionServices, '/tmp/base', options), /hook unavailable/);
    assert.deepEqual(steps, ['stats', 'hook']);
    assert.equal(hasArtifacts, true, 'failed hook must leave the retry marker');

    failHook = false;
    steps.length = 0;
    await recoverLandedIntegration('task-2595', missionServices, '/tmp/base', options);
    assert.deepEqual(steps, ['hook', 'cleanup', 'closed-again'], 'retry preserves the one statistics row');
    assert.equal((await missionServices.store.load()).mission.closedAt, closedAt);

    steps.length = 0;
    await recoverLandedIntegration('task-2595', missionServices, '/tmp/base', options);
    assert.deepEqual(steps, [], 'fully recovered closed Mission is an idempotent no-op');
  });

  test('TASK-2605: missing landed proof stops legacy recovery before mutation', async () => {
    let mutations = 0;
    await assert.rejects(recoverLandedIntegration('task-2595',
      { store: { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt: '2026-09-27' } }) } },
      '/tmp/base', {
        findSquashCommit: () => null,
        recoverMissionForIntegration: async () => { mutations++; return { status: 'done' }; },
        persistLandedIntegrationOrAbort: async () => { mutations++; },
        recordPostIntegrationStatsOrAbort: async () => { mutations++; },
        cleanupMissionWorktree: () => { mutations++; return true; },
        runPostIntegrateHookOrAbort: () => { mutations++; },
        closeLandedIntegrationOrAbort: async () => { mutations++; },
        hasIntegrationMeasurement: () => false,
        hasCleanupArtifacts: () => true,
        createAbort: () => new Error('aborted'),
        baseBranch: 'main',
      }), /aborted/);
    assert.equal(mutations, 0);
  });

  test('TASK-2605: invalid stored classification stops before hook and cleanup', async () => {
    const steps: string[] = [];
    await assert.rejects(recoverLandedIntegration('task-2595',
      { store: { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt: '2026-09-27' } }) } },
      '/tmp/base', {
        findSquashCommit: () => 'landed-commit',
        recoverMissionForIntegration: async () => ({ status: 'done' }),
        persistLandedIntegrationOrAbort: async () => { steps.push('redelivered'); },
        recordPostIntegrationStatsOrAbort: async () => { throw new Error('invalid px classification'); },
        cleanupMissionWorktree: () => { steps.push('cleanup'); return true; },
        runPostIntegrateHookOrAbort: () => { steps.push('hook'); },
        closeLandedIntegrationOrAbort: async () => { steps.push('closed-again'); },
        hasIntegrationMeasurement: () => false,
        hasCleanupArtifacts: () => true,
        createAbort: () => new Error('aborted'),
        baseBranch: 'main',
      }), /invalid px classification/);
    assert.deepEqual(steps, []);
  });
});

// ---- task-2517 SC4 landed guard on active/review (consolidated from test/task-2517-sc4-landed-guard.test.ts, TASK-2622.09) ----
describe("landed guard on active/review", async () => {
  // TASK-2517 SC4: `px active` and `px review` refuse a mission whose payload
  // already landed on the base branch and point at the closeout command.
  //
  // Red before the fix: neither command checks for a landed payload, so an
  // operator re-runs `px active`/`px review` against a mission the rebound already
  // delivered, relaunching an implementer for work that is done. The guard is an
  // opt-in seam (`payloadLandedFn`) so direct unit callers that do not set it keep
  // their existing behaviour (the 300+ active/review tests that omit the seam
  // still proceed); the composition root wires it for the real CLI.

  const active = (await import('../../../../../src/adapters/cli/commands/active.js')).default;
  const { ReviewWorkflowAdapter } = await import('../../../../../src/adapters/review/review-workflow-adapter.js');
  const { ReviewCommandUseCase } = await import('../../../../../src/application/review-command-use-case.js');

  test('SC4: px active refuses a landed payload and names the closeout command', async () => {
    const errors = [];
    const exits = [];
    await active(['task-2517-landed'], {
      inferSlugFn: (s) => s,
      errorFn: (m) => errors.push(m),
      exitFn: (c) => exits.push(c),
      payloadLandedFn: async () => true,
    });
    assert.deepEqual(exits, [1], 'active exits non-zero for a landed payload');
    assert.ok(errors.some((m) => m.includes('--recover-landed')), 'active hints the closeout command');
  });

  test('SC4: px review refuses a landed payload', async () => {
    const errors: string[] = [];
    const exits: number[] = [];
    const command = new ReviewCommandUseCase(new ReviewWorkflowAdapter({
      payloadLandedFn: async () => true,
      error: (message) => errors.push(message),
      exit: ((code: number) => { exits.push(code); }) as unknown as typeof process.exit,
    }));
    await command.execute(['task-2517-landed']);
    assert.deepEqual(exits, [1], 'review exits non-zero for a landed payload');
    assert.ok(errors.some((message) => message.includes('--recover-landed')), 'review hints the closeout command');
  });
});

// ---- task-2517 rebounded landing guard (consolidated from test/task-2517-integrate-rebound-landing-guard.test.ts, TASK-2622.09) ----
describe("rebounded landing guard", () => {
  // TASK-2517: closeout eligibility must be proven before any landing effect.
  //
  // Red before the fix: `finishLanding` syncs the Forgejo PR before asking the
  // lifecycle service whether the rebounded (active) Mission can integrate, and
  // the `github-pr` landing observes/merges the PR before the same question.


  for (const failedStep of ['stats', 'cleanup', 'hook', 'none']) {
    test(`landed mission closes only after post-merge effects: ${failedStep}`, async () => {
      const effects: string[] = [];
      const abort = new Error('closeout failed');
      const { finishLanding } = createSquashLanding({
        productConfig: { isForgejoReviewEnabled: () => false },
        fileSystem: { existsSync: () => false },
        git: { git: () => ({ status: 0, stdout: '', stderr: '' }) },
        checkout: { maybeUpdateGraphifyOnPrimary: () => { effects.push('graphify'); } },
        landing: {
          createAbort: () => abort,
          persistLandedIntegrationOrAbort: async () => { effects.push('decide'); },
          recordPostIntegrationStatsOrAbort: async () => { effects.push('stats'); if (failedStep === 'stats') { throw abort; } },
          cleanupMissionWorktree: () => { effects.push('cleanup'); return failedStep !== 'cleanup'; },
          runPostIntegrateHookOrAbort: () => { effects.push('hook'); if (failedStep === 'hook') { throw abort; } },
          closeLandedIntegrationOrAbort: async () => { effects.push('close'); },
        },
      } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });
      const run = {
        slug: 'task-closeout', context: {},
        missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' } }) } },
        baseWorktree: '/tmp/base', baseBranch: 'main', seams: {},
        state: { temporaryStash: null, nextActionMessage: null },
      } as never;
      const landing = finishLanding(run, { branch: 'mission/task-closeout', mergedCommit: 'abc', stepLabel: 'test', variant: 'variant-b' });
      if (failedStep === 'none') { await landing; }
      else { await assert.rejects(landing, error => error === abort); }
      assert.deepEqual(effects, failedStep === 'stats' ? ['decide', 'stats']
        : failedStep === 'cleanup' ? ['decide', 'stats', 'hook', 'cleanup']
        : failedStep === 'hook' ? ['decide', 'stats', 'hook']
          : ['decide', 'stats', 'hook', 'cleanup', 'close'], 'successful closeout preserves its lifecycle effects without refreshing Graphify');
    });
  }

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
});

// ---- task-2508 interrupted landed integration (consolidated from test/task-2508-interrupted-landed-integration-repro.test.ts, TASK-2622.09) ----
describe("interrupted landed integration", () => {
  function preflight(missionStatus) {
    return printIntegrationPreflight({
      slug: 'task-2508',
      branch: 'mission/task-2508',
      currentBranch: 'mission/task-2508',
      missionDir: '/tmp/missions/task-2508',
      task: { ok: true, taskFile: `${process.cwd()}/backlog/tasks/task-2508 - Make-interrupted-landed-integrations-idempotently-closeable.md` },
      taskStatus: missionStatus,
      missionStatus,
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'merged', number: 2508 },
      siblingPrs: [],
      approval: { ok: true, reviewState: 'APPROVED' },
      baseBranch: 'main',
      baseWorktree: process.cwd(),
      mainBranch: 'main',
      mainDirty: false,
      mainDirtyEntries: [],
    }, {
      readTokenFn: () => 'token',
      resolveTokenFileFn: () => '/tmp/token',
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, rebaseDir: null, rebaseHead: null, unmergedFiles: [] }),
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      findMissionDocInBranchesFn: () => [],
      isForgejoReviewEnabledFn: () => true,
      log: () => '',
    });
  }

  test('printIntegrationPreflight does not fail on a merged PR for a landed integration', () => {
    for (const missionStatus of ['integration', 'done']) {
      assert.ok(!preflight(missionStatus).failures.includes('pr-merged'));
    }

    assert.ok(preflight('review').failures.includes('pr-merged'));
  });

  test('interrupted landing decides delivery once and closes after retry', async () => {
    const calls = [];
    let mission = { status: 'integration', closedAt: null, assignee: 'codex' };
    const services = {
      store: { load: async () => ({ kind: 'found', mission, version: 1 }) },
      integration: {
        decideIntegration: async request => {
          calls.push(['decide', request]);
          mission = { ...mission, status: 'done' };
          return { status: 'completed' };
        },
        close: async request => {
          calls.push(['close', request]);
          mission = { ...mission, closedAt: '2026-09-14T12:00:00.000Z' };
          return { status: 'completed' };
        },
      },
    };

    await persistLandedIntegrationOrAbort('task-2508', 'landed-sha', services, { landedAt: '2026-09-14T10:00:00.000Z' });
    await persistLandedIntegrationOrAbort('task-2508', 'landed-sha', services, { landedAt: '2026-09-14T10:00:00.000Z' });
    assert.equal(mission.closedAt, null);
    await closeLandedIntegrationOrAbort('task-2508', 'landed-sha', services);
    await closeLandedIntegrationOrAbort('task-2508', 'landed-sha', services);

    assert.deepEqual(calls.map(([kind]) => kind), ['decide', 'close']);
    assert.equal(calls[0][1].idempotencyKey, 'integrate:task-2508:landed-sha');
    assert.equal(calls[1][1].idempotencyKey, 'close:task-2508:landed-sha');
    assert.notEqual(mission.closedAt, null);
  });

  test('cleanupMissionWorktree accepts a retry after worktree and branch removal', () => {
    const rootDir = '/tmp/task-2508-root';
    const worktree = conventionalWorktreePath('task-2508', rootDir);
    let branchExists = true;
    let worktreeExists = true;
    const gitRunner = args => {
      if (args.slice(-2).join(' ') === 'branch --show-current') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('show-ref')) return { status: branchExists ? 0 : 1, stdout: '', stderr: '' };
      if (args.slice(-2).join(' ') === 'list --porcelain') return { status: 0, stdout: `worktree ${worktree}\n`, stderr: '' };
      if (args.includes('-D')) branchExists = false;
      return { status: 0, stdout: '', stderr: '' };
    };
    const retired: string[] = [];
    const options = { retireTerminal: (slug: string) => { retired.push(slug); }, rootDir, gitRunner, existsSync: target => target === worktree && worktreeExists, removeDir: () => { worktreeExists = false; } };

    assert.equal(cleanupMissionWorktree('task-2508', options), true);
    assert.equal(cleanupMissionWorktree('task-2508', options), true);
    assert.deepEqual(retired, ['task-2508', 'task-2508']);
    assert.equal(cleanupMissionWorktree('task-2508', { ...options,
      retireTerminal: () => { throw new Error('tmux set-option failed'); },
    }), true, 'terminal retirement must not block landed closeout');
  });

  test('px status reports the authoritative done lifecycle', async () => {
    const lines = [];
    await status(['task-2508'], {
      log: line => lines.push(line),
      exit: () => {},
      inferSlugFn: () => 'task-2508',
      getCurrentBranchFn: () => 'main',
      getPrStatusFn: () => ({ exists: false }),
      readAgentConfigOrExitFn: () => ({}),
      eligibleAgentsForStepFn: () => [],
      allWorkflowAgentNamesFn: () => [],
      workflowLauncherStatusFn: () => ({ supported: true }),
      getLastThreeCommitsFn: () => [],
      getUncommittedCountFn: () => 0,
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
      buildProjectionFn: async () => ({ build: async () => ({ stages: [{ cards: [{
        id: 'task-2508', status: 'done', rawStatus: 'active', checkpoint: null,
        checkpointDescription: null, reviewPhase: null, reviewHistory: [],
      }] }] }) }),
    });

    assert.ok(lines.includes('Mission status: done'));
  });
});

// ---- task-2515 lifecycle not masked by completed backlog task (consolidated from test/task-2515-integration-lifecycle-not-masked.test.ts, TASK-2622.09) ----
describe("lifecycle not masked by completed backlog task", () => {
  /**
   * Regression for TASK-2515: a mission whose SQLite `Mission` aggregate is stuck
   * in a non-terminal lifecycle (`integration`) must project into the integration
   * board lane and expose the human-only `integrate-lane` attention item even when
   * its `backlog/completed/` task file carries `status: done`. The board derives
   * its lane from the shared DB-backed projection, never from the stale Markdown.
   */
  const repository = repositoryId('task-2515-not-masked-repo');

  function mission(id: string, status: MissionStatus): Mission {
    return {
      id: missionId(id), repositoryId: repository, title: id, labels: [], assignee: null,
      checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null,
    };
  }

  function storeFor(persisted: readonly Mission[]): MissionStore {
    return {
      async load(id: MissionId) {
        const found = persisted.find((candidate) => candidate.id === id);
        return found
          ? { kind: 'found' as const, mission: found, version: 1 as never }
          : { kind: 'missing' as const };
      },
      async save() { return 1 as never; },
      async loadByRepository() { return persisted; },
    };
  }

  // Hermetic doubles: no shimmed git CLI, launcher probe, or OS process scan.
  const gitDouble = () => ({ status: 0, stdout: '', stderr: '' });

  function board(rootDir: string, store: MissionStore) {
    return composeBoardProjection({
      rootDir,
      missionStore: store,
      repositoryId: repository,
      blocklistRepo: { async findAll() { return []; } } as never,
      historyRepo: { async findAll() { return []; }, async findByType() { return []; } } as never,
      laneEventRepo: { async findAll() { return []; } } as never,
      usageRepo: { async findAll() { return []; } } as never,
      knownAgentFamilies: [],
      launcherProbe: () => ({ available: true, detail: null }),
      readAgentConfig: () => null,
      detectRunningSessions: () => null,
      gitFn: gitDouble,
    });
  }

  function writeCompletedTask(root: string, id: string, status: string): void {
    const file = path.join(root, 'backlog', 'completed', `${id}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\n---\n`, 'utf8');
  }

  test('task-2515 integration lifecycle not masked by completed backlog task', async () => {
    const root = registeredMkdtemp('task-2515-');
    try {
      // Completed task Markdown says `done`; the persisted aggregate says `integration`.
      writeCompletedTask(root, 'task-2515', 'done');
      const store = storeFor([mission('task-2515', 'integration')]);
      const projection = await board(root, store).builder.build();

      const card = projection.stages
        .flatMap((stage) => stage.cards)
        .find((c) => c.id === missionId('task-2515'));

      // SC1: projected into the integration lane despite the completed Markdown.
      assert.ok(card, 'mission must be present on the board');
      assert.equal(card?.lane, 'integration');
      assert.equal(card?.status, 'integration');

      // The `integrate` command is enabled on the card (human-only path).
      const integrateCmd = card?.commands.find((c) => c.command === 'integrate');
      assert.ok(integrateCmd?.enabled, 'integrate command must be enabled on an integration card');

      // SC2: attention queue carries the mission with the integrate-lane reason.
      const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-2515'));
      assert.ok(item, 'attention queue must enqueue the integration mission');
      assert.deepEqual(item?.reason, { kind: 'integrate-lane', detail: 'Awaiting integration' });
      assert.equal(item?.action.kind, 'integrate:merge');
      assert.equal(item?.action.display, `px integrate ${card!.id}`);

      // SC3: single DB-backed projection — no Markdown-only reconstruction.
      const sourceFacts = projection.sourceFacts.some((f) => f.source === 'mission-store');
      assert.ok(sourceFacts, 'projection must cite the mission-store authority');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // SC1 extends to every non-terminal status: a completed-Markdown `done` must never
  // override a non-terminal persisted lifecycle. Each case is hermetic.
  const NON_TERMINAL: MissionStatus[] = ['backlog', 'refined', 'active', 'review', 'integration'];
  test('task-2515 every non-terminal persisted lifecycle wins over completed Markdown', async () => {
    for (const status of NON_TERMINAL) {
      const root = registeredMkdtemp('task-2515-');
      try {
        writeCompletedTask(root, 'task-2515', 'done');
        const projection = await board(root, storeFor([mission('task-2515', status)])).builder.build();
        const card = projection.stages
          .flatMap((stage) => stage.cards)
          .find((c) => c.id === missionId('task-2515'));
        assert.equal(card?.lane, status, `persisted ${status} must project to lane ${status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
});

// ---- post-integrate hook (consolidated from test/post-integrate-hook.test.ts, TASK-2622.09) ----
describe("post-integrate hook", () => {
  function withTempDir(fn) {
    const dir = registeredMkdtemp('workflow-post-integrate-hook-');
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('resolvePostIntegrateCommand returns null when no workflow.config.json is present', () => {
    withTempDir(root => {
      assert.equal(resolvePostIntegrateCommand(root), null);
    });
  });

  test('resolvePostIntegrateCommand returns null when postIntegrateCommand is absent', () => {
    withTempDir(root => {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
        adapters: { integrate: {} },
      }));
      assert.equal(resolvePostIntegrateCommand(root), null);
    });
  });

  test('resolvePostIntegrateCommand returns the trimmed configured command', () => {
    withTempDir(root => {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
        adapters: { integrate: { postIntegrateCommand: '  ./scripts/refresh-px.sh  ' } },
      }));
      assert.equal(resolvePostIntegrateCommand(root), './scripts/refresh-px.sh');
    });
  });

  test('buildPostIntegrateHookEnv exposes slug, base worktree, base branch, and variant', () => {
    const env = buildPostIntegrateHookEnv({
      slug: 'task-1402',
      baseWorktree: '/repo',
      baseBranch: 'main',
      variant: 'variant-b',
      processEnv: {},
    });

    assert.equal(env.INTEGRATE_HOOK_SLUG, 'task-1402');
    assert.equal(env.INTEGRATE_HOOK_BASE_WORKTREE, '/repo');
    assert.equal(env.INTEGRATE_HOOK_BASE_BRANCH, 'main');
    assert.equal(env.INTEGRATE_HOOK_VARIANT, 'variant-b');
  });

  test('runPostIntegrateHook is a no-op when no command is configured', () => {
    const runFn = () => { throw new Error('should not run a command'); };
    const result = runPostIntegrateHook({
      slug: 'task-1402',
      baseWorktree: '/repo',
      baseBranch: 'main',
      variant: 'variant-b',
      runFn,
      resolveCommandFn: () => null,
    });

    assert.deepEqual(result, { ran: false, ok: true });
  });

  test('runPostIntegrateHook runs the configured command from the base worktree with hook env', () => {
    let capturedCmd;
    let capturedArgs;
    let capturedOptions;
    const runFn = (cmd, args, options) => {
      capturedCmd = cmd;
      capturedArgs = args;
      capturedOptions = options;
      return { status: 0, stdout: 'bumped to 1.3.5\n', stderr: '' };
    };

    const result = runPostIntegrateHook({
      slug: 'task-1402',
      baseWorktree: '/repo',
      baseBranch: 'main',
      variant: 'variant-b',
      runFn,
      resolveCommandFn: () => './scripts/refresh-px.sh',
    });

    assert.equal(capturedCmd, 'bash');
    assert.deepEqual(capturedArgs, ['-lc', './scripts/refresh-px.sh']);
    assert.equal(capturedOptions.cwd, '/repo');
    assert.equal(capturedOptions.env.INTEGRATE_HOOK_SLUG, 'task-1402');
    assert.equal(capturedOptions.env.INTEGRATE_HOOK_VARIANT, 'variant-b');
    assert.deepEqual(result, {
      ran: true,
      ok: true,
      command: './scripts/refresh-px.sh',
      output: 'bumped to 1.3.5',
      exitCode: 0,
    });
  });

  test('runPostIntegrateHook reports a non-zero exit as a failed hook, not thrown', () => {
    const runFn = () => ({ status: 3, stdout: '', stderr: 'permission denied' });

    const result = runPostIntegrateHook({
      slug: 'task-1402',
      baseWorktree: '/repo',
      baseBranch: 'main',
      variant: 'variant-b-resumed',
      runFn,
      resolveCommandFn: () => './scripts/refresh-px.sh',
    });

    assert.equal(result.ran, true);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 3);
    assert.equal(result.output, 'permission denied');
  });

  test('resolvePreCommitCommand reads preCommitCommand independently of postIntegrateCommand', () => {
    withTempDir(root => {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
        adapters: { integrate: { preCommitCommand: ' ./scripts/bump-version.sh ', postIntegrateCommand: './scripts/refresh-px.sh' } },
      }));
      assert.equal(resolvePreCommitCommand(root), './scripts/bump-version.sh');
      assert.equal(resolvePostIntegrateCommand(root), './scripts/refresh-px.sh');
    });
  });

  test('runPreCommitHook resolves the pre-commit command from the base worktree', () => {
    withTempDir(root => {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
        adapters: { integrate: { postIntegrateCommand: './scripts/refresh-px.sh' } },
      }));
      const runFn = () => { throw new Error('no pre-commit command is configured'); };
      assert.deepEqual(runPreCommitHook({ slug: 'task-2510', baseWorktree: root, baseBranch: 'main', variant: 'variant-b', runFn }), { ran: false, ok: true });
    });
  });
});

// ---- task-2614 landed integration refreshes the local px before cleanup (consolidated from test/task-2614-local-autoinstall-repro.test.ts, TASK-2622.17) ----
describe("landed integration refreshes the local px before cleanup (consolidated from test/-local-autoinstall-repro.test.ts,", () => {
  test('TASK-2614: a landed integration refreshes the repository-built local px before cleanup', async () => {
    const effects: string[] = [];
    const cleanupFailure = new Error('cleanup failed');

    await assert.rejects(
      completeLandedCloseout({
        slug: 'task-2614',
        landedCommit: 'landed-commit',
        missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration', closedAt: null } }) } },
        baseWorktree: '/repo/current-integration',
        baseBranch: 'main',
        variant: 'variant-b',
        landing: {
          createAbort: () => cleanupFailure,
          persistLandedIntegrationOrAbort: async () => { effects.push('persist'); },
          recordPostIntegrationStatsOrAbort: async () => { effects.push('stats'); },
          // The repository-built refresh is the configured post-integrate
          // handoff (`scripts/refresh-global-px.sh` in this repository).
          runPostIntegrateHookOrAbort: () => { effects.push('install-repository-built-px'); },
          cleanupMissionWorktree: () => { effects.push('cleanup'); return false; },
          closeLandedIntegrationOrAbort: async () => { effects.push('close'); },
        },
      }),
      error => error === cleanupFailure,
    );

    assert.deepEqual(effects, ['persist', 'stats', 'install-repository-built-px', 'cleanup']);
  });
});

test('landed closeout forwards the composition-bound statistics lifecycle reader (TASK-2637.04)', async () => {
  const readMissionFlow = async () => [];
  const store = { load: async () => ({ kind: 'found', mission: { status: 'done', closedAt: null } }) };
  const calls: string[] = [];
  await completeLandedCloseout({
    slug: 'task-stats-closeout', landedCommit: 'landed', baseWorktree: '/repo/base',
    baseBranch: 'main', variant: 'variant-b',
    missionServices: { store, readStatsMissionFlow: readMissionFlow },
    landing: {
      createAbort: () => new Error('unexpected abort'),
      persistLandedIntegrationOrAbort: async () => { throw new Error('delivery already persisted'); },
      recordPostIntegrationStatsOrAbort: async (slug, options) => {
        assert.equal(slug, 'task-stats-closeout');
        assert.equal(options.missionStore, store);
        assert.equal(options.readMissionFlow, readMissionFlow);
        assert.deepEqual(await options.readMissionFlow!(), []);
        calls.push('statistics');
      },
      runPostIntegrateHookOrAbort: () => { calls.push('hook'); },
      cleanupMissionWorktree: () => { calls.push('cleanup'); return true; },
      closeLandedIntegrationOrAbort: async () => { calls.push('close'); },
    },
  });
  assert.deepEqual(calls, ['statistics', 'hook', 'cleanup', 'close']);
});
