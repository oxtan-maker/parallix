import { StructuredFailure, failureReason } from '../../domain/failure-reason.js';
import { createIntegrationRebase } from './rebase.js';
import { integrationRepairCertified, verifyRestartedRepair } from './repair-certification.js';
import { pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { retentionEvidenceMatches } from '../../domain/integration-approval-retention.js';
import { repairCheckpointFailure, repairContractFailure } from '../repair-checkpoint-service.js';
import {
  backlogMirrorOwnership, missionId, type BacklogMirrorOwnership,
} from '../../domain/mission.js';
import type { ReviewRound } from '../../domain/review.js';
import type { IntegrationMissionServices } from '../ports/integration-records.js';
import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';
import type { LiveMissionExecutionContext, MissionExecutionContext } from '../ports/mission-execution-context.js';
import type { IntegrationApprovalEvidencePort } from '../ports/integration-approval-evidence.js';
import { carriedRetentionValidation, retainIntegrationApproval, type RetentionOutcome } from './approval-retention.js';
import { IntegrationStopsForHuman, reviewBeforeIntegration } from './review-before-integration.js';
import type { GateStepRequest, IntegrateSeams } from './gates.js';
import { abortWith, projectBacklogTransition } from './support.js';
import { fixedVerificationNextAction } from '../verification-policy/fixed-next-action.js';

interface RepairExecution {
  slug: string; services: IntegrationMissionServices; ports: IntegrateWorkflowPorts;
  executionContext: LiveMissionExecutionContext;
  verification: Pick<GateStepRequest, 'realAgent' | 'realAgentModel'> & { dryRun?: boolean };
  pending: ReviewRound; worktree: string; evidence: IntegrationApprovalEvidencePort; revision: string; baseline: string;
  mirrorOwnership: BacklogMirrorOwnership;
}

/** Restart verifies the same durable incident; it cannot use generic approval recovery. */
export async function resumePendingIntegrationRepair(slug: string, services: IntegrationMissionServices,
  ports: IntegrateWorkflowPorts, execution: MissionExecutionContext, seams: IntegrateSeams, verification: RepairExecution['verification']): Promise<void> {
  const result = await certifyPendingIntegrationRepair(slug, services, ports, execution, verification);
  if (!result) { return; }
  return finishResumedRepair(result.execution, result.outcome, result.gatesPassed, seams);
}

/** Shared continuation only certifies and assesses; it has no landing or review launch path. */
async function certifyPendingIntegrationRepair(slug: string, services: IntegrationMissionServices,
  ports: IntegrateWorkflowPorts, context: MissionExecutionContext,
  verification: RepairExecution['verification'] = { realAgent: null, realAgentModel: null }) {
  const loaded = await services.store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error('Integration repair mission is unavailable'); }
  const action = fixedVerificationNextAction({ mission: loaded.mission });
  if (action.kind === 'human-handoff' && action.reason === 'recorded-blocker') {
    const diagnostic = repairContractFailure(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria)
      ?? 'Invalid locked contract requires human review.';
    throw new StructuredFailure(diagnostic, failureReason('mission-contract-incomplete', 'verification'));
  }
  const pending = pendingIntegrationApproval(loaded.mission);
  if (!pending) { return null; }
  const failure = repairCheckpointFailure(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria);
  if (failure) { throw new StructuredFailure(failure, failureReason('mission-contract-incomplete', 'verification')); }
  // The repair runs in the mission checkout resolved from Mission identity, and
  // rebases onto the receiving base from that same resolution.
  const worktree = context.missionWorktree;
  if (!worktree) { throw abortWith(ports.landing, 'Integration repair checkout is unavailable.'); }
  const execution = await resolveRepairExecution(slug, services, ports, pending, verification, context, worktree,
    backlogMirrorOwnership(loaded.mission));
  const gatesPassed = await ensureRepairVerification(execution);
  const outcome = await retainIntegrationApproval({ slug, services, evidence: execution.evidence,
    candidate: { revision: execution.revision, baseline: execution.baseline }, worktree, head: () => committedRepairHead(execution) });
  return { execution, outcome, gatesPassed };
}

