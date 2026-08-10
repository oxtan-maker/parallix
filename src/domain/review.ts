import type { AgentFamily, StepSelectionPolicy } from './agents.js';

export type ReviewFindingId = string & { readonly __brand: 'ReviewFindingId' };
export type ChangeRevision = string & { readonly __brand: 'ChangeRevision' };

export function reviewFindingId(value: string): ReviewFindingId {
  if (!value.trim()) { throw new Error('Review finding id cannot be empty'); }
  return value as ReviewFindingId;
}

export function changeRevision(value: string): ChangeRevision {
  if (!value.trim()) { throw new Error('Reviewed revision cannot be empty'); }
  return value as ChangeRevision;
}

export interface ReviewFinding {
  readonly id: ReviewFindingId;
  readonly summary: string;
  readonly location: string | null;
}

/**
 * A single finding disposition recorded by the implementer during a round.
 *
 * Replaces the previous three-column blob model (fixedItems, pushedBackItems,
 * parkedItems: unknown[]) with a typed collection. The implementer's round
 * summary classifies each finding as fixed, pushed_back, or parked.
 */
export interface ReviewItemDisposition {
  readonly kind: 'fixed' | 'pushed_back' | 'parked';
  readonly findingId: ReviewFindingId;
}

export interface PullRequestReference {
  readonly kind: 'pull-request';
  /** Local review-surface key; for example, Forgejo running in local Docker. */
  readonly provider: string;
  /** Opaque identifier within that review surface. */
  readonly id: string;
  readonly url: string | null;
  readonly sourceBranch: string;
  readonly targetBranch: string;
}

export interface LocalBranchReference {
  readonly kind: 'local-branch';
  readonly sourceBranch: string;
  readonly targetBranch: string;
}

/** Stable identity of the change across review rounds. */
export type ReviewedChange = PullRequestReference | LocalBranchReference;

/** The exact change revision presented to one review round. */
export interface ReviewedRevision {
  readonly change: ReviewedChange;
  readonly revision: ChangeRevision;
}

export type ReviewApprovalSource =
  | { readonly kind: 'provider'; readonly provider: string }
  | { readonly kind: 'local' };

export type ReviewerDecision =
  | {
    readonly kind: 'approved';
    readonly decidedAt: string;
    readonly comment: string | null;
    readonly source: ReviewApprovalSource;
  }
  | {
    readonly kind: 'changes-requested';
    readonly decidedAt: string;
    readonly comment: string | null;
    readonly findings: readonly ReviewFinding[];
  };

export type FindingResolution =
  | {
    readonly findingId: ReviewFindingId;
    readonly kind: 'fixed';
    readonly evidence: string;
  }
  | {
    readonly findingId: ReviewFindingId;
    readonly kind: 'disputed';
    readonly rationale: string;
  };

export interface ImplementerResolution {
  readonly kind: 'resolved';
  readonly respondedAt: string;
  readonly resolutions: readonly FindingResolution[];
  readonly resultingRevision: ChangeRevision;
}

/**
 * The reviewer's verdict vocabulary.
 *
 * This is deliberately richer than {@link ReviewerDecision}: `BLOCKED` and
 * `PUSHBACK_ALL` both imply `changes-requested`, but the loop needs to tell them
 * apart. Inferring one from the other is lossy in the direction that matters, so
 * the disposition is stored rather than derived.
 */
export type ReviewDisposition =
  | 'APPROVED'
  | 'REQUEST_CHANGES'
  | 'COMMENT'
  | 'PUSHBACK_ALL'
  | 'BLOCKED'
  | 'PARKED'
  | 'CHANGES_MADE';

export const REVIEW_DISPOSITIONS: readonly ReviewDisposition[] =
  ['APPROVED', 'REQUEST_CHANGES', 'COMMENT', 'PUSHBACK_ALL', 'BLOCKED', 'PARKED', 'CHANGES_MADE'];

/**
 * Workflow phase of the review loop.
 *
 * Not derivable from {@link reviewStatus}: `pending-approval` and
 * `ready-for-next-round` describe the same decision history but drive different
 * loop behavior, and the phase survives a restart that has no decision to replay.
 */
export type ReviewPhase = 'reviewing' | 'fixing' | 'pending-approval' | 'approved';

export const REVIEW_PHASES: readonly ReviewPhase[] =
  ['reviewing', 'fixing', 'pending-approval', 'approved'];

