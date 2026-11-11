import { StructuredFailure, failureReason } from '../../domain/failure-reason.js';
import { effectiveRepairObligations } from '../../domain/repair-coverage.js';
import type { RetainedRepairPort } from '../ports/review-round.js';
import { createIntegrationRebase } from './rebase.js';
import { integrationRepairCertified, verifyRestartedRepair } from './repair-certification.js';
import {
  integrationGateWithdrawals, integrationRepairNeedsReview, pendingIntegrationApproval,
} from '../../domain/integration-repair-policy.js';
import { retentionEvidenceMatches } from '../../domain/integration-approval-retention.js';
import { repairCheckpointFailure } from '../repair-checkpoint-service.js';
import {
  backlogMirrorOwnership, missionId, type BacklogMirrorOwnership, type Mission,
} from '../../domain/mission.js';
import type { MissionStore } from '../domain-ports.js';
import { decidedRevisionOf, type ReviewRound } from '../../domain/review.js';
import type { IntegrationMissionServices, IntegrationRepairContinuationPort } from '../ports/integration-records.js';
import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';
import type { MissionExecutionContext } from '../ports/mission-execution-context.js';
import type { IntegrationApprovalEvidencePort } from '../ports/integration-approval-evidence.js';
import { carriedRetentionValidation, retainIntegrationApproval, type RetentionOutcome } from './approval-retention.js';
import { IntegrationStopsForHuman, reviewBeforeIntegration } from './review-before-integration.js';
import type { GateStepRequest, IntegrateSeams } from './gates.js';
import { abortWith, projectBacklogTransition } from './support.js';

/** What review and execute must do next about a pending retained approval. */
export type PendingRepairContinuation =
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'preview'; readonly implementer: Mission['assignee'] }
  | { readonly kind: 'unavailable' | 'retained' | 'blocked' | 'landed'; readonly implementer: Mission['assignee'] }
  /** withdrawnRevision is null when no round recorded a decided revision; callers must not invent one. */
  | { readonly kind: 'review-required'; readonly implementer: Mission['assignee']; readonly withdrawnRevision: string | null };

/**
 * Pending approval retention is settled before any generic repair, preparation
 * or launch. A preview observes without certifying; `none` means authoritative
 * state is no longer pending, so the caller continues exactly as a restart would.
 */
export async function continuePendingIntegrationRepair(slug: string, store: Pick<MissionStore, 'load'>,
  continuation: IntegrationRepairContinuationPort | undefined): Promise<Exclude<PendingRepairContinuation, { kind: 'preview' }>>;
export async function continuePendingIntegrationRepair(slug: string, store: Pick<MissionStore, 'load'>,
  continuation: IntegrationRepairContinuationPort | undefined, mode: 'resume' | 'preview'): Promise<PendingRepairContinuation>;
export async function continuePendingIntegrationRepair(slug: string, store: Pick<MissionStore, 'load'>,
  continuation: IntegrationRepairContinuationPort | undefined, mode: 'resume' | 'preview' = 'resume'): Promise<PendingRepairContinuation> {
  const loaded = await store.load(missionId(slug));
  const pending = loaded.kind === 'found' ? pendingIntegrationApproval(loaded.mission) : null;
  if (loaded.kind !== 'found' || !pending) { return { kind: 'not-pending' }; }
  const implementer = loaded.mission.assignee;
  if (mode === 'preview') { return { kind: 'preview', implementer }; }
  if (!continuation) { return { kind: 'unavailable', implementer }; }
  const outcome = await continuation.resume(slug);
  // The continuation reloads and mutates authoritative state, so the pre-continuation snapshot
  // classifies nothing and supplies no metadata once it returns (PX-0041.02).
  const reloaded = await store.load(missionId(slug));
  return continuationRoute(outcome, reloaded.kind === 'found' ? reloaded.mission : null, pending, reloaded.kind === 'found' ? reloaded.mission.assignee : implementer);
}

type ContinuationOutcome = Awaited<ReturnType<IntegrationRepairContinuationPort['resume']>>;
type SettledRepairRoute = Exclude<PendingRepairContinuation, { kind: 'preview' }>;

/**
 * What the repair became is decided by the post-effect Mission, not by this caller's own outcome.
 * `blocked` names only this caller's failed CAS: a competing controller's durable settlement turns
 * that loss into what actually happened, while a concurrent save that records neither leaves the
 * obligation unproven and fails closed, as TASK-2824 pins.
 */
function continuationRoute(outcome: ContinuationOutcome, after: Mission | null, before: ReviewRound,
  implementer: Mission['assignee']): SettledRepairRoute {
  // Retention revoked the judgment and opened an undecided round for the changed code.
  if (outcome === 'changed') { return { kind: 'review-required', implementer, withdrawnRevision: withdrawnApprovalRevision(after, before) }; }
  if (!after) { return outcome === 'blocked' ? { kind: 'blocked', implementer } : { kind: 'not-pending' }; }
  const settled = settledRepairRoute(after, before, implementer);
  if (outcome === 'none') { return settled; }
  if (outcome === 'blocked') { return competingSettlementRecorded(after) ? settled : { kind: 'blocked', implementer }; }
  // A concurrent landing between the continuation's retention and this reload is authoritative:
  // the repair is already landed, so a second px integrate is not owed (PX-0041.02).
  return settled.kind === 'landed' ? settled : { kind: 'retained', implementer };
}

/**
 * Another controller may have settled the repair while this caller certified, so the post-effect
 * state decides between an idempotent handoff, a fresh review, an unproven obligation or nothing.
 */
