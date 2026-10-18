// Lifecycle composition owns nested review routing; real workflow admission
// stays in-process here, with execution and persistence replaced by doubles.
import test, { mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { NO_CURRENT_WORK_PORT } from '../../../src/application/recording/current-work-recorder.js';
import { completed, failure } from '../../../src/application/contracts.js';
import type { BoardCommandRequest } from '../../../src/application/controller/board-command.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import type { CliCommandContext } from '../../../src/composition/cli-service-scope.js';
import type { Command } from '../../../src/interfaces/cli/runtime.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';

const integration = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>(
  '../../../src/adapters/cli/commands/integrate.js', import.meta.url);
const reviewCli = mockModule<typeof import('../../../src/interfaces/cli/review.js')>(
  '../../../src/interfaces/cli/review.js', import.meta.url);
await installModuleMocks();
const { createLifecycleCommands } = await import('../../../src/composition/cli-lifecycle-commands.js');
const { ownWorkflowCli } = await import('../../../src/composition/workflow-cli.js');

function fixture(t: TestContext, denyAdmission = false) {
  t.after(() => { mock.restoreAll(); configureMissionWriteAuthorization(null); });
  const requests: BoardCommandRequest[] = [];
  const borrowedGraphs: unknown[] = [];
  let directReviews = 0;
  let admissionsClosed = 0;
  const mission = fixtureMission('task-nested', { status: 'review', checkpoints: [] });
  const graph = {
    mission: { store: { load: async () => ({ kind: 'found', mission, version: 1 }) } },
    currentWork: NO_CURRENT_WORK_PORT,
    operatorState: { close: async () => { admissionsClosed++; } },
    presentationCapabilities: { commandController: { dispatch: async (request: BoardCommandRequest) => {
      requests.push(request);
      return denyAdmission ? failure('conflict', 'Another workflow owns this mission') : completed({});
    } } },
  } as unknown as ProductionApplicationServices;
  const missionFactory = async () => graph.mission!;
  const scope: CliCommandContext['scope'] = {
    openServices: async () => graph,
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
    directReviews: () => directReviews, admissionsClosed: () => admissionsClosed };
}

test('unowned integration re-review goes through workflow admission (TASK-2762)', async t => {
  const f = fixture(t);
  await f.invoke();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].kind, 'review:submit');
  assert.deepEqual(f.requests[0].invocation?.args, ['task-nested', '--continue']);
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
