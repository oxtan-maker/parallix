/**
 * Mechanism ports for the application-owned autonomous review loop.
 *
 * Each port reports facts about one external mechanism — review persistence,
 * the Backlog task mirror, the review provider, reviewer routing, agent
 * launches, review artifacts, and the pre-review Git/gate checks. None of them
 * decides what happens next: `src/application/review-loop/` interprets the
 * facts and sequences every effect.
 */
import type { ReviewLoopEvent } from './review-loop-output.js';
import type { PullRequestReference } from '../../domain/review.js';
import type { GateFailureReason, HookFailureReason, ReboundReason } from '../rebound-kernel.js';
import type { MissionStore } from '../domain-ports.js';
import type { MissionLifecycleService } from '../mission-lifecycle-service.js';

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

export interface PersistedReviewRound {
  readonly round: number;
}

/** One `px review --start|--continue` request, as parsed by the CLI adapter. */
export interface StartReviewRound {
  readonly slug: string;
  readonly implementer?: string;
  readonly reviewer?: string;
  readonly focus: string;
  readonly maxAttempts: number;
  readonly dryRun: boolean;
  readonly reset: boolean;
  readonly isContinue: boolean;
  readonly verbose: boolean;
  readonly pollTimeoutSeconds: number | null;
  readonly missionPath?: string;
}

/** Entry facts and effects `ReviewRoundUseCase` needs before the loop runs. */
export interface ReviewRoundEntryPort {
  loadRound(_slug: string): Promise<PersistedReviewRound | null>;
  isKnownMission(_slug: string): Promise<boolean>;
  clearHumanIntervention(_slug: string): Promise<void>;
  invalidateResolvedBlocker(_slug: string): Promise<void>;
  invalidMaxAttempts(_raw: string): void;
  missingReviewAggregate(_slug: string): void;
  /** Bind the review mechanisms for this request; the application runs the loop. */
  mechanisms(_request: StartReviewRound): Promise<ReviewLoopPorts> | ReviewLoopPorts;
}

/* ------------------------------------------------------------------ *
 * Review state
 * ------------------------------------------------------------------ */

/** The persisted review round the loop advances (the adapter's ReviewState). */
export interface ReviewLoopState {
  readonly slug: string;
  reviewer?: string;
  implementer?: string;
  round: number;
  startedAt: string;
  phase: string;
  disposition: string | null;
  metadata: Record<string, unknown>;
  pullRequest: PullRequestReference | null;
  transitionTo(_phase: string): unknown;
  advanceRound(): unknown;
}

/** Review-round persistence for one Mission. */
export interface ReviewStatePort {
  read(): Promise<ReviewLoopState | null>;
  /** Persist an already-decided state; throws when the write does not commit. */
  persist(_state: ReviewLoopState): Promise<void>;
  /** Discard the persisted state; true when a reset was committed. */
  reset(): Promise<boolean>;
  /** A fresh in-memory round (not yet persisted). */
  create(_identity: { reviewer?: string; implementer?: string }): ReviewLoopState;
  /** The persisted round as a mutable state value. */
  resume(_persisted: ReviewLoopState): ReviewLoopState;
  /** Persist a canonical phase when the stored phase was an alias. */
  repairInvalidPhase(_state: ReviewLoopState): Promise<void>;
  /** Persist the round-open boundary; false after the diagnostic was emitted. */
  openRound(_state: ReviewLoopState): Promise<boolean>;
}

/* ------------------------------------------------------------------ *
 * Backlog task mirror
 * ------------------------------------------------------------------ */

export type TaskFileFacts = { ok: boolean; taskFile?: string; matches: string[]; reason?: string };

/** The Backlog task file mirror of the Mission lane. */
export interface ReviewTaskMirrorPort {
  readonly task: TaskFileFacts;
  /** The task's recorded implementer, when a task file exists. */
  implementer(): string | null;
  status(): string | null;
  /** Report an unresolved task file to the operator. */
  reportUnresolved(): void;
  mirror(_lane: 'active' | 'review', _implementer?: string): Promise<void>;
  /** Mirror the approved virtual state onto the task. */
  mirrorApproved(): Promise<void>;
  /** Record a fallback implementer as assignee; false when it could not. */
  assign(_implementer: string): boolean;
}

/* ------------------------------------------------------------------ *
 * Handoff
 * ------------------------------------------------------------------ */

/** What the handoff mechanism observed. */
export interface HandoffFacts {
  readonly ok?: boolean;
  readonly gatekeeperPushedBack?: boolean;
  readonly reason?: string;
  readonly recoveryAttempted?: boolean;
  readonly error?: unknown;
}

export interface ReviewHandoffPort {
  handoff(_implementer: string): Promise<HandoffFacts | null | undefined>;
}

/* ------------------------------------------------------------------ *
 * Review provider
 * ------------------------------------------------------------------ */

/** Sentinel for a provider poll that saw nothing before its deadline. */
export const POLL_TIMEOUT = Object.freeze({ __isPollTimeout: true });

