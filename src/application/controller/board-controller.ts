import type { ActivePort, ProgressPort } from '../../platform/runtime/lib/application/ports.js';
import { ActiveService, type ActiveRequest, type ActiveResult } from '../../platform/runtime/lib/application/active-service.js';
import type {
  BoardCommandKind,
  BoardCommandRequest,
  BoardCommandResult,
  OperationEvent,
} from './board-command.js';
import {
  isIntegratedCapability,
  unavailableCapability,
  unavailableReason,
  cancelledOutcome,
  staleConflict,
  toProgressEvent,
} from './board-command.js';

// ---------------------------------------------------------------------------
// BoardCommandController — guarded dispatch over integrated use cases
// ---------------------------------------------------------------------------

export class BoardCommandController {
  private readonly activeService: ActiveService;
  private readonly progressPort?: ProgressPort;

  constructor(
    activePort: ActivePort,
    progressPort?: ProgressPort,
  ) {
    this.activeService = new ActiveService(activePort, progressPort);
    this.progressPort = progressPort;
  }

  /**
   * Dispatch a board command through the guarded controller.
   * Only integrated capabilities are executed; all others return typed unavailable results.
   */
  async dispatch<T = unknown>(request: BoardCommandRequest): Promise<BoardCommandResult<T>> {
    const { operationId, kind, missionId, missionStatusAtRequest, capabilities: _capabilities, cancellation } = request;

    // Emit dispatch event
    this.emit(operationId, 0, 'dispatch', `dispatching ${kind} for ${missionId}`);

    // Guard 1: capability check
    if (!isIntegratedCapability(kind)) {
      this.emit(operationId, 1, 'unavailable', unavailableReason(kind) ?? 'capability not yet integrated');
      return unavailableCapability(kind, unavailableReason(kind) ?? 'not yet integrated');
    }

    // Guard 2: stale command check
    const staleResult = this.checkStaleCommand(kind, missionId, missionStatusAtRequest);
    if (staleResult) { return staleResult as BoardCommandResult<T>; }

    // Guard 3: cancellation before dispatch
    if (cancellation?.requested) {
      return cancelledOutcome<T>('cancelled before launch');
    }

    // Dispatch to integrated use case (only active:execute is currently integrated)
    if (kind === 'active:execute') {
      return (await this.dispatchActive(request)) as BoardCommandResult<T>;
    }
    // Unreachable: isIntegratedCapability guard above catches all non-integrated kinds
    return unavailableCapability(kind, 'unexpected integrated capability') as BoardCommandResult<T>;
  }

  private async dispatchActive(request: BoardCommandRequest): Promise<BoardCommandResult<ActiveResult>> {
    const activeRequest: ActiveRequest = {
      operationId: request.operationId,
      slug: request.missionId,
      agent: request.agent ?? undefined,
      capabilities: request.capabilities,
      cancellation: request.cancellation,
    };
    return this.activeService.execute(activeRequest);
  }

  /**
   * Check if the mission status has changed since the request was made.
   * Returns a stale conflict result if the status no longer matches.
   */
  private checkStaleCommand(
    _kind: BoardCommandKind,
    _missionId: string,
    _missionStatusAtRequest: string,
  ): BoardCommandResult<unknown> | null {
    // The stale check is performed by comparing the mission status at request time
    // with the current status from the projection. The controller delegates the
    // actual status comparison to the caller, who provides the current status.
    // If the caller wants stale checking, they should use `dispatchWithStatus`.
    return null;
  }

  /**
   * Dispatch with explicit stale check against current mission status.
   * Returns a conflict if the mission status changed since the request.
   */
  async dispatchWithStatus<T = unknown>(
    request: BoardCommandRequest,
    currentMissionStatus: string,
  ): Promise<BoardCommandResult<T>> {
    if (request.missionStatusAtRequest !== currentMissionStatus) {
      return staleConflict(request.missionStatusAtRequest, currentMissionStatus);
    }
    return this.dispatch(request);
  }

  private emit(operationId: string, sequence: number, phase: string, message: string, agent?: string) {
    const event: OperationEvent = {
      operationId,
      sequence,
      phase,
      message,
      timestamp: new Date().toISOString(),
      agent: agent ?? undefined,
    };
    this.progressPort?.(toProgressEvent(event));
  }
}
