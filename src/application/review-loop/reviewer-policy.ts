/**
 * The serialized runner's reviewer requirement for one exact revision.
 *
 * The round records which independent reviewers were selected, how many were
 * actually available and how many approvals are required (two, one, or the
 * same-agent fallback).  The runner launches the selected reviewers one after
 * another; only the Review authority decides when the requirement is met.
 */
import { AgentSelectionPolicyError, agentFamily } from '../../domain/agents.js';
import { changeRevision } from '../../domain/review.js';
import { planReviewerPolicy, type ReviewerAvailabilityProbe, type ReviewerPolicy } from '../../domain/reviewer-policy.js';
import { recognizedFailureReason } from '../../domain/failure-reason.js';
import type { ReviewerProgress, ReviewerRoutingPort, ReviewStatePort, ReviewLoopState } from '../ports/review-round.js';
import type { LoopContext, ReviewRound } from './round.js';

/** Runtime blocks and unavailable launchers are evidence; busy capacity is not. */
export async function routingProbe(routing: ReviewerRoutingPort, selected: readonly string[] = []): Promise<ReviewerAvailabilityProbe> {
  const eligible = routing.eligibleFamilies();
  const families = [...new Set([...eligible, ...selected])];
  const blocked = new Set((await Promise.all(families.map(async family =>
    await routing.isBlocked?.(family) ? family : null))).filter((family): family is string => family !== null));
  return {
    eligible: () => eligible,
    nominate: excluded => {
      try {
        const nominee = routing.nominate(new Set([...excluded, ...blocked]));
        return excluded.has(nominee) ? null : nominee;
      } catch (error) {
        if (error instanceof AgentSelectionPolicyError) { throw error; }
        return null;
      }
    },
    runnable: family => blocked.has(family)
      ? { supported: false, detail: `${family} is currently blocked by the block authority` }
      : routing.launcherStatus(family),
  };
}

/** Make `family` the running reviewer for the round, persisting the identity. */
async function switchReviewer(context: LoopContext, family: string): Promise<void> {
  if (context.identities.reviewer === family) { return; }
  context.identities.reviewer = family;
  context.state.reviewer = family;
  await context.ports.state.persist(context.state);
}

/** Settlement belongs to a selected reviewer whose judgment already exists. */
async function selectRecordedApprover(context: LoopContext, progress: ReviewerProgress): Promise<void> {
  const family = progress.approved.find(approved => progress.policy.selected.some(selected => selected === approved));
  if (family) { await switchReviewer(context, family); }
}

/** A restart may find the policy write committed before approval settlement. */
export async function recordedApprovalReady(context: LoopContext, round: ReviewRound): Promise<boolean> {
  const revision = revisionOf(context, round);
  const progress = revision ? await context.ports.state.reviewerProgress(context.state, revision) : null;
  if (!progress?.met) { return false; }
  await selectRecordedApprover(context, progress);
  return true;
}

function revisionOf(context: LoopContext, round: ReviewRound): string | null {
  return round.verifiedRevision ?? context.ports.preReview.head() ?? null;
}

function announce(context: LoopContext, policy: ReviewerPolicy): void {
  context.emit({ kind: 'reviewer-policy', mode: policy.mode, required: policy.requiredApprovals, selected: policy.selected,
    available: policy.independentAvailable, reason: policy.fallbackReason });
}

/**
 * Decide, or resume, the round's requirement before any reviewer launches.
 * A recorded policy governs its round; a new revision is a new round and is
 * decided afresh.  Returns false when no agent reviewer applies (local
 * workflow-owned review), leaving the historical single-reviewer path.
 */
export async function establishReviewerPolicy(context: LoopContext, round: ReviewRound): Promise<boolean> {
  const { ports, identities } = context;
  const revision = revisionOf(context, round);
  if (!revision || identities.reviewer === 'autonomous') { return false; }
  const { progress, policy } = await refreshReviewerAvailability(ports.state, ports.routing, context.state, revision,
    policy => announce(context, policy), identities);
  if (!policy) { return false; }
  await switchReviewer(context, progress?.outstanding[0] ?? policy.selected[0]);
  return true;
}

