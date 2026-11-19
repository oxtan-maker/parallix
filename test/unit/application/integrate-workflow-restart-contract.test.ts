import test from 'node:test';
import assert from 'node:assert/strict';

import { createIntegrateWorkflow } from '../../../src/application/integrate-workflow.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { revokeApprovedDecision } from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { approvedReview, fixtureMission } from '../../fixtures/mission-builders.js';
import { missionExecutionContext } from '../../fixtures/mission-execution-context.js';
import { integrationServices } from '../../helpers/stub-integration-services.js';
import { stubIntegrateWorkflowPorts } from '../../helpers/stub-integrate-workflow-ports.js';

const SLUG = 'task-restart';

test('persisted repaired restart without retained gate debt enters one review and stops before gates or landing (TASK-2819, PX-0031)', async () => {
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
      persistLandedIntegrationOrAbort: async () => { calls.landing++; return assert.fail('review handoff must stop before landing'); },
    },
  });
  const exits: number[] = [];

  const result = await createIntegrateWorkflow(ports).integrate([SLUG, '--dry-run'], {
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
