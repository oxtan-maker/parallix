import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { ChangeIdentityPort } from '../approval-coverage.js';
import type { BeliefFailureKind } from '../verification-policy/belief.js';
import type { PolicyHistory } from '../verification-policy/history-adapter.js';
import type { PerAction, PolicyAction, PolicyArtifact, PolicyRejection } from '../verification-policy/policy-artifact.js';

export interface VerificationPolicyConfiguration {
  readonly artifact?: string;
}
export type PolicyLoadResult =
  | { readonly kind: 'artifact'; readonly hash: string; readonly artifact: PolicyArtifact }
  | { readonly kind: 'fixed'; readonly reason: 'missing' | 'invalid' | 'unreadable' | 'hash-mismatch'; readonly rejection?: PolicyRejection };
/** One loader per mission entry; callers retain its canonical pin across observations. */
export type PolicyArtifactLoader = (expectedHash?: string) => PolicyLoadResult;

type ArtifactFailure = Extract<PolicyLoadResult, { kind: 'fixed' }>['reason'];
type HistoryFailure = Extract<PolicyHistory, { ok: false }>['failure']['kind'];

/** Observation-specific codes derive policy failures from their canonical owners. */
export type ReviewStartFailureKind =
  | `artifact-${ArtifactFailure}`
  | `history-${HistoryFailure}`
  | `belief-${BeliefFailureKind}`
  | 'no-recommendation'
  | 'policy-exception'
  | 'writer-failure'
  | 'observation-timeout';

/**
 * Diagnostic text paired with the stable observation code stored on the decision.
 * This is deliberately not the workflow FailureReason: observation failures do
 * not fail or steer the Mission and must remain outside its control protocol.
 */
export interface ReviewStartFailure {
  readonly kind: ReviewStartFailureKind;
  readonly message: string;
}

/** One append-only artifact pin, fixed for the lifetime of a Mission. */
export interface ReviewEntryPin {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  readonly changeIdentity: string | null;
  readonly actionSequence: 1;
  readonly artifactSha256: string | null;
  readonly failureReason: ReviewStartFailure | null;
  readonly recordedAt: string;
}

export type ReviewEntryPinInput = Pick<ReviewEntryPin,
  'missionId' | 'repositoryId' | 'changeIdentity' | 'artifactSha256' | 'failureReason'>;

/** Complete append-only review-start observation. Unknown values are explicit nulls. */
export interface ReviewStartDecision {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  readonly changeIdentity: string | null;
  readonly artifactSha256: string | null;
  readonly recommendedAction: PolicyAction | null;
  readonly predictedPassProbability: PerAction<number | null>;
  readonly actualAction: PolicyAction;
  readonly operatorOverride: boolean;
  readonly verdictCorrelation: string;
  readonly agentRunId: string | null;
  readonly gateRunId: string | null;
  readonly operationId: string | null;
  readonly actionSequence: number;
  /**
   * Whether this action had already started once for the same change identity.
   * Null when the change identity is unknown; absent on rows recorded before it was kept.
   */
  readonly sameRevisionRerun?: boolean | null;
  readonly failureReason: ReviewStartFailure | null;
  readonly recordedAt: string;
}

/** Who stood behind a recorded verdict. `reviewer` is the agent reviewer: a changes-requested decision with no operator source. */
export type ReviewVerdictSource = 'reviewer' | 'classifier' | 'operator' | 'provider' | 'local' | 'mechanical-restoration';

/** What one implementer response that disputed findings led to; null when the review answered none. */
export interface ReviewRebuttalOutcome {
  readonly disputedFindings: number;
  /** Findings the same response fixed; 0 marks a pure rebuttal. */
  readonly fixedFindings: number;
  /** The settled round decision of the review that judged the revision the response produced; null while none exists, and for an approval that was later withdrawn. */
  readonly renewedVerdict: 'approved' | 'changes-requested' | null;
}

/**
 * Append-only observation of how one review start ended, settled from the review
 * round and run records already stored. Every unobserved value is an explicit null,
 * never zero, an empty list or an estimate.
 */
