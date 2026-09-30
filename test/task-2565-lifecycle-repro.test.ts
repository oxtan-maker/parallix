import test from 'node:test';
import assert from 'node:assert/strict';

import { routeIntegrationGateFailure } from '../src/adapters/cli/commands/integrate-gate-rebound.js';

test('TASK-2565: integration-gate rebound reactivates through the lifecycle path', async () => {
  let lifecycleTransitions = 0;
  let backlogTransitions = 0;

  await routeIntegrationGateFailure({
    slug: 'task-2565-fixture',
    missionWorktree: '/tmp/mission',
    baseWorktree: '/tmp/base',
    baseBranch: 'main',
    verificationCommand: 'npm test',
    failedGate: { key: 'unit', command: 'npm test', exitCode: 1, stdout: '', stderr: '' },
    gateError: 'unit failed',
    gates: [],
    implementer: 'codex',
    repositoryId: 'fixture',
    startAgentFn: async () => ({ result: { status: 0 } }),
    transitionTaskFn: async () => { backlogTransitions += 1; },
    reactivateMissionFn: async () => { lifecycleTransitions += 1; },
    captureFinalTreeFn: () => ({ ok: true, rootDir: '/tmp/mission', tree: 'tree' }),
    runPhaseGatesFn: async () => ({ ok: true, phase: 'integration', gates: [], executed: 0, skipped: false, dryRun: false, failedGate: null, error: null }),
    reboundFn: async (_reason, context) => {
      await context.transitionToImplementer?.('task-2565-fixture');
      return { outcome: 'fixed', attempts: 1, diagnostic: '', classification: { failureClass: 'GateFailure', dispatchAction: 'AutoRepair', isRelaunchable: true, label: 'gate' }, implementer: 'codex' };
    },
  } as any);

  assert.equal(lifecycleTransitions, 1);
  assert.equal(backlogTransitions, 0, 'the Backlog mirror must not choose the Mission lifecycle');
});
