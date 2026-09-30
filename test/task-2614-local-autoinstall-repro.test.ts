import test from 'node:test';
import assert from 'node:assert/strict';
import { completeLandedCloseout } from '../src/application/integrate/landed-closeout.js';

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
