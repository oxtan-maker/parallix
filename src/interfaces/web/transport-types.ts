import type { ProviderExecutionFacts } from '../../application/projections/provider-execution.js';
import type { RepairBudgetFacts } from '../../application/projections/repair-budget.js';
/**
 * Web transport wire vocabulary: the versioned DTO types, request kinds, and
 * the `WebTransportError` raised when a value cannot cross the JSON wire.
 */



export const WEB_TRANSPORT_VERSION = 2 as const;
export type WebTransportVersion = typeof WEB_TRANSPORT_VERSION;
export const SUPPORTED_WEB_TRANSPORT_VERSIONS: readonly number[] = [WEB_TRANSPORT_VERSION];

// ---------------------------------------------------------------------------
// Wire vocabulary — self-contained literals, no domain brands across the wire
// ---------------------------------------------------------------------------

export type WebBoardLane = 'backlog' | 'refined' | 'active' | 'review' | 'integration' | 'done';
export type WebBoardCommandKind =
  | 'workflow:stop'
  | 'active:execute'
  | 'mission:intake'
  | 'mission:create'
  | 'mission:edit-read'
  | 'mission:edit'
  | 'draft:create'
  | 'checkpoint:record'
  | 'review:submit'
  | 'review:act-on-findings'
  | 'approve:review'
  | 'integrate:merge'
  | 'mission:cancel';
export type WebCommandActionState = 'enabled' | 'ineligible' | 'unavailable';
export type WebGateState = 'unconfigured' | 'not-run' | 'running' | 'passed' | 'failed' | 'stale' | 'unavailable';
export type WebWorkCertainty = 'live' | 'unknown' | 'stale';
export type WebAttentionReasonKind =
  | 'blocking'
  | 'gate-failed'
  | 'review-lane'
  | 'integrate-lane'
  | 'stale-work'
  | 'orphaned-active'
  | 'none';
export type WebTerminalStatus = 'accepted' | 'completed' | 'rejected' | 'failed' | 'cancelled';
export type WebErrorKind = 'validation' | 'capability' | 'conflict' | 'unavailable' | 'execution' | 'cancelled';
export type WebEvidenceSource = 'task-markdown' | 'git' | 'stats' | 'mission-store';

/**
 * A millisecond duration that may be indefinite. `Infinity` in the domain is
 * the indefinite agent block; on the wire it is a dedicated tag so it can
 * never serialize to `null`.
 */
export type WebDurationMs =
  | { readonly kind: 'finite'; readonly ms: number }
  | { readonly kind: 'indefinite' };

/** Authoritative mission work, projected from `projectMissionActivity`. */
export type WebMissionWork =
  | {
    readonly kind: 'working';
    readonly certainty: WebWorkCertainty;
    readonly phase: string;
    readonly summary: string;
    readonly agent: string | null;
    readonly operationId: string;
  }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'idle' };

/** Recovery-only coordinator evidence. `unknown` means the scan never ran. */
export type WebCoordinatorEvidence =
  | { readonly state: 'live'; readonly family: string | null }
  | { readonly state: 'stopped' }
  | { readonly state: 'unknown' };

export interface WebMissionActivity {
  readonly work: WebMissionWork;
  readonly coordinator: WebCoordinatorEvidence;
}

/**
 * One rendered action. `state` and `reason` are server-owned: the client
 * renders them without the capability registry or lane rules.
 */
export interface WebCommandAction {
  readonly kind: WebBoardCommandKind;
  readonly display: string;
  readonly state: WebCommandActionState;
  /** Non-null exactly when `state` is not `enabled`. */
  readonly reason: string | null;
  /** Server-owned drag/drop destination; null means this action is button-only. */
  readonly targetLane: WebBoardLane | null;
  /**
   * Optional short verb for this action in the mission's current state (the
   * server's word, e.g. `resume`). Absent when the command reads the same in
   * every state; `display` stays the accessible name either way.
   */
  readonly label?: string;
}

/** Wire mirror of the domain `PullRequestReference` — six keys, `url` nullable. */
export interface WebPullRequestReference {
  readonly kind: 'pull-request';
  readonly provider: string;
  readonly id: string;
  readonly url: string | null;
  readonly sourceBranch: string;
  readonly targetBranch: string;
}

/** Wire mirror of review history, oldest first. */
export interface WebReviewRoundSummary {
  readonly startRevision?: string;
  readonly decidedRevision?: string | null;
  readonly number: number;
  readonly reviewer: string;
  readonly implementer: string;
  readonly phase: string;
  readonly disposition: string | null;
  readonly comment: string | null;
  readonly findingSummaries: readonly string[];
  readonly pushbacks: readonly string[];
  readonly fixes: readonly string[];
}

export interface WebGoalCheckRow {
  readonly criterion: string;
  readonly evidence: string;
  readonly recordedRound?: number;
  readonly repairedGate?: string;
  readonly repairedGates?: readonly string[];
}

