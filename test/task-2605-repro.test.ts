import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverLandedIntegration } from '../src/application/integrate/landed-recovery.js';

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