const REVIEW_PHASE_TRANSITIONS: Record<ReviewPhase, readonly ReviewPhase[]> = {
  'reviewing': ['fixing', 'approved'],
  'fixing': ['reviewing', 'pending-approval'],
  'pending-approval': ['reviewing'],
  'approved': [],
};

/** Coerce untrusted text to a phase, or null when it names none. */
export function parseReviewPhase(value: string | null | undefined): ReviewPhase | null {
  const candidate = String(value ?? '').trim().toLowerCase();
  return (REVIEW_PHASES as readonly string[]).includes(candidate)
    ? candidate as ReviewPhase
    : null;
}

/** Coerce untrusted text to a disposition, or null when it names none. */
export function parseReviewDisposition(
  value: string | null | undefined,
): ReviewDisposition | null {
  const candidate = String(value ?? '').trim().toUpperCase();
  return (REVIEW_DISPOSITIONS as readonly string[]).includes(candidate)
    ? candidate as ReviewDisposition
    : null;
}

/** Upper bound on retained fingerprints per stage window. */
export const STAGE_LAUNCH_HISTORY_LIMIT = 20;

/**
 * De-duplication record for agent launches within one stage window.
 *
 * The loop records a launch fingerprint before acting on it so that a restart
 * mid-stage does not double-count the same agent run.
 */
export interface StageLaunchWindow {
  readonly stageKey: string;
  readonly fingerprints: readonly string[];
}

/**
 * Build stage-launch windows from an untyped `{ stageKey: fingerprints[] }` bag.
 *
 * Both legacy read paths carry this shape in an untyped metadata blob, so the
 * coercion lives here rather than being duplicated per adapter. Malformed
 * windows are dropped instead of throwing: a corrupt de-duplication hint costs
 * at worst one repeated launch, which is not worth failing a mission read over.
 */
export function stageLaunchWindowsFrom(source: unknown): readonly StageLaunchWindow[] {
  if (!source || typeof source !== 'object') { return []; }
  const windows: StageLaunchWindow[] = [];
  for (const [stageKey, value] of Object.entries(source as Record<string, unknown>)) {
    if (!stageKey.trim() || !Array.isArray(value)) { continue; }
    const fingerprints = value
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .slice(-STAGE_LAUNCH_HISTORY_LIMIT);
    if (fingerprints.length > 0) { windows.push({ stageKey, fingerprints }); }
  }
  return sortStageLaunchWindows(windows);
}

export interface ReviewRound {
  readonly number: number;
  readonly subject: ReviewedRevision;
  readonly reviewer: AgentFamily;
  readonly implementer: AgentFamily;
  readonly startedAt: string;
  readonly decision: ReviewerDecision | null;
  readonly response: ImplementerResolution | null;
  /** Workflow phase of this round. Reset to `reviewing` when a round begins. */
  readonly phase: ReviewPhase;
  /** Reviewer's verdict for this round, richer than `decision.kind`. */
  readonly disposition: ReviewDisposition | null;
  /** Gate retries consumed by the reviewer in this round. Reset per round. */
  readonly reviewerRetryCount: number;
  /** Gate retries consumed by the implementer in this round. Reset per round. */
  readonly implementerRetryCount: number;
  /** Full text of the implementer's round summary (from implementer artifact). */
  readonly implementerResponseContent?: string;
  /**
   * How the implementer classified each finding in this round.
   * Populated from the implementer's round summary artifact.
   */
  readonly itemDispositions?: readonly ReviewItemDisposition[];
  /** Reason the round was blocked, if BLOCKED disposition. */
  readonly blockedReason?: string;
}

export interface ReviewIntervention {
  readonly requestedAt: string;
  readonly requestedBy: 'reviewer' | 'implementer' | 'workflow';
  readonly reason: string;
}

/** Canonical event types stored in the review audit trail. */
export type ReviewEventType =
  | 'reviewer_findings'
  | 'reviewer_outcome'
  | 'implementer_round_summary'
  | 'implementer_disposition'
  | 'neutral_discussion'
  | 'human_note'
  | 'blocked_publication'
  | 'parked_followup';

