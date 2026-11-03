// Lifecycle composition owns nested review routing; real workflow admission
// stays in-process here, with execution and persistence replaced by doubles.
import test, { mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { ExecutionActivityRecorder, NO_EXECUTION_ACTIVITY } from '../../../src/application/recording/execution-activity-recorder.js';
import { completed, failure } from '../../../src/application/contracts.js';
import type { BoardCommandRequest } from '../../../src/application/controller/board-command.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import type { CliCommandContext } from '../../../src/composition/cli-service-scope.js';
import type { Command } from '../../../src/interfaces/cli/runtime.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { memoryExecutionActivity } from '../../fixtures/execution-activity.js';
import { projectExecutionActivity } from '../../../src/domain/execution-activity.js';
import { workflowOperation } from '../../../src/domain/workflow-operation.js';
import type { WorkflowOperationStore } from '../../../src/application/ports/workflow-operation.js';
import { WorkflowOperationService } from '../../../src/application/workflow-operation-service.js';
import { log } from '../../../src/application/presentation/cli-format.js';
import { commandInvocation } from '../../../src/composition/command-invocation.js';
import { main } from '../../../src/interfaces/cli/runtime.js';
import { runIntegrateEntry } from '../../../src/application/integrate-entry.js';

const integration = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>(
  '../../../src/adapters/cli/commands/integrate.js', import.meta.url);
const reviewCli = mockModule<typeof import('../../../src/interfaces/cli/review.js')>(
  '../../../src/interfaces/cli/review.js', import.meta.url);
await installModuleMocks();
const { createLifecycleCommands } = await import('../../../src/composition/cli-lifecycle-commands.js');
const { ownWorkflowCli } = await import('../../../src/composition/workflow-cli.js');

function fixture(t: TestContext, denyAdmission = false, currentWork: ProductionApplicationServices['currentWork'] = NO_EXECUTION_ACTIVITY) {
  t.after(() => { mock.restoreAll(); configureMissionWriteAuthorization(null); });
  const requests: BoardCommandRequest[] = [];
  const borrowedGraphs: unknown[] = [];
  let directReviews = 0;
  let admissionsClosed = 0;
  const mission = fixtureMission('task-nested', { status: 'review', checkpoints: [] });
  const graph = {
    mission: { store: { load: async () => ({ kind: 'found', mission, version: 1 }) } },
    currentWork,
    operatorState: { close: async () => { admissionsClosed++; } },
    presentationCapabilities: { commandController: { dispatch: async (request: BoardCommandRequest) => {
      requests.push(request);
      return denyAdmission ? failure('conflict', 'Another workflow owns this mission') : completed({});
    } } },
  } as unknown as ProductionApplicationServices;
  const missionFactory = async () => graph.mission!;
  const scope: CliCommandContext['scope'] = {
    openServices: async () => graph,
    openWorkflowServices: async () => graph,
    withGraph: async invoke => invoke(graph),
    withMissionFactories: async invoke => invoke(missionFactory),
    withMissionAndGraph: async (invoke, _options, borrowed) => {
      borrowedGraphs.push(borrowed);
      return invoke(missionFactory, graph);
    },
  };
  const registry: Record<string, Command> = {};
  const commands = createLifecycleCommands({ rootDir: '/fixture', packageDir: '/fixture',
    configuration: resolveConfiguration({}), scope, active: async () => {}, commands: () => registry });
  Object.assign(registry, commands);
  ownWorkflowCli(registry, async () => graph);
  mock.method(integration, 'default', async (_args: string[], options: Parameters<typeof integration.default>[1]) => {
    assert.ok(options?.reReviewFn);
    await options.reReviewFn('task-nested', '/fixture');
  });
  mock.method(reviewCli, 'createReviewCommand', () => async () => { directReviews++; });
  // Invoke the internal integration entry deliberately without its outer CLI
  // wrapper: the nested callback must itself retain the admission fallback.
  return { invoke: () => commands.integrate(['task-nested']), requests, borrowedGraphs, graph,
    commands, directReviews: () => directReviews, admissionsClosed: () => admissionsClosed };
}

test('unowned integration re-review goes through workflow admission (TASK-2762)', async t => {
  const f = fixture(t);
  await f.invoke();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].kind, 'review:submit');
  assert.deepEqual(f.requests[0].invocation?.args, ['task-nested']);
  assert.equal(f.directReviews(), 0);
  assert.equal(f.admissionsClosed(), 1);
});

test('refused nested review admission never executes the unowned review (TASK-2762)', async t => {
  const f = fixture(t, true);
  await assert.rejects(async () => f.invoke(), /Another workflow owns this mission/);
  assert.equal(f.directReviews(), 0);
  assert.equal(f.admissionsClosed(), 1);
});

test('owned integration re-review reuses its graph without a second admission (TASK-2762)', async t => {
  const f = fixture(t);
  configureMissionWriteAuthorization({ operationId: 'integrate-owner', assert: async () => {} });
  await f.invoke();
  assert.equal(f.requests.length, 0);
  assert.equal(f.directReviews(), 1);
  assert.deepEqual(f.borrowedGraphs, [f.graph]);
  assert.equal(f.admissionsClosed(), 0, 'the integration owner retains its borrowed graph');
});