/**
 * Wire mirror of one checkpoint's evidence: its name, first-line description, and
 * Goal Check rows. Optional on the wire — a snapshot built before this field exists
 * omits it and the client reads it as "no evidence", never malformed.
 */
export interface WebCheckpointEvidence {
  readonly name: string;
  readonly description: string;
  readonly goalCheck: readonly WebGoalCheckRow[];
  /** Server-owned progress state; omitted by older snapshots. */
  readonly state?: 'completed' | 'current' | 'future';
}

export interface WebMissionCard {
  readonly execution?: ProviderExecutionFacts;
  readonly id: string;
  readonly title: string;
  readonly lane: WebBoardLane;
  readonly status: WebBoardLane;
  readonly closed: boolean;
  readonly agent: string | null;
  readonly checkpoint: string | null;
  /** Null when the authoritative work fact does not name a checkpoint. */
  readonly currentCheckpoint?: string | null;
  readonly checkpointDescription: string | null;
  /**
   * Per-checkpoint evidence for the mission, oldest first. Optional-and-nullable:
   * the server always sends it, but an omitted field on an older snapshot reads as
   * "no evidence" rather than a malformed card.
   */
  readonly checkpointEvidence?: readonly WebCheckpointEvidence[];
  readonly nextActionText: string | null;
  readonly gate: WebGateState;
  readonly pullRequest: WebPullRequestReference | null;
  readonly reviewApproved: boolean;
  readonly reviewRound: number | null;
  readonly reviewPhase: string | null;
  /** The application-owned recovery decision; null when recovery is not applicable. */
  readonly reviewRecovery: import('../../application/review-recovery.js').ReviewRecovery | null;
  readonly reviewDisposition: string | null;
  readonly reviewHistory: readonly WebReviewRoundSummary[];
  /** Autonomous attempts per review entry; never a validity bound on reviewRound. */
  readonly reviewWindowAllowance?: number | null;
  /** The retained repair-attempt budget; null when the mission retains no repair fact. */
  readonly repairBudget?: RepairBudgetFacts | null;
  readonly blockingReason: string | null;
  readonly flags: readonly string[];
  readonly activity: WebMissionActivity;
  readonly actions: readonly WebCommandAction[];
}

export interface WebStage {
  readonly historyCards?: readonly WebMissionCard[];
  readonly lane: WebBoardLane;
  readonly count: number;
  readonly cards: readonly WebMissionCard[];
}

export interface WebAttentionItem {
  readonly missionId: string;
  readonly rank: number;
  readonly reason: { readonly kind: WebAttentionReasonKind; readonly detail: string | null };
  readonly action: WebCommandAction | {
    /** No direct lifecycle command; display offers bounded lead investigation. */
    readonly kind: 'manual'; readonly display: string;
    readonly state: 'ineligible'; readonly reason: string; readonly targetLane: null;
  } | null;
  readonly dependsOnSources: readonly string[];
}

export interface WebOperationLogEntry {
  readonly operationId: string;
  readonly phase: string;
  readonly message: string;
  readonly timestamp: string;
  /** Producer progress sequence when available; paired with operationId. */
  readonly sequence?: number;
  /** Optional: omitted when the entry has no agent, never `null`. */
  readonly agent?: string;
}

export interface WebAgentAvailability {
  readonly family: string;
  readonly available: boolean;
  readonly blockedFor: WebDurationMs;
  readonly reason: string | null;
  /** Confirmed provider invocations for the family; `0` means none were confirmed. Omitted before an execution reader ran. */
  readonly runningSessions?: number;
}

export interface WebSourceFact {
  /** One fact per `(source, status, value)` tuple in a board snapshot; repeats are collapsed. */
  readonly source: string;
  readonly status: string;
  /** Optional: omitted when the fact carries no value. */
  readonly value?: string;
}

/** The typed FLOW projection carried unchanged on the wire; browsers format and lay it out, never recalculate it. */
export type WebFlowStatistics = import('../../application/projections/flow-statistics.js').FlowStatistics;
export type WebFlowWindow = import('../../application/projections/flow-statistics.js').FlowWindowStatistics;
export type WebFlowLane = import('../../application/projections/flow-statistics.js').FlowLaneId;
export type WebFlowNodeId = import('../../application/projections/flow-statistics.js').FlowNodeId;
export type WebFlowEdge = import('../../application/projections/flow-statistics.js').FlowGraphEdge;
export type WebFlowNode = import('../../application/projections/flow-statistics.js').FlowGraphNode;
export type WebFlowTimeRow = import('../../application/projections/flow-statistics.js').FlowTimeTableRow;