/** One review event from the audit trail (replaces .md files). */
export interface ReviewEventRecord {
  readonly position: number;
  readonly eventType: ReviewEventType;
  readonly roundNumber: number | null;
  readonly phase: string | null;
  readonly actor: string | null;
  readonly content: string;
  readonly disposition: string | null;
  readonly verdict: string | null;
  /** How the implementer classified findings in this event (round summary). */
  readonly itemDispositions: readonly ReviewItemDisposition[] | null;
  readonly blockedReason: string | null;
  readonly followUpReference: string | null;
  readonly createdAt: string;
}

/**
 * Review is an ordered conversation. The current state is derived from the
 * latest round and an optional human-intervention request.
 */
export interface Review {
  readonly rounds: readonly [ReviewRound, ...ReviewRound[]];
  readonly intervention: ReviewIntervention | null;
  /**
   * Stage-launch de-duplication windows, cumulative across rounds. A round
   * boundary does not clear these: the same agent run must not be recorded twice
   * even if the loop advances between the launch and its bookkeeping.
   */
  readonly stageLaunches: readonly StageLaunchWindow[];
  /**
   * Pre-review gate failures that auto-bounced the mission to the implementer.
   *
   * Cumulative across rounds, and distinct from the per-round retry counters: a
   * gate bounce does not consume a reviewer cycle, so it cannot share a counter
   * with the agent-timeout retries without changing when the loop gives up.
   */
  readonly gateFailureRetryCount: number;
  /**
   * Hook failure auto-bounce retries (pre-commit, pre-push, etc.).
   * Separate from gateFailureRetryCount: hook bounces happen during
   * rebase/integrate operations, not during the pre-review gate.
   */
  readonly hookFailureRetryCount: number;
  /**
   * Full audit trail for review events (replaces .md files under
   * missions/<slug>/review-events/). Stores reviewer findings/outcomes,
   * implementer summaries/dispositions, human notes, and blocked/parked
   * publication records.
   */
  readonly reviewEvents: readonly ReviewEventRecord[];
}

export type ReviewStatus =
  | 'awaiting-review'
  | 'awaiting-implementation'
  | 'ready-for-next-round'
  | 'approved'
  | 'human-intervention';

/**
 * The explicit reviewer allow-list from the user-configured `review` step.
 *
 * This value cannot be constructed from a default selection policy. The
 * application must pass the configured review step itself; an absent or empty
 * step makes review assignment unavailable instead of activating a built-in
 * agent-family fallback.
 */
export class ConfiguredReviewerEligibility {
  private readonly source = 'configured-review-step';
  readonly reviewers: readonly AgentFamily[];

  private constructor(reviewers: readonly AgentFamily[]) {
    this.reviewers = reviewers;
  }

  static fromReviewStep(policy: StepSelectionPolicy | undefined): ConfiguredReviewerEligibility {
    if (!policy) {
      throw new Error('Reviewer eligibility requires an explicitly configured review step');
    }
    if (policy.eligible.length === 0) {
      throw new Error('Configured review step requires at least one eligible reviewer');
    }
    if (new Set(policy.eligible).size !== policy.eligible.length) {
      throw new Error('Configured review step contains duplicate eligible reviewers');
    }
    return new ConfiguredReviewerEligibility([...policy.eligible]);
  }

  includes(reviewer: AgentFamily): boolean {
    return this.reviewers.includes(reviewer);
  }
}

export type ReviewerCommand =
  | {
    readonly type: 'approve';
    readonly decidedAt: string;
    readonly comment: string | null;
    readonly source: ReviewApprovalSource;
  }
  | {
    readonly type: 'request-changes';
    readonly decidedAt: string;
    readonly comment: string | null;
    readonly findings: readonly ReviewFinding[];
    /**
     * Which flavour of "changes requested" this is. Omitted means the generic
     * `REQUEST_CHANGES`; `BLOCKED`, `PUSHBACK_ALL`, `COMMENT` and `PARKED` all
     * imply the same decision kind but drive the loop differently.
     */
    readonly disposition?: Exclude<ReviewDisposition, 'APPROVED' | 'CHANGES_MADE'>;
  };

export type ImplementerCommand =
  | {
    readonly type: 'submit-resolution';
    readonly respondedAt: string;
    readonly resolutions: readonly FindingResolution[];
    readonly resultingRevision: ChangeRevision;
  }
  | {
    readonly type: 'request-human-intervention';
    readonly requestedAt: string;
    readonly reason: string;
  };

