// Review repair evidence owns aggregate retained-capture reads before configured reruns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../../../../src/domain/agents.js';
import { changeRevision, currentReviewRound, replaceCurrentRound } from '../../../../src/domain/review.js';
import type { FailureReason } from '../../../../src/domain/failure-reason.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { RepairCheckpointService } from '../../../../src/application/repair-checkpoint-service.js';
import { certifyPendingIntegrationRepair } from '../../../../src/application/integrate/repair-resumption.js';
import type { IntegrationApprovalEvidencePort } from '../../../../src/application/ports/integration-approval-evidence.js';
import {
  RECOVERY_EVIDENCE_VERSION,
  type RecoveryEvidenceRef,
} from '../../../../src/application/recovery-evidence-types.js';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import { approvedReview, fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';

const slug = 'review-repair-evidence-contract';
const commands = ['npm run typecheck', 'npm run test:integration:ci:prebuilt'];
const criteria = ['static analysis passes', 'integration ci passes'];

function recoveryEvidenceRef(command: string, cwd: string, incidentId: string): RecoveryEvidenceRef {
  return {
    version: RECOVERY_EVIDENCE_VERSION,
    incidentId,
    attempt: 1,
    command,
    cwd,
    capturedRevision: 'fixture-revision',
    exitCode: 1,
    signal: null,
    stdoutPath: '/retained/out',
    stderrPath: '/retained/err',
    stdoutBytes: 0,
    stderrBytes: 0,
    captureComplete: true,
    truncatedFrom: null,
    redacted: false,
    capturedAt: '2026-11-16T12:00:00.000Z',
  };
}

async function aggregateReviewScenario() {
  const approved = approvedReview(slug);
  const round = currentReviewRound(approved);
  const review = { ...approved, rounds: replaceCurrentRound(approved, { ...round,
    subject: { ...round.subject, baseline: changeRevision('base') },
    integrationRepairAssessment: {
      assessedAt: '2026-11-16T12:00:00Z', approvedRevision: changeRevision('fixture-revision'),
      candidateRevision: changeRevision('fixture-revision'), failedGate: 'static-analysis', outcome: 'pending' as const,
      repair: { startedAt: '2026-11-16T12:00:00Z', cause: {
        kind: 'integration-gate-failure' as const, gate: 'static-analysis', command: commands[0],
      } },
    },
  }) };
  const base = fixtureMission(slug);
  const template = base.checkpoints[0];
  const mission = fixtureMission(slug, {
    status: 'review', reviewPreparationPending: true, assignee: agentFamily('codex'), review,
    declaredGates: commands, successCriteria: criteria,
    checkpoints: commands.map((command, index) => ({
      ...template,
      name: `CP-${index + 1}`,
      recording: { recordedAt: '2026-11-16T12:05:00Z', recordedRound: 1, missionRevision: index + 1 },
      goalCheck: [{ criterion: criteria[index], evidence: 'test/unit/application/review-loop/review-repair-evidence-contract.test.ts', recordedRound: 1 }],
      repair: {
        incidentId: `repair-${index + 1}`, gateKey: index === 0 ? 'static-analysis' : 'integration-ci',
        command, authorizedGates: commands, authorizedCriteria: criteria, attempt: 1,
        evidenceRecorded: true, verified: false,
        occurrence: {
          openedMissionRevision: 1, worktree: '/fixture', failureRevision: 'fixture-revision',
          failureEvidenceId: `original:${index + 1}`,
        },
      },
    })),
  });
  const store = inMemoryTransitionStore(mission);
  const lifecycle = new MissionLifecycleService(store);
  const fake = fakeReviewLoopPorts({
    slug, worktree: '/fixture', missionStore: store, lifecycle,
    preReview: { head: () => 'repaired-revision', reviewBaseline: () => 'base' },
    reviewPreparation: { reviewPreparation: async () => assert.fail('retained approval must stop before review preparation') },
  });
  const worktree = fake.ports.worktree;
  const gates = commands.map((command, index) => ({
    key: index === 0 ? 'static-analysis' : 'integration-ci', command, order: index + 1,
  }));
  let validation: Awaited<ReturnType<IntegrationApprovalEvidencePort['validation']>> = null;
  let configuredReruns = 0;
  const evidence: IntegrationApprovalEvidencePort = {
    now: () => '2026-11-16T12:30:00Z',
    reconcileHumanFeedback: async () => true,
    samePatch: async () => true,
    validation: async () => validation,
  };
  const services = integrationServices({ store, lifecycle, operationalHistory: {
    loadLatestByTypeForMission: async () => null,
    recordIntegrationValidation: async input => {
      validation = { ...input, baseline: input.baseline ?? null,
        createdAt: '2026-11-16T12:20:00Z', reference: 'operational_history:aggregate' };
    },
  } });
  const integration = stubIntegrateWorkflowPorts({
    process: { cwd: () => worktree },
    missionPaths: {
      resolveWorktree: () => worktree, resolveMissionBaseBranch: () => 'main',
      resolveBaseWorktree: () => worktree, missionBranchName: () => `mission/${slug}`,
    },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    gates: {
      approvalEvidence: () => evidence,
      captureFinalIntegrationTree: () => ({ ok: true, commit: 'repaired-revision' }),
      loadPhaseGates: () => gates,
      runPhaseGates: async () => {
        configuredReruns += 1;
        return { ok: true, phase: 'integration', gates, executed: gates.length, skipped: false,
          dryRun: false, failedGate: null, failures: [],
          outcomes: gates.map(gate => ({ ...gate, exitCode: 0, stdout: '', stderr: '' })), error: null };
      },
    },
  });
  const reads: string[] = [];
  Object.assign(fake.ports, { retainedRepair: {
    read: async (command: string) => {
      reads.push(command);
      return { evidence: recoveryEvidenceRef(command, worktree, `original:${reads.length}`), stdout: 'failed', stderr: '' };
    },
    verify: async () => assert.fail('aggregate repair uses the configured gate runner'),
    checkpoints: new RepairCheckpointService(store),
  } });
  Object.assign(fake.ports, { integrationRepair: { resume: async () =>
    (await certifyPendingIntegrationRepair(slug, services, integration,
      missionExecutionContext({ missionId: slug, missionWorktree: worktree, baseWorktree: worktree }),
      undefined, fake.ports.retainedRepair))?.outcome ?? 'none' } });
  return { fake, store, reads, configuredReruns: () => configuredReruns };
}

test('direct Review reads every outstanding repair capture before atomic configured certification (PX-0063)', async () => {
  const scenario = await aggregateReviewScenario();
  await runReviewLoop({ slug, isContinue: true }, scenario.fake.ports);
  assert.deepEqual(scenario.reads, commands, 'the parent aggregate path reads no retained captures');
  assert.equal(scenario.configuredReruns(), 1);
  const repairs = scenario.store.mission().checkpoints.map(checkpoint => checkpoint.repair!);
  assert.deepEqual(repairs.map(repair => repair.verified), [true, true]);
  assert.equal(repairs[0].exactSuccessCoverage?.verifiedMissionRevision,
    repairs[1].exactSuccessCoverage?.verifiedMissionRevision);
});

for (const fault of ['missing', 'mismatched'] as const) {
  test(`aggregate Review rejects ${fault} retained evidence before configured certification (PX-0063)`, async () => {
    const scenario = await aggregateReviewScenario();
    const before = structuredClone(scenario.store.mission());
    scenario.fake.ports.retainedRepair!.read = async command => {
      scenario.reads.push(command);
      if (command === commands[1] && fault === 'missing') { throw new Error('capture expired'); }
      const evidence = recoveryEvidenceRef(command, scenario.fake.ports.worktree, `original:${scenario.reads.length}`);
      return { evidence: command === commands[1] && fault === 'mismatched'
        ? { ...evidence, command: commands[0] } : evidence, stdout: 'failed', stderr: '' };
    };
    await assert.rejects(runReviewLoop({ slug, isContinue: true }, scenario.fake.ports), error => {
      assert.equal((error as { failureReason?: FailureReason }).failureReason?.code, 'incomplete-evidence');
      assert.match(String(error), fault === 'missing' ? /evidence is unavailable/ : /evidence is incomplete or mismatched/);
      return true;
    });
    assert.deepEqual(scenario.reads, commands);
    assert.equal(scenario.configuredReruns(), 0);
    assert.deepEqual(scenario.store.mission(), before, 'failed evidence reads certify no checkpoint');
  });
}
