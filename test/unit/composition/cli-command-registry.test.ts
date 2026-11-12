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
const missionContexts = mockModule<typeof import('../../../src/adapters/git/mission-execution-context.js')>('../../../src/adapters/git/mission-execution-context.js', import.meta.url);
await installModuleMocks();
import { missionExecutionContext } from '../../fixtures/mission-execution-context.js';
const { admittedBootstrapGitSpawn } = await import('../../../src/composition/git-admission.js');
const { createRuntimeOptions } = await import('../../../src/composition/cli-command-registry.js');
const request: RecoveryRequest = { missionId: 'task-recovery', lane: 'active', diagnostic: 'stuck', attemptedOperation: 'active', instruction: 'Repair safely' };
for (const mode of ['empty', 'report', 'failure'] as const) {
  const fails = mode === 'failure';
  test(`lead recovery ${mode} publishes completion and retains fresh-session authority (TASK-2762)`, async t => {
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
      else {
        const report = await port.launchRecovery(request);
        if (mode === 'report') {
          assert.match(report, /Recovery report.*verify against Mission evidence/);
          assert.match(report, /Decision: retain the contract; evidence: CP-2; options: A or B; recommend A/);
        } else { assert.equal(report, 'custom ran in /fixture'); }
      }
      return 0;
    });
    mock.method(config, 'resolveAgentModel', () => 'fixture-model');
    mock.method(missionContexts, 'resolveMissionExecutionContext', (slug: string) => ({ ok: true, context: missionExecutionContext({ missionId: slug, missionWorktree: '/fixture' }) }));
    mock.method(stats, 'recordStageStatsSafe', async (_stage: string, options: { stage: string; model?: string }) => {
      assert.equal(options.stage, 'recovery'); assert.equal(options.model, undefined); events.push('usage');
    });
    mock.method(agents, 'startAgent', async (stage: string, options: { agent: string; sessionMarkerPort: unknown; worktree: string; prompt: string }) => {
      assert.equal(stage, 'execute'); assert.equal(options.agent, 'custom'); assert.equal(options.worktree, '/fixture');
      assert.equal(options.prompt, request.instruction); assert.ok(options.sessionMarkerPort);
      events.push('launch');
      if (fails) { throw new Error('launch failed'); }
      return { agent: 'custom', ...(mode === 'report' ? { result: { stdout: 'Decision: retain the contract; evidence: CP-2; options: A or B; recommend A' } } : {}) };
    });
    const runtime = createRuntimeOptions('/fixture', resolveConfiguration({}));
    const command = runtime.commandFns?.lead;
    assert.ok(typeof command === 'function', 'lead command must be registered');
    await command([]);
    assert.deepEqual(events, fails ? ['running', 'launch', 'ended'] : ['running', 'launch', 'usage', 'ended']);
  });
}