export function assertReviewedChange(change: ReviewedChange): void {
  if (!change.sourceBranch.trim() || !change.targetBranch.trim()) {
    throw new Error('Reviewed change requires source and target branches');
  }
  if (change.kind === 'pull-request' && (!change.provider.trim() || !change.id.trim())) {
    throw new Error('Pull request requires a provider and its opaque id');
  }
}

export function sameReviewedChange(left: ReviewedChange, right: ReviewedChange): boolean {
  return left.kind === right.kind
    && left.sourceBranch === right.sourceBranch
    && left.targetBranch === right.targetBranch
    && (left.kind !== 'pull-request'
      || (right.kind === 'pull-request'
        && left.provider === right.provider
        && left.id === right.id));
}

export function sameReviewedRevision(left: ReviewedRevision, right: ReviewedRevision): boolean {
  return sameReviewedChange(left.change, right.change) && left.revision === right.revision;
}

export function currentReviewRound(review: Review): ReviewRound {
  return review.rounds[review.rounds.length - 1];
}

function replaceCurrentRound(review: Review, round: ReviewRound): Review['rounds'] {
  const [first, ...rest] = review.rounds;
  if (rest.length === 0) { return [round]; }
  return [first, ...rest.slice(0, -1), round];
}

export function reviewStatus(review: Review): ReviewStatus {
  if (review.intervention) { return 'human-intervention'; }
  const round = currentReviewRound(review);
  if (round.decision?.kind === 'approved') { return 'approved'; }
  if (round.response) { return 'ready-for-next-round'; }
  if (round.decision?.kind === 'changes-requested') { return 'awaiting-implementation'; }
  return 'awaiting-review';
}

function requireEligibleReviewer(
  reviewer: AgentFamily,
  eligibility: ConfiguredReviewerEligibility,
): void {
  if (!eligibility.includes(reviewer)) {
    throw new Error(`Reviewer ${reviewer} is not eligible under the configured review policy`);
  }
}

/**
 * An agent family may not review its own work.
 *
 * The single exception is the workstation that has no second family to ask:
 * when the eligibility recorded on the round is exactly the implementer's own
 * family, self-review is the only review available and is recorded as such.
 * Callers must therefore narrow the eligibility they pass to that one family
 * rather than keep a multi-family policy and quietly reuse the implementer —
 * a round that names four eligible reviewers and picks the implementer is not
 * an escape hatch, it is a selection defect.
 */
function requireSeparateReviewer(
  reviewer: AgentFamily,
  implementer: AgentFamily,
  eligibility: ConfiguredReviewerEligibility,
): void {
  if (reviewer !== implementer) { return; }
  const soleEligible = eligibility.reviewers.length === 1 && eligibility.reviewers[0] === reviewer;
  if (soleEligible) { return; }
  throw new Error(
    `Reviewer ${reviewer} may not review its own work: the configured review policy `
    + `also allows ${eligibility.reviewers.filter((family) => family !== reviewer).join(', ')}`,
  );
}