/**
 * Identify the poll-timeout sentinel by identity or by its brand: a module graph
 * may evaluate this file more than once, yielding equal but distinct sentinels.
 */
export function isPollTimeout(result: unknown): boolean {
  if (result === POLL_TIMEOUT) { return true; }
  return typeof result === 'object'
    && result !== null
    && (result as { __isPollTimeout?: unknown }).__isPollTimeout === true;
}

export type ProviderPoll = string | null | typeof POLL_TIMEOUT;

export interface ProviderPollRequest {
  readonly label: string;
  /** A short skip-check probe rather than the full outcome wait. */
  readonly quick?: boolean;
  readonly retryCount?: number;
}

/** The configured external review provider; null when the provider is disabled. */
export interface ReviewProviderPort {
  /** Probe, and bootstrap once when unreachable; false after the diagnostic. */
  ensureReachable(): Promise<boolean>;
  /** The open review pull request for the mission branch, if one exists. */
  openPullRequest(): PullRequestReference | null;
  latestReview(_reviewer: string, _sinceIso: string): Promise<string | null>;
  pollReview(_reviewer: string, _sinceIso: string, _request: ProviderPollRequest): Promise<ProviderPoll>;
  pollDisposition(_implementer: string, _sinceIso: string, _request: ProviderPollRequest): Promise<ProviderPoll>;
  /** Push the mission branch to the review remote; null without push credentials. */
  publishRevision(): { ok: boolean; detail: string; status: number | null } | null;
}

/** An operator correction reconciled from the provider before an agent launch. */
export interface HumanReviewFeedback {
  readonly source: string;
  readonly author: string;
  readonly state: 'current' | 'dismissed';
  readonly disposition: 'REQUEST_CHANGES' | null;
  /** A dismissed approval is the only dismissed provider decision that blocks continuation. */
  readonly approval: boolean;
  readonly reason: string;
  readonly findings: readonly { id: string; summary: string }[];
}

/**
 * Provider feedback is an input fact, not a workflow decision.  The loop
 * consumes it before choosing a reviewer or implementer action.
 */
export interface HumanFeedbackPort {
  reconcile(_state: ReviewLoopState): Promise<HumanReviewFeedback | null>;
}

/**
 * Stands down the effective approval of a round when a human's current change
 * request on the provider supersedes it.  The provider author is the operator
 * of record; a failed revocation leaves the correction unconsumed.
 */
export interface ApprovalRevocationPort {
  revoke(_request: { readonly round: number; readonly operator: string; readonly reason: string }): Promise<{ readonly ok: true } | { readonly ok: false; readonly diagnostic: string }>;
}

/* ------------------------------------------------------------------ *
 * Reviewer routing and agent launches
 * ------------------------------------------------------------------ */

export interface LauncherStatus { supported: boolean; detail: string }

/** Which configured families can review right now. */
export interface ReviewerRoutingPort {
  eligibleFamilies(): string[];
  launcherStatus(_agent: string): LauncherStatus;
  /** The configured selector's nominee outside `excluded`; throws when none. */
  nominate(_excluded: ReadonlySet<string>): string;
  /** The runtime matrix, one line per route, for a no-route diagnostic. */
  runtimeMatrix(): string[];
}

export type ReviewRole = 'reviewer' | 'implementer';

/** The facts a reviewer or act-on-review prompt is rendered from. */
export interface ReviewPromptFacts {
  readonly reviewer: string;
  readonly implementer: string;
  readonly attempt: number;
  readonly reviewBaseline: string | undefined;
  readonly integrationRepair: string;
  readonly reviewOutcome?: unknown;
  readonly humanFeedback?: string;
}

export interface ReviewAgentLaunch {
  readonly role: ReviewRole;
  readonly agent: string;
  readonly exclude: readonly (string | undefined)[];
  /** The role prompt; absent for a bare repair launch that carries only `recovery`. */
  readonly prompt?: ReviewPromptFacts;
  /** Recovery instructions appended to the role prompt by a rebound. */
  readonly recovery?: { prompt: (_actualAgent: string) => unknown; sessionPolicy?: unknown };
}

export interface ReviewAgentLaunchResult {
  /** The family the launcher actually ran (differs after a capacity fallback). */
  readonly agent?: string | null;
  readonly result?: { status?: number | null; startedAt?: string; endedAt?: string; [key: string]: unknown } | null;
}

