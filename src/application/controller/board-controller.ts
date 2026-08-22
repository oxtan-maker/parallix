import type { ExecuteMissionPorts } from '../ports/execute-mission.js';
import {
  ExecuteMissionService,
  type ExecuteMissionRequest,
  type ExecuteMissionResult,
} from '../execute-mission-service.js';
import { rejected } from '../contracts.js';
import type { MissionCheckpointService } from '../mission-checkpoint-service.js';
import type { MissionHandoffService } from '../mission-handoff-service.js';
import type { MissionIntakeService } from '../mission-intake-service.js';
import type { MissionId } from '../../domain/mission.js';
import { NO_CURRENT_WORK_PORT, type CurrentWorkPort } from '../recording/current-work-recorder.js';
import type {
  BoardCommandDispatcher,
  BoardCommandKind,
  BoardProgressSink,
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

/**
 * The Mission use cases a host composition root supplies.
 *
 * A host that has no Mission authority wired (the read-only shell) omits them,
 * and the corresponding commands report an explicit unavailable result instead
 * of reaching for a store the interface is not allowed to open.
 */
export interface BoardMissionServices {
  readonly intake?: MissionIntakeService;
  readonly checkpoints?: MissionCheckpointService;
  readonly handoff?: MissionHandoffService;
}

// ---------------------------------------------------------------------------
// BoardCommandController — guarded dispatch over integrated use cases
// ---------------------------------------------------------------------------

export class BoardCommandController implements BoardCommandDispatcher {
  private readonly executeMission: ExecuteMissionService;
  private readonly progressPort?: BoardProgressSink;
  private readonly missionServices: BoardMissionServices;

  constructor(
    executePorts: ExecuteMissionPorts,
    progressPort?: BoardProgressSink,
    missionServices: BoardMissionServices = {},
    currentWork: CurrentWorkPort = NO_CURRENT_WORK_PORT,
  ) {
    this.executeMission = new ExecuteMissionService(executePorts, progressPort, currentWork);
    this.progressPort = progressPort;
    this.missionServices = missionServices;
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

    // Dispatch to the integrated use cases.
    if (kind === 'active:execute') {
      return (await this.dispatchActive(request)) as BoardCommandResult<T>;
    }
    if (kind === 'mission:intake') {
      return (await this.dispatchIntake(request)) as BoardCommandResult<T>;
    }
    if (kind === 'checkpoint:record') {
      return (await this.dispatchCheckpoint(request)) as BoardCommandResult<T>;
    }
    if (kind === 'handoff:record') {
      return (await this.dispatchHandoff(request)) as BoardCommandResult<T>;
    }
    // Unreachable: isIntegratedCapability guard above catches all non-integrated kinds
    return unavailableCapability(kind, 'unexpected integrated capability') as BoardCommandResult<T>;
  }

  private async dispatchIntake(request: BoardCommandRequest): Promise<BoardCommandResult<unknown>> {
    const payload = request.payload;
    if (payload?.kind !== 'mission:intake') {
      return rejected('validation', 'mission:intake requires an intake payload');
    }
    if (!this.missionServices.intake) {
      return unavailableCapability('mission:intake', 'no Mission authority is configured for this interface');
    }
    this.emit(request.operationId, 1, 'intake', `materializing ${request.missionId}`);
    return this.missionServices.intake.execute({
      operationId: request.operationId,
      missionId: request.missionId as MissionId,
      repositoryId: payload.repositoryId,
      title: payload.title,
      labels: payload.labels,
      assignee: payload.assignee ?? null,
      rawStatus: payload.rawStatus,
      externalTaskRef: payload.externalTaskRef ?? null,
      capabilities: request.capabilities,
    });
  }

  private async dispatchCheckpoint(request: BoardCommandRequest): Promise<BoardCommandResult<unknown>> {
    const payload = request.payload;
    if (payload?.kind !== 'checkpoint:record') {
      return rejected('validation', 'checkpoint:record requires a checkpoint payload');
    }
    if (!this.missionServices.checkpoints) {
      return unavailableCapability('checkpoint:record', 'no Mission authority is configured for this interface');
    }
    this.emit(request.operationId, 1, 'checkpoint', `recording ${payload.checkpoint.name}`);
    return this.missionServices.checkpoints.record({
      operationId: request.operationId,
      missionId: request.missionId as MissionId,
      capabilities: request.capabilities,
      expectedVersion: payload.expectedVersion,
      checkpoint: payload.checkpoint,
    });
  }

  private async dispatchHandoff(request: BoardCommandRequest): Promise<BoardCommandResult<unknown>> {
    const payload = request.payload;
    if (payload?.kind !== 'handoff:record') {
      return rejected('validation', 'handoff:record requires a handoff payload');
    }
    if (!this.missionServices.handoff) {
      return unavailableCapability('handoff:record', 'no Mission authority is configured for this interface');
    }
    this.emit(request.operationId, 1, 'handoff', `recording change size for ${request.missionId}`);
    return this.missionServices.handoff.recordNel({
      operationId: request.operationId,
      missionId: request.missionId as MissionId,
      capabilities: request.capabilities,
      expectedVersion: payload.expectedVersion,
      netEngineeringLines: payload.netEngineeringLines,
      predictedBucket: payload.predictedBucket,
      capturedAt: payload.capturedAt,
      artifacts: payload.artifacts,
      reviewRounds: payload.reviewRounds,
    });
  }

  private async dispatchActive(request: BoardCommandRequest): Promise<BoardCommandResult<ExecuteMissionResult>> {
    const executeRequest: ExecuteMissionRequest = {
      operationId: request.operationId,
      slug: request.missionId,
      agent: request.agent ?? undefined,
      capabilities: request.capabilities,
      cancellation: request.cancellation,
      // Board dispatch is fire-and-forget (void confirmAction()): the board
      // must be able to exit on q/Ctrl+C while the action runs on, so the
      // launched child must not keep the board process alive (CP-4 rule).
      detached: true,
    };
    return this.executeMission.execute(executeRequest);
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
