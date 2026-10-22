// Registry composition owns recovery launch wiring; all external boundaries
// are doubles so these cases exercise publication, fresh sessions and cleanup.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import type { SupervisorPort, RecoveryRequest } from '../../../src/application/recovery-supervisor.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
const scope = mockModule<typeof import('../../../src/composition/cli-service-scope.js')>('../../../src/composition/cli-service-scope.js', import.meta.url);
const lead = mockModule<typeof import('../../../src/composition/lead-supervisor.js')>('../../../src/composition/lead-supervisor.js', import.meta.url);
const cli = mockModule<typeof import('../../../src/interfaces/cli/lead.js')>('../../../src/interfaces/cli/lead.js', import.meta.url);
const agents = mockModule<typeof import('../../../src/adapters/agents/agents.js')>('../../../src/adapters/agents/agents.js', import.meta.url);
const stats = mockModule<typeof import('../../../src/adapters/review/review-agent-fallback.js')>('../../../src/adapters/review/review-agent-fallback.js', import.meta.url);
const config = mockModule<typeof import('../../../src/adapters/config/product-config.js')>('../../../src/adapters/config/product-config.js', import.meta.url);
await installModuleMocks();
const { createRuntimeOptions } = await import('../../../src/composition/cli-command-registry.js');
const request: RecoveryRequest = { missionId: 'task-recovery', lane: 'active', diagnostic: 'stuck', attemptedOperation: 'active', instruction: 'Repair safely' };
for (const fails of [false, true]) {
  test(`lead recovery ${fails ? 'failure' : 'success'} publishes completion and retains fresh-session authority (TASK-2762)`, async t => {
    t.after(() => mock.restoreAll());
    const events: string[] = [];
    const services = { mission: { store: { load: async () => ({ kind: 'found', mission: { assignee: 'custom' } }) } }, currentWork: {
      running: async () => { events.push('running'); }, ended: async () => { events.push('ended'); },
    } } as unknown as ProductionApplicationServices;
    mock.method(scope, 'createCliServiceScope', () => ({ withGraph: async (invoke: (s: unknown) => unknown) => invoke(services), openServices: async () => services }));
    mock.method(lead, 'leadRecoveryWorkspace', () => ({ worktree: '/fixture', prompt: request.instruction }));
    mock.method(lead, 'createLeadSupervisorPort', (_services: unknown, _forwards: unknown, context: { launchRecovery: SupervisorPort['launchRecovery'] }) => ({ launchRecovery: context.launchRecovery }));
    mock.method(cli, 'createLeadCommand', (port: SupervisorPort) => async () => {
      if (fails) { await assert.rejects(port.launchRecovery(request), /launch failed/); }
      else { assert.equal(await port.launchRecovery(request), 'custom ran in /fixture'); }
      return 0;
    });
    mock.method(config, 'resolveAgentModel', () => 'fixture-model');
    mock.method(stats, 'recordStageStatsSafe', async (_stage: string, options: { stage: string; model: string }) => {
      assert.equal(options.stage, 'recovery'); assert.equal(options.model, 'fixture-model'); events.push('usage');
    });
    mock.method(agents, 'startAgent', async (mode: string, options: { agent: string; sessionMarkerPort: unknown; worktree: string; prompt: string }) => {
      assert.equal(mode, 'execute'); assert.equal(options.agent, 'custom'); assert.equal(options.worktree, '/fixture');
      assert.equal(options.prompt, request.instruction); assert.ok(options.sessionMarkerPort);
      events.push('launch');
      if (fails) { throw new Error('launch failed'); }
      return { agent: 'custom' };
    });
    const runtime = createRuntimeOptions('/fixture', resolveConfiguration({}));
    const command = runtime.commandFns?.lead;
    assert.ok(typeof command === 'function', 'lead command must be registered');
    await command([]);
    assert.deepEqual(events, fails ? ['running', 'launch', 'ended'] : ['running', 'launch', 'usage', 'ended']);
  });
}


test('lead interruption returns failure after forwarded settlement (TASK-2792)', async t => {
  t.after(() => mock.restoreAll());
  const events: string[] = [];
  mock.method(scope, 'createCliServiceScope', () => ({ withGraph: async (invoke: (s: unknown) => unknown) => {
    try { return await invoke({}); } finally { events.push('closed'); }
  } }));
  mock.method(lead, 'createLeadSupervisorPort', (_services: unknown, forwards: Set<Promise<unknown>>) => {
    forwards.add(Promise.resolve().then(() => { events.push('settled'); }));
    return {};
  });
  mock.method(cli, 'createLeadCommand', () => async () => 130);
  const command = createRuntimeOptions('/fixture', resolveConfiguration({})).commandFns!.lead!;
  await assert.rejects(async () => command([], { exitFn: (code: number) => {
    assert.equal(code, 130); events.push('exit'); throw new Error('interrupted');
  } }), /interrupted/);
  assert.deepEqual(events, ['settled', 'exit', 'closed']);
});