export interface ReviewAgentPort {
  /** Launch a role; throws when the launcher cannot start it. */
  launch(_launch: ReviewAgentLaunch): Promise<ReviewAgentLaunchResult | null | undefined>;
  /** The full prompt a dry run prints for a role. */
  dryRunPrompt(_role: ReviewRole, _facts: ReviewPromptFacts): string;
  /** Best-effort stage telemetry for a completed launch. */
  recordStage(_role: ReviewRole, _state: ReviewLoopState, _identity: { reviewer?: string; implementer?: string }, _launch: ReviewAgentLaunchResult | null | undefined): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Review artifacts
 * ------------------------------------------------------------------ */

export interface ReviewerArtifactFacts {
  readonly consumed: boolean;
  readonly ok?: boolean;
  readonly diagnostic?: string;
  readonly reviewState?: string | null;
  readonly reviewFindings?: { id: string; summary: string }[];
}

export interface ImplementerArtifactFacts {
  readonly consumed: boolean;
  readonly ok?: boolean;
  readonly diagnostic?: string;
  readonly disposition?: string | null;
  readonly changedRevision?: boolean;
}

/** Workflow output written by the reviewer and implementer for this round. */
export interface ReviewArtifactPort {
  consumeReviewer(_reviewer: string, _state?: ReviewLoopState): Promise<ReviewerArtifactFacts>;
  consumeImplementer(_implementer: string, _state?: ReviewLoopState): Promise<ImplementerArtifactFacts>;
}

/**
 * Artifact consumers mark downstream provider/storage failures with "post
 * failed" or "persist failed": an infrastructure blocker no relaunch can fix.
 */
export function isArtifactInfraDiagnostic(diagnostic: string | undefined | null): boolean {
  if (!diagnostic) { return false; }
  return diagnostic.includes('post failed') || diagnostic.includes('persist failed');
}

/* ------------------------------------------------------------------ *
 * Pre-review checks
 * ------------------------------------------------------------------ */

export type PreReviewRebaseFacts =
  | { readonly ok: true }
  | {
    readonly ok: false;
    /** The push-time verification gate rejected the rebase. */
    readonly gate?: { readonly area: string; readonly exitCode: number | null; readonly command: string; readonly operation: string; readonly reason: GateFailureReason };
    /** A Git hook rejected the rebase or its safety commit. */
    readonly hook?: HookFailureReason;
    /** Diagnostic and reason when this rebase re-runs a repair's verification. */
    readonly diagnostic: string;
    readonly verifyReason?: ReboundReason;
  };

export type PreReviewGateFacts =
  | { readonly ok: true }
  | { readonly ok: false; readonly area: string; readonly exitCode: number | null; readonly diagnostic: string; readonly reason: GateFailureReason };

/** The mission worktree's pre-review Git and verification mechanisms. */
export interface PreReviewPort {
  refreshKnowledgeGraph(): Promise<void>;
  rebase(): Promise<PreReviewRebaseFacts>;
  runGate(): Promise<PreReviewGateFacts>;
  /** The primary-branch revision the reviewer compares against. */
  reviewBaseline(): string | undefined;
  head(): string | null;
}

/* ------------------------------------------------------------------ *
 * Operator output, current work, and the controller fence
 * ------------------------------------------------------------------ */

export interface ReviewLoopOutput {
  emit(_event: ReviewLoopEvent): void;
  log(_message: string): void;
  error(_message: string): void;
  exit(_code: number): void;
  onAgentLaunched?(_agent: string, _phase: 'review' | 'review-response'): Promise<void> | void;
  onAutonomousStop?(_reason: string): Promise<void> | void;
}

/** A process-local single-controller fence for one mission worktree. */
export interface ReviewControllerLock {
  tryAcquire(): boolean;
  release(): void;
}

/* ------------------------------------------------------------------ *
 * The bound mechanism set
 * ------------------------------------------------------------------ */

export interface ReviewLoopPorts {
  readonly branch: string;
  /** The mission worktree, quoted in repair prompts. */
  readonly worktree: string;
  /** Provider poll cadence, reported in verbose output. */
  readonly polling: { readonly intervalMs: number; readonly timeoutMs: number };
  readonly state: ReviewStatePort;
  readonly task: ReviewTaskMirrorPort;
  readonly handoff: ReviewHandoffPort | null;
  readonly provider: ReviewProviderPort | null;
  readonly humanFeedback: HumanFeedbackPort;
  /** Null when no mission authority is bound; the loop then stops with `px revoke-review` guidance. */
  readonly approvalRevocation?: ApprovalRevocationPort | null;
  readonly routing: ReviewerRoutingPort;
  readonly agents: ReviewAgentPort;
  readonly artifacts: ReviewArtifactPort;
  readonly preReview: PreReviewPort;
  readonly output: ReviewLoopOutput;
  readonly lock: ReviewControllerLock;
  readonly classification?: import('./review-classification.js').ReviewClassificationPorts;
  readonly missionStore: MissionStore | null;
  readonly lifecycle: MissionLifecycleService | null;
}

/** One autonomous review run, with the loop's tuning knobs. */
export interface ReviewLoopRequest {
  readonly slug: string;
  readonly implementer?: string;
  readonly reviewer?: string;
  readonly focus?: string;
  readonly maxAttempts?: number;
  readonly reboundsPerRound?: number;
  readonly dryRun?: boolean;
  readonly reset?: boolean;
  readonly isContinue?: boolean;
  /** The caller already ran the handoff transition (e.g. `px active` repair). */
  readonly skipHandoff?: boolean;
  readonly verbose?: boolean;
}
