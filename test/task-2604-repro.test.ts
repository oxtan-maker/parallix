import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverLandedIntegration } from '../src/application/integrate/landed-recovery.js';

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
