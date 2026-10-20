// Cross-factory composition contract. External storage, processes and provider
// calls are doubled; the configuration-bearing factories remain production code.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks, importFresh } from '../../lib/module-mock.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { NO_CURRENT_WORK_PORT } from '../../../src/application/recording/current-work-recorder.js';

const agents = mockModule<typeof import('../../../src/adapters/agents/agents.js')>('../../../src/adapters/agents/agents.js', import.meta.url);
const selection = mockModule<typeof import('../../../src/adapters/agents/launcher-selection.js')>('../../../src/adapters/agents/launcher-selection.js', import.meta.url);
const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
const backlog = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
const paths = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
const provider = mockModule<typeof import('../../../src/adapters/review/review-adapter.js')>('../../../src/adapters/review/review-adapter.js', import.meta.url);
const rebase = mockModule<typeof import('../../../src/adapters/rebase/rebase-workflow-adapter.js')>('../../../src/adapters/rebase/rebase-workflow-adapter.js', import.meta.url);
const workflow = mockModule<typeof import('../../../src/application/rebase-workflow.js')>('../../../src/application/rebase-workflow.js', import.meta.url);
const handoff = mockModule<typeof import('../../../src/adapters/cli/commands/handoff.js')>('../../../src/adapters/cli/commands/handoff.js', import.meta.url);
const repair = mockModule<typeof import('../../../src/adapters/cli/commands/repair-handoff.js')>('../../../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
const execution = mockModule<typeof import('../../../src/adapters/git/mission-execution-context.js')>('../../../src/adapters/git/mission-execution-context.js', import.meta.url);
const integration = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);
const execute = mockModule<typeof import('../../../src/adapters/mission/execute-mission-adapters.js')>('../../../src/adapters/mission/execute-mission-adapters.js', import.meta.url);
await installModuleMocks();
const { createDefaultExecuteMissionRuntime } = await import('../../../src/adapters/mission/execute-mission-adapters.js');
const { createReviewLoopPorts } = await importFresh<typeof import('../../../src/adapters/review/review-loop.js')>('../../../src/adapters/review/review-loop.js', import.meta.url);
const { createLauncherProbe } = await import('../../../src/adapters/agents/launcher-availability.js');
const { createBoardIntegrateService, createProductionApplicationServices } = await importFresh<typeof import('../../../src/composition/application-services.js')>('../../../src/composition/application-services.js', import.meta.url);

const configuration = resolveConfiguration({ PATH: '/composed/bin', PARALLIX_HOME: '/composed/home', TASK_CONFIGURATION: 'composed' });

function boundaries(t: TestContext) {
  t.mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  t.mock.method(paths, 'findMissionDir', () => null);
  t.mock.method(paths, 'missionBranchName', () => 'mission/task-fixture');
  t.mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/fixture/task.md', matches: ['/fixture/task.md'] }));
  t.mock.method(provider, 'isProviderEnabled', () => true);
}

for (const route of ['review', 'handoff'] as const) {
 test(`nested ${route} rebase factory retains configuration identity (TASK-2709, TASK-2744)`, async t => {
  boundaries(t);
  const original = rebase.createRebaseWorkflowPort;
  let factories = 0;
  let probes = 0;
  t.mock.method(rebase, 'createRebaseWorkflowPort', (options: Parameters<typeof original>[0]) => {
    factories++;
    assert.strictEqual(options?.configuration, configuration);
    return original(options);
  });
  t.mock.method(agents, 'workflowLauncherStatus', (_agent: string, _root: string, resolved: unknown) => {
    probes++;
    assert.strictEqual(resolved, configuration);
    return { supported: true };
  });
  t.mock.method(workflow, 'runRebaseWorkflow', async (_args: string[], port: ReturnType<typeof original>) => {
    assert.equal(port.workflowLauncherStatus('codex', '/fixture').supported, true);
  });
  if (route === 'review') {
    const ports = createReviewLoopPorts('task-fixture', { worktree: '/fixture' }, { configuration, log: () => {}, error: () => {} });
    assert.equal((await ports.preReview.rebase()).ok, true);
  } else {
    assert.equal((await handoff.createHandoffPorts(configuration).rebase.rebaseBeforeReviewRound('task-fixture', {
      worktree: '/fixture', log: () => {}, error: () => {}, isForgejoReviewEnabledFn: () => true,
    })).ok, true);
  }
  assert.equal(factories, 1);
  assert.equal(probes, 1);
});

}

test('launcher availability passes composed configuration to discovery (TASK-2724)', t => {
  boundaries(t);
  let probes = 0;
  t.mock.method(selection, 'workflowLauncherStatus', (_agent: string, _root: string, resolved: unknown) => {
    probes++;
    assert.strictEqual(resolved, configuration);
    return { supported: true };
  });
  const probe = createLauncherProbe({ configuration, worktree: '/fixture' });
  assert.equal(probe(agentFamily('codex')).available, true);
  assert.equal(probe(agentFamily('codex')).available, true);
  assert.equal(probes, 1);
});

test('execution runtime binds handoff and repair-handoff configuration (TASK-2744)', async t => {
  boundaries(t);
  let calls = 0;
  t.mock.method(handoff, 'performHandoff', async (_slug: string, options: { configuration?: unknown }) => {
    assert.strictEqual(options.configuration, configuration); calls++; return { ok: true };
  });
  t.mock.method(repair, 'default', async (_slug: string, _root: string, _error: string, options: { configuration?: unknown }) => {
    assert.strictEqual(options.configuration, configuration); calls++; return { repaired: true };
  });
  const runtime = createDefaultExecuteMissionRuntime(configuration);
  await runtime.performHandoff('task-fixture', { worktree: '/fixture' });
  await runtime.repairHandoff('task-fixture', '/fixture', 'failure', {});
  assert.equal(calls, 2);
});

test('board integration context factory and nested adapter retain configuration', async t => {
  boundaries(t);
  let contexts = 0;
  let integrations = 0;
  t.mock.method(execution, 'resolveMissionExecutionContext', (_slug: string, _root: string, resolved: unknown) => {
    assert.strictEqual(resolved, configuration); contexts++;
    return { ok: true, context: { worktree: '/fixture', configuration } };
  });
  t.mock.method(integration, 'default', async (_args: string[], options: { configuration?: unknown; executionContext?: unknown }) => {
    assert.strictEqual(options.configuration, configuration);
    assert.deepEqual(options.executionContext, { worktree: '/fixture', configuration }); integrations++;
  });
  // The adapter is doubled, so the service never loads Mission persistence.
  const mission = {} as Parameters<typeof createBoardIntegrateService>[0];
  const service = createBoardIntegrateService(mission, NO_CURRENT_WORK_PORT, configuration, '/fixture');
  await service.execute(['task-fixture']);
  assert.equal(contexts, 1);
  assert.equal(integrations, 1);
});

test('production graph resolves execute factories from its supplied configuration', async t => {
  boundaries(t);
  const original = execute.createExecuteMissionPorts;
  let factories = 0;
  t.mock.method(execute, 'createExecuteMissionPorts', (...args: Parameters<typeof original>) => {
    assert.strictEqual(args[1].configuration, configuration); factories++;
    return original(...args);
  });
  const graph = await createProductionApplicationServices('/fixture', undefined, {
    configuration, includeOperatorState: false, includePresentationCapabilities: false,
  });
  t.after(() => graph.operatorState.close());
  assert.ok(graph.executePorts.handoffExecution);
  assert.equal(factories, 1);
});
