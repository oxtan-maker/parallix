import assert from 'node:assert/strict';
import test from 'node:test';
import { mockModule, installModuleMocks, importFresh } from '../../lib/module-mock.js';
import { DEFAULT_CONFIGURATION } from '../../../src/application/ports/configuration.js';
import * as fmt from '../../../src/application/presentation/cli-format.js';
import type { VerificationActionPolicyFactory } from '../../../src/application/ports/verification-policy.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';

const workflow = mockModule<typeof import('../../../src/application/integrate-workflow.js')>(
  '../../../src/application/integrate-workflow.js', import.meta.url);
const observation = mockModule<typeof import('../../../src/composition/review-start-observation.js')>(
  '../../../src/composition/review-start-observation.js', import.meta.url);
await installModuleMocks();

type IntegrateOptions = import('../../../src/application/integrate-workflow.js').IntegrateOptions;
let runTests: (slug: string, options: IntegrateOptions) => Promise<unknown>;
workflow.createIntegrateWorkflow = ((() => new Proxy({}, {
  get: (_target, property) => {
    if (property === 'VARIANT_B_AUTOMATION_SUMMARY') { return 'fixture summary'; }
    if (property === 'runReviewStepTests') { return runTests; }
    return () => undefined;
  },
})) as unknown) as typeof workflow.createIntegrateWorkflow;

const { runReviewStepTestsForSlug } = await importFresh<typeof import('../../../src/composition/review-step-tests.js')>(
  '../../../src/composition/review-step-tests.js', import.meta.url);

test('the human-turn composition supplies policy services and reports a reused passing tests action (TASK-2859.17)', async t => {
  const store = {};
  const history = {};
  const lifecycle = {};
  const policy = (() => ({} as ReturnType<VerificationActionPolicyFactory>)) satisfies VerificationActionPolicyFactory;
  const services = {
    mission: { store, operationalHistory: history, repositoryId: 'repository-1' },
    operatorState: { db: {}, repositories: { boardLaneEvents: lifecycle } },
  } as unknown as ProductionApplicationServices;
  observation.createTestsActionPolicyFactory = ((configuration, supplied) => {
    assert.equal(configuration, DEFAULT_CONFIGURATION);
    assert.deepEqual(supplied, { db: services.operatorState.db, store, history, lifecycle,
      repositoryId: 'repository-1' });
    return policy;
  }) as typeof observation.createTestsActionPolicyFactory;
  runTests = async (slug, options) => {
    assert.equal(slug, 'task-2859.17');
    assert.equal(options.configuration, DEFAULT_CONFIGURATION);
    assert.equal(options.executionRoot, '/fixture/operator');
    assert.equal(options.missionServicesFn, missionServicesFn);
    assert.equal(options.verificationActionPolicy, policy);
    return { kind: 'completed', verdict: 'passed', recorded: true, evidence: {}, repairRoute: null, next: null };
  };
  const messages: string[] = [];
  t.mock.method(fmt.log, 'info', (message: string) => { messages.push(message); });
  const missionServicesFn = async () => ({}) as never;

  await runReviewStepTestsForSlug('task-2859.17', DEFAULT_CONFIGURATION, '/fixture/operator', missionServicesFn, services);
  assert.deepEqual(messages, ['[review] Integration tests passed for task-2859.17 (current run reused).']);
});

test('the human-turn composition omits unavailable policy services and reports a typed handoff (TASK-2859.17)', async t => {
  const services = { mission: null, operatorState: { db: null, repositories: null } } as unknown as ProductionApplicationServices;
  observation.createTestsActionPolicyFactory = (() => assert.fail('incomplete services must not create a policy')) as typeof observation.createTestsActionPolicyFactory;
  runTests = async (_slug, options) => {
    assert.equal(options.verificationActionPolicy, undefined);
    return { kind: 'human-handoff', reason: 'gate-evidence-unavailable', detail: 'receipt missing' };
  };
  const messages: string[] = [];
  t.mock.method(fmt.log, 'warn', (message: string) => { messages.push(message); });

  await runReviewStepTestsForSlug('task-2859.17', DEFAULT_CONFIGURATION, '/fixture/operator', async () => ({}) as never, services);
  assert.deepEqual(messages, [
    '[review] Integration tests for task-2859.17 need a human: gate-evidence-unavailable — receipt missing',
  ]);
});
