import type { ExecuteMissionPorts } from '../ports/execute-mission.js';
import {
  ExecuteMissionService,
  type ExecuteMissionRequest,
  type ExecuteMissionResult,
} from '../execute-mission-service.js';
import { completed, failure, rejected } from '../contracts.js';
import type { MissionCheckpointService } from '../mission-checkpoint-service.js';
import type { MissionHandoffService } from '../mission-handoff-service.js';
import type { MissionIntakeService } from '../mission-intake-service.js';
import type { DraftCommandUseCase } from '../draft-command-use-case.js';
import type { IntegrateCommandUseCase } from '../integrate-command-use-case.js';
import type { MissionCancelService } from '../mission-cancel-service.js';
import type { MissionId } from '../../domain/mission.js';
import type { MissionStore, MissionVersion } from '../domain-ports.js';
import {
  currentWorkPublication,
  NO_CURRENT_WORK_PORT,
  type CurrentWorkPort,
} from '../recording/current-work-recorder.js';
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
  /** The CLI-equivalent handoff workflow derives its own evidence and starts review. */
  readonly handoffWorkflow?: { executeForSlug(_slug: string): Promise<void> };
  /**
   * The application-owned draft use case, wired by the composition from the
   * trusted draft workflow adapter. The board reaches it through
   * `executeForSlug` only — the request's `missionId` (slug) is the sole
   * value that crosses the boundary.
   */
  readonly draft?: DraftCommandUseCase;
  /** Integration accepts only the mission identity; its workflow owns policy and effects. */
  readonly integrate?: Pick<IntegrateCommandUseCase, 'executeForSlug'>;
  /**
   * Cancellation, the one destructive lifecycle command. It too takes the
   * mission identity alone, so no surface can widen the delete it performs.
   */
  readonly cancel?: Pick<MissionCancelService, 'executeForSlug'>;
}

// ---------------------------------------------------------------------------
// BoardCommandController — guarded dispatch over integrated use cases
// ---------------------------------------------------------------------------