function settledRepairRoute(after: Mission | null, before: ReviewRound, implementer: Mission['assignee']): SettledRepairRoute {
  if (!after) { return { kind: 'not-pending' }; }
  if (pendingIntegrationApproval(after)) { return { kind: 'blocked', implementer }; }
  if (integrationRepairNeedsReview(after)) {
    return { kind: 'review-required', implementer, withdrawnRevision: withdrawnApprovalRevision(after, before) };
  }
  // A landed Mission owes nothing: no handoff, no second px integrate, no launch.
  if (after.status === 'done') { return { kind: 'landed', implementer }; }
  // Leaving the repair lane unlanded means retention settled the obligation; that is an idempotent
  // handoff to the operator, never a blocker and never a fresh agent launch.
  return after.status === 'integration' ? { kind: 'retained', implementer } : { kind: 'not-pending' };
}

/**
 * A lost CAS is an idempotent handoff only when the competing controller recorded a durable
 * settlement: it retained the approval, or it revoked that approval for changed repair code and
 * opened the fresh review this caller must now answer. A concurrent save recording neither - a
 * newer independent judgment, a moved branch - leaves the obligation unproven.
 */
function competingSettlementRecorded(mission: Mission): boolean {
  return mission.review?.rounds.at(-1)?.integrationRepairAssessment?.outcome === 'retained' || integrationRepairNeedsReview(mission);
}

/**
 * The post-effect review fact names the withdrawn approval; the pre-continuation round is only a
 * fallback. A legacy withdrawal may legitimately lack a decided revision, and that uncertainty
 * stays null instead of becoming a provider revision the review would dismiss with.
 */
function withdrawnApprovalRevision(after: Mission | null, before: ReviewRound): string | null {
  const withdrawn = after ? integrationGateWithdrawals(after).at(-1) : undefined;
  const revision = decidedRevisionOf(withdrawn) ?? decidedRevisionOf(before);
  return revision === null ? null : String(revision);
}

interface RepairExecution {
  slug: string; services: IntegrationMissionServices; ports: IntegrateWorkflowPorts;
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
export async function certifyPendingIntegrationRepair(slug: string, services: IntegrationMissionServices,
  ports: IntegrateWorkflowPorts, context: MissionExecutionContext,
  verification: RepairExecution['verification'] = { realAgent: null, realAgentModel: null }, exact?: RetainedRepairPort) {
  const loaded = await services.store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error('Integration repair mission is unavailable'); }
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
  if (exact) {
    const obligations = effectiveRepairObligations(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria, worktree);
    const command = obligations.at(-1)?.repair?.command;
    if (command) {
      // Read immutable original diagnostics before running the authorized verifier.
      const retained = await exact.read(command).catch(cause => {
        throw new StructuredFailure('Original repair evidence is unavailable', failureReason('incomplete-evidence', 'verification'), cause);
      });
      if (retained.evidence.command !== command || retained.evidence.cwd !== worktree
        || retained.evidence.exitCode === 0 || !retained.evidence.captureComplete) {
        throw new StructuredFailure('Original repair evidence is incomplete or mismatched', failureReason('incomplete-evidence', 'verification'));
      }
      await verifyRestartedRepair({ slug, services, worktree, revision: execution.revision,
        gates: [{ key: 'repair', command, order: 1 }], head: () => committedRepairHead(execution),
        run: async () => { throw new Error('Exact verification owns this check'); },
        exact: () => exact.verify(command, worktree) });
    }
  }
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
  return { slug, services, ports, verification, pending, worktree, evidence, revision: tree.commit, baseline, mirrorOwnership };
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
    run: () => ports.gates.runPhaseGates('integration', { slug, checkoutPath: worktree, gates,
      realAgent: execution.verification.realAgent, realAgentModel: execution.verification.realAgentModel }) });
  if (committedRepairHead(execution) !== revision) { throw abortWith(ports.landing, 'Integration repair changed during verification.'); }
  await services.operationalHistory?.recordIntegrationValidation({ missionId: slug, sha: revision,
    hooks: gates.map(g => g.key), baseline, ...(!passed ? { failed: true } : {}) });
  return passed;
}

async function finishResumedRepair(execution: RepairExecution, outcome: RetentionOutcome, gatesPassed: boolean, seams: IntegrateSeams): Promise<void> {
  const { slug, ports, worktree, pending, mirrorOwnership } = execution;
  if (outcome === 'retained') {
    await projectBacklogTransition(mirrorOwnership, seams.transitionTaskFn, slug, 'ready-for-integration');
    throw new IntegrationStopsForHuman(`Original approval retained for ${slug}; review the PR and run px integrate ${slug} to land.`);
  }
  if (outcome === 'changed') {
    const branch = ports.missionPaths.missionBranchName(slug, worktree);
    const approval = ports.forgejo.getLatestReviewDecision(branch, {});
    await ports.gates.invalidateApproval?.({ slug, branch, approval,
      approvedRevision: pending.decision?.revision ? String(pending.decision.revision) : undefined,
      summary: 'Integration repair changed the approved mission patch; fresh review is required.' });
    if (!gatesPassed) { throw abortWith(ports.landing, 'Changed repair withdrew stale approval, but integration verification did not pass.'); }
    return reviewBeforeIntegration(slug, worktree, ports.landing, seams.reReviewFn);
  }
  throw abortWith(ports.landing, 'Integration repair retention is unproven or its decision changed. Aborting before merge.');
}
