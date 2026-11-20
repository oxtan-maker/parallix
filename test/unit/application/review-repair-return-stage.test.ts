import { agentFamily } from '../../../src/domain/agents.js';
import { DECLARED_GATES_RETURN_STAGE } from '../../../src/domain/board-event.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { fixtureMission, inMemoryTransitionStore, pendingReview, type InMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { gateFailureReason } from '../../../src/adapters/review/review-gate-handling.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import { repairPreReviewFailure } from '../../../src/application/review-loop/pre-review.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
import { submitForReview } from '../../../src/adapters/review/review-commands.js';
import { recordReviewPreparationFailure } from '../../../src/application/review-submission-service.js';
import { missionExecutionContext } from '../../fixtures/mission-execution-context.js';

// A declared-gate rebound is not an agent-review return. Each
// repair producer names the lane its return leaves, and the repair owner places
// that stage on the durable lane event instead of defaulting every producer.
describe('review repair return stage', { concurrency: false }, () => {
  function gateRepairMission(slug: string): InMemoryTransitionStore {
    return inMemoryTransitionStore(fixtureMission(slug, {
      status: 'review', assignee: agentFamily('codex'), review: pendingReview(slug),
    }));
  }
  /** Each committed lane event with the return stage the producer placed on it. */
  function placedReturns(store: InMemoryTransitionStore) {
    return store.events.map(event => [`${event.from}→${event.to}:${event.trigger}`, event.returnIdentity?.stage ?? null]);
  }

  test('pre-review gate repair places its return at declared-gates (PX-0055.01)', async () => {
    const slug = 'task-0055-pre-review';
    const store = gateRepairMission(slug);
    const fake = fakeReviewLoopPorts({ slug, missionStore: store, lifecycle: new MissionLifecycleService(store) });
    const context = fakeLoopContext(fake, { slug, identities: { implementer: agentFamily('codex'), reviewer: agentFamily('claude') } });
    const repair = await repairPreReviewFailure(context,
      gateFailureReason({ ok: false, area: 'test', command: 'npm test', exitCode: 1, stdout: '', stderr: 'assertion failed' }), 1);
    assert.equal(repair.outcome, 'fixed');
    assert.deepEqual(placedReturns(store), [
      ['review→active:rebound-to-active', 'declared-gates'],
      ['active→review:submit-for-review', null],
    ], 'the verified repair resumes review without claiming a return');
  });

  test('review-loop validation-failed bounce places its return at declared-gates (PX-0055.01)', async () => {
    const slug = 'task-0055-validation';
    const store = gateRepairMission(slug);
    const fake = fakeReviewLoopPorts({
      slug, missionStore: store, lifecycle: new MissionLifecycleService(store),
      reviewPreparation: { reviewPreparation: async () => ({
        ok: false as const, reason: 'validation-failed' as const,
        error: 'Gate declaration must contain an exact runnable command only',
      }) },
    });
    await runReviewLoop({ slug, implementer: 'codex', reviewer: 'claude' }, fake.ports);
    assert.deepEqual(placedReturns(store), [['review→active:rebound-to-active', 'declared-gates']]);
  });

  test('px review submit gate failure places its send-back return at declared-gates (PX-0055.01)', async () => {
    const slug = 'task-0055-submit';
    const store = gateRepairMission(slug);
    await submitForReview(slug, false, {
      executionContext: missionExecutionContext({ missionId: slug, missionWorktree: '/worktree' }),
      readReviewStateFn: () => null,
      resolveTaskFileFn: () => ({ ok: true as const, taskFile: '/worktree/task.md', matches: [] }),
      getTaskImplementerFn: () => 'codex',
      isReviewProviderEnabledFn: () => false,
      missionStore: store, lifecycleService: new MissionLifecycleService(store),
      transitionTaskFn: async () => true,
      performReviewPreparationFn: async () => ({
        ok: false as const, reason: 'validation-failed' as const,
        error: 'Gate declaration must contain an exact runnable command only',
      }),
      exit: () => undefined,
    });
    assert.deepEqual(placedReturns(store), [['review→active:rebound-to-active', 'declared-gates']]);
  });

  test('review preparation send-back places its return at declared-gates (PX-0055.01)', async () => {
    const slug = 'task-0055-send-back';
    const store = gateRepairMission(slug);
    await recordReviewPreparationFailure(slug, 'Declared gate "npm test" failed', {
      store, lifecycle: new MissionLifecycleService(store),
      checkpoints: { record: async () => assert.fail('the gate incident owns its checkpoint'),
        plan: async () => assert.fail('a declared-gate failure has its own repair owner') },
    }, { kind: 'gate-failure', area: 'declared gate', command: 'npm test', exitCode: 1, stdout: '', stderr: 'test failed' }, DECLARED_GATES_RETURN_STAGE);
    assert.deepEqual(placedReturns(store), [['review→active:rebound-to-active', 'declared-gates']]);
  });
});
