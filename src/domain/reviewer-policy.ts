import type { AgentFamily } from './agents.js';
import type { ChangeRevision, Review, ReviewRound } from './review.js';
import { currentRevisionApprovals } from './reviewer-result.js';

/**
 * How many independent agent approvals one exact revision owes.
 *
 * `two-independent` and `one-independent` need that many approvals from
 * distinct independent families. `same-agent` is the existing single-family
 * fallback: no independent reviewer is available, so the implementer's own
 * family reviews in a fresh context and one valid approval is required.
 * Human inspection is never part of the count.
 */
export type ReviewerMode = 'two-independent' | 'one-independent' | 'same-agent';

export interface UnavailableReviewer {
  readonly family: string;
  readonly reason: string;
}

/**
 * A selected reviewer the launcher ran somewhere else because it was busy.
 * Queued or live capacity is not unavailability, so the family keeps its slot
 * and the recorded requirement stands. Absent on rows written before PX-0046.03.
 */
export interface ReroutedReviewer {
  readonly family: string;
  readonly replacedBy: string;
  readonly reason: string;
}

/** Typed, authoritative reviewer requirement recorded on the round it governs. */
export interface ReviewerPolicy {
  /** Exact post-setup revision whose reviewer requirement this policy governs. */
  readonly revision: ChangeRevision;
  readonly mode: ReviewerMode;
  readonly requiredApprovals: 1 | 2;
  /** Distinct identities, in the order the serialized runner launches them. */
  readonly selected: readonly AgentFamily[];
  /** Independent reviewers that were actually launchable when the policy was decided. */
  readonly independentAvailable: number;
  readonly unavailable: readonly UnavailableReviewer[];
  /** Selected families the launcher rerouted away for capacity; never evidence of unavailability. */
  readonly rerouted?: readonly ReroutedReviewer[];
  /** Why fewer than two independent reviewers are required; null in two-reviewer mode. */
  readonly fallbackReason: string | null;
}

/**
 * Routing facts the planner may read.  Only a family the launcher reports as
 * unsupported is unavailable: queued or live capacity, unknown liveness,
 * silence and quota telemetry failure are not reported as unsupported, so they
 * never lower the requirement.
 */
export interface ReviewerAvailabilityProbe {
  /** Every family the configured review step allows. */
  eligible(): readonly string[];
  /** The configured selector's nominee outside `excluded`; null when none. */
  nominate(excluded: ReadonlySet<string>): string | null;
  runnable(family: string): { readonly supported: boolean; readonly detail: string };
}

const MAX_INDEPENDENT_REVIEWERS = 2;

function nextRunnableReviewer(
  probe: ReviewerAvailabilityProbe,
  tried: Set<string>,
  unavailable: UnavailableReviewer[],
): AgentFamily | null {
  for (;;) {
    const nominee = probe.nominate(tried);
    if (!nominee || tried.has(nominee)) { return null; }
    tried.add(nominee);
    const status = probe.runnable(nominee);
    if (status.supported) { return nominee as AgentFamily; }
    unavailable.push({ family: nominee, reason: status.detail });
  }
}

function describeUnavailable(unavailable: readonly UnavailableReviewer[]): string {
  return unavailable.length === 0 ? 'no other eligible reviewer' : unavailable.map(entry => `${entry.family}: ${entry.reason}`).join('; ');
}

function independentPolicy(revision: ChangeRevision, selected: readonly AgentFamily[], unavailable: readonly UnavailableReviewer[],
  rerouted: readonly ReroutedReviewer[] = []): ReviewerPolicy {
  if (selected.length >= MAX_INDEPENDENT_REVIEWERS) {
    return { revision, mode: 'two-independent', requiredApprovals: 2, selected: selected.slice(0, MAX_INDEPENDENT_REVIEWERS),
      independentAvailable: selected.length, unavailable, rerouted, fallbackReason: null };
  }
  return { revision, mode: 'one-independent', requiredApprovals: 1, selected, independentAvailable: selected.length, unavailable, rerouted,
    fallbackReason: `only one independent reviewer is available (${describeUnavailable(unavailable)})` };
}