export class BoardCommandController implements BoardCommandDispatcher {
  private readonly executeMission: ExecuteMissionService;
  private readonly progressPort?: BoardProgressSink;
  private readonly missionServices: BoardMissionServices;
  private readonly currentWork: CurrentWorkPort;
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
    this.currentWork = currentWork;
    this.missionStore = missionStore;
  }

  canExecute(kind: BoardCommandRequest['kind']): boolean {
    if (!isIntegratedCapability(kind)) { return false; }
    if (kind === 'mission:intake') { return Boolean(this.missionServices.intake); }
    if (kind === 'checkpoint:record') { return Boolean(this.missionServices.checkpoints); }
    if (kind === 'handoff:record') { return Boolean(this.missionServices.handoffWorkflow); }
    if (kind === 'draft:create') { return Boolean(this.missionServices.draft); }
    if (kind === 'integrate:merge') { return Boolean(this.missionServices.integrate); }
    if (kind === 'mission:cancel') { return Boolean(this.missionServices.cancel); }
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
    // `draft:create` carries no payload, so the payload guard above cannot see
    // an unwired draft service. Report the typed unavailable result here,
    // before mission authority is touched: a read-only graph stays read-only.
    if (kind === 'draft:create' && !this.canExecute(kind)) {
      const reason = 'no Mission authority is configured for this interface';
      this.emit(operationId, 1, 'unavailable', reason);
      return unavailableCapability(kind, reason);
    }
    if (kind === 'integrate:merge' && !this.canExecute(kind)) {
      const reason = 'no integration workflow is configured for this interface';
      this.emit(operationId, 1, 'unavailable', reason);
      return unavailableCapability(kind, reason);
    }
    if (kind === 'mission:cancel' && !this.canExecute(kind)) {
      const reason = 'no cancellation authority is configured for this interface';
      this.emit(operationId, 1, 'unavailable', reason);
      return unavailableCapability(kind, reason);
    }
    if (kind === 'handoff:record' && !this.canExecute(kind)) {
      return unavailableCapability(kind, 'no handoff workflow is configured for this interface');
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
    if (kind === 'draft:create') {
      return (await this.dispatchDraft(request)) as BoardCommandResult<T>;
    }
    if (kind === 'checkpoint:record') {
      return (await this.dispatchCheckpoint(request)) as BoardCommandResult<T>;
    }
    if (kind === 'handoff:record') {
      return (await this.dispatchHandoff(request)) as BoardCommandResult<T>;
    }
    if (kind === 'integrate:merge') {
      return (await this.dispatchIntegrate(request)) as BoardCommandResult<T>;
    }
    if (kind === 'mission:cancel') {
      return (await this.dispatchCancel(request)) as BoardCommandResult<T>;
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
    if (!this.missionServices.handoffWorkflow) {
      return unavailableCapability('handoff:record', 'no handoff workflow is configured for this interface');
    }
    this.emit(request.operationId, 1, 'handoff', `handing off ${request.missionId} and starting review`);
    const publication = currentWorkPublication({
      slug: request.missionId,
      operationId: request.operationId,
      phase: 'handoff',
      summary: `px review ${request.missionId} --start`,
      agent: request.agent,
    });
    if (publication) { await bestEffort(() => this.currentWork.running(publication)); }
    try {
      await this.missionServices.handoffWorkflow.executeForSlug(request.missionId);
      if (publication) { await bestEffort(() => this.currentWork.ended(publication)); }
      return completed({ slug: request.missionId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'handoff workflow aborted';
      if (publication) { await bestEffort(() => this.currentWork.blocked(publication, reason)); }
      return failure('execution', `handoff:record for ${request.missionId} failed: ${reason}`);
    }
  }

  private async dispatchDraft(request: BoardCommandRequest): Promise<BoardCommandResult<unknown>> {
    if (!this.missionServices.draft) {
      return unavailableCapability('draft:create', 'no Mission authority is configured for this interface');
    }
    // Dispatch backstop: only a mission still in the pre-draft state is
    // draftable. Pre-draft means either "no aggregate yet" (the ordinary case:
    // a backlog card straight off the task files, which draft's intake step
    // materializes) or an aggregate still sitting in `backlog`. Every other
    // state is rejected before the draft workflow port is reached, so
    // projection drift or a stale card can never project a successful move.
    if (!this.missionStore) {
      return failure('unavailable', 'Mission authority is not configured for this interface');
    }
    let loaded;
    try {
      loaded = await this.missionStore.load(request.missionId as MissionId);
    } catch {
      return failure('unavailable', 'mission authority is unavailable');
    }
    if (loaded.kind === 'unavailable') { return failure('unavailable', loaded.reason); }
    if (loaded.kind === 'found' && loaded.mission.status !== 'backlog') {
      return rejected('validation', `draft:create requires a mission in the pre-draft (backlog) state, current: ${loaded.mission.status}`);
    }
    this.emit(request.operationId, 1, 'draft', `drafting ${request.missionId}`);
    try {
      await this.missionServices.draft.executeForSlug(request.missionId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'draft workflow aborted';
      return failure('execution', `draft:create for ${request.missionId} aborted: ${reason}`);
    }
    return completed({ slug: request.missionId });
  }

  private async dispatchIntegrate(request: BoardCommandRequest): Promise<BoardCommandResult<unknown>> {
    if (!this.missionServices.integrate) {
      return unavailableCapability('integrate:merge', 'no integration workflow is configured for this interface');
    }
    this.emit(request.operationId, 1, 'integrate', `integrating ${request.missionId}`);
    try {
      await this.missionServices.integrate.executeForSlug(request.missionId);
      return completed({ slug: request.missionId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'integration workflow failed';
      return failure('execution', `integrate:merge for ${request.missionId} failed: ${reason}`);
    }
  }

  /**
   * Cancellation is irreversible, so the confirmation that precedes it lives on
   * every surface (a distinct keypress on the TUI, a second explicitly labelled
   * click on the web board, `--yes` on the CLI). This dispatch performs the
   * delete and reports the git cleanup the operator still owns; it runs no git
   * command of its own.
   */
  private async dispatchCancel(request: BoardCommandRequest): Promise<BoardCommandResult<unknown>> {
    if (!this.missionServices.cancel) {
      return unavailableCapability('mission:cancel', 'no cancellation authority is configured for this interface');
    }
    this.emit(request.operationId, 1, 'cancel', `cancelling ${request.missionId}`);
    try {
      const result = await this.missionServices.cancel.executeForSlug(request.missionId);
      return completed(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'cancellation failed';
      return failure('execution', `mission:cancel for ${request.missionId} failed: ${reason}`);
    }
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
    // Cancellation has no status precondition to resolve: it deletes whatever
    // lifecycle rows exist and archives the task file. A pre-draft card has no
    // aggregate at all, and a stale lane is no reason to keep an abandoned
    // mission on the board.
    if (request.kind === 'mission:cancel') { return null; }
    if (!this.missionStore) {
      return failure('unavailable', 'Mission authority is not configured for this interface');
    }
    try {
      const loaded = await this.missionStore.load(request.missionId as MissionId);
      if (loaded.kind === 'unavailable') {
        return failure('unavailable', loaded.reason);
      }
      if (loaded.kind === 'missing') {
        // A backlog card the board projects from the task files has no Mission
        // aggregate until draft's intake step materializes one. For
        // `draft:create` that absence *is* the pre-draft state, so there is no
        // status precondition to resolve; every other command needs the
        // aggregate it claims to advance.
        if (request.kind === 'draft:create') { return null; }
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

async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch (error) {
    void error;
  }
}