/** Provider, quota and uncertain execution failures do not prove a family unavailable. */
export function launchFailureAllowsReplacement(error: unknown): boolean {
  const code = recognizedFailureReason((error as { failureReason?: unknown } | null)?.failureReason)?.code;
  if (!code) { return true; }
  return !['agent-quota', 'infrastructure', 'process-terminated', 'resource-exhausted', 'unexpected'].includes(code)
    && !code.startsWith('provider-');
}

/** A persisted requirement must follow newly evidenced unavailability on resume. */
export async function refreshReviewerAvailability(state: Pick<ReviewStatePort, 'reviewerProgress' | 'replaceReviewer' | 'recordReviewerPolicy'>,
  routing: ReviewerRoutingPort, observed: ReviewLoopState, revision: string, changed?: (_policy: ReviewerPolicy) => void,
  identity: { reviewer?: string; implementer?: string } = observed,
): Promise<{ progress: ReviewerProgress | null; policy: ReviewerPolicy | null }> {
  let progress = await state.reviewerProgress(observed, revision);
  const probe = await routingProbe(routing, progress?.policy.selected);
  const established = await ensureReviewerPolicy(state, observed, revision, probe, identity, progress, changed);
  progress = established.progress;
  const policy = established.policy;
  if (!progress || progress.decided || progress.negative) { return { progress, policy }; }
  for (const family of progress.outstanding) {
    const availability = probe.runnable(family);
    if (availability.supported) { continue; }
    const policy = await state.replaceReviewer(observed, revision, family, availability.detail, probe);
    if (policy) { changed?.(policy); }
  }
  progress = await state.reviewerProgress(observed, revision);
  return { progress, policy: progress?.policy ?? policy };
}

/** Initial selection and revision changes share one persistence and read-back path. */
async function ensureReviewerPolicy(state: Pick<ReviewStatePort, 'recordReviewerPolicy' | 'reviewerProgress'>,
  observed: ReviewLoopState, revision: string, probe: ReviewerAvailabilityProbe,
  identity: { reviewer?: string; implementer?: string }, progress: ReviewerProgress | null,
  changed?: (_policy: ReviewerPolicy) => void,
): Promise<{ progress: ReviewerProgress | null; policy: ReviewerPolicy | null }> {
  let policy = progress?.policy ?? null;
  if (!progress && identity.reviewer && identity.implementer && identity.reviewer !== 'autonomous') {
    policy = planReviewerPolicy({ revision: changeRevision(revision), implementer: agentFamily(identity.implementer),
      primary: agentFamily(identity.reviewer), probe });
    await state.recordReviewerPolicy(observed, policy);
    // A competing controller may have adopted the legacy round first. Both
    // explicit submission and the loop must read back the authoritative policy.
    progress = await state.reviewerProgress(observed, revision);
    policy = progress?.policy ?? policy;
    changed?.(policy);
  }
  return { progress, policy };
}

/**
 * A reviewer that approved through `px verdict` has already been recorded by
 * the Review authority; while the requirement is unmet that approval does not
 * move the round, so the runner reads it back as the reviewer's outcome
 * instead of mistaking the quiet exit for a missing verdict.
 */
export async function recordedPendingApproval(context: LoopContext, round: ReviewRound): Promise<boolean> {
  const revision = revisionOf(context, round);
  const progress = revision ? await context.ports.state.reviewerProgress(context.state, revision) : null;
  return Boolean(progress && !progress.met && !progress.negative && !progress.decided && progress.approved.includes(context.identities.reviewer));
}

/**
 * An approval observed through the provider is recorded as the running
 * reviewer's attributed result before the requirement is read back, so it can
 * neither be lost nor decide a round that still owes another approval.  An
 * observation without its judged revision is never counted: HEAD or the
 * clock cannot stand in for missing evidence.
 */