export interface ReviewStartOutcome {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  /** Repository that owns the settled start; absent on rows recorded before ownership was kept. */
  readonly repositoryId?: RepositoryId;
  /** Idempotency key of the review-start decision this settles. */
  readonly startKey: string;
  readonly missionId: MissionId;
  readonly changeIdentity: string | null;
  readonly actualAction: PolicyAction;
  /** Wall time of the agent run from its run record; null when the run record or its end is missing. */
  readonly runDurationMs: number | null;
  /** Agent review time: round start to this reviewer's own publication (or the round decision when the round has none); null with neither. */
  readonly reviewMs: number | null;
  /** Human wait: handoff start to the human decision; null with no decision or no start time. */
  readonly humanWaitMs: number | null;
  /** Findings of the decision this action produced; null when no decision was recorded. */
  readonly findingCount: number | null;
  readonly verdictSource: ReviewVerdictSource | null;
  /**
   * Whether the check this start ran passed, matched to the start's predicted pass probability: an agent approval is a
   * pass, a changes-requested verdict or an operator rejection after a human handoff is not. Null when unobserved
   * (a human handoff ended by merge leaves no decision); absent on rows recorded before it was kept.
   */
  readonly passed?: boolean | null;
  readonly rebuttal: ReviewRebuttalOutcome | null;
  readonly recordedAt: string;
}

/** Durable cancellation of the concurrent human request after the two automated verdicts have joined. */
export interface HumanReviewWithdrawal {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  readonly changeIdentity: string;
  readonly round: number;
  readonly reason: 'automated-failure';
  readonly recordedAt: string;
}
export type HumanReviewWithdrawalInput = Pick<HumanReviewWithdrawal,
  'missionId' | 'repositoryId' | 'changeIdentity' | 'round' | 'reason'>;

export type ReviewStartOutcomeInput = Omit<ReviewStartOutcome, 'schemaVersion' | 'idempotencyKey' | 'recordedAt'>;

/** The stored facts an outcome is settled from. */
export interface ReviewOutcomeFacts {
  readonly review: import('../../domain/review.js').Review | null;
  /** Agent run windows by run id; endedAt null is a run with no recorded end. */
  readonly runs: readonly { readonly runId: string; readonly startedAt: string | null; readonly endedAt: string | null }[];
}

/** Shared facts presented after any verification-action start commits. */
export interface VerificationActionStartFactsBase<Action extends PolicyAction> {
  readonly missionId: MissionId;
  readonly actualAction: Action;
  readonly revision: string;
  readonly verdictCorrelation: string;
  readonly agentRunId: string | null;
  readonly operatorInvocation: boolean;
  /** The reason selection fell back; the start record carries it instead of re-deriving a different one. */
  readonly selectionFailure?: ReviewStartFailure | null;
}

/** Durable review-action facts presented to optional observers. */
export type ReviewStartFacts = VerificationActionStartFactsBase<Exclude<PolicyAction, 'tests'>>;

/** Durable facts for the integration tests action after its gate-run start commits. */
export interface TestsActionStartFacts extends VerificationActionStartFactsBase<'tests'> {
  readonly agentRunId: null;
  readonly gateRunId: string;
}

/** Every currently observed verification action uses the slice-9 decision contract. */
export type VerificationActionStartFacts = ReviewStartFacts | TestsActionStartFacts;

/** Facts known at the start boundary; the one writer assigns the durable sequence. */
export type ReviewStartDecisionInput = Omit<ReviewStartDecision,
  'schemaVersion' | 'idempotencyKey' | 'recordedAt' | 'actionSequence' | 'sameRevisionRerun'>;