// Exercise the production exit adapter inside the same activity/owner nesting
// as the executor. Only storage, process launch and integration effects are doubled.
async function integrationCompletion(t: TestContext, control: { code?: 0 | 1; error?: Error; cleanup?: Error } = {}) {
  const activity = memoryExecutionActivity();
  const f = fixture(t, false, new ExecutionActivityRecorder(activity));
  const diagnostics: string[] = [];
  mock.method(log, 'fail', (message: string) => { diagnostics.push(message); });
  const publications: Array<{ phase: string; state: string; reason: string | null }> = [];
  const publish = activity.publish;
  activity.publish = async (event, source) => {
    publications.push({ phase: event.phase, state: event.state, reason: event.blockedReason });
    await publish(event, source);
  };
  const mission = fixtureMission('task-nested', { status: 'integration' });
  let row = workflowOperation({ id: 'integration-owner', requestKey: 'integration-owner',
    missionId: mission.id, repositoryId: mission.repositoryId, command: 'integrate:merge',
    generation: 0, phase: 'accepted', owner: null, providerStarted: false, agent: null, reviewer: null,
    originalStatus: 'integration', previousAssignee: null, reason: null,
    createdAt: '2026-11-02T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z' });
  const operations: WorkflowOperationStore = {
    activity, readOnly: work => work(), transaction: work => work(),
    get: async () => row, byRequest: async () => row, current: async () => row,
    open: async () => [row], latest: async () => row, latestByMission: async () => [row],
    insert: async value => { row = value; }, replace: async value => { row = value; },
  };
  const service = new WorkflowOperationService(operations, f.graph.mission!.store,
    { canExecute: () => true, async dispatch<T>() { return completed({} as T); } },
    { identity: () => ({ pid: 100, identity: 'fixture' }), launch: async () => {},
      alive: async () => true, stop: async () => true },
    mission.repositoryId, async () => 'codex', async () => {});
  const ports = integration.createIntegratePorts();
  ports.missionPaths.inferSlug = () => mission.id;
  let released = false;
  ports.process.claimIntegration = async () => async () => { released = true; if (control.cleanup) { throw control.cleanup; } };
  mock.method(integration, 'default', (args: string[], options: Parameters<typeof integration.default>[1]) =>
    runIntegrateEntry(args, options!, ports, {
      runIntegration: async () => { if (control.error) { throw control.error; } return control.code ?? 0; }, restoreTemporaryStash: () => 0,
    }));
  let status: number | undefined;
  await service.run(row.id, async () => {
    configureMissionWriteAuthorization({ operationId: row.id, assert: async () => {},
      activity: (event, source) => service.activity(row.id, row.generation, event, source) });
    try {
      status = await commandInvocation(exitFn => main(['integrate', mission.id], {
        commandFns: f.commands, exitFn, cwdFn: () => '/fixture', runtime: resolveConfiguration({}).runtime,
        ensureStandaloneGitRepoFn: () => ({}), loadAliasesFn: () => ({}),
      }));
      return status === 0 ? completed({}) : failure('execution', `Workflow exited with status ${status}`);
    } finally { configureMissionWriteAuthorization(null); }
  });
  return { status, row, publications, released, diagnostics,
    snapshot: (await activity.loadCurrentWork())[0],
    facts: projectExecutionActivity(await activity.loadCurrentWork(), { nowMs: Date.now(), ttlMs: 300000 }).get(mission.id)! };
}

test('successful CLI integration exit ends its activity without a false blocker (px-0024)', async t => {
  const f = await integrationCompletion(t);
  assert.equal(f.status, 0);
  assert.equal(f.row.phase, 'completed');
  assert.equal(f.released, true);
  assert.equal(f.facts.blockingReason, null);
  assert.equal(f.facts.currentWork, null);
  assert.ok(f.publications.some(event => event.phase === 'integrate' && event.state === 'ended'));
  assert.ok(!f.publications.some(event => event.state === 'blocked'));
  assert.equal(f.snapshot.frames.length, 0);
});

for (const control of [
  { name: 'nonzero exit', code: 1 as const, reason: 'px integrate task-nested exited with status 1' },
  { name: 'workflow exception', error: new Error('landing failed'), reason: 'px integrate task-nested exited with status 1' },
  { name: 'cleanup', cleanup: new Error('release failed'), reason: 'release failed' },
]) {
  test(`CLI integration preserves ${control.name} failure (px-0024)`, async t => {
    const f = await integrationCompletion(t, control);
    assert.equal(f.row.phase, 'blocked');
    assert.notEqual(f.status, 0);
    assert.equal(f.facts.blockingReason, control.cleanup ? control.reason : 'Workflow exited with status 1');
    assert.equal(f.released, true);
    if (control.error) { assert.ok(f.diagnostics.some(message => message.includes(control.error!.message))); }
    assert.ok(f.publications.some(event => event.state === 'blocked' && event.reason === control.reason));
    assert.ok(!f.publications.some(event => event.phase === 'integrate' && event.state === 'ended'));
  });
}
