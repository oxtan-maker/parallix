// Behavior-owned suite: the review-preparation port graph records the agent family an
// automatic repair actually launched, against the checkout the invocation resolved,
// so a gate or gatekeeper repair cannot leave a stale Mission implementer (TASK-2850 F1).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks, importFresh } from '../../../../lib/module-mock.js';
import { fixtureMission, pendingReview } from '../../../../fixtures/mission-builders.js';
import { missionExecutionContext } from '../../../../fixtures/mission-execution-context.js';
import { resolveConfiguration } from '../../../../../src/composition/config.js';
import { agentFamily } from '../../../../../src/domain/agents.js';
import { missionVersion } from '../../../../../src/application/domain-ports.js';
import type { MissionTransitionRequest } from '../../../../../src/application/mission-lifecycle-service.js';

const agents = mockModule<typeof import('../../../../../src/adapters/agents/agents.js')>('../../../../../src/adapters/agents/agents.js', import.meta.url);
await installModuleMocks();
const { createReviewPreparationPorts } = await importFresh<typeof import('../../../../../src/adapters/cli/commands/review-preparation.js')>(
  '../../../../../src/adapters/cli/commands/review-preparation.js', import.meta.url);

const SLUG = 'task-2850-launch';

function launchGraph(t: TestContext, executionContext: ReturnType<typeof missionExecutionContext> | undefined) {
  let mission = fixtureMission(SLUG, { status: 'review', assignee: agentFamily('codex'), review: pendingReview(SLUG) });
  let version = missionVersion(1);
  const openedRoots: string[] = [];
  const transitions: MissionTransitionRequest[] = [];
  const store = { load: async () => ({ kind: 'found' as const, mission, version }) };
  const lifecycle = {
    transition: async (request: MissionTransitionRequest) => {
      transitions.push(request);
      if (request.command.type === 'record-implementer') {
        mission = { ...mission, assignee: request.command.agent };
        version = missionVersion(Number(version) + 1);
      }
      return { status: 'completed' as const, durableEvidence: [] };
    },
  };
  const missionServices = async (root: string) => {
    openedRoots.push(root);
    return {
      store, lifecycle,
      checkpoints: { record: async () => { throw new Error('Unexpected checkpoint recording during launch identity capture'); } },
      nel: { recordNel: async () => { throw new Error('Unexpected NEL recording during launch identity capture'); } },
    };
  };
  t.mock.method(agents, 'startAgent', async (_step: string, options: { onLaunch?: (event: { agent: string }) => unknown }) => {
    await options.onLaunch?.({ agent: 'qwen' });
    return { agent: 'qwen', result: { status: 0 } };
  });
  const ports = createReviewPreparationPorts(resolveConfiguration({}), missionServices, executionContext);
  return { ports, openedRoots, transitions };
}

test('review preparation records the family an automatic repair actually launched in the resolved checkout (TASK-2850 F1)', async t => {
  const { ports, openedRoots, transitions } = launchGraph(t,
    missionExecutionContext({ missionId: SLUG, missionWorktree: '/work/mission-checkout', baseWorktree: '/work/base' }));
  await ports.agents.startAgent('implementer', { prompt: 'repair the failed gate', slug: SLUG, worktree: '/work/mission-checkout' });
  assert.deepEqual(openedRoots, ['/work/mission-checkout'], 'launch recording opens Mission services for the resolved checkout, not the process checkout');
  assert.equal(transitions.length, 1, 'the launch is recorded once through the existing lifecycle authority');
  assert.equal(transitions[0].command.type, 'record-implementer');
  assert.equal(transitions[0].command.agent, agentFamily('qwen'), 'the actually launched family becomes the recorded implementer');
});