/** Policy mechanisms composed for every verification workflow. */
export interface ReviewStartPolicyPorts {
  readonly configuration: VerificationPolicyConfiguration;
  readonly repositoryId: RepositoryId;
  readonly targetBranch: string;
  readonly operationId: string | null;
  readonly loadPolicy: PolicyArtifactLoader;
  readonly readHistory: (_signal: AbortSignal) => Promise<PolicyHistory>;
  readonly identity: ChangeIdentityPort;
  readonly writer: {
    recordReviewStartDecision(_input: ReviewStartDecisionInput): Promise<boolean>;
    resolveReviewEntryPin(_input: ReviewEntryPinInput): Promise<ReviewEntryPin | null>;
    /** Append the outcome of every settled start of the Mission not yet recorded; returns how many rows were new. */
    settleReviewStartOutcomes(_missionId: MissionId,
      _build: (_start: ReviewStartDecision, _later: readonly ReviewStartDecision[], _all: readonly ReviewStartDecision[]) => ReviewStartOutcomeInput | null): Promise<number>;
    /** Reuse operational history for the cancellation; no persistence schema change is needed. */
    recordHumanReviewWithdrawal?(_input: HumanReviewWithdrawalInput): Promise<boolean>;
    /** Exact round/change cancellation fence used by human-verdict consumers. */
    isHumanReviewWithdrawn?(_input: Pick<HumanReviewWithdrawalInput,
      'missionId' | 'repositoryId' | 'changeIdentity' | 'round'>): Promise<boolean>;
  };
  /** The stored review rounds and run records an outcome is settled from; unreadable is a throw, never empty. */
  readonly readOutcomeFacts: (_missionId: MissionId) => Promise<ReviewOutcomeFacts>;
  readonly diagnostic: (_failure: ReviewStartFailure) => void;
}

/** Composition-time factory for one integration checkout and receiving branch. */
export type VerificationActionPolicyFactory = (_input: {
  readonly rootDir: string;
  readonly targetBranch: string;
  readonly slug: string;
}) => Omit<ReviewStartPolicyPorts, 'diagnostic'>;

/** How a policy-selected integration-test action ended; the executor's own typed outcome. */
export type PolicyTestsOutcome =
  | { readonly kind: 'not-selected' }
  | { readonly kind: 'completed'; readonly verdict: 'passed' | 'failed' | 'cancelled';
    /** True only when the post-failure policy selection chose tests again before rebound began. */
    readonly retryWithoutRepair?: boolean;
    /** Pinned failed-run identity included in the one joined repair prompt. */
    readonly repairBrief?: string }
  | { readonly kind: 'human-handoff'; readonly reason: string; readonly detail: string };

/** The policy choice: an action to run, or null with the typed reason the fixed policy stays in charge (absent when none applies). */
export interface PolicySelection {
  readonly action: PolicyAction | null;
  readonly failure: ReviewStartFailure | null;
}

/** Policy choices the loop acts on between rounds. */
export interface PolicyActionPort {
  /** The policy's next unfinished check for the current change; null leaves the fixed policy in charge. */
  select(_facts: { readonly missionId: MissionId; readonly revision: string;
  }): Promise<PolicySelection>;
  /** Static concurrent delivery tree carried by the pinned artifact; null keeps the serial fixed workflow. */
  selectRound?(_facts: { readonly missionId: MissionId; readonly revision: string }): Promise<{
    readonly plan: import('../verification-policy/policy-artifact.js').PolicyRoundPlan | null;
    readonly failure: ReviewStartFailure | null;
  }>;
  /** Run the integration tests through the integrate workflow's own claim, rebase and gate owners. */
  runTests(_stillSelected: (_revision: string) => Promise<boolean>): Promise<PolicyTestsOutcome>;
  /** Rule-(a) tests run on the prepared revision. A red run waits for the agent verdict before choosing its one repair owner. */
  runConcurrentTests?(_beforeGateRepair: () => Promise<void>, _sameRevision: (_revision: string) => Promise<boolean>,
    _jointRepair: (_revision: string) => Promise<boolean>, _preparedRevision: string): Promise<PolicyTestsOutcome>;
  /** Fence and durably record cancellation of the human request for this round. */
  withdrawHuman?(_facts: { readonly missionId: MissionId; readonly revision: string; readonly round: number }): Promise<boolean>;
  /** A rebase stopped on conflicts is outside the model: no decision while it is open. */
  rebaseInProgress(): boolean;
}
