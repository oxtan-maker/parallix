/**
 * transport.ts — the versioned, JSON-safe wire contract between the local
 * web host (ADR 0054) and a future browser client (ADR 0055).
 *
 * This module is the board-to-browser boundary. It projects existing
 * application read models — `BoardProjection`, mission activity, action
 * availability, and typed command outcomes — into plain-data DTOs and
 * validates parsed payloads. It is pure: no node builtins, no network, no
 * React, no filesystem. Every special value that raw `JSON.stringify` would
 * collapse (`Infinity`, `undefined`, `Error`, `Set`, `Map`, `BigInt`,
 * non-finite numbers) is either encoded explicitly or rejected fail-closed.
 *
 * The wire vocabulary distinguishes what the domain distinguishes:
 *   - an indefinite agent block is a tagged `indefinite` duration, never `null`
 *   - `runningSessions` keeps four states: omitted (no probe), `null`
 *     (liveness not observed), `0` (observed none), `n` (observed n)
 *   - mission work keeps live / unknown / stale / blocked / idle
 *   - an action is `enabled`, `ineligible` (lane/lifecycle), or
 *     `unavailable` (capability not integrated) — the server decides, the
 *     client never evaluates the capability registry or lane rules
 *   - optional means omitted, nullable means `null`; the two never collapse
 *
 * The exact HTTP response shape is owned by the transport mission; this
 * contract only defines the payload and its validated states.
 */

import {
  BOARD_PROJECTION_VERSION,
  type AgentAvailabilityMetric,
  type AttentionItem,
  type BoardProjection,
  type OperationLogEntry,
} from '../../application/projections/board.js';
import {
  projectMissionActivity,
  type CoordinatorEvidence,
  type MissionWorkActivity,
} from '../../application/projections/mission-activity.js';
import type {
  BoardCommand,
  CommandAvailability,
  MissionCard,
} from '../../application/projections/mission-board.js';
import {
  isIntegratedCapability,
  unavailableReason,
} from '../../application/controller/board-command.js';
import type {
  ApplicationOutcome,
  ProgressEvent,
  SourceFact,
} from '../../application/contracts.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const WEB_TRANSPORT_VERSION = 2 as const;
export type WebTransportVersion = typeof WEB_TRANSPORT_VERSION;
export const SUPPORTED_WEB_TRANSPORT_VERSIONS: readonly number[] = [WEB_TRANSPORT_VERSION];

// ---------------------------------------------------------------------------
// Wire vocabulary — self-contained literals, no domain brands across the wire
// ---------------------------------------------------------------------------

export type WebBoardLane = 'backlog' | 'refined' | 'active' | 'review' | 'integration' | 'done';
export type WebBoardCommandKind =
  | 'active:execute'
  | 'mission:intake'
  | 'draft:create'
  | 'checkpoint:record'
  | 'handoff:record'
  | 'review:submit'
  | 'review:act-on-findings'
  | 'approve:review'
  | 'integrate:merge';
export type WebCommandActionState = 'enabled' | 'ineligible' | 'unavailable';
export type WebGateState = 'passed' | 'failed' | 'running' | 'unknown';
export type WebWorkCertainty = 'live' | 'unknown' | 'stale';
export type WebAttentionReasonKind =
  | 'blocking'
  | 'gate-failed'
  | 'review-lane'
  | 'integrate-lane'
  | 'stale-work'
  | 'none';
export type WebTerminalStatus = 'completed' | 'rejected' | 'failed' | 'cancelled';
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