test('lead recovery keeps completed work when telemetry context is unresolved (TASK-2851 F2)', async t => {
  t.after(() => mock.restoreAll());
  const events: string[] = [];
  const services = { mission: { store: { load: async () => ({ kind: 'found', mission: { assignee: 'custom' } }) } }, currentWork: {
    running: async () => { events.push('running'); }, ended: async () => { events.push('ended'); },
  } } as unknown as ProductionApplicationServices;
  mock.method(scope, 'createCliServiceScope', () => ({ withGraph: async (invoke: (s: unknown) => unknown) => invoke(services), openServices: async () => services }));
  mock.method(lead, 'leadRecoveryWorkspace', () => ({ worktree: '/fixture', prompt: request.instruction }));
  mock.method(lead, 'createLeadSupervisorPort', (_services: unknown, _forwards: unknown, context: { launchRecovery: SupervisorPort['launchRecovery'] }) => ({ launchRecovery: context.launchRecovery }));
  mock.method(cli, 'createLeadCommand', (port: SupervisorPort) => async () => {
    assert.equal(await port.launchRecovery(request), 'custom ran in /fixture');
    return 0;
  });
  mock.method(config, 'resolveAgentModel', () => 'fixture-model');
  mock.method(missionContexts, 'resolveMissionExecutionContext', () => ({ ok: false, reason: 'mission checkout is not resolved' }));
  mock.method(stats, 'recordStageStatsSafe', async () => { events.push('usage'); });
  mock.method(agents, 'startAgent', async () => { events.push('launch'); return { agent: 'custom' }; });

  await createRuntimeOptions('/fixture', resolveConfiguration({})).commandFns!.lead!([]);
  assert.deepEqual(events, ['running', 'launch', 'ended'], 'telemetry is skipped without turning a completed recovery into a launch failure');
});


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
for (const race of ['none', 'version', 'operation', 'progress', 'integration'] as const) {
  test(`judged recovery revalidates ${race} at the prepared launcher boundary (TASK-2798)`, async t => {
    t.after(() => mock.restoreAll());
    const { OperatorJudgmentService } = await import('../../../src/application/operator-judgment.js');
    const events: string[] = [];
    let current = { missionId: request.missionId, version: 1, operationId: null as string | null,
      progress: 'head', lane: 'active', working: false, evidence: [{ ref: 'fixture:1', summary: 'fixture' }] };
    const service = new OperatorJudgmentService({ propose: async e => ({ missionId: e.missionId,
      version: e.version, operationId: e.operationId, progress: e.progress,
      evidenceRefs: e.evidence.map(x => x.ref), action: 'continue', summary: 'continue' }) },
    { now: () => 100, read: async () => current, record: () => {} });
    const judged = await service.judge(request.missionId);
    assert.ok(judged.admission);
    const services = { mission: { store: { load: async () => ({ kind: 'found', mission: { assignee: 'custom' } }) } }, currentWork: {
      running: async () => { events.push('running'); }, ended: async () => { events.push('ended'); },
    } } as unknown as ProductionApplicationServices;
    mock.method(scope, 'createCliServiceScope', () => ({ withGraph: async (invoke: (s: unknown) => unknown) => invoke(services), openServices: async () => services }));
    mock.method(lead, 'leadRecoveryWorkspace', () => ({ worktree: '/fixture', prompt: request.instruction }));
    mock.method(lead, 'createLeadSupervisorPort', (_services: unknown, _forwards: unknown, context: { launchRecovery: SupervisorPort['launchRecovery'] }) => ({
      launchRecovery: context.launchRecovery, admitRecovery: (admission: NonNullable<RecoveryRequest['admission']>) => service.assertContinuation(admission),
    }));
    mock.method(cli, 'createLeadCommand', (port: SupervisorPort) => async () => {
      const launch = port.launchRecovery({ ...request, admission: judged.admission });
      if (race === 'none') { await launch; } else { await assert.rejects(launch, /stale|not authorized/); }
      return 0;
    });
    mock.method(config, 'resolveAgentModel', () => 'fixture-model');
    mock.method(missionContexts, 'resolveMissionExecutionContext', (slug: string) => ({ ok: true, context: missionExecutionContext({ missionId: slug, missionWorktree: '/fixture' }) }));
    mock.method(stats, 'recordStageStatsSafe', async () => { events.push('usage'); });
    mock.method(agents, 'startAgent', async (_step: string, options: import('../../../src/adapters/agents/agent-launch-context.js').StartAgentOptions) => {
      // Simulate Mission movement during selection/capacity preparation, after
      // both service admission and the registry's assignee lookup.
      if (race === 'version') { current = { ...current, version: 2 }; }
      if (race === 'operation') { current = { ...current, operationId: 'new-owner' }; }
      if (race === 'progress') { current = { ...current, progress: 'new-head' }; }
      if (race === 'integration') { current = { ...current, lane: 'integration', version: 2 }; }
      assert.ok(options.launchAdmission, 'production passes admitted facts to the actual launch seam');
      await options.launchAdmission.assert();
      events.push('spawn');
      await options.onLaunch?.({ agent: 'custom', model: null, invocation: null, startedAtMs: 0 });
      return { agent: 'custom' };
    });
    await createRuntimeOptions('/fixture', resolveConfiguration({})).commandFns!.lead!([]);
    assert.deepEqual(events, race === 'none' ? ['spawn', 'running', 'usage', 'ended'] : []);
  });
}


test('CLI startup injects admitted bootstrap without an ambient binding (TASK-2830 F4)', t => {
  t.after(() => mock.restoreAll());
  let calls = 0;
  mock.method(config, 'ensureStandaloneGitRepo', (root: string | undefined, options: Parameters<typeof config.ensureStandaloneGitRepo>[1]) => {
    calls++;
    assert.equal(root, '/fixture');
    assert.equal(options?.spawnSyncFn, admittedBootstrapGitSpawn);
    return { changed: false, initialized: false };
  });
  const runtime = createRuntimeOptions('/fixture', resolveConfiguration({}));
  assert.deepEqual(runtime.ensureStandaloneGitRepoFn?.('/fixture'), { changed: false, initialized: false });
  assert.equal(calls, 1);
});
