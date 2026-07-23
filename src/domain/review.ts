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

export interface ReviewRound {
  readonly number: number;
  readonly subject: ReviewedRevision;
  readonly reviewer: AgentFamily;
  readonly implementer: AgentFamily;
  readonly startedAt: string;
  readonly decision: ReviewerDecision | null;
  readonly response: ImplementerResolution | null;
}

export interface ReviewIntervention {
  readonly requestedAt: string;
  readonly requestedBy: 'reviewer' | 'implementer' | 'workflow';
  readonly reason: string;
}

/**
 * Review is an ordered conversation. The current state is derived from the
 * latest round and an optional human-intervention request.
 */
export interface Review {
  readonly rounds: readonly [ReviewRound, ...ReviewRound[]];
  readonly intervention: ReviewIntervention | null;
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
    }],
    intervention: null,
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
  return {
    ...review,
    rounds: replaceCurrentRound(review, { ...current, decision }),
  };
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
    response: {
      kind: 'resolved',
      respondedAt: command.respondedAt,
      resolutions: command.resolutions,
      resultingRevision: command.resultingRevision,
    },
  };
  return {
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
  if (!startedAt.trim()) { throw new Error('Review round requires a start time'); }
  const current = currentReviewRound(review);
  if (!current.response) { throw new Error('New review round requires an implementer resolution'); }
  return {
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