/** The existing same-agent/model fallback, recorded as a mode rather than an absence. */
export function sameAgentPolicy(revision: ChangeRevision, implementer: AgentFamily, unavailable: readonly UnavailableReviewer[],
  rerouted: readonly ReroutedReviewer[] = []): ReviewerPolicy {
  return { revision, mode: 'same-agent', requiredApprovals: 1, selected: [implementer], independentAvailable: 0, unavailable, rerouted,
    fallbackReason: `no independent reviewer is available (${describeUnavailable(unavailable)}); the same agent reviews in a fresh context` };
}

/**
 * Select up to two distinct eligible independent reviewers for one revision.
 *
 * `primary` is the reviewer the existing selection already routed; it is kept
 * when it is independent of the implementer and runnable.  The configured
 * selector then nominates the rest; a nominee the launcher cannot run is
 * recorded as unavailable and replaced by the next eligible family before the
 * requirement is lowered.
 */
export function planReviewerPolicy(
  input: { readonly revision: ChangeRevision; readonly implementer: AgentFamily; readonly primary?: AgentFamily | null; readonly probe: ReviewerAvailabilityProbe },
): ReviewerPolicy {
  const { implementer, probe } = input;
  const selected: AgentFamily[] = [];
  const unavailable: UnavailableReviewer[] = [];
  const tried = new Set<string>([implementer]);
  if (input.primary && input.primary !== implementer) {
    const status = probe.runnable(input.primary);
    tried.add(input.primary);
    if (status.supported) { selected.push(input.primary); } else { unavailable.push({ family: input.primary, reason: status.detail }); }
  }
  while (selected.length < MAX_INDEPENDENT_REVIEWERS) {
    const nominee = nextRunnableReviewer(probe, tried, unavailable);
    if (!nominee) { break; }
    selected.push(nominee);
  }
  // The selector never nominates a family it cannot launch; name those families and why, so a lowered requirement is explained.
  for (const family of probe.eligible()) {
    const status = tried.has(family) ? null : probe.runnable(family);
    if (status && !status.supported) { unavailable.push({ family, reason: status.detail }); }
  }
  return selected.length === 0
    ? sameAgentPolicy(input.revision, implementer, unavailable)
    : independentPolicy(input.revision, selected, unavailable);
}

/** Valid approvals recorded for the exact revision by the identities the policy selected. */
function approvedFamilies(review: Review, revision: ChangeRevision): ReadonlySet<AgentFamily> {
  const selected = currentRound(review).reviewerPolicy?.selected;
  // Only the identities the policy selected can satisfy it; a family it replaced never counts.
  return new Set(currentRevisionApprovals(review, revision).map(result => result.agentFamily)
    .filter(family => !selected || selected.includes(family)));
}

function currentRound(review: Review): ReviewRound {
  return review.rounds[review.rounds.length - 1];
}

/** True when a valid, non-revoked negative verdict exists for the exact revision. */
export function hasNegativeResult(review: Review, revision: ChangeRevision): boolean {
  const results = currentRound(review).reviewerResults ?? [];
  return results.some(result => result.revision === revision && result.decision === 'changes-requested'
    && result.outcome === 'completed' && result.status === 0 && !result.revokedAt);
}

/**
 * Whether the recorded agent approvals satisfy the round's requirement for the
 * exact revision.  A round without a recorded policy keeps the historical
 * one-approval behaviour.
 */
export function approvalRequirementMet(review: Review, revision: ChangeRevision): boolean {
  const round = currentRound(review);
  const required = round.reviewerPolicy?.requiredApprovals ?? 1;
  return approvedFamilies(review, revision).size >= required && !hasNegativeResult(review, revision);
}

/** Selected reviewers still owing an approval on the exact revision, in launch order. */
export function outstandingReviewers(review: Review, revision: ChangeRevision): readonly AgentFamily[] {
  const policy = currentRound(review).reviewerPolicy;
  if (!policy) { return []; }
  const approved = approvedFamilies(review, revision);
  if (approved.size >= policy.requiredApprovals) { return []; }
  return policy.selected.filter(family => !approved.has(family)).slice(0, policy.requiredApprovals - approved.size);
}

