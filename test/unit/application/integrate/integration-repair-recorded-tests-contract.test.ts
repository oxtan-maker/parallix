// Repair certification reads the recorded tests and starts no gate (TASK-2872.02).
// Retention outcomes stay in the repair projection suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId, type Mission } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, startReview } from '../../../../src/domain/review.js';
import { resumePendingIntegrationRepair } from '../../../../src/application/integrate/repair-resumption.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';
import { integrationBounceSeams } from '../../../helpers/integration-bounce-seams.js';
import { recordedGateRun } from '../../../helpers/integrate-git-doubles.js';
import { integrationRetentionScenario } from '../../../helpers/integration-retention-scenario.js';

const REVIEWER = agentFamily('codex');
const IMPLEMENTER = agentFamily('custom');
const SUBJECT = { change: { kind: 'local-branch' as const, sourceBranch: 'mission/task-2620', targetBranch: 'main' }, revision: changeRevision('a1b2c3') };

/** An integration-lane Mission whose provider approval still stands, the state a pending repair certifies from. */
function approvedIntegrationMission(): Mission {
  const started = startReview(SUBJECT, REVIEWER, IMPLEMENTER, '2026-09-20T10:00:00.000Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [REVIEWER], strategy: 'random' }));
  const review = applyReviewerCommand(started, { type: 'approve', revision: SUBJECT.revision, decidedAt: '2026-09-20T11:00:00.000Z',
    comment: 'looks right', source: { kind: 'provider', provider: 'forgejo' } });
  return fixtureMission(String(missionId('task-2620')), { repositoryId: repositoryId('parallix'), title: 'Mission task-2620', labels: [],
    status: 'integration', rawStatus: 'integration', checkpoints: [], brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
    declaredGates: [], successCriteria: [], dependencies: [], predictedNelBucket: 'Small', assignee: IMPLEMENTER, externalTaskRef: null,
    review, netEngineeringLines: null, closedAt: null });
}

function retentionScenario() {
  return integrationRetentionScenario(approvedIntegrationMission(), IMPLEMENTER);
}

test('restart refuses naming tests when no current passing run is recorded and certifies nothing (TASK-2872.02)', async () => {
  const s = retentionScenario();
  s.evidence.validation = async () => null;
  let runs = 0;
  const ports = stubIntegrateWorkflowPorts({
    process: { cwd: () => '/fixture' },
    missionPaths: { resolveWorktree: () => '/fixture', resolveMissionBaseBranch: () => 'main',
      resolveBaseWorktree: () => '/fixture', missionBranchName: () => 'mission/task-2620' },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    landing: { createAbort: message => Object.assign(new Error(message), { name: 'IntegrationAbort' }) },
    gates: { approvalEvidence: () => s.evidence, captureFinalIntegrationTree: () => ({ ok: true, commit: 'candidate' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }],
      // A recorded run for another revision is neither current nor carried onto the candidate.
      readGateRun: () => recordedGateRun([{ key: 'unit', command: 'verify' }], { revision: 'older', current: false }),
      runPhaseGates: async () => { runs++; return { ok: true }; } },
  });
  const seams = { ...integrationBounceSeams({ transitionTaskFn: () => true }),
    routeIntegrationGateFailureFn: async () => { throw new Error('unexpected repair launch'); } };
  await assert.rejects(resumePendingIntegrationRepair('task-2620', s.services, ports, missionExecutionContext({ missionId: 'task-2620' }), seams),
    /no current passing tests are recorded for revision candidate.*px review task-2620/);
  assert.equal(runs, 0, 'a missing receipt is never repaired by starting a gate');
  assert.equal(s.store.mission().status, 'active', 'nothing was certified or retained');
});

test('restart certifies a recorded run carried across the repair rebase, as landing admission does (TASK-2872.02)', async () => {
  const s = retentionScenario();
  let runs = 0;
  const ports = stubIntegrateWorkflowPorts({
    process: { cwd: () => '/fixture' },
    missionPaths: { resolveWorktree: () => '/fixture', resolveMissionBaseBranch: () => 'main',
      resolveBaseWorktree: () => '/fixture', missionBranchName: () => 'mission/task-2620' },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    gates: { approvalEvidence: () => s.evidence, captureFinalIntegrationTree: () => ({ ok: true, commit: 'candidate' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }],
      // After the rebase onto an advanced base the adapter reports the run non-current with completed-rebase lineage.
      readGateRun: () => recordedGateRun([{ key: 'unit', command: 'verify' }],
        { revision: 'pre-rebase', current: false, carried: [{ from: 'pre-rebase', to: 'candidate' }] }),
      runPhaseGates: async () => { runs++; return { ok: true }; } },
  });
  const seams = { ...integrationBounceSeams({ transitionTaskFn: () => true }),
    routeIntegrationGateFailureFn: async () => { throw new Error('unexpected repair launch'); } };
  await assert.rejects(resumePendingIntegrationRepair('task-2620', s.services, ports, missionExecutionContext({ missionId: 'task-2620' }), seams),
    { name: 'IntegrationStopsForHuman' }, 'certified from the carried run, then stops for the human landing');
  assert.equal(runs, 0, 'a carried receipt never starts a gate');
});
