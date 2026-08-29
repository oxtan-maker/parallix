import type { ExecuteMissionPorts } from '../ports/execute-mission.js';
import {
  ExecuteMissionService,
  type ExecuteMissionRequest,
  type ExecuteMissionResult,
} from '../execute-mission-service.js';
import { failure, rejected } from '../contracts.js';
import type { MissionCheckpointService } from '../mission-checkpoint-service.js';
import type { MissionHandoffService } from '../mission-handoff-service.js';
import type { MissionIntakeService } from '../mission-intake-service.js';
import type { MissionId } from '../../domain/mission.js';
import type { MissionStore, MissionVersion } from '../domain-ports.js';
import { NO_CURRENT_WORK_PORT, type CurrentWorkPort } from '../recording/current-work-recorder.js';
import type {
  BoardCommandDispatcher,
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
  private readonly missionStore: Pick<MissionStore, 'load'> | null;

  constructor(
    executePorts: ExecuteMissionPorts,
    progressPort?: BoardProgressSink,
    missionServices: BoardMissionServices = {},
    currentWork: CurrentWorkPort = NO_CURRENT_WORK_PORT,
    missionStore: Pick<MissionStore, 'load'> | null = executePorts.missionTransitions,
  ) {
    this.executeMission = new ExecuteMissionService(executePorts, progressPort, currentWork);
    this.progressPort = progressPort;
    this.missionServices = missionServices;
    this.missionStore = missionStore;
  }

  canExecute(kind: BoardCommandRequest['kind']): boolean {
    if (!isIntegratedCapability(kind)) { return false; }
    if (kind === 'mission:intake') { return Boolean(this.missionServices.intake); }
    if (kind === 'checkpoint:record') { return Boolean(this.missionServices.checkpoints); }
    if (kind === 'handoff:record') { return Boolean(this.missionServices.handoff); }
    return true;
  }

  /**
   * Dispatch a board command through the guarded controller.
   * Only integrated capabilities are executed; all others return typed unavailable results.
   */
  async dispatch<T = unknown>(request: BoardCommandRequest): Promise<BoardCommandResult<T>> {
    const { operationId, kind, missionId, capabilities: _capabilities, cancellation } = request;

    // Emit dispatch event
    this.emit(operationId, 0, 'dispatch', `dispatching ${kind} for ${missionId}`);

    // Guard 1: capability check
    if (!isIntegratedCapability(kind)) {
      const reason = unavailableReason(kind) ?? 'not yet integrated';
      this.emit(operationId, 1, 'unavailable', reason);
      return unavailableCapability(kind, reason);
    }
    if (!this.canExecute(kind) && request.payload?.kind === kind) {
      const reason = 'no Mission authority is configured for this interface';
      this.emit(operationId, 1, 'unavailable', reason);
      return unavailableCapability(kind, reason);
    }

    // Guard 2: stale command check
    const staleResult = await this.checkStaleCommand(request);
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
      // Backlog card IDs retain their frontmatter casing; execute slugs are
      // canonical lowercase so a card such as TASK-2375SHUT can launch.
      slug: request.missionId.toLowerCase(),
      agent: request.agent ?? undefined,
      capabilities: request.capabilities,
      cancellation: request.cancellation,
      // Board dispatch is fire-and-forget (void confirmAction()): the board
      // must be able to exit on q/Ctrl+C while the action runs on, so the
      // launched child must not keep the board process alive (CP-4 rule).
      detached: request.detached ?? true,
    };
    return this.executeMission.execute(executeRequest);
  }

  /**
   * Check if the mission status has changed since the request was made.
   * Returns a stale conflict result if the status no longer matches.
   */
  private async checkStaleCommand(request: BoardCommandRequest): Promise<BoardCommandResult<unknown> | null> {
    // Intake creates the mission being recorded, so there is no existing status
    // precondition to resolve. Every command against an existing card is guarded.
    if (request.kind === 'mission:intake') { return null; }
    if (!this.missionStore) {
      return failure('unavailable', 'Mission authority is not configured for this interface');
    }
    try {
      const loaded = await this.missionStore.load(request.missionId as MissionId);
      if (loaded.kind === 'unavailable') {
        return failure('unavailable', loaded.reason);
      }
      if (loaded.kind === 'missing') {
        return failure('unavailable', 'mission authority could not find the mission');
      }
      if (request.missionStatusAtRequest !== undefined && loaded.mission.status !== request.missionStatusAtRequest) {
        return staleConflict(request.missionStatusAtRequest, loaded.mission.status);
      }
      const expectedVersion = this.expectedVersion(request);
      if (expectedVersion !== undefined && expectedVersion !== loaded.version) {
        return staleConflict(`version ${expectedVersion}`, `version ${loaded.version}`);
      }
      return null;
    } catch {
      return failure('unavailable', 'mission authority is unavailable');
    }
  }

  private expectedVersion(request: BoardCommandRequest): MissionVersion | undefined {
    return request.payload?.kind === 'checkpoint:record' || request.payload?.kind === 'handoff:record'
      ? request.payload.expectedVersion
      : undefined;
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
