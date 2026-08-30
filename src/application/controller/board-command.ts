import type { Capability, DurableEvidence, ProgressEvent } from '../contracts.js';
import { failure, rejected, type ApplicationOutcome } from '../contracts.js';
import type { MissionVersion } from '../domain-ports.js';
import type { AgentFamily } from '../../domain/agents.js';
import type { CheckpointData } from '../../domain/checkpoint.js';
import type { ExternalTaskRef } from '../../domain/external-task.js';
import type { MissionLabel } from '../../domain/mission.js';
import type { ArtifactReference, NelBucketLabel } from '../../domain/net-engineering-lines.js';
import type { RepositoryId } from '../../domain/repository.js';

// ---------------------------------------------------------------------------
// BoardCommandRequest — typed request for a board operation
// ---------------------------------------------------------------------------

export type BoardCommandKind =
  | 'active:execute'
  | 'mission:intake'
  | 'draft:create'
  | 'checkpoint:record'
  | 'handoff:record'
  | 'review:submit'
  | 'review:act-on-findings'
  | 'approve:review'
  | 'integrate:merge';

/**
 * Domain-shaped input for the Mission commands this controller dispatches.
 *
 * A payload carries checked domain values only — never a mission-directory
 * path, a `CP-N.md` filename, or SQL. A board button therefore cannot acquire
 * filesystem or database authority by sending a richer payload.
 *
 * `draft:create` has no payload member: the envelope `missionId` is the entire
 * request. There is no argv array, options bag, path, environment, or
 * agent-launch field for it, so a board request cannot smuggle CLI input
 * through the boundary.
 */
export type BoardCommandPayload =
  | {
    readonly kind: 'mission:intake';
    readonly repositoryId: RepositoryId;
    readonly title: string;
    readonly labels?: readonly MissionLabel[];
    readonly assignee?: AgentFamily | null;
    readonly rawStatus?: string;
    readonly externalTaskRef?: ExternalTaskRef | null;
  }
  | {
    readonly kind: 'checkpoint:record';
    readonly checkpoint: CheckpointData;
    readonly expectedVersion?: MissionVersion;
  }
  | {
    readonly kind: 'handoff:record';
    readonly netEngineeringLines: number;
    readonly predictedBucket?: NelBucketLabel | 'Unknown';
    readonly capturedAt: string;
    readonly artifacts?: readonly ArtifactReference[];
    readonly reviewRounds?: number;
    readonly expectedVersion?: MissionVersion;
  };

export interface BoardCommandRequest {
  readonly operationId: string;
  readonly kind: BoardCommandKind;
  readonly missionId: string;
  /** Present for board actions, which capture a status before confirmation. */
  readonly missionStatusAtRequest?: string;
  readonly agent?: string | null;
  readonly capabilities: ReadonlySet<Capability>;
  /** Optional cancellation handle for cooperative cancellation. */
  readonly cancellation?: BoardCancellation;
  /** Keep CLI launches attached; board actions default to fire-and-forget. */
  readonly detached?: boolean;
  /** Required by the Mission commands; absent for `active:execute`. */
  readonly payload?: BoardCommandPayload;
}

// ---------------------------------------------------------------------------
// BoardCancellation — cooperative cancellation at safe boundaries
// ---------------------------------------------------------------------------

export interface BoardCancellation {
  readonly requested: boolean;
  /** If cancellation is requested after a safe boundary, return durable partial state. */
  readonly safeBoundaryCrossed?: boolean;
}

// ---------------------------------------------------------------------------
// BoardCommandResult — typed result for a board operation
// ---------------------------------------------------------------------------

export type BoardCommandResult<T = unknown> = ApplicationOutcome<T>;

/** Convenience builders for board-specific outcomes. */
export function unavailableCapability<T>(kind: BoardCommandKind, reason: string): BoardCommandResult<T> {
  return rejected('capability', `${kind} is not yet available: ${reason}`);
}

export function staleConflict<T>(expected: string, actual: string): BoardCommandResult<T> {
  return failure('conflict', `Mission status changed since request: expected ${expected}, got ${actual}`);
}

export function cancelledOutcome<T>(message: string, durableEvidence: readonly DurableEvidence[] = []): BoardCommandResult<T> {
  return failure('cancelled', message, durableEvidence);
}

// ---------------------------------------------------------------------------
// OperationEvent — progress event with stable operation ID
// ---------------------------------------------------------------------------

export interface OperationEvent {
  readonly operationId: string;
  readonly sequence: number;
  readonly phase: string;
  readonly message: string;
  readonly timestamp: string;
  readonly agent?: string;
}

/** Convert an OperationEvent to the shared ProgressEvent. */
export function toProgressEvent(event: OperationEvent): ProgressEvent {
  return event as ProgressEvent;
}

export type BoardProgressEvent = ProgressEvent;
export type BoardProgressSink = (_event: BoardProgressEvent) => void;

export interface BoardCommandDispatcher {
  canExecute(_kind: BoardCommandKind): boolean;
  dispatch<T = unknown>(_request: BoardCommandRequest): Promise<BoardCommandResult<T>>;
}

// ---------------------------------------------------------------------------
// Capability registry — which commands are currently available
// ---------------------------------------------------------------------------

/**
 * The set of lifecycle commands that have an integrated application use case.
 * Commands not in this set return `unavailable` capability results.
 */
export const INTEGRATED_CAPABILITIES = new Set<BoardCommandKind>([
  'active:execute',
  'mission:intake',
  'draft:create',
  'checkpoint:record',
  'handoff:record',
  'integrate:merge',
]);

/**
 * Unavailable commands with their documented reason. These remain visible on
 * the board but cannot be executed until separate bounded extraction missions land.
 */
export const UNAVAILABLE_CAPABILITIES: ReadonlyMap<BoardCommandKind, string> = new Map([
  ['review:submit', 'Review submission is not available from the board'],
  ['review:act-on-findings', 'Existing artifact consumption can synthesize review state or reviewer identity'],
  ['approve:review', 'Review approval is not available from the board'],
]);

export function isIntegratedCapability(kind: BoardCommandKind): boolean {
  return INTEGRATED_CAPABILITIES.has(kind);
}

export function unavailableReason(kind: BoardCommandKind): string | null {
  return UNAVAILABLE_CAPABILITIES.get(kind) ?? null;
}