async function resolveRepairExecution(slug: string, services: IntegrationMissionServices, ports: IntegrateWorkflowPorts,
  pending: ReviewRound, verification: RepairExecution['verification'], context: MissionExecutionContext, worktree: string,
  mirrorOwnership: BacklogMirrorOwnership): Promise<RepairExecution> {
  const evidence = ports.gates.approvalEvidence?.(worktree);
  if (!evidence) { throw abortWith(ports.landing, 'Integration repair evidence is unavailable. Aborting before merge.'); }
  const original = ports.gates.captureFinalIntegrationTree(worktree);
  if (!original.ok || !original.commit) { throw abortWith(ports.landing, 'Commit the integration repair before resuming integration.'); }
  const base = context.baseBranch;
  const baseWorktree = context.baseWorktree;
  const rebase = createIntegrationRebase(ports);
  const target = { baseWorktree, baseBranch: base, git: ports.git.git };
  const prediction = rebase.predictIntegrationRebase(slug, target);
  if (prediction.needed && verification.dryRun) {
    const conflict = prediction.wouldConflict ? ' and would conflict' : '';
    throw abortWith(ports.landing, `Integration repair requires a rebase onto ${base}${conflict}; dry-run did not mutate the mission branch. Run px integrate ${slug} to resume repair and rebase before verification.`);
  }
  if (prediction.needed) {
    await rebase.runIntegrationRebase(slug, {
      ...target,
      executionContext: { ...context, missionWorktree: worktree },
      missionServicesFn: async () => services,
    });
  }
  const tree = ports.gates.captureFinalIntegrationTree(worktree);
  const baseline = ports.git.git(['-C', worktree, 'rev-parse', base]).stdout.trim();
  if (!tree.ok || !tree.commit || !baseline
    || ports.git.git(['-C', worktree, 'merge-base', '--is-ancestor', baseline, tree.commit]).status !== 0) {
    throw abortWith(ports.landing, 'Integration repair baseline is not established; resume rebase before integration.');
  }
  return { slug, services, ports, executionContext: { ...context, missionWorktree: worktree }, verification,
    pending, worktree, evidence, revision: tree.commit, baseline, mirrorOwnership };
}

function committedRepairHead({ ports, worktree }: RepairExecution): string | null {
  const current = ports.gates.captureFinalIntegrationTree(worktree);
  return current.ok ? current.commit ?? null : null;
}

async function ensureRepairVerification(execution: RepairExecution): Promise<boolean> {
  const { slug, evidence, pending, revision, ports, worktree, services, baseline } = execution;
  // Rebase may have changed durable obligations; reload before reusing any gate marker.
  const loaded = await services.store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error('Integration repair mission is unavailable'); }
  const failure = repairCheckpointFailure(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria);
  if (failure) { throw new StructuredFailure(failure, failureReason('mission-contract-incomplete', 'verification')); }
  const needsCertification = !integrationRepairCertified(loaded.mission, worktree);
  const validation = carriedRetentionValidation(evidence, await evidence.validation(slug).catch(() => null), { revision, baseline });
  const assessment = pending.integrationRepairAssessment!;
  if (!needsCertification && retentionEvidenceMatches({ ...assessment, assessedAt: evidence.now(), candidateRevision: revision,
    ...(validation ? { validation } : { validation: undefined }) }, slug, baseline)) { return true; }
  const gates = ports.gates.loadPhaseGates(worktree, 'preIntegration');
  if (!gates.length) { throw abortWith(ports.landing, 'No integration evidence can establish approval retention.'); }
  const passed = await verifyRestartedRepair({ slug, services, worktree, revision, gates, head: () => committedRepairHead(execution),
    run: () => ports.gates.runPhaseGates('integration', { slug, checkoutPath: worktree,
      targetBranch: execution.executionContext.baseBranch, gates,
      realAgent: execution.verification.realAgent, realAgentModel: execution.verification.realAgentModel }) });
  if (committedRepairHead(execution) !== revision) { throw abortWith(ports.landing, 'Integration repair changed during verification.'); }
  await services.operationalHistory?.recordIntegrationValidation({ missionId: slug, sha: revision,
    hooks: gates.map(g => g.key), baseline, ...(!passed ? { failed: true } : {}) });
  return passed;
}

async function finishResumedRepair(execution: RepairExecution, outcome: RetentionOutcome, gatesPassed: boolean, seams: IntegrateSeams): Promise<void> {
  const { slug, ports, worktree, pending, mirrorOwnership, services } = execution;
  if (outcome === 'retained') {
    await projectBacklogTransition(mirrorOwnership, seams.transitionTaskFn, slug, 'ready-for-integration');
    throw new IntegrationStopsForHuman(`Original approval retained for ${slug}; review the PR and run px integrate ${slug} to land.`);
  }
  if (outcome === 'changed') {
    const branch = ports.missionPaths.missionBranchName(slug, worktree);
    const approval = ports.forgejo.getLatestReviewDecision(branch, {});
    const invalidation = await ports.gates.invalidateApproval?.({ slug, branch, approval,
      approvedRevision: pending.decision?.revision ? String(pending.decision.revision) : undefined,
      summary: 'Integration repair changed the approved mission patch; fresh review is required.',
      executionContext: execution.executionContext,
      missionStore: services.store });
    if (invalidation && !invalidation.ok) {
      throw abortWith(ports.landing, `Changed repair could not publish approval withdrawal: ${invalidation.errors.join('; ')}`);
    }
    if (!gatesPassed) { throw abortWith(ports.landing, 'Changed repair withdrew stale approval, but integration verification did not pass.'); }
    return reviewBeforeIntegration(slug, worktree, ports.landing, seams.reReviewFn);
  }
  throw abortWith(ports.landing, 'Integration repair retention is unproven or its decision changed. Aborting before merge.');
}
