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
import type { ReviewerRoutingPort } from '../ports/review-round.js';
import type { LoopContext, ReviewRound } from './round.js';

/** Read the routing port as availability facts: only an unsupported launcher is unavailable. */
export function routingProbe(routing: ReviewerRoutingPort): ReviewerAvailabilityProbe {
  return {
    eligible: () => routing.eligibleFamilies(),
    nominate: excluded => {
      try {
        const nominee = routing.nominate(excluded);
        return excluded.has(nominee) ? null : nominee;
      } catch (error) {
        if (error instanceof AgentSelectionPolicyError) { throw error; }
        return null;
      }
    },
    runnable: family => routing.launcherStatus(family),
  };
}

/** Make `family` the running reviewer for the round, persisting the identity. */
async function switchReviewer(context: LoopContext, family: string): Promise<void> {
  if (context.identities.reviewer === family) { return; }
  context.identities.reviewer = family;
  context.state.reviewer = family;
  await context.ports.state.persist(context.state);
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
  const progress = await ports.state.reviewerProgress(context.state, revision);
  if (progress) {
    await switchReviewer(context, progress.outstanding[0] ?? identities.reviewer);
    return true;
  }
  const policy = planReviewerPolicy({ revision: changeRevision(revision), implementer: agentFamily(identities.implementer),
    primary: agentFamily(identities.reviewer), probe: routingProbe(ports.routing) });
  await ports.state.recordReviewerPolicy(context.state, policy);
  announce(context, policy);
  await switchReviewer(context, policy.selected[0]);
  return true;
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
async function recordObservedApproval(context: LoopContext, round: ReviewRound, revision: string): Promise<void> {
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
  if (!progress || progress.met || progress.negative || progress.decided) { return 'done'; }
  const next = progress.outstanding.find(family => !launched.has(family));
  if (!next) {
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
  context.emit({ kind: 'reviewer-next', reviewer: next, required: progress.policy.requiredApprovals,
    approved: progress.policy.selected.length - progress.outstanding.length });
  await switchReviewer(context, next);
  return 'next';
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
  const policy = await context.ports.state.replaceReviewer(context.state, revision, failed, reason, routingProbe(context.ports.routing), rerouted);
  if (!policy) { return false; }
  announce(context, policy);
  const progress = await context.ports.state.reviewerProgress(context.state, revision);
  if (!progress) { return false; }
  if (progress.met || progress.outstanding.length === 0) { return 'approved'; }
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
  const policy = await context.ports.state.replaceReviewer(context.state, revision, requested, `launcher rerouted ${requested} to ${actual}`, routingProbe(context.ports.routing), actual);
  if (policy) { announce(context, policy); }
}