export interface WebBoardMetrics {
  readonly verification?: readonly string[];
  /** Typed shared FLOW statistics; browser consumers format but never recalculate these values. */
  readonly flow?: WebFlowStatistics;
  /** Why FLOW is absent: its observation read failed. Shown as a failure, never replaced by values. */
  readonly flowUnavailable?: string;
  /** Deliveries in the server-selected local reporting week; absent when unavailable. */
  readonly weeklyCompletedMissions?: number;
  readonly health: { readonly state: string };
  readonly provenance: { readonly sampleSize: number; readonly newestEventTimestamp: string | null };
  /** The rolling week that FLOW uses, shared with the board's decision metrics. */
  readonly flowWindow?: { readonly startDate: string; readonly endDate: string; readonly label: string };
  readonly bottleneck: { readonly sentence: string };
}

export interface WebBoardSnapshot {
  readonly kind: 'board-snapshot';
  readonly transportVersion: WebTransportVersion;
  readonly projectionVersion: number;
  readonly repositoryId: string;
  readonly stages: readonly WebStage[];
  readonly attentionQueue: readonly WebAttentionItem[];
  readonly availableActions: readonly WebCommandAction[];
  readonly wipCounts: readonly { readonly lane: WebBoardLane; readonly count: number }[];
  readonly inFlightWip: number;
  readonly operationLog: readonly WebOperationLogEntry[];
  readonly agentAvailability: readonly WebAgentAvailability[];
  readonly metrics: WebBoardMetrics;
  /** One fact per `(source, status, value)` tuple; repeats are collapsed by the projection. */
  readonly sourceFacts: readonly WebSourceFact[];
}

export interface WebCommandError {
  readonly kind: WebErrorKind;
  readonly message: string;
  /** The wire error is exactly these two keys — never a stack trace. */
}

export interface WebCommandResult {
  readonly kind: 'command-result';
  readonly transportVersion: WebTransportVersion;
  readonly status: WebTerminalStatus;
  readonly error: WebCommandError | null;
  readonly durableEvidence: readonly {
    readonly id: string;
    readonly source: WebEvidenceSource;
    readonly detail: string;
  }[];
  /** JSON-safe value, present only when the outcome carries one. */
  readonly value?: unknown;
}

export interface WebProgressEvent {
  readonly kind: 'progress';
  readonly transportVersion: WebTransportVersion;
  readonly operationId: string;
  readonly sequence: number;
  readonly phase: string;
  readonly message: string;
  readonly timestamp: string;
  /** Optional: omitted when the event has no agent, never `null`. */
  readonly agent?: string;
}

// ---------------------------------------------------------------------------
// Command request — the browser-to-host mutation envelope (TASK-2433)
// ---------------------------------------------------------------------------

/**
 * The action kinds a card advertises. `mission:intake`,
 * `checkpoint:record`, `approve:review`, and `review:act-on-findings` are not
 * card-advertised and are rejected as unsupported request kinds.
 */
export type WebCommandRequestKind =
  | 'workflow:stop'
  | 'active:execute'
  | 'draft:create'
  | 'integrate:merge'
  | 'review:submit'
  | 'mission:cancel';

/**
 * The only mutation envelope the host accepts. Top-level keys are exactly
 * `missionId`, `kind`, `missionStatusAtRequest`, `requestKey`, optional `agent`
 * (launches only), with no measurement payload.
 * There is no key through which a client can supply an operation ID, a
 * capability set, an environment, argv, a path, or a version:
 * the host generates the operation ID and the single-kind capability set
 * itself.
 */
export interface WebCommandRequest {
  /** Required and nonblank for workflow commands; optional for stop and cancellation. */
  readonly requestKey?: string;
  /** Explicit launch family; omission preserves automatic selection. */
  readonly agent?: string;
  readonly missionId: string;
  readonly kind: WebCommandRequestKind;
  /**
   * The status the browser rendered on the card. It is the observed
   * precondition the controller's authoritative stale guard compares, never
   * a claim about the current status.
   */
  readonly missionStatusAtRequest: string;
}

export type WebCommandRequestValidation =
  | { readonly ok: true; readonly value: WebCommandRequest }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Type guard for the rejection case. Callers must use this instead of
 * narrowing on `ok` directly: the test project typechecks without
 * `strictNullChecks`, where boolean-literal discriminants do not narrow.
 */
export function isInvalidWebCommandRequest(
  result: WebCommandRequestValidation,
): result is { readonly ok: false; readonly problems: readonly string[] } {
  return result.ok === false;
}

// ---------------------------------------------------------------------------
// Fail-closed conversion errors (server-side; never serialized to the wire)
// ---------------------------------------------------------------------------

export type WebTransportErrorCode =
  | 'unsupported-projection-version'
  | 'non-finite-number'
  | 'unsafe-value';

export class WebTransportError extends Error {
  constructor(
    readonly code: WebTransportErrorCode,
    detail: string,
  ) {
    super(`web transport: ${code}: ${detail}`);
    this.name = 'WebTransportError';
  }
}

// ---------------------------------------------------------------------------
// Conversion — application read models → wire DTOs
// ---------------------------------------------------------------------------