export async function recordObservedApproval(context: LoopContext, round: ReviewRound, revision: string): Promise<void> {
  const progress = await context.ports.state.reviewerProgress(context.state, revision);
  if (!progress || progress.decided || progress.negative || progress.approved.includes(context.identities.reviewer) || !round.providerApproval?.revision) { return; }
  await context.ports.state.recordApproval(context.state, round.providerApproval);
}

/**
 * After an approval, either the requirement is met (the Review authority has
 * decided) or the next selected reviewer must still examine the revision.
 * A negative verdict never reaches here: it is decisive on its own.
 */
export async function nextOutstandingReviewer(context: LoopContext, round: ReviewRound, launched: ReadonlySet<string>): Promise<'done' | 'next' | 'exhausted'> {
  const revision = revisionOf(context, round);
  if (revision) { await recordObservedApproval(context, round, revision); }
  const progress = revision ? await context.ports.state.reviewerProgress(context.state, revision) : null;
  if (progress?.met && !progress.decided) { await selectRecordedApprover(context, progress); }
  if (!progress || progress.met || progress.negative || progress.decided) { return 'done'; }
  const next = progress.outstanding.find(family => !launched.has(family));
  if (!next) { return recoverMissingReviewer(context, round, progress); }
  context.emit({ kind: 'reviewer-next', reviewer: next, required: progress.policy.requiredApprovals,
    approved: progress.policy.selected.length - progress.outstanding.length });
  await switchReviewer(context, next);
  return 'next';
}

async function recoverMissingReviewer(context: LoopContext, round: ReviewRound,
  progress: ReviewerProgress): Promise<'done' | 'next' | 'exhausted'> {
  const failed = progress.outstanding[0] ?? context.identities.reviewer;
  if (progress.policy.rerouted?.some(entry => entry.family === failed)) {
    // A capacity reroute explains the missing distinct approval but does not
    // establish that the selected family is unavailable. Keep the recorded
    // requirement until a later launch attempt supplies that evidence.
    return 'exhausted';
  }
  // A selected reviewer that ran without a distinct approval is replaced or the requirement is evidenced down before any escalation.
  const replaced = await replaceFailedReviewer(context, round, failed, 'ran without recording a distinct approval');
  return replaced === 'retry' ? 'next' : replaced === 'approved' ? 'done' : 'exhausted';
}

/**
 * A selected reviewer could not launch.  An eligible replacement is tried
 * first; only when none exists, and no negative verdict stands, does the
 * recorded requirement drop to one independent reviewer.  `approved` means the
 * lowered requirement is already met by a recorded approval; `false` means the
 * existing launch-failure escalation applies.
 */
export async function replaceFailedReviewer(context: LoopContext, round: ReviewRound, failed: string, reason: string, rerouted?: string): Promise<'retry' | 'approved' | false> {
  const revision = revisionOf(context, round);
  if (!revision || !await context.ports.state.reviewerProgress(context.state, revision)) { return false; }
  const policy = await context.ports.state.replaceReviewer(context.state, revision, failed, reason, await routingProbe(context.ports.routing), rerouted);
  if (!policy) { return false; }
  announce(context, policy);
  const progress = await context.ports.state.reviewerProgress(context.state, revision);
  if (!progress) { return false; }
  if (progress.met) { await selectRecordedApprover(context, progress); return 'approved'; }
  await switchReviewer(context, progress.outstanding[0]);
  return 'retry';
}

/**
 * The launcher may run a different family than the one requested (capacity or
 * limit-hit reroute).  The recorded policy follows the family that actually
 * ran, so its selected identities and availability stay truthful.
 */
export async function reconcileReroutedReviewer(context: LoopContext, round: ReviewRound, requested: string, actual: string | null | undefined): Promise<void> {
  if (!actual || actual === requested) { return; }
  const revision = revisionOf(context, round);
  if (!revision || !await context.ports.state.reviewerProgress(context.state, revision)) { return; }
  const policy = await context.ports.state.replaceReviewer(context.state, revision, requested, `launcher rerouted ${requested} to ${actual}`, await routingProbe(context.ports.routing), actual);
  if (policy) { announce(context, policy); }
}
