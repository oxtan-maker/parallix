import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { ChangeIdentityPort } from '../approval-coverage.js';
import type { BeliefFailureKind } from '../verification-policy/belief.js';
import type { PolicyHistory } from '../verification-policy/history-adapter.js';
import type { PerAction, PolicyAction, PolicyArtifact, PolicyRejection } from '../verification-policy/policy-artifact.js';

export interface VerificationPolicyConfiguration {
  readonly mode: 'off' | 'shadow' | 'pilot';
  readonly artifact?: string;
}
export type ActiveVerificationPolicyConfiguration = VerificationPolicyConfiguration & {
  readonly mode: Exclude<VerificationPolicyConfiguration['mode'], 'off'>;
};
export type PolicyLoadResult =
  | { readonly mode: 'off' }
  | { readonly mode: 'shadow'; readonly hash: string; readonly artifact: PolicyArtifact }
  | { readonly mode: 'fixed'; readonly reason: 'missing' | 'invalid' | 'unreadable' | 'hash-mismatch'; readonly rejection?: PolicyRejection };
/** One loader per mission entry; callers retain its canonical pin across observations. */
export type PolicyArtifactLoader = (expectedHash?: string) => PolicyLoadResult;

type ArtifactFailure = Extract<PolicyLoadResult, { mode: 'fixed' }>['reason'];
type HistoryFailure = Extract<PolicyHistory, { ok: false }>['failure']['kind'];

/** Observation-specific codes derive policy failures from their canonical owners. */
export type ReviewStartFailureKind =
  | `artifact-${ArtifactFailure}`
  | `history-${HistoryFailure}`
  | `belief-${BeliefFailureKind}`
  | 'no-recommendation'
  | 'human-turn-unavailable'
  | 'mode-changed-in-flight'
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

/** One append-only pilot pin, fixed for the lifetime of a Mission: the mode and artifact it entered review under. */
export interface ReviewEntryPin {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  readonly changeIdentity: string | null;
  readonly configuredMode: 'pilot';
  readonly actionSequence: 1;
  readonly artifactSha256: string | null;
  readonly failureReason: ReviewStartFailure | null;
  readonly recordedAt: string;
}

export type ReviewEntryPinInput = Pick<ReviewEntryPin,
  'missionId' | 'repositoryId' | 'changeIdentity' | 'artifactSha256' | 'failureReason'> & {
  readonly configuredMode: ActiveVerificationPolicyConfiguration['mode'];
};

/** Complete append-only review-start observation. Unknown values are explicit nulls. */
export interface ReviewStartDecision {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  readonly changeIdentity: string | null;
  readonly configuredMode: Exclude<VerificationPolicyConfiguration['mode'], 'off'>;
  readonly effectiveMode: Exclude<PolicyLoadResult['mode'], 'off'> | 'pilot';
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
  readonly failureReason: ReviewStartFailure | null;
  readonly recordedAt: string;
}

/** Shared facts presented after any verification-action start commits. */
export interface VerificationActionStartFactsBase<Action extends PolicyAction> {
  readonly missionId: MissionId;
  readonly actualAction: Action;
  readonly revision: string;
  readonly verdictCorrelation: string;
  readonly agentRunId: string | null;
  readonly operatorInvocation: boolean;
  /** The reason the pilot's own selection fell back; the start record carries it instead of re-deriving a different one. */
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
  'schemaVersion' | 'idempotencyKey' | 'recordedAt' | 'actionSequence'>;

/** Policy mechanisms composed only when verificationPolicy is active. */
export interface ReviewStartPolicyPorts {
  readonly configuration: ActiveVerificationPolicyConfiguration;
  readonly repositoryId: RepositoryId;
  readonly targetBranch: string;
  readonly operationId: string | null;
  readonly loadPolicy: (_expectedHash?: string) => Exclude<PolicyLoadResult, { mode: 'off' }>;
  readonly readHistory: (_signal: AbortSignal) => Promise<PolicyHistory>;
  readonly identity: ChangeIdentityPort;
  readonly writer: {
    recordReviewStartDecision(_input: ReviewStartDecisionInput): Promise<boolean>;
    resolveReviewEntryPin(_input: ReviewEntryPinInput): Promise<ReviewEntryPin | null>;
  };
  readonly diagnostic: (_failure: ReviewStartFailure) => void;
}

/** Composition-time factory for one integration checkout and receiving branch. */
export type VerificationActionPolicyFactory = (_input: {
  readonly rootDir: string;
  readonly targetBranch: string;
  readonly slug: string;
}) => Omit<ReviewStartPolicyPorts, 'diagnostic'> | undefined;

/** How a policy-selected integration-test action ended; the executor's own typed outcome. */
export type PolicyTestsOutcome =
  | { readonly kind: 'not-selected' }
  | { readonly kind: 'completed'; readonly verdict: 'passed' | 'failed' | 'cancelled' }
  | { readonly kind: 'human-handoff'; readonly reason: string; readonly detail: string };

/** The pilot's choice: an action to run, or null with the typed reason the fixed policy stays in charge (absent when none applies). */
export interface PolicySelection {
  readonly action: PolicyAction | null;
  readonly failure: ReviewStartFailure | null;
}

/** Pilot-mode choices the loop acts on between rounds; composed only while verificationPolicy.mode is pilot. */
export interface PolicyActionPort {
  /** The policy's next unfinished check for the current change; null leaves the fixed policy in charge. */
  select(_facts: { readonly missionId: MissionId; readonly revision: string;
  }): Promise<PolicySelection>;
  /** Run the integration tests through the integrate workflow's own claim, rebase and gate owners. */
  runTests(_stillSelected: (_revision: string) => Promise<boolean>): Promise<PolicyTestsOutcome>;
  /** Tests actions already started for this Mission, from durable records; a restart resumes the count. */
  testsActionsSpent(): Promise<number>;
  /** A rebase stopped on conflicts is outside the model: no decision while it is open. */
  rebaseInProgress(): boolean;
}
