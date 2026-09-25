// TASK-2551: a recovered landed integration persists its confirmation without
// running the repo post-integrate hook, leaving the mission's SonarQube Cloud
// branch analysis behind (review round 1 finding). The recovery closeout must
// run the same post-integrate hook seam as the normal landing path, after the
// confirmation is persisted, so ADR 0060 cleanup applies to recovered
// integrations too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverLandedIntegration } from '../src/application/integrate/landed-recovery.js';

const missionServices = { store: { load: async () => ({ kind: 'found', mission: {} }) } };

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    findSquashCommit: () => 'abc123',
    recoverMissionForIntegration: async () => ({ status: 'integration' }),
    persistLandedIntegrationOrAbort: async () => {},
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
    cleanupMissionWorktree: () => { calls.push({ stage: 'cleanup' }); return true; },
    runPostIntegrateHookOrAbort: (slug: string, options: unknown) => { calls.push({ stage: 'hook', slug, options }); },
  }));
  assert.deepEqual(calls, [
    { stage: 'persist' },
    { stage: 'cleanup' },
    { stage: 'hook', slug: 'task-2551', options: { baseWorktree: '/work/base', baseBranch: 'main', variant: 'variant-b-resumed' } },
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
