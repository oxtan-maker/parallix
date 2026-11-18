import test from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { DEFAULT_CONFIGURATION } from '../../../src/application/ports/configuration.js';
import type { IntegrationMissionServices } from '../../../src/application/ports/integration-records.js';
import type { VerificationActionPolicyFactory } from '../../../src/application/ports/verification-policy.js';

const integration = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>(
  '../../../src/adapters/cli/commands/integrate.js', import.meta.url);
const resumption = mockModule<typeof import('../../../src/application/integrate/repair-resumption.js')>(
  '../../../src/application/integrate/repair-resumption.js', import.meta.url);
const execution = mockModule<typeof import('../../../src/adapters/git/mission-execution-context.js')>(
  '../../../src/adapters/git/mission-execution-context.js', import.meta.url);
const retained = mockModule<typeof import('../../../src/adapters/review/retained-repair.js')>(
  '../../../src/adapters/review/retained-repair.js', import.meta.url);
await installModuleMocks();
const { integrationRepairContinuation } = await import('../../../src/composition/integration-repair-continuation.js');
type CreateIntegratePortsParameters = Parameters<typeof integration.createIntegratePorts>;
type CertifyPendingIntegrationRepairParameters = Parameters<typeof resumption.certifyPendingIntegrationRepair>;

test('integration repair continuation observes rerun tests with non-operator policy (TASK-2859.10 F2)', async t => {
  const policyFactory = (() => undefined) satisfies VerificationActionPolicyFactory;
  const ports = {} as ReturnType<typeof integration.createIntegratePorts>;
  const services = { store: {} } as IntegrationMissionServices;
  t.mock.method(execution, 'resolveMissionExecutionContext', () => ({ ok: true, context: {
    missionId: 'task-2859.10', missionWorktree: '/mission', missionBranch: 'mission/task-2859.10',
    baseWorktree: '/base', baseBranch: 'main',
  } }));
  t.mock.method(integration, 'createIntegratePorts', (configuration: CreateIntegratePortsParameters[0],
    policy: CreateIntegratePortsParameters[1], operatorInvocation: CreateIntegratePortsParameters[2]) => {
    assert.strictEqual(configuration, DEFAULT_CONFIGURATION);
    assert.strictEqual(policy, policyFactory);
    assert.equal(operatorInvocation, false);
    return ports;
  });
  t.mock.method(retained, 'retainedRepairPort', () => ({} as ReturnType<typeof retained.retainedRepairPort>));
  t.mock.method(resumption, 'certifyPendingIntegrationRepair', async (_slug: CertifyPendingIntegrationRepairParameters[0],
    actualServices: CertifyPendingIntegrationRepairParameters[1], actualPorts: CertifyPendingIntegrationRepairParameters[2]) => {
    assert.strictEqual(actualServices, services);
    assert.strictEqual(actualPorts, ports);
    return { outcome: 'changed' } as Awaited<ReturnType<typeof resumption.certifyPendingIntegrationRepair>>;
  });

  assert.equal(await integrationRepairContinuation(services, DEFAULT_CONFIGURATION, '/base', policyFactory)
    .resume('task-2859.10'), 'changed');
});
