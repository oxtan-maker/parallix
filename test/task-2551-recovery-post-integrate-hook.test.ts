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
