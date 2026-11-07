import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntegrationGateStep, type GateStepRequest } from '../../../../src/application/integrate/gates.js';
import { setLogger } from '../../../../src/application/presentation/cli-format.js';
import type { IntegrationGateFailureRequest, IntegrationGateRunResult } from '../../../../src/application/ports/integrate-workflow.js';
import { missionId } from '../../../../src/domain/mission.js';
import { integrationContext } from '../../../fixtures/integration-context.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';

const gates = [
  { key: 'unit', command: 'npm test -- --unit', order: 0 },
  { key: 'types', command: 'npm run typecheck', order: 1 },
];

function receipt(overrides: Partial<IntegrationGateRunResult> = {}): IntegrationGateRunResult {
  return {
    ok: true,
    phase: 'integration',
    gates,
    executed: gates.length,
    skipped: false,
    dryRun: false,
    cancelled: false,
    failedGate: null,
    outcomes: gates.map(gate => ({ ...gate, exitCode: 0, stdout: '', stderr: '' })),
    proofReusable: true,
    error: null,
    ...overrides,
  };
}

async function fixture(result: IntegrationGateRunResult, configured = gates) {
  let repairRoutes = 0;
  const repairRequests: IntegrationGateFailureRequest[] = [];
  let runnerDryRun: boolean | undefined;
  const unsuccessful: unknown[] = [];
  const services = integrationServices({ operationalHistory: {
    loadLatestByTypeForMission: async () => null,
    recordIntegrationValidation: async input => { unsuccessful.push(input); },
  } });
  const missionLoad = await services.store.load(missionId('px-dry-run'));
  const step = createIntegrationGateStep(stubIntegrateWorkflowPorts({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/fixture/mission',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture/mission', commit: 'a'.repeat(40), tree: 'b'.repeat(40) }),
      loadPhaseGates: () => configured,
      loadRequirePreIntegration: () => true,
      runPhaseGates: async (_phase, options) => { runnerDryRun = options.dryRun; return result; },
      routeIntegrationGateFailure: async () => { repairRoutes++; return { route: 'fixed' }; },
    },
    verification: { formatVerificationCommand: () => 'npm test' },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
  }));
  const request: GateStepRequest = {
    slug: 'px-dry-run', context: integrationContext({ slug: 'px-dry-run' }), missionLoad, missionServices: services,
    dryRun: true, noIntegrationGates: false, realAgent: null, realAgentModel: null,
    seams: {
      routeIntegrationGateFailureFn: async input => { repairRoutes++; repairRequests.push(input); return { route: 'human-only', diagnostic: 'fixture stop' }; },
      startAgentFn: async () => { throw new Error('fixture route must own launches'); },
      transitionTaskFn: async () => { throw new Error('fixture route must own lifecycle changes'); },
      applyAgentFallbackFn: async () => { throw new Error('fixture route must own fallback selection'); },
    },
  };
  return { step, request, observations: () => ({ repairRoutes, repairRequests, runnerDryRun, unsuccessful }) };
}

async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const previous = setLogger({ log: () => {}, error: () => {} });
  try { return await run(); } finally { setLogger(previous); }
}

test('integration dry-run executes the complete selected plan through the live runner (PX-0031)', async () => {
  const { step, request, observations } = await fixture(receipt());
  assert.equal(await quiet(() => step.runRequiredLocalGates(request)), '2 integration gate(s) passed');
  assert.equal(observations().runnerDryRun, false);
  assert.equal(observations().repairRoutes, 0);
});

test('integration dry-run routes a repairable red receipt with exact failure evidence (PX-0031)', async () => {
  const failedGate = { ...gates[0], exitCode: 7, stdout: 'bounded stdout', stderr: 'bounded stderr' };
  const { step, request, observations } = await fixture(receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }));
  await assert.rejects(quiet(() => step.runRequiredLocalGates(request)), { name: 'IntegrationAbort' });
  assert.equal(observations().repairRoutes, 1);
  assert.equal(observations().repairRequests[0]?.failedGate?.command, gates[0].command);
  assert.equal(observations().repairRequests[0]?.failedGate?.stderr, 'bounded stderr');
  assert.deepEqual(observations().repairRequests[0]?.gates, gates, 'repair verification receives the complete configured plan');
  assert.equal(observations().unsuccessful.length, 1, 'the red run remains recorded as failed evidence');
});

for (const [scenario, result] of [
  ['cancelled', receipt({ ok: false, cancelled: true, executed: 1, outcomes: [{ ...gates[0], exitCode: null, stdout: '', stderr: 'cancelled' }], error: 'cancelled' })],
  ['partial', receipt({ executed: 1, outcomes: [{ ...gates[0], exitCode: 0, stdout: '', stderr: '' }] })],
  ['malformed', { ok: true }],
] as const) {
  test(`integration dry-run rejects ${scenario} execution without repair or landing (PX-0031)`, async () => {
    const { step, request, observations } = await fixture(result);
    await assert.rejects(quiet(() => step.runRequiredLocalGates(request)), { name: 'IntegrationAbort' });
    assert.equal(observations().runnerDryRun, false);
    assert.equal(observations().repairRoutes, 0);
    assert.equal(observations().unsuccessful.length, 1);
  });
}

test('integration dry-run accepts a complete green receipt when optional reusable proof is unavailable (PX-0031)', async () => {
  const { step, request, observations } = await fixture(receipt({ proofReusable: false }));
  assert.equal(await quiet(() => step.runRequiredLocalGates(request)), '2 integration gate(s) passed');
  assert.equal(observations().repairRoutes, 0);
  assert.deepEqual(observations().unsuccessful, [], 'a green execution must not create failed validation history');
});

test('integration dry-run fails closed when mandatory preIntegration is missing (PX-0031)', async () => {
  const { step, request, observations } = await fixture(receipt({ ok: true, executed: 0, skipped: true, outcomes: [] }), []);
  await assert.rejects(quiet(() => step.runRequiredLocalGates(request)), { name: 'IntegrationAbort' });
  assert.equal(observations().repairRoutes, 0);
});
