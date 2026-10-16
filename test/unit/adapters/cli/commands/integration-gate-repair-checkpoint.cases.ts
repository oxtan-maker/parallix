import assert from 'node:assert/strict';
import test from 'node:test';
import { rebound } from '../../../../../src/application/rebound-kernel.js';
import type { routeIntegrationGateFailure } from '../../../../../src/adapters/cli/commands/integrate-gate-rebound.js';

/** Cases executed by the integration gate rebound contract; all boundaries doubled. */
export function integrationGateCheckpointCases(route: typeof routeIntegrationGateFailure): void {
  test('integration repair certifies the current failed command after unit becomes green (TASK-2750)', async () => {
    const unit = { key: 'unit', command: 'npm test', exitCode: 1, stdout: 'unit failed', stderr: '' };
    const integration = { ...unit, key: 'integration-ci', command: 'npm run test:integration:ci:prebuilt', stdout: 'integration failed' };
    const commands: string[] = [];
    let reruns = 0;
    let certified = 0;
    const result = await route({
      slug: 'fixture', missionWorktree: '', failedGate: unit, gates: [], implementer: 'codex', repositoryId: 'fixture',
      startAgentFn: async () => ({ result: { status: 0 } }), transitionTaskFn: async () => {},
      captureFinalTreeFn: () => ({ ok: true, rootDir: '', commit: 'unchanged', tree: 'tree' }),
      runPhaseGatesFn: async () => {
        reruns++;
        return { ok: reruns === 2, phase: 'integration', gates: [], executed: 2, skipped: false, dryRun: false,
          failedGate: reruns === 1 ? integration : null, error: reruns === 1 ? 'integration failed' : null };
      },
      reboundFn: (reason, context) => rebound(reason, { ...context, repairCheckpoints: {
        open: async input => { commands.push(input.command); return { name: 'CP-2', version: input.attempt }; },
        readBlocker: async () => undefined, verify: async () => { certified++; },
      } }),
      log() {}, error() {},
    });
    assert.equal(result.route, 'fixed');
    assert.equal(result.rebounds, 2);
    assert.deepEqual(commands, [unit.command, integration.command]);
    assert.equal(certified, 1);
    assert.equal(reruns, 2);
  });
}
