import type { Capability, DurableEvidence, ProgressEvent } from '../contracts.js';
import { failure, rejected, type ApplicationOutcome } from '../contracts.js';

// ---------------------------------------------------------------------------
// BoardCommandRequest — typed request for a board operation
// ---------------------------------------------------------------------------

export type BoardCommandKind =
  | 'active:execute'
  | 'draft:create'
  | 'checkpoint:record'
  | 'review:submit'
  | 'review:act-on-findings'
  | 'approve:review'
  | 'integrate:merge';

export interface BoardCommandRequest {
  readonly operationId: string;
  readonly kind: BoardCommandKind;
  readonly missionId: string;
  readonly missionStatusAtRequest: string;
  readonly agent?: string | null;
  readonly capabilities: ReadonlySet<Capability>;
  /** Optional cancellation handle for cooperative cancellation. */
  readonly cancellation?: BoardCancellation;
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
  dispatchWithStatus<T = unknown>(
    _request: BoardCommandRequest,
    _currentMissionStatus: string,
  ): Promise<BoardCommandResult<T>>;
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
]);

/**
 * Unavailable commands with their documented reason. These remain visible on
 * the board but cannot be executed until separate bounded extraction missions land.
 */
export const UNAVAILABLE_CAPABILITIES: ReadonlyMap<BoardCommandKind, string> = new Map([
  ['draft:create', 'Draft extraction not yet integrated (TASK-2289)'],
  ['checkpoint:record', 'Checkpoint extraction not yet integrated (TASK-2290)'],
  ['review:submit', 'Review extraction not yet integrated (TASK-2289)'],
  ['review:act-on-findings', 'Review findings extraction not yet integrated (TASK-2290)'],
  ['approve:review', 'Approve extraction not yet integrated (TASK-2289)'],
  ['integrate:merge', 'Integrate extraction not yet integrated (TASK-2290)'],
]);

export function isIntegratedCapability(kind: BoardCommandKind): boolean {
  return INTEGRATED_CAPABILITIES.has(kind);
}

export function unavailableReason(kind: BoardCommandKind): string | null {
  return UNAVAILABLE_CAPABILITIES.get(kind) ?? null;
}