/**
 * The launcher already ran another family in place of `failed`.  A same-agent
 * review becomes an evidenced independent one; an unselected independent
 * family takes the slot.  Undefined when the reroute does not settle it.
 */
function reroutedPolicy(review: Review, policy: ReviewerPolicy, revision: ChangeRevision, failed: AgentFamily, unavailable: readonly UnavailableReviewer[],
  rerouted: readonly ReroutedReviewer[], target?: AgentFamily): ReviewerPolicy | null | undefined {
  const independent = target !== undefined && target !== currentRound(review).implementer;
  if (policy.mode === 'same-agent') { return independent ? independentPolicy(revision, [target], unavailable, rerouted) : null; }
  if (independent && !policy.selected.includes(target)) {
    return { ...policy, selected: policy.selected.map(family => family === failed ? target : family), unavailable, rerouted };
  }
  return undefined;
}

/** One recorded capacity reroute: the launcher ran `replacedBy` for `family`. */
function rerouteEntry(prior: readonly ReroutedReviewer[], family: AgentFamily, replacedBy: AgentFamily, reason: string): readonly ReroutedReviewer[] {
  return prior.some(entry => entry.family === family && entry.replacedBy === replacedBy)
    ? prior : [...prior, { family, replacedBy, reason }];
}

/**
 * Replace a selected reviewer that can no longer run.  An eligible replacement
 * is always tried first; the requirement drops to one independent reviewer
 * only when no replacement exists, another independent reviewer remains, no
 * negative verdict exists for the revision, and the lost family was never
 * merely rerouted for capacity.  `rerouted` names a family the launcher ran
 * instead of `failed`, which keeps the requirement.  With no independent
 * family left, the authorized zero-independent fallback records the same-agent
 * review.  Returns null when the requirement must simply stand.
 */
export function replaceUnavailableReviewer(
  review: Review,
  revision: ChangeRevision,
  failed: AgentFamily,
  reason: string,
  probe: ReviewerAvailabilityProbe,
  rerouted?: AgentFamily,
): ReviewerPolicy | null {
  const round = currentRound(review);
  const policy = round.reviewerPolicy;
  if (!policy || !policy.selected.includes(failed)) { return null; }
  const prior = policy.rerouted ?? [];
  const capacityOnly = rerouted !== undefined && rerouted !== failed;
  // A family the launcher ran elsewhere is busy, not unavailable: it is recorded as rerouted, never as unavailable.
  const reroutes = capacityOnly ? rerouteEntry(prior, failed, rerouted as AgentFamily, reason) : prior;
  const unavailable = capacityOnly ? [...policy.unavailable] : [...policy.unavailable, { family: failed, reason }];
  const taken = reroutedPolicy(review, policy, revision, failed, unavailable, reroutes, rerouted);
  if (taken !== undefined) { return taken; }
  const kept = policy.selected.filter(family => family !== failed);
  const tried = new Set<string>([round.implementer, ...policy.selected, ...policy.unavailable.map(entry => entry.family)]);
  const replacement = nextRunnableReviewer(probe, tried, unavailable);
  if (replacement) {
    return { ...policy, selected: [...kept, replacement], unavailable, rerouted: reroutes, independentAvailable: kept.length + 1 };
  }
  if (hasNegativeResult(review, revision)) { return null; }
  // The authorized same-agent review already names the only family that can run.
  if (policy.mode === 'same-agent') { return null; }
  // Every selected independent reviewer is gone on launcher evidence: the authorized zero-independent fallback, not an escalation.
  if (kept.length === 0) { return sameAgentPolicy(revision, round.implementer, unavailable, reroutes); }
  if (reroutes.length > prior.length) {
    // Capacity evidence only: the rerouted family keeps its slot and the requirement is unchanged.
    return { ...policy, unavailable, rerouted: reroutes };
  }
  // This call represents current launcher evidence. Capacity-only reroutes are
  // filtered by the serialized runner before they reach this degradation path.
  return independentPolicy(revision, kept, unavailable, reroutes);
}