export function startReview(
  subject: ReviewedRevision,
  reviewer: AgentFamily,
  implementer: AgentFamily,
  startedAt: string,
  reviewerEligibility: ConfiguredReviewerEligibility,
): Review {
  assertReviewedChange(subject.change);
  changeRevision(subject.revision);
  requireEligibleReviewer(reviewer, reviewerEligibility);
  requireSeparateReviewer(reviewer, implementer, reviewerEligibility);
  if (!startedAt.trim()) { throw new Error('Review round requires a start time'); }
  return {
    rounds: [{
      number: 1,
      subject,
      reviewer,
      implementer,
      startedAt,
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    intervention: null,
    stageLaunches: [],
    gateFailureRetryCount: 0,
    hookFailureRetryCount: 0,
    reviewEvents: [],
  };
}

export function applyReviewerCommand(review: Review, command: ReviewerCommand): Review {
  if (reviewStatus(review) !== 'awaiting-review') {
    throw new Error(`Reviewer cannot ${command.type} while review is ${reviewStatus(review)}`);
  }
  if (!command.decidedAt.trim()) { throw new Error('Reviewer decision requires a time'); }
  if (command.type === 'request-changes') {
    if (command.findings.length === 0) {
      throw new Error('Requested changes require at least one finding');
    }
    const ids = new Set<string>();
    for (const finding of command.findings) {
      if (!finding.id.trim() || !finding.summary.trim()) {
        throw new Error('Review finding requires an id and summary');
      }
      if (ids.has(finding.id)) {
        throw new Error(`Review finding ${finding.id} is duplicated`);
      }
      ids.add(finding.id);
    }
  }
  const current = currentReviewRound(review);
  const decision: ReviewerDecision = command.type === 'approve'
    ? {
      kind: 'approved',
      decidedAt: command.decidedAt,
      comment: command.comment,
      source: command.source,
    }
    : {
      kind: 'changes-requested',
      decidedAt: command.decidedAt,
      comment: command.comment,
      findings: command.findings,
    };
  const disposition: ReviewDisposition = command.type === 'approve'
    ? 'APPROVED'
    : command.disposition ?? 'REQUEST_CHANGES';
  return {
    ...review,
    rounds: replaceCurrentRound(review, {
      ...current,
      decision,
      disposition,
      phase: command.type === 'approve' ? 'approved' : 'fixing',
    }),
  };
}

/**
 * Move the current round to `phase`, enforcing the loop's transition table.
 *
 * The phase is workflow state, not a projection of the decision history, so it
 * is advanced explicitly rather than inferred.
 */
export function transitionReviewPhase(review: Review, phase: ReviewPhase): Review {
  const current = currentReviewRound(review);
  if (!REVIEW_PHASES.includes(phase)) {
    throw new Error(`Invalid review phase: "${phase}". Valid: ${REVIEW_PHASES.join(', ')}`);
  }
  const allowed = REVIEW_PHASE_TRANSITIONS[current.phase];
  if (!allowed.includes(phase)) {
    // Worded so the phase never follows the word "from" in quotes: the domain
    // import-boundary scanner reads that as an import specifier
    // (test/domain-import-boundary.test.ts).
    throw new Error(
      `Review phase "${current.phase}" cannot move to "${phase}". Allowed: ${allowed.join(', ') || 'none'}`,
    );
  }
  return { ...review, rounds: replaceCurrentRound(review, { ...current, phase }) };
}

/** Consume one gate retry for `actor` in the current round. */
export function recordReviewRetry(review: Review, actor: 'reviewer' | 'implementer'): Review {
  const current = currentReviewRound(review);
  const updated: ReviewRound = actor === 'reviewer'
    ? { ...current, reviewerRetryCount: current.reviewerRetryCount + 1 }
    : { ...current, implementerRetryCount: current.implementerRetryCount + 1 };
  return { ...review, rounds: replaceCurrentRound(review, updated) };
}

/** Whether `fingerprint` was already recorded in the `stageKey` window. */
export function hasRecordedStageLaunch(
  review: Review,
  stageKey: string,
  fingerprint: string,
): boolean {
  const window = review.stageLaunches.find((entry) => entry.stageKey === stageKey);
  return window ? window.fingerprints.includes(fingerprint) : false;
}

/**
 * Record `fingerprint` in the `stageKey` window.
 *
 * Returns the review unchanged when the fingerprint is already present, so the
 * caller can treat identity of the result as "already recorded" and skip the
 * duplicate launch.
 */
export function recordStageLaunch(
  review: Review,
  stageKey: string,
  fingerprint: string,
): Review {
  if (!stageKey.trim()) { throw new Error('Stage launch requires a stage key'); }
  if (hasRecordedStageLaunch(review, stageKey, fingerprint)) { return review; }
  const existing = review.stageLaunches.find((entry) => entry.stageKey === stageKey);
  const fingerprints = [...(existing?.fingerprints ?? []), fingerprint]
    .slice(-STAGE_LAUNCH_HISTORY_LIMIT);
  const others = review.stageLaunches.filter((entry) => entry.stageKey !== stageKey);
  return {
    ...review,
    stageLaunches: sortStageLaunchWindows([...others, { stageKey, fingerprints }]),
  };
}

/**
 * Windows are an unordered set keyed by stage. Sorting them makes the aggregate
 * representation canonical, so a persist/reload cycle is value-identical.
 */
function sortStageLaunchWindows(
  windows: readonly StageLaunchWindow[],
): readonly StageLaunchWindow[] {
  return [...windows].sort((left, right) => left.stageKey.localeCompare(right.stageKey));
}

/**
 * Consume one pre-review gate retry.
 *
 * Counted on the review rather than the round: an auto-bounce hands the mission
 * back to the implementer without starting a new round, so a per-round counter
 * would reset the budget every time the gate bounced.
 */
export function recordGateFailureRetry(review: Review): Review {
  return { ...review, gateFailureRetryCount: review.gateFailureRetryCount + 1 };
}

/**
 * Consume one hook failure retry.
 *
 * Counted on the review rather than the round: a hook auto-bounce hands the
 * mission back to the implementer without starting a new round.
 */
export function recordHookFailureRetry(review: Review): Review {
  return { ...review, hookFailureRetryCount: review.hookFailureRetryCount + 1 };
}

function validateResolutions(
  findings: readonly ReviewFinding[],
  resolutions: readonly FindingResolution[],
): void {
  const expected = new Set(findings.map(({ id }) => id));
  const seen = new Set<ReviewFindingId>();
  for (const resolution of resolutions) {
    if (!expected.has(resolution.findingId)) {
      throw new Error(`Resolution references unknown finding ${resolution.findingId}`);
    }
    if (seen.has(resolution.findingId)) {
      throw new Error(`Finding ${resolution.findingId} has multiple resolutions`);
    }
    const explanation = resolution.kind === 'fixed' ? resolution.evidence : resolution.rationale;
    if (!explanation.trim()) {
      throw new Error(`Resolution for ${resolution.findingId} requires evidence or rationale`);
    }
    seen.add(resolution.findingId);
  }
  const unresolved = findings.filter(({ id }) => !seen.has(id));
  if (unresolved.length > 0) {
    throw new Error(`Missing resolution for ${unresolved.map(({ id }) => id).join(', ')}`);
  }
}

export function applyImplementerCommand(review: Review, command: ImplementerCommand): Review {
  if (reviewStatus(review) !== 'awaiting-implementation') {
    throw new Error(`Implementer cannot ${command.type} while review is ${reviewStatus(review)}`);
  }
  if (command.type === 'request-human-intervention') {
    if (!command.reason.trim() || !command.requestedAt.trim()) {
      throw new Error('Human intervention requires a reason and time');
    }
    return {
      ...review,
      intervention: {
        requestedAt: command.requestedAt,
        requestedBy: 'implementer',
        reason: command.reason,
      },
    };
  }

  const current = currentReviewRound(review);
  if (current.decision?.kind !== 'changes-requested') {
    throw new Error('Implementer resolution requires requested changes');
  }
  validateResolutions(current.decision.findings, command.resolutions);
  if (!command.respondedAt.trim()) {
    throw new Error('Implementer resolution requires a response time');
  }
  changeRevision(command.resultingRevision);
  const completedRound: ReviewRound = {
    ...current,
    phase: 'pending-approval',
    disposition: 'CHANGES_MADE',
    response: {
      kind: 'resolved',
      respondedAt: command.respondedAt,
      resolutions: command.resolutions,
      resultingRevision: command.resultingRevision,
    },
  };
  return {
    ...review,
    rounds: replaceCurrentRound(review, completedRound),
    intervention: null,
  };
}

export function beginNextReviewRound(
  review: Review,
  reviewer: AgentFamily,
  implementer: AgentFamily,
  startedAt: string,
  reviewerEligibility: ConfiguredReviewerEligibility,
): Review {
  if (reviewStatus(review) !== 'ready-for-next-round') {
    throw new Error(`Cannot begin a new round while review is ${reviewStatus(review)}`);
  }
  requireEligibleReviewer(reviewer, reviewerEligibility);
  requireSeparateReviewer(reviewer, implementer, reviewerEligibility);
  if (!startedAt.trim()) { throw new Error('Review round requires a start time'); }
  const current = currentReviewRound(review);
  if (!current.response) { throw new Error('New review round requires an implementer resolution'); }
  return {
    ...review,
    rounds: [...review.rounds, {
      number: current.number + 1,
      subject: {
        change: current.subject.change,
        revision: current.response.resultingRevision,
      },
      reviewer,
      implementer,
      startedAt,
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    intervention: null,
  };
}

export function requestReviewIntervention(
  review: Review,
  intervention: ReviewIntervention,
): Review {
  if (reviewStatus(review) === 'approved') {
    throw new Error('Approved review cannot request human intervention');
  }
  if (!intervention.reason.trim() || !intervention.requestedAt.trim()) {
    throw new Error('Human intervention requires a reason and time');
  }
  return { ...review, intervention };
}

export function resumeReview(review: Review): Review {
  if (!review.intervention) {
    throw new Error('Review is not waiting for human intervention');
  }
  return { ...review, intervention: null };
}
