import { StructuredFailure, failureReason } from '../../domain/failure-reason.js';
import { createIntegrationRebase } from './rebase.js';
import { integrationRepairCertified, verifyRestartedRepair } from './repair-certification.js';
import { currentIntegrationRepair, pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { retentionEvidenceMatches } from '../../domain/integration-approval-retention.js';
import { repairCheckpointFailure, repairContractFailure } from '../repair-checkpoint-service.js';
import {
  backlogMirrorOwnership, missionId, type BacklogMirrorOwnership,
} from '../../domain/mission.js';
import type { MissionLoadResult } from '../domain-ports.js';
import type { ReviewRound } from '../../domain/review.js';
import type { IntegrationGateDefinition, IntegrationMissionServices } from '../ports/integration-records.js';
import type { IntegrateWorkflowPorts, IntegrationGateRunResult } from '../ports/integrate-workflow.js';
import { completeCurrentTestsPass } from './tests-action.js';
import type { LiveMissionExecutionContext, MissionExecutionContext } from '../ports/mission-execution-context.js';
import type { IntegrationApprovalEvidencePort } from '../ports/integration-approval-evidence.js';
import { carriedRetentionValidation, retainIntegrationApproval, type RetentionOutcome } from './approval-retention.js';
import { IntegrationStopsForHuman, reviewBeforeIntegration } from './review-before-integration.js';
import type { IntegrateSeams } from './gates.js';
import { abortWith, projectBacklogTransition } from './support.js';
import { fixedVerificationNextAction } from '../verification-policy/fixed-next-action.js';

interface RepairExecution {
  slug: string; services: IntegrationMissionServices; ports: IntegrateWorkflowPorts;
  executionContext: LiveMissionExecutionContext;
  pending: ReviewRound; worktree: string; evidence: IntegrationApprovalEvidencePort; revision: string; baseline: string;
  mirrorOwnership: BacklogMirrorOwnership;
}

/** What a shared certification answers: nothing pending, the tests action's receipt is owed, or a retention verdict. */
type IntegrationRepairCertification =
  | { readonly kind: 'tests-required'; readonly execution: RepairExecution }
  | { readonly kind: 'assessed'; readonly execution: RepairExecution; readonly outcome: RetentionOutcome; readonly gatesPassed: boolean };

/** Restart verifies the same durable incident; it cannot use generic approval recovery. */
export async function resumePendingIntegrationRepair(slug: string, services: IntegrationMissionServices,
  ports: IntegrateWorkflowPorts, execution: MissionExecutionContext, seams: IntegrateSeams): Promise<void> {
  const result = await certifyPendingIntegrationRepair(slug, services, ports, execution);
  if (!result) { return; }
  // Integration owns no gate execution, so a repair still waiting on the tests action's
  // recorded run stops here naming the receipt; review and active route it to that action.
  if (result.kind === 'tests-required') {
    throw abortWith(ports.landing, `Integration repair for ${slug} cannot be certified: no current passing tests are recorded for revision ${result.execution.revision}; px integrate never runs them. Run px review ${slug} so the tests action records them, then retry.`);
  }
  return finishResumedRepair(result.execution, result.outcome, result.gatesPassed, seams);
}

/** Integrate previews pending repair without writes; a real entry certifies it from recorded tests. */
export async function resumeOrPreviewPendingIntegrationRepair(slug: string, existing: MissionLoadResult,
  services: IntegrationMissionServices, ports: IntegrateWorkflowPorts, execution: MissionExecutionContext,
  seams: IntegrateSeams, dryRun: boolean): Promise<MissionLoadResult> {
  if (dryRun) {
    // A preview reports readiness only: it neither certifies a retained approval nor runs the
    // review a review-required repair would otherwise enter here.
    const repair = existing.kind === 'found' ? currentIntegrationRepair(existing.mission) : null;
    if (repair) {
      throw abortWith(ports.landing, `Mission ${slug} has an integration repair pending; --dry-run does not resume it. Run px integrate ${slug} to certify it from the recorded tests.`);
    }
    return existing;
  }
  await resumePendingIntegrationRepair(slug, services, ports, execution, seams);
  return services.store.load(missionId(slug));
}

/** Shared continuation only certifies and assesses; it has no landing or review launch path. */
async function certifyPendingIntegrationRepair(slug: string, services: IntegrationMissionServices,
  ports: IntegrateWorkflowPorts, context: MissionExecutionContext): Promise<IntegrationRepairCertification | null> {
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
  const execution = await resolveRepairExecution(slug, services, ports, pending, context, worktree,
    backlogMirrorOwnership(loaded.mission));
  const verification = await ensureRepairVerification(execution);
  if (verification === 'tests-required') { return { kind: 'tests-required', execution }; }
  const outcome = await retainIntegrationApproval({ slug, services, evidence: execution.evidence,
    candidate: { revision: execution.revision, baseline: execution.baseline }, worktree, head: () => committedRepairHead(execution) });
  return { kind: 'assessed', execution, outcome, gatesPassed: verification };
}

async function resolveRepairExecution(slug: string, services: IntegrationMissionServices, ports: IntegrateWorkflowPorts,
  pending: ReviewRound, context: MissionExecutionContext, worktree: string,
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
  return { slug, services, ports, executionContext: { ...context, missionWorktree: worktree },
    pending, worktree, evidence, revision: tree.commit, baseline, mirrorOwnership };
}

function committedRepairHead({ ports, worktree }: RepairExecution): string | null {
  const current = ports.gates.captureFinalIntegrationTree(worktree);
  return current.ok ? current.commit ?? null : null;
}

/**
 * The recorded passing run for the candidate, shaped as the phase result certification consumes.
 * It applies the same equivalent-input policy as landing admission, so a run carried across a
 * completed rebase certifies the repair instead of stranding it (TASK-2872.02).
 */
function recordedTestsRun(ports: IntegrateWorkflowPorts, worktree: string, revision: string,
  gates: readonly IntegrationGateDefinition[]): IntegrationGateRunResult | null {
  let run: ReturnType<NonNullable<IntegrateWorkflowPorts['gates']['readGateRun']>> = null;
  try { run = ports.gates.readGateRun?.(worktree) ?? null; } catch { return null; }
  if (!completeCurrentTestsPass(run, revision, gates, 'equivalent')) { return null; }
  return { ok: true, phase: 'integration', executed: gates.length,
    outcomes: run.outcomes.map(outcome => ({ key: outcome.key, command: outcome.command, exitCode: outcome.exitCode, stdout: '', stderr: '' })) };
}

async function ensureRepairVerification(execution: RepairExecution): Promise<boolean | 'tests-required'> {
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
  // Repair certification never starts a gate: the tests action owns execution, so the
  // recorded run for this exact revision is the only evidence the certification reads.
  const recorded = recordedTestsRun(ports, worktree, revision, gates);
  if (!recorded) { return 'tests-required'; }
  const passed = await verifyRestartedRepair({ slug, services, worktree, revision, gates, head: () => committedRepairHead(execution),
    run: async () => recorded });
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