/** Wire mirror of `ReviewRoundSummary` — nine keys per round, oldest first. */
export interface WebReviewRoundSummary {
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

export interface WebMissionCard {
  readonly id: string;
  readonly title: string;
  readonly lane: WebBoardLane;
  readonly status: WebBoardLane;
  readonly closed: boolean;
  readonly agent: string | null;
  readonly checkpoint: string | null;
  readonly checkpointDescription: string | null;
  readonly nextActionText: string | null;
  readonly gate: WebGateState;
  readonly pullRequest: WebPullRequestReference | null;
  readonly reviewApproved: boolean;
  readonly reviewRound: number | null;
  readonly reviewPhase: string | null;
  readonly reviewDisposition: string | null;
  readonly reviewHistory: readonly WebReviewRoundSummary[];
  readonly blockingReason: string | null;
  readonly flags: readonly string[];
  readonly activity: WebMissionActivity;
  readonly actions: readonly WebCommandAction[];
}

export interface WebStage {
  readonly lane: WebBoardLane;
  readonly count: number;
  readonly cards: readonly WebMissionCard[];
}

export interface WebAttentionItem {
  readonly missionId: string;
  readonly rank: number;
  readonly reason: { readonly kind: WebAttentionReasonKind; readonly detail: string | null };
  readonly action: WebCommandAction;
  readonly dependsOnSources: readonly string[];
}

export interface WebOperationLogEntry {
  readonly operationId: string;
  readonly phase: string;
  readonly message: string;
  readonly timestamp: string;
  /** Optional: omitted when the entry has no agent, never `null`. */
  readonly agent?: string;
}

export interface WebAgentAvailability {
  readonly family: string;
  readonly available: boolean;
  readonly blockedFor: WebDurationMs;
  readonly reason: string | null;
  /**
   * Optional-and-nullable, projected one-to-one: key omitted when the metric
   * was built without a liveness probe, `null` when liveness could not be
   * observed, `0` when the probe ran and nothing was running.
   */
  readonly runningSessions?: number | null;
}

export interface WebSourceFact {
  /** One fact per `(source, status, value)` tuple in a board snapshot; repeats are collapsed. */
  readonly source: string;
  readonly status: string;
  /** Optional: omitted when the fact carries no value. */
  readonly value?: string;
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
  readonly operationLog: readonly WebOperationLogEntry[];
  readonly agentAvailability: readonly WebAgentAvailability[];
  /** Optional-and-nullable, same three states as `runningSessions`. */
  readonly unattributedRunningSessions?: number | null;
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
 * The five action kinds a card advertises. `mission:intake`,
 * `checkpoint:record`, `approve:review`, and `review:act-on-findings` are not
 * card-advertised and are rejected as unsupported request kinds.
 */
export type WebCommandRequestKind =
  | 'active:execute'
  | 'draft:create'
  | 'integrate:merge'
  | 'handoff:record'
  | 'review:submit';

/** Wire artifact reference: a pointer plus observed size, never the material. */
export interface WebHandoffArtifact {
  readonly kind: 'file' | 'git-range' | 'url';
  readonly location: string;
  /** Observed size in bytes, `null` when unmeasured. */
  readonly byteSize: number | null;
}

/**
 * The handoff payload minus `expectedVersion`: the version precondition is
 * server-owned (TASK-2425's guard), never client-supplied.
 */
export interface WebHandoffPayload {
  /** Finite number, >= 0. */
  readonly netEngineeringLines: number;
  /** Optional: omitted, never `null` or `Unknown`. */
  readonly predictedBucket?: 'Small' | 'Medium' | 'Large';
  readonly capturedAt: string;
  readonly artifacts?: readonly WebHandoffArtifact[];
  /** Optional finite integer, >= 0. */
  readonly reviewRounds?: number;
}

/**
 * The only mutation envelope the host accepts. Top-level keys are exactly
 * `missionId`, `kind`, `missionStatusAtRequest`, and `payload` (handoff only).
 * There is no key through which a client can supply an operation ID, a
 * capability set, an agent, an environment, argv, a path, or a version:
 * the host generates the operation ID and the single-kind capability set
 * itself.
 */
export interface WebCommandRequest {
  readonly missionId: string;
  readonly kind: WebCommandRequestKind;
  /**
   * The status the browser rendered on the card. It is the observed
   * precondition the controller's authoritative stale guard compares, never
   * a claim about the current status.
   */
  readonly missionStatusAtRequest: string;
  /** Present only for `handoff:record`. */
  readonly payload?: WebHandoffPayload;
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

const BOARD_COMMAND_KINDS: Readonly<Record<BoardCommand, WebBoardCommandKind>> = {
  active: 'active:execute',
  handoff: 'handoff:record',
  review: 'review:submit',
  integrate: 'integrate:merge',
  draft: 'draft:create',
};

const ATTENTION_KIND_COMMANDS: Readonly<Partial<Record<WebBoardCommandKind, BoardCommand>>> = {
  'active:execute': 'active',
  'handoff:record': 'handoff',
  'review:submit': 'review',
  'integrate:merge': 'integrate',
  'draft:create': 'draft',
};

/**
 * Server-owned action state. Unavailable outranks ineligibility: a command
 * whose kind is not an integrated capability is unavailable from the board
 * no matter what the lane says.
 */
function toCommandAction(
  kind: WebBoardCommandKind,
  display: string,
  availability: CommandAvailability | undefined,
): WebCommandAction {
  if (!isIntegratedCapability(kind)) {
    return { kind, display, state: 'unavailable', reason: unavailableReason(kind) };
  }
  if (availability !== undefined && availability.enabled) {
    return { kind, display, state: 'enabled', reason: null };
  }
  return {
    kind,
    display,
    state: 'ineligible',
    reason: availability?.reason ?? 'command is not eligible for this mission',
  };
}

function toWireDuration(ms: number, path: string): WebDurationMs {
  if (ms === Infinity) { return { kind: 'indefinite' }; }
  if (!Number.isFinite(ms)) {
    throw new WebTransportError('non-finite-number', `${path} blockedForMs is ${String(ms)}`);
  }
  return { kind: 'finite', ms };
}

function toWebMissionWork(work: MissionWorkActivity): WebMissionWork {
  if (work.kind === 'working') {
    return {
      kind: 'working',
      certainty: work.certainty,
      phase: work.phase,
      summary: work.summary,
      agent: work.agent,
      operationId: work.operationId,
    };
  }
  if (work.kind === 'blocked') { return { kind: 'blocked', reason: work.reason }; }
  return { kind: 'idle' };
}

function toWebCoordinatorEvidence(evidence: CoordinatorEvidence): WebCoordinatorEvidence {
  if (evidence.state === 'live') { return { state: 'live', family: evidence.family }; }
  return { state: evidence.state };
}

function toCardActions(card: MissionCard): WebCommandAction[] {
  return card.commands.map((command) => {
    const kind = BOARD_COMMAND_KINDS[command.command];
    return toCommandAction(kind, `px ${command.command} ${card.id}`, command);
  });
}

function toWebMissionCard(card: MissionCard): WebMissionCard {
  const activity = projectMissionActivity(card);
  return {
    id: card.id,
    title: card.title,
    lane: card.lane,
    status: card.status,
    closed: card.closed,
    agent: card.agent,
    checkpoint: card.checkpoint,
    checkpointDescription: card.checkpointDescription,
    nextActionText: card.nextActionText,
    gate: card.gate,
    pullRequest: card.pullRequest === null ? null : {
      kind: 'pull-request',
      provider: card.pullRequest.provider,
      id: card.pullRequest.id,
      url: card.pullRequest.url,
      sourceBranch: card.pullRequest.sourceBranch,
      targetBranch: card.pullRequest.targetBranch,
    },
    reviewApproved: card.reviewApproved,
    reviewRound: card.reviewRound,
    reviewPhase: card.reviewPhase,
    reviewDisposition: card.reviewDisposition,
    reviewHistory: card.reviewHistory.map((round) => ({
      number: round.number,
      reviewer: round.reviewer,
      implementer: round.implementer,
      phase: round.phase,
      disposition: round.disposition,
      comment: round.comment,
      findingSummaries: [...round.findingSummaries],
      pushbacks: [...round.pushbacks],
      fixes: [...round.fixes],
    })),
    blockingReason: card.blockingReason,
    flags: [...card.flags],
    activity: {
      work: toWebMissionWork(activity.work),
      coordinator: toWebCoordinatorEvidence(activity.coordinator),
    },
    actions: toCardActions(card),
  };
}

function toWebAttentionItem(item: AttentionItem, card: MissionCard | undefined): WebAttentionItem {
  const kind = item.action.kind;
  const boardCommand = ATTENTION_KIND_COMMANDS[kind];
  const availability = boardCommand === undefined
    ? undefined
    : card?.commands.find((command) => command.command === boardCommand);
  return {
    missionId: item.missionId,
    rank: item.rank,
    reason: { kind: item.reason.kind, detail: item.reason.kind === 'none' ? null : item.reason.detail },
    action: toCommandAction(kind, item.action.display, availability),
    dependsOnSources: [...item.dependsOnSources],
  };
}

function toLogEntry(entry: OperationLogEntry): WebOperationLogEntry {
  return {
    operationId: entry.operationId,
    phase: entry.phase,
    message: entry.message,
    timestamp: entry.timestamp,
    ...(entry.agent !== undefined ? { agent: entry.agent } : {}),
  };
}

function toAgentAvailability(metric: AgentAvailabilityMetric): WebAgentAvailability {
  return {
    family: metric.family,
    available: metric.available,
    blockedFor: toWireDuration(metric.blockedForMs, `agentAvailability[${metric.family}]`),
    reason: metric.reason ?? null,
    ...(metric.runningSessions !== undefined ? { runningSessions: metric.runningSessions } : {}),
  };
}

function toSourceFact(fact: SourceFact<string>): WebSourceFact {
  return {
    source: fact.source,
    status: fact.status,
    ...(fact.value !== undefined ? { value: fact.value } : {}),
  };
}

/**
 * Project a `BoardProjection` to the wire snapshot. Pure and fail-closed:
 * an unknown projection version is rejected rather than guessed at.
 */
export function toWebBoardSnapshot(projection: BoardProjection): WebBoardSnapshot {
  if (projection.version !== BOARD_PROJECTION_VERSION) {
    throw new WebTransportError(
      'unsupported-projection-version',
      `projection version ${String(projection.version)} is not supported by transport v${WEB_TRANSPORT_VERSION}`,
    );
  }
  const cardsById = new Map<string, MissionCard>();
  for (const stage of projection.stages) {
    for (const card of stage.cards) { cardsById.set(card.id, card); }
  }
  return {
    kind: 'board-snapshot',
    transportVersion: WEB_TRANSPORT_VERSION,
    projectionVersion: projection.version,
    repositoryId: projection.repositoryId,
    stages: projection.stages.map((stage) => ({
      lane: stage.lane,
      count: stage.count,
      cards: stage.cards.map(toWebMissionCard),
    })),
    attentionQueue: projection.attentionQueue.map((item) =>
      toWebAttentionItem(item, cardsById.get(item.missionId))),
    availableActions: projection.availableActions.map((command) =>
      toCommandAction(BOARD_COMMAND_KINDS[command.command], `px ${command.command}`, command)),
    wipCounts: projection.wipCounts.map((wip) => ({ lane: wip.lane, count: wip.count })),
    operationLog: projection.operationLog.map(toLogEntry),
    agentAvailability: projection.metrics.agentAvailability.map(toAgentAvailability),
    sourceFacts: projection.sourceFacts.map(toSourceFact),
    ...(projection.metrics.unattributedRunningSessions !== undefined
      ? { unattributedRunningSessions: projection.metrics.unattributedRunningSessions }
      : {}),
  };
}

/**
 * Project a typed application outcome to the wire command result.
 *
 * The error is always exactly `{ kind, message }` — a thrown object's stack
 * or extra properties can never cross the wire. An `Error` instance, `Set`,
 * `Map`, function, `Symbol`, `BigInt`, non-finite number, or any
 * `undefined`-dependent field in `value` rejects the whole result.
 */
export function toWebCommandResult(outcome: ApplicationOutcome<unknown>): WebCommandResult {
  let value: unknown;
  let hasValue = false;
  if (outcome.value !== undefined) {
    assertJsonValueSafe(outcome.value, 'value');
    value = outcome.value;
    hasValue = true;
  }
  return {
    kind: 'command-result',
    transportVersion: WEB_TRANSPORT_VERSION,
    status: outcome.status,
    error: outcome.error === undefined ? null : { kind: outcome.error.kind, message: outcome.error.message },
    durableEvidence: outcome.durableEvidence.map((evidence) => ({
      id: evidence.id,
      source: evidence.source,
      detail: evidence.detail,
    })),
    ...(hasValue ? { value } : {}),
  };
}

/** Project a progress event; the optional `agent` is omitted, never `null`. */
export function toWebProgressEvent(event: ProgressEvent): WebProgressEvent {
  return {
    kind: 'progress',
    transportVersion: WEB_TRANSPORT_VERSION,
    operationId: event.operationId,
    sequence: event.sequence,
    phase: event.phase,
    message: event.message,
    timestamp: event.timestamp,
    ...(event.agent !== undefined ? { agent: event.agent } : {}),
  };
}

// ---------------------------------------------------------------------------
// JSON-safety — the converter's fail-closed check for outcome values
// ---------------------------------------------------------------------------

function assertJsonValueSafe(value: unknown, path: string): void {
  if (value === null) { return; }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new WebTransportError('non-finite-number', `${path} is ${String(value)}`);
      }
      return;
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      throw new WebTransportError('unsafe-value', `${path} cannot cross the JSON wire`);
    default:
      break;
  }
  if (value instanceof Error) {
    throw new WebTransportError('unsafe-value', `${path} carries a thrown ${value.name}`);
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) => assertJsonValueSafe(element, `${path}[${index}]`));
    return;
  }
  if (value instanceof Set || value instanceof Map) {
    throw new WebTransportError('unsafe-value', `${path} is a ${value.constructor.name}`);
  }
  for (const [key, element] of Object.entries(value as Record<string, unknown>)) {
    if (element === undefined) {
      throw new WebTransportError('unsafe-value', `${path}.${key} is undefined and would silently vanish on the wire`);
    }
    assertJsonValueSafe(element, `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Validation — parsed payloads → DTOs or an explicit failure state
// ---------------------------------------------------------------------------

export type WebTransportValidation<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false;
    readonly code: 'incompatible-client';
    readonly field: 'transportVersion';
    readonly received: unknown;
    readonly supported: readonly number[];
  }
  | { readonly ok: false; readonly code: 'invalid-payload'; readonly problems: readonly string[] };

const LANES: readonly string[] = ['backlog', 'refined', 'active', 'review', 'integration', 'done'];
const GATES: readonly string[] = ['passed', 'failed', 'running', 'unknown'];
const ACTION_STATES: readonly string[] = ['enabled', 'ineligible', 'unavailable'];
const CERTAINTIES: readonly string[] = ['live', 'unknown', 'stale'];
const ATTENTION_REASONS: readonly string[] = ['blocking', 'gate-failed', 'review-lane', 'integrate-lane', 'stale-work', 'none'];
const TERMINAL_STATUSES: readonly string[] = ['completed', 'rejected', 'failed', 'cancelled'];
const ERROR_KINDS: readonly string[] = ['validation', 'capability', 'conflict', 'unavailable', 'execution', 'cancelled'];
const EVIDENCE_SOURCES: readonly string[] = ['task-markdown', 'git', 'stats', 'mission-store'];
const COMMAND_KINDS: readonly string[] = [
  'active:execute', 'mission:intake', 'draft:create', 'checkpoint:record',
  'handoff:record', 'review:submit', 'review:act-on-findings', 'approve:review',
  'integrate:merge',
];
/** The card-advertised kinds a mutation request may name (TASK-2433). */
const COMMAND_REQUEST_KINDS: readonly string[] = [
  'active:execute', 'draft:create', 'integrate:merge', 'handoff:record', 'review:submit',
];
const BUCKET_LABELS: readonly string[] = ['Small', 'Medium', 'Large'];
const ARTIFACT_KINDS: readonly string[] = ['file', 'git-range', 'url'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
  problems: string[],
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) { problems.push(`${path}: unexpected key "${key}"`); }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) { problems.push(`${path}: missing key "${key}"`); }
  }
}

function checkString(object: Record<string, unknown>, key: string, path: string, problems: string[]): string | null {
  const value = object[key];
  if (typeof value !== 'string') { problems.push(`${path}.${key} must be a string, got ${typeof value}`); return null; }
  return value;
}

function checkNullableString(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (value !== null && typeof value !== 'string') { problems.push(`${path}.${key} must be a string or null, got ${typeof value}`); }
}

function checkBoolean(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  if (typeof object[key] !== 'boolean') { problems.push(`${path}.${key} must be a boolean, got ${typeof object[key]}`); }
}

function checkFiniteNumber(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) { problems.push(`${path}.${key} must be a finite number, got ${String(value)}`); }
}

function checkNullableFiniteNumber(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    problems.push(`${path}.${key} must be a finite number or null, got ${String(value)}`);
  }
}

function checkEnum(object: Record<string, unknown>, key: string, allowed: readonly string[], path: string, problems: string[]): void {
  const value = object[key];
  if (typeof value !== 'string' || !allowed.includes(value)) { problems.push(`${path}.${key} must be one of ${allowed.join(', ')}, got ${String(value)}`); }
}

function checkStringArray(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (!Array.isArray(value) || value.some((element) => typeof element !== 'string')) {
    problems.push(`${path}.${key} must be an array of strings`);
  }
}

function checkOptString(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined) {
    const value = object[key];
    if (typeof value !== 'string') { problems.push(`${path}.${key} must be a string when present, got ${typeof value}`); }
  }
}

function checkOptionalNullableNumber(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined) {
    const value = object[key];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      problems.push(`${path}.${key} must be a finite number or null when present, got ${String(value)}`);
    }
  }
}

/** Recursively ensure a parsed `value` payload is JSON-representable. */
function checkJsonValue(value: unknown, path: string, problems: string[]): void {
  if (value === null) { return; }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) { problems.push(`${path} must be a finite number, got ${String(value)}`); }
      return;
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      problems.push(`${path} is not JSON-representable`);
      return;
    default:
      break;
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) => checkJsonValue(element, `${path}[${index}]`, problems));
    return;
  }
  if (value instanceof Set || value instanceof Map) {
    problems.push(`${path} is not JSON-representable`);
    return;
  }
  for (const [key, element] of Object.entries(value as Record<string, unknown>)) {
    checkJsonValue(element, `${path}.${key}`, problems);
  }
}

function checkDuration(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['kind', 'ms'], ['kind'], path, problems);
  if (object.kind === 'indefinite') {
    if (Object.prototype.hasOwnProperty.call(object, 'ms')) { problems.push(`${path}: indefinite duration has no ms`); }
  } else if (object.kind === 'finite') {
    checkFiniteNumber(object, 'ms', path, problems);
  } else {
    problems.push(`${path}.kind must be "finite" or "indefinite", got ${String(object.kind)}`);
  }
}

function checkCommandAction(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['kind', 'display', 'state', 'reason'], ['kind', 'display', 'state', 'reason'], path, problems);
  checkEnum(object, 'kind', COMMAND_KINDS, path, problems);
  checkString(object, 'display', path, problems);
  checkEnum(object, 'state', ACTION_STATES, path, problems);
  checkNullableString(object, 'reason', path, problems);
}

function checkWork(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  const { kind } = object;
  if (kind === 'working') {
    checkKeys(object, ['kind', 'certainty', 'phase', 'summary', 'agent', 'operationId'],
      ['kind', 'certainty', 'phase', 'summary', 'agent', 'operationId'], path, problems);
    checkEnum(object, 'certainty', CERTAINTIES, path, problems);
    checkString(object, 'phase', path, problems);
    checkString(object, 'summary', path, problems);
    checkNullableString(object, 'agent', path, problems);
    checkString(object, 'operationId', path, problems);
  } else if (kind === 'blocked') {
    checkKeys(object, ['kind', 'reason'], ['kind', 'reason'], path, problems);
    checkString(object, 'reason', path, problems);
  } else if (kind === 'idle') {
    checkKeys(object, ['kind'], ['kind'], path, problems);
  } else {
    problems.push(`${path}.kind must be "working", "blocked", or "idle", got ${String(kind)}`);
  }
}

function checkCoordinator(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  const { state } = object;
  if (state === 'live') {
    checkKeys(object, ['state', 'family'], ['state', 'family'], path, problems);
    checkNullableString(object, 'family', path, problems);
  } else if (state === 'stopped' || state === 'unknown') {
    checkKeys(object, ['state'], ['state'], path, problems);
  } else {
    problems.push(`${path}.state must be "live", "stopped", or "unknown", got ${String(state)}`);
  }
}

function checkPullRequest(object: unknown, path: string, problems: string[]): void {
  if (object === null) { return; }
  if (!isPlainObject(object)) { problems.push(`${path} must be an object or null`); return; }
  checkKeys(object,
    ['kind', 'provider', 'id', 'url', 'sourceBranch', 'targetBranch'],
    ['kind', 'provider', 'id', 'url', 'sourceBranch', 'targetBranch'], path, problems);
  if (object.kind !== 'pull-request') { problems.push(`${path}.kind must be "pull-request", got ${String(object.kind)}`); }
  checkString(object, 'provider', path, problems);
  checkString(object, 'id', path, problems);
  checkNullableString(object, 'url', path, problems);
  checkString(object, 'sourceBranch', path, problems);
  checkString(object, 'targetBranch', path, problems);
}

function checkReviewRound(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object,
    ['number', 'reviewer', 'implementer', 'phase', 'disposition', 'comment',
      'findingSummaries', 'pushbacks', 'fixes'],
    ['number', 'reviewer', 'implementer', 'phase', 'disposition', 'comment',
      'findingSummaries', 'pushbacks', 'fixes'], path, problems);
  checkFiniteNumber(object, 'number', path, problems);
  checkString(object, 'reviewer', path, problems);
  checkString(object, 'implementer', path, problems);
  checkString(object, 'phase', path, problems);
  checkNullableString(object, 'disposition', path, problems);
  checkNullableString(object, 'comment', path, problems);
  checkStringArray(object, 'findingSummaries', path, problems);
  checkStringArray(object, 'pushbacks', path, problems);
  checkStringArray(object, 'fixes', path, problems);
}

function checkMissionCard(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object,
    ['id', 'title', 'lane', 'status', 'closed', 'agent', 'checkpoint', 'checkpointDescription',
      'nextActionText', 'gate', 'pullRequest', 'reviewApproved', 'reviewRound', 'reviewPhase',
      'reviewDisposition', 'reviewHistory', 'blockingReason', 'flags', 'activity', 'actions'],
    ['id', 'title', 'lane', 'status', 'closed', 'agent', 'checkpoint', 'checkpointDescription',
      'nextActionText', 'gate', 'pullRequest', 'reviewApproved', 'reviewRound', 'reviewPhase',
      'reviewDisposition', 'reviewHistory', 'blockingReason', 'flags', 'activity', 'actions'], path, problems);
  checkString(object, 'id', path, problems);
  checkString(object, 'title', path, problems);
  checkEnum(object, 'lane', LANES, path, problems);
  checkEnum(object, 'status', LANES, path, problems);
  checkBoolean(object, 'closed', path, problems);
  checkNullableString(object, 'agent', path, problems);
  checkNullableString(object, 'checkpoint', path, problems);
  checkNullableString(object, 'checkpointDescription', path, problems);
  checkNullableString(object, 'nextActionText', path, problems);
  checkEnum(object, 'gate', GATES, path, problems);
  checkPullRequest(object.pullRequest, `${path}.pullRequest`, problems);
  checkBoolean(object, 'reviewApproved', path, problems);
  checkNullableFiniteNumber(object, 'reviewRound', path, problems);
  checkNullableString(object, 'reviewPhase', path, problems);
  checkNullableString(object, 'reviewDisposition', path, problems);
  if (Array.isArray(object.reviewHistory)) {
    object.reviewHistory.forEach((round, index) => checkReviewRound(round, `${path}.reviewHistory[${index}]`, problems));
  } else {
    problems.push(`${path}.reviewHistory must be an array`);
  }
  checkNullableString(object, 'blockingReason', path, problems);
  checkStringArray(object, 'flags', path, problems);
  if (isPlainObject(object.activity)) {
    checkKeys(object.activity, ['work', 'coordinator'], ['work', 'coordinator'], `${path}.activity`, problems);
    checkWork(object.activity.work, `${path}.activity.work`, problems);
    checkCoordinator(object.activity.coordinator, `${path}.activity.coordinator`, problems);
  } else {
    problems.push(`${path}.activity must be an object`);
  }
  if (Array.isArray(object.actions)) {
    object.actions.forEach((action, index) => checkCommandAction(action, `${path}.actions[${index}]`, problems));
  } else {
    problems.push(`${path}.actions must be an array`);
  }
}

function checkAttentionItem(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['missionId', 'rank', 'reason', 'action', 'dependsOnSources'],
    ['missionId', 'rank', 'reason', 'action', 'dependsOnSources'], path, problems);
  checkString(object, 'missionId', path, problems);
  checkFiniteNumber(object, 'rank', path, problems);
  if (isPlainObject(object.reason)) {
    checkKeys(object.reason, ['kind', 'detail'], ['kind', 'detail'], `${path}.reason`, problems);
    checkEnum(object.reason, 'kind', ATTENTION_REASONS, `${path}.reason`, problems);
    checkNullableString(object.reason, 'detail', `${path}.reason`, problems);
  } else {
    problems.push(`${path}.reason must be an object`);
  }
  checkCommandAction(object.action, `${path}.action`, problems);
  checkStringArray(object, 'dependsOnSources', path, problems);
}

function checkLogEntry(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['operationId', 'phase', 'message', 'timestamp', 'agent'],
    ['operationId', 'phase', 'message', 'timestamp'], path, problems);
  checkString(object, 'operationId', path, problems);
  checkString(object, 'phase', path, problems);
  checkString(object, 'message', path, problems);
  checkString(object, 'timestamp', path, problems);
  checkOptString(object, 'agent', path, problems);
}

function checkAgentAvailability(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['family', 'available', 'blockedFor', 'reason', 'runningSessions'],
    ['family', 'available', 'blockedFor', 'reason'], path, problems);
  checkString(object, 'family', path, problems);
  checkBoolean(object, 'available', path, problems);
  checkDuration(object.blockedFor, `${path}.blockedFor`, problems);
  checkNullableString(object, 'reason', path, problems);
  checkOptionalNullableNumber(object, 'runningSessions', path, problems);
}

function checkSourceFact(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['source', 'status', 'value'], ['source', 'status'], path, problems);
  checkString(object, 'source', path, problems);
  checkString(object, 'status', path, problems);
  checkOptString(object, 'value', path, problems);
}

function validateWithVersion<T>(
  payload: unknown,
  kind: string,
  validateShape: (_payload: Record<string, unknown>, _problems: string[]) => void,
): WebTransportValidation<T> {
  if (!isPlainObject(payload)) {
    return { ok: false, code: 'invalid-payload', problems: [`payload is not a ${kind} object`] };
  }
  if (payload.kind !== kind) {
    return { ok: false, code: 'invalid-payload', problems: [`kind must be "${kind}", got ${String(payload.kind)}`] };
  }
  const version = payload.transportVersion;
  if (typeof version !== 'number' || !SUPPORTED_WEB_TRANSPORT_VERSIONS.includes(version)) {
    return {
      ok: false,
      code: 'incompatible-client',
      field: 'transportVersion',
      received: version,
      supported: [...SUPPORTED_WEB_TRANSPORT_VERSIONS],
    };
  }
  const problems: string[] = [];
  validateShape(payload, problems);
  if (problems.length > 0) {
    return { ok: false, code: 'invalid-payload', problems };
  }
  return { ok: true, value: payload as unknown as T };
}

/** Validate a parsed board snapshot payload. */
export function validateWebBoardSnapshot(payload: unknown): WebTransportValidation<WebBoardSnapshot> {
  return validateWithVersion<WebBoardSnapshot>(payload, 'board-snapshot', (p, problems) => {
    checkKeys(p,
      ['kind', 'transportVersion', 'projectionVersion', 'repositoryId', 'stages', 'attentionQueue',
        'availableActions', 'wipCounts', 'operationLog', 'agentAvailability',
        'unattributedRunningSessions', 'sourceFacts'],
      ['kind', 'transportVersion', 'projectionVersion', 'repositoryId', 'stages', 'attentionQueue',
        'availableActions', 'wipCounts', 'operationLog', 'agentAvailability', 'sourceFacts'],
      'snapshot', problems);
    checkFiniteNumber(p, 'projectionVersion', 'snapshot', problems);
    checkString(p, 'repositoryId', 'snapshot', problems);
    if (Array.isArray(p.stages)) {
      p.stages.forEach((stage, index) => {
        const path = `snapshot.stages[${index}]`;
        if (!isPlainObject(stage)) { problems.push(`${path} must be an object`); return; }
        checkKeys(stage, ['lane', 'count', 'cards'], ['lane', 'count', 'cards'], path, problems);
        checkEnum(stage, 'lane', LANES, path, problems);
        checkFiniteNumber(stage, 'count', path, problems);
        if (Array.isArray(stage.cards)) {
          stage.cards.forEach((card, cardIndex) => checkMissionCard(card, `${path}.cards[${cardIndex}]`, problems));
        } else {
          problems.push(`${path}.cards must be an array`);
        }
      });
    } else {
      problems.push('snapshot.stages must be an array');
    }
    if (Array.isArray(p.attentionQueue)) {
      p.attentionQueue.forEach((item, index) => checkAttentionItem(item, `snapshot.attentionQueue[${index}]`, problems));
    } else {
      problems.push('snapshot.attentionQueue must be an array');
    }
    if (Array.isArray(p.availableActions)) {
      p.availableActions.forEach((action, index) => checkCommandAction(action, `snapshot.availableActions[${index}]`, problems));
    } else {
      problems.push('snapshot.availableActions must be an array');
    }
    if (Array.isArray(p.wipCounts)) {
      p.wipCounts.forEach((wip, index) => {
        const path = `snapshot.wipCounts[${index}]`;
        if (!isPlainObject(wip)) { problems.push(`${path} must be an object`); return; }
        checkKeys(wip, ['lane', 'count'], ['lane', 'count'], path, problems);
        checkEnum(wip, 'lane', LANES, path, problems);
        checkFiniteNumber(wip, 'count', path, problems);
      });
    } else {
      problems.push('snapshot.wipCounts must be an array');
    }
    if (Array.isArray(p.operationLog)) {
      p.operationLog.forEach((entry, index) => checkLogEntry(entry, `snapshot.operationLog[${index}]`, problems));
    } else {
      problems.push('snapshot.operationLog must be an array');
    }
    if (Array.isArray(p.agentAvailability)) {
      p.agentAvailability.forEach((metric, index) => checkAgentAvailability(metric, `snapshot.agentAvailability[${index}]`, problems));
    } else {
      problems.push('snapshot.agentAvailability must be an array');
    }
    checkOptionalNullableNumber(p, 'unattributedRunningSessions', 'snapshot', problems);
    if (Array.isArray(p.sourceFacts)) {
      p.sourceFacts.forEach((fact, index) => checkSourceFact(fact, `snapshot.sourceFacts[${index}]`, problems));
    } else {
      problems.push('snapshot.sourceFacts must be an array');
    }
  });
}

/** Validate a parsed command result payload. */
export function validateWebCommandResult(payload: unknown): WebTransportValidation<WebCommandResult> {
  return validateWithVersion<WebCommandResult>(payload, 'command-result', (p, problems) => {
    checkKeys(p, ['kind', 'transportVersion', 'status', 'error', 'durableEvidence', 'value'],
      ['kind', 'transportVersion', 'status', 'error', 'durableEvidence'], 'result', problems);
    checkEnum(p, 'status', TERMINAL_STATUSES, 'result', problems);
    if (p.error === null) {
      if (p.status !== 'completed') { problems.push('result.error must be present when status is not "completed"'); }
    } else if (p.status === 'completed') {
      problems.push('result.error must be null when status is "completed"');
    } else if (isPlainObject(p.error)) {
      checkKeys(p.error, ['kind', 'message'], ['kind', 'message'], 'result.error', problems);
      checkEnum(p.error, 'kind', ERROR_KINDS, 'result.error', problems);
      checkString(p.error, 'message', 'result.error', problems);
    } else {
      problems.push('result.error must be an object or null');
    }
    if (Array.isArray(p.durableEvidence)) {
      p.durableEvidence.forEach((evidence, index) => {
        const path = `result.durableEvidence[${index}]`;
        if (!isPlainObject(evidence)) { problems.push(`${path} must be an object`); return; }
        checkKeys(evidence, ['id', 'source', 'detail'], ['id', 'source', 'detail'], path, problems);
        checkString(evidence, 'id', path, problems);
        checkEnum(evidence, 'source', EVIDENCE_SOURCES, path, problems);
        checkString(evidence, 'detail', path, problems);
      });
    } else {
      problems.push('result.durableEvidence must be an array');
    }
    if (Object.prototype.hasOwnProperty.call(p, 'value') && p.value !== undefined) {
      checkJsonValue(p.value, 'result.value', problems);
    }
  });
}

/**
 * Validate a parsed command request payload (browser → host, TASK-2433).
 * Pure and fail-closed: every unknown top-level key, every kind outside the
 * five card-advertised kinds, a `payload` key on an identity-only kind, and
 * every missing, mistyped, or out-of-range handoff field is rejected. The
 * caller must treat a rejection as zero dispatch.
 */
export function validateWebCommandRequest(payload: unknown): WebCommandRequestValidation {
  if (!isPlainObject(payload)) {
    return { ok: false, problems: ['request must be a JSON object'] };
  }
  const problems: string[] = [];
  checkKeys(payload,
    ['missionId', 'kind', 'missionStatusAtRequest', 'payload'],
    ['missionId', 'kind', 'missionStatusAtRequest'],
    'request', problems);
  const missionId = checkString(payload, 'missionId', 'request', problems);
  if (missionId !== null && missionId.length === 0) {
    problems.push('request.missionId must be a non-empty string');
  }
  const kind = checkString(payload, 'kind', 'request', problems);
  if (kind !== null && !COMMAND_REQUEST_KINDS.includes(kind)) {
    problems.push(`request.kind must be one of ${COMMAND_REQUEST_KINDS.join(', ')}, got ${kind}`);
  }
  checkString(payload, 'missionStatusAtRequest', 'request', problems);
  if (Object.prototype.hasOwnProperty.call(payload, 'payload')) {
    const value = payload.payload;
    if (kind === 'handoff:record') {
      checkHandoffPayload(value, 'request.payload', problems);
    } else {
      problems.push(`request.payload is only allowed for handoff:record, got kind ${String(kind)}`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    value: {
      missionId: payload.missionId as string,
      kind: payload.kind as WebCommandRequestKind,
      missionStatusAtRequest: payload.missionStatusAtRequest as string,
      ...(payload.payload !== undefined ? { payload: payload.payload as WebHandoffPayload } : {}),
    },
  };
}

function checkHandoffPayload(value: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(value)) { problems.push(`${path} must be an object`); return; }
  checkKeys(value,
    ['netEngineeringLines', 'predictedBucket', 'capturedAt', 'artifacts', 'reviewRounds'],
    ['netEngineeringLines', 'capturedAt'], path, problems);
  const lines = value.netEngineeringLines;
  if (typeof lines !== 'number' || !Number.isFinite(lines) || lines < 0) {
    problems.push(`${path}.netEngineeringLines must be a finite number >= 0, got ${String(lines)}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'predictedBucket')) {
    checkEnum(value, 'predictedBucket', BUCKET_LABELS, path, problems);
  }
  checkString(value, 'capturedAt', path, problems);
  if (Object.prototype.hasOwnProperty.call(value, 'artifacts')) {
    const artifacts = value.artifacts;
    if (!Array.isArray(artifacts)) {
      problems.push(`${path}.artifacts must be an array`);
    } else {
      artifacts.forEach((artifact, index) => {
        const artifactPath = `${path}.artifacts[${index}]`;
        if (!isPlainObject(artifact)) { problems.push(`${artifactPath} must be an object`); return; }
        checkKeys(artifact, ['kind', 'location', 'byteSize'], ['kind', 'location', 'byteSize'], artifactPath, problems);
        checkEnum(artifact, 'kind', ARTIFACT_KINDS, artifactPath, problems);
        checkString(artifact, 'location', artifactPath, problems);
        const byteSize = artifact.byteSize;
        if (byteSize !== null && (typeof byteSize !== 'number' || !Number.isFinite(byteSize))) {
          problems.push(`${artifactPath}.byteSize must be a finite number or null, got ${String(byteSize)}`);
        }
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'reviewRounds')) {
    const rounds = value.reviewRounds;
    if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 0) {
      problems.push(`${path}.reviewRounds must be an integer >= 0, got ${String(rounds)}`);
    }
  }
}

/** Validate a parsed progress event payload. */
export function validateWebProgressEvent(payload: unknown): WebTransportValidation<WebProgressEvent> {
  return validateWithVersion<WebProgressEvent>(payload, 'progress', (p, problems) => {
    checkKeys(p, ['kind', 'transportVersion', 'operationId', 'sequence', 'phase', 'message', 'timestamp', 'agent'],
      ['kind', 'transportVersion', 'operationId', 'sequence', 'phase', 'message', 'timestamp'], 'progress', problems);
    checkString(p, 'operationId', 'progress', problems);
    checkFiniteNumber(p, 'sequence', 'progress', problems);
    checkString(p, 'phase', 'progress', problems);
    checkString(p, 'message', 'progress', problems);
    checkString(p, 'timestamp', 'progress', problems);
    checkOptString(p, 'agent', 'progress', problems);
  });
}
