// Behavior-owned suite: lifecycle recovery binds the resolved Mission checkout only where a
// review-preparation mutation actually replays, and a closeout that already removed that
// checkout keeps recovering an already-decided lane (TASK-2850 F2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureMission, approvedReview, pendingReview } from '../../../fixtures/mission-builders.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { setLogger } from '../../../../src/application/presentation/cli-format.js';
import { createMissionRecovery } from '../../../../src/application/integrate/recovery.js';
import { recoverLandedIntegration } from '../../../../src/application/integrate/landed-recovery.js';

const NO_CHECKOUT = { ok: false as const, reason: 'the mission checkout is unavailable after landing' };

test('TASK-2850: recovery replays review preparation only with the resolved mission checkout', async () => {
  const slug = 'task-2850-replay';
  const mission = fixtureMission(slug, { status: 'active', review: pendingReview(slug) });
  const services = integrationServices({ store: { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }) } });
  const diagnostics: string[] = [];
  const previousLogger = setLogger({ log: (message: unknown) => { diagnostics.push(String(message)); }, error: (message: unknown) => { diagnostics.push(String(message)); } });
  let submitCalls = 0;
  try {
    const recovery = createMissionRecovery(stubIntegrateWorkflowPorts({ landing: { createAbort: () => new Error('IntegrationAbort') } }));
    await assert.rejects(
      recovery.recoverMissionForIntegration(
        { slug, approval: { ok: false as const, error: 'forgejo-off', reviewState: null }, missionStatus: undefined },
        { missionServices: services, submitForReviewFn: async () => { submitCalls += 1; } },
      ),
      /IntegrationAbort/,
      'recovery aborts instead of guessing a checkout',
    );
  } finally {
    setLogger(previousLogger);
  }
  assert.equal(submitCalls, 0, 'review preparation never runs without the resolved checkout');
  assert.ok(
    diagnostics.some(message => message.includes('the resolved mission execution context is unavailable')),
    'the abort names the missing execution context as the reason',
  );
});

test('TASK-2850: recovery replays review preparation with the resolved checkout it was given', async () => {
  const slug = 'task-2850-replay-live';
  const mission = fixtureMission(slug, { status: 'active', review: pendingReview(slug) });
  const services = integrationServices({ store: { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }) } });
  const previousLogger = setLogger({ log: () => {}, error: () => {} });
  const submitted: Array<{ worktree: string }> = [];
  try {
    const recovery = createMissionRecovery(stubIntegrateWorkflowPorts({ landing: { createAbort: () => new Error('IntegrationAbort') } }));
    await assert.rejects(
      recovery.recoverMissionForIntegration(
        {
          slug,
          approval: { ok: false as const, error: 'forgejo-off', reviewState: null },
          missionStatus: undefined,
          executionContext: missionExecutionContext({ missionId: slug, missionWorktree: '/work/mission-checkout' }),
        },
        {
          missionServices: services,
          submitForReviewFn: async (_slug, _isContinue, options) => {
            submitted.push({ worktree: options.executionContext.missionWorktree });
            throw new Error('submit stopped after the handoff');
          },
        },
      ),
      /submit stopped after the handoff/,
    );
  } finally {
    setLogger(previousLogger);
  }
  assert.deepEqual(submitted, [{ worktree: '/work/mission-checkout' }], 'the replay receives the resolved checkout, never a fallback');
});

test('TASK-2850: landed closeout still closes a decided lane whose checkout was already cleaned', async () => {
  const slug = 'task-2850-cleaned-lane';
  const mission = fixtureMission(slug, { status: 'review', review: approvedReview(slug) });
  const mutations: string[] = [];
  const recoveredContexts: Array<{ executionContext?: { missionWorktree: string | null } }> = [];
  await recoverLandedIntegration(slug, integrationServices({ store: { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }) } }), '.', {
    liveExecutionContext: NO_CHECKOUT,
    findSquashCommit: () => 'abc123',
    recoverMissionForIntegration: async context => { recoveredContexts.push(context); return { status: 'integration' }; },
    persistLandedIntegrationOrAbort: async () => { mutations.push('persist'); },
    recordPostIntegrationStatsOrAbort: async () => { mutations.push('stats'); },
    closeLandedIntegrationOrAbort: async () => { mutations.push('close'); },
    cleanupMissionWorktree: () => { mutations.push('cleanup'); return true; },
    runPostIntegrateHookOrAbort: () => { mutations.push('hook'); },
    updateGraphifyRepository: async () => { mutations.push('graphify'); },
    createAbort: () => new Error('IntegrationAbort'),
    baseBranch: 'main',
  });
  assert.deepEqual(mutations, ['persist', 'stats', 'hook', 'graphify', 'cleanup', 'close'], 'the decided lane reaches the full authoritative closeout');
  assert.equal(recoveredContexts.length, 1, 'the decided lane is recovered once');
  assert.equal(recoveredContexts[0].executionContext, undefined, 'a decided lane is recovered without any checkout mutation authority');
});
