import test from 'node:test';
import assert from 'node:assert/strict';

import { createIntegrateWorkflow } from '../../../src/application/integrate-workflow.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { revokeApprovedDecision } from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { approvedReview, fixtureMission } from '../../fixtures/mission-builders.js';
import { missionExecutionContext } from '../../fixtures/mission-execution-context.js';
import { integrationServices } from '../../helpers/stub-integration-services.js';
import { integrationRetentionScenario } from '../../helpers/integration-retention-scenario.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { stubIntegrateWorkflowPorts } from '../../helpers/stub-integrate-workflow-ports.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';

const SLUG = 'task-restart';

/** A persisted repair whose review is owed: the approval was withdrawn by a failed integration gate. */
function restartFixture() {
  const review = revokeApprovedDecision(approvedReview(SLUG), 1, {
    revokedAt: '2026-10-25T10:00:00Z',
    revokedBy: 'workflow',
    reason: 'Gate failed before interruption',
    cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: 'Restart regression' },
  });
  const mission = fixtureMission(SLUG, {
    status: 'active', rawStatus: 'active', assignee: agentFamily('codex'), checkpoints: [], review,
  });
  const services = integrationServices({
    store: { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }) },
  });
  const calls = { repair: 0, review: 0, gates: 0, landing: 0, released: 0 };
  const ports = stubIntegrateWorkflowPorts({
    process: {
      cwd: () => '/fixture/main',
      claimIntegration: async () => async () => { calls.released++; },
    },
    missionContext: {
      resolve: () => ({ ok: true as const, context: missionExecutionContext({
        missionId: SLUG, missionWorktree: `/fixture/${SLUG}`, baseWorktree: '/fixture/main',
      }) }),
    },
    missionPaths: { inferSlug: explicit => explicit ?? null },
    gates: {
      routeIntegrationGateFailure: async () => { calls.repair++; return assert.fail('restart must not launch another repair'); },
      runPhaseGates: async () => { calls.gates++; return assert.fail('review handoff must stop before gates'); },
    },
    landing: {
      createAbort: (message: string) => Object.assign(new Error(message), { name: 'IntegrationAbort' }),
      isAbort: (error: unknown) => error instanceof Error && error.name === 'IntegrationAbort',
      persistLandedIntegrationOrAbort: async () => { calls.landing++; return assert.fail('review handoff must stop before landing'); },
    },
  });
  return { calls, ports, services };
}

test('persisted repaired restart without retained gate debt enters one review and stops before gates or landing (TASK-2819, PX-0031)', async () => {
  const { calls, ports, services } = restartFixture();
  const exits: number[] = [];

  const result = await createIntegrateWorkflow(ports).integrate([SLUG], {
    missionServicesFn: async () => services,
    reReviewFn: async (slug, worktree) => {
      calls.review++;
      assert.equal(slug, SLUG);
      assert.equal(worktree, `/fixture/${SLUG}`);
      return true;
    },
    exitFn: code => { exits.push(code); },
  });

  assert.deepEqual(result, { exitCode: 0 });
  assert.deepEqual(exits, [0]);
  assert.deepEqual(calls, { repair: 0, review: 1, gates: 0, landing: 0, released: 1 });
});

test('integrate --dry-run reports an approval-retention repair without certifying it or starting a gate (TASK-2872.02 SC4)', async () => {
  // The other repair kind: the original approval still stands and only waits on certification.
  const scenario = integrationRetentionScenario(
    fixtureMission(SLUG, { status: 'integration', assignee: agentFamily('codex'), checkpoints: [], review: approvedReview(SLUG) }),
    agentFamily('codex'));
  const calls = { review: 0, gates: 0, landing: 0, released: 0 };
  const ports = stubIntegrateWorkflowPorts({
    process: { cwd: () => '/fixture/main', claimIntegration: async () => async () => { calls.released++; } },
    missionContext: { resolve: () => ({ ok: true as const, context: missionExecutionContext({
      missionId: SLUG, missionWorktree: `/fixture/${SLUG}`, baseWorktree: '/fixture/main' }) }) },
    missionPaths: { inferSlug: explicit => explicit ?? null },
    gates: {
      loadPhaseGates: () => [{ key: 'unit', command: 'npm test', order: 1 }],
      runPhaseGates: async () => { calls.gates++; return assert.fail('--dry-run must not start an integration gate'); },
      captureFinalIntegrationTree: () => ({ ok: true as const, commit: 'candidate' }),
    },
    landing: {
      createAbort: (message: string) => Object.assign(new Error(message), { name: 'IntegrationAbort' }),
      isAbort: (error: unknown) => error instanceof Error && error.name === 'IntegrationAbort',
      persistLandedIntegrationOrAbort: async () => { calls.landing++; return assert.fail('--dry-run must not land'); },
    },
  });
  const logs: string[] = [];
  const previousLogger = setLogger({ log: line => { logs.push(String(line)); }, error: line => { logs.push(String(line)); } });
  try {
    const result = await createIntegrateWorkflow(ports).integrate([SLUG, '--dry-run'], {
      missionServicesFn: async () => integrationServices({ store: scenario.store, lifecycle: new MissionLifecycleService(scenario.store) }),
      reReviewFn: async () => { calls.review++; return true; },
      exitFn: () => {},
    });
    assert.match(logs.join('\n'), /has an integration repair pending; --dry-run does not resume it/);
    assert.deepEqual(calls, { review: 0, gates: 0, landing: 0, released: 1 }, 'a preview certifies nothing and writes nothing');
    assert.ok(result);
    assert.notEqual(result.exitCode, 0);
  } finally {
    setLogger(previousLogger);
  }
});

test('integrate --dry-run reports a pending review-required repair without entering its review or a gate (TASK-2872.02 SC4)', async () => {
  const { calls, ports, services } = restartFixture();
  const logs: string[] = [];
  const previousLogger = setLogger({ log: line => { logs.push(String(line)); }, error: line => { logs.push(String(line)); } });
  try {
    const exits: number[] = [];
    const result = await createIntegrateWorkflow(ports).integrate([SLUG, '--dry-run'], {
      missionServicesFn: async () => services,
      reReviewFn: async () => { calls.review++; return true; },
      exitFn: code => { exits.push(code); },
    });
    assert.match(logs.join('\n'), /has an integration repair pending; --dry-run does not resume it/);
    assert.deepEqual(calls, { repair: 0, review: 0, gates: 0, landing: 0, released: 1 },
      'a preview enters no review, starts no gate and lands nothing');
    assert.ok(result);
    assert.notEqual(result.exitCode, 0, 'a repair a preview cannot certify is reported as not ready');
    assert.deepEqual(exits, [result.exitCode]);
  } finally {
    setLogger(previousLogger);
  }
});
