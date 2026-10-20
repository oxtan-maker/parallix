import { availableBoardCommands } from './projections/mission-board.js';
import { reviewStatus } from '../domain/review.js';
import { reviewOperation } from '../domain/review-command-policy.js';
import { agentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import type { RepositoryId } from '../domain/repository.js';
import { isOpenWorkflow, isWorkflowCommand, requireWorkflowOwner, workflowEligible, workflowOperation, claimWorkflow, settleWorkflowStop, type WorkflowCommand } from '../domain/workflow-operation.js';
import { completed, failure, rejected, type ApplicationOutcome } from './contracts.js';
import type { BoardCommandDispatcher, BoardCommandRequest, BoardCommandResult } from './controller/board-command.js';
import type { MissionTransitionStore, MissionLoadResult } from './domain-ports.js';
import { MissionLifecycleService } from './mission-lifecycle-service.js';
import { MissionIntakeService } from './mission-intake-service.js';
import type { MissionLabel } from '../domain/mission.js';
import type { WorkflowOperationStore, WorkflowProcessPort, WorkflowOperationRecord as WorkflowOperation } from './ports/workflow-operation.js';
import { currentWorkPublication, type CurrentWorkPort, type CurrentWorkPhase } from './recording/current-work-recorder.js';

export interface WorkflowAcceptance {
  readonly status: 'accepted';
  readonly operation: WorkflowOperation;
}
export type WorkflowAdmission = WorkflowAcceptance | ApplicationOutcome<unknown>;
export { isWorkflowCommand } from '../domain/workflow-operation.js';
type DraftInput = { title: string; labels: readonly MissionLabel[]; status: string };
interface AdmissionPreparation { readonly agent: string | null; readonly draft: DraftInput | null; }

/** Admission and execution share policy; no transaction spans external work. */
export class WorkflowOperationService implements BoardCommandDispatcher {
  constructor(
    private readonly _operations: WorkflowOperationStore,
    private readonly _missions: MissionTransitionStore,
    private readonly _dispatcher: BoardCommandDispatcher,
    private readonly _processes: WorkflowProcessPort,
    private readonly _work: CurrentWorkPort,
    private readonly _repository: RepositoryId,
    private readonly _selectAgent: () => Promise<string>,
    private readonly _pause: () => Promise<void>,
    private readonly _draftInput?: (_mission: string) => Promise<{ title: string; labels: readonly MissionLabel[]; status: string } | null>,
    private readonly _observe?: (_operation: WorkflowOperation) => Promise<boolean | void> | boolean | void,
    private readonly _wait: { now(): number; timeoutMs: number } = { now: Date.now, timeoutMs: 24 * 60 * 60 * 1000 },
    private readonly _eligibleAgent: (_agent: string) => Promise<boolean> = async () => false,
  ) {}

  canExecute(kind: BoardCommandRequest['kind']): boolean {
    return kind === 'workflow:stop' || this._dispatcher.canExecute(kind);
  }

  async dispatch<T>(request: BoardCommandRequest): Promise<BoardCommandResult<T>> {
    if (request.kind === 'workflow:stop') {
      if (!request.capabilities.has('workflow:stop')) { return rejected('capability', 'workflow:stop capability is required'); }
      return await this.stop(request.missionId) as BoardCommandResult<T>;
    }
    if (!isWorkflowCommand(request.kind)) {
      if (await this._operations.readOnly(() => this._operations.current(request.missionId))) {
        return failure('conflict', 'A workflow owns this mission; stop it before editing or deleting it');
      }
      return this._dispatcher.dispatch<T>(request);
    }
    const admitted = await this.admit(request);
    if (admitted.status !== 'accepted') { return admitted as BoardCommandResult<T>; }
    return this.waitForWorkflow<T>(admitted.operation.id, request);
  }

  private async waitForWorkflow<T>(id: string, request: BoardCommandRequest): Promise<BoardCommandResult<T>> {
    let settledAt: number | null = null;
    const deadline = this._wait.now() + this._wait.timeoutMs;
    for (;;) {
      const operation = await this.operation(id);
      if (!operation) { return failure('execution', 'Accepted operation is unavailable'); }
      const observed = await this._observe?.(operation);
      const interrupted = await this.settleForegroundStop(operation, request);
      if (interrupted) { return interrupted as BoardCommandResult<T>; }
      if (operation.phase === 'stopping') { return failure('conflict', `Stop is pending for ${operation.id}; use px stop ${operation.missionId} to confirm settlement`); }
      if (!isOpenWorkflow(operation)) {
        settledAt ??= this._wait.now();
        if (observed === false && this._wait.now() - settledAt < 2000) { await this._pause(); continue; }
        return (operation.phase === 'completed' ? completed({ operationId: operation.id })
          : failure('execution', operation.reason ?? operation.phase)) as BoardCommandResult<T>;
      }
      if (request.cancellation?.requested || this._wait.now() >= deadline) {
        return failure('cancelled', `Stopped waiting for ${operation.id}; workflow continues independently. Inspect px history ${operation.missionId} or use px stop ${operation.missionId}`);
      }
      await this._pause();
    }
  }

  private async settleForegroundStop(operation: WorkflowOperation, request: BoardCommandRequest): Promise<ApplicationOutcome<unknown> | null> {
    if (!request.cancellation?.stopOwnedWorkflow || !request.cancellation.requested && operation.phase !== 'stopping') { return null; }
    const stopped = await this.stop(operation.missionId, operation.id);
    return stopped.status === 'completed'
      ? failure('cancelled', 'Workflow interrupted; owned work stopped and mission retained') : stopped;
  }

  async admit(request: BoardCommandRequest): Promise<WorkflowAdmission> {
    const key = request.requestKey ?? request.operationId;
    const refusal = this.admissionRequestRefusal(request, key);
    if (refusal) { return refusal; }
    let accepted: WorkflowAdmission;
    let inserted = false;
    try {
      const existing = await this._operations.readOnly(() => this.existingAdmission(request, key));
      if (existing) { return existing; }
      const prepared = await this.prepareAdmission(request);
      if ('status' in prepared) { return prepared; }
      accepted = await this._operations.transaction(async () => {
        const refusal = this.admissionRequestRefusal(request, key);
        if (refusal) { return refusal; }
        const id = missionId(request.missionId);
        const competing = await this.existingAdmission(request, key);
        if (competing) { return competing; }
        const loaded = await this.loadForAdmission(request, id, prepared.draft);
        if ('status' in loaded) { return loaded; }
        if (loaded.kind !== 'found' || loaded.mission.repositoryId !== this._repository) {
          return failure('unavailable', 'Mission authority could not find this mission');
        }
        const ineligible = this.admissionEligibility(request, loaded);
        if (ineligible) { return ineligible; }
        const command = request.kind as WorkflowCommand;
        const outcome = await this.accept(request, loaded, key, command, prepared.agent);
        inserted = outcome.status === 'accepted';
        return outcome;
      });
    } catch (error) { return failure('execution', message(error)); }
    if (inserted && accepted.status === 'accepted' && accepted.operation.phase === 'accepted') {
      // Multiple launchers are harmless: only one worker can claim the intent.
      // A failed spawn leaves accepted intent recoverable on the next pass.
      try { await this._processes.launch(accepted.operation.id); } catch { /* persisted intent survives */ }
    }
    return accepted;
  }

  private admissionRequestRefusal(request: BoardCommandRequest, key: string): ApplicationOutcome<unknown> | null {
    if (!isWorkflowCommand(request.kind)) { return rejected('validation', 'Not a workflow command'); }
    if (!request.capabilities.has(request.kind) || !this.canExecute(request.kind)) {
      return rejected('capability', 'Workflow command is not available');
    }
    if (request.cancellation?.requested) { return failure('cancelled', 'Cancelled before admission'); }
    if (!key.trim() || key.length > 128) { return rejected('validation', 'Request key must contain 1–128 characters'); }
    return null;
  }

  private async existingAdmission(request: BoardCommandRequest, key: string): Promise<WorkflowAdmission | null> {
    const id = missionId(request.missionId);
    const duplicate = await this._operations.byRequest(id, key);
    if (duplicate) {
      return duplicate.command === request.kind ? { status: 'accepted', operation: duplicate }
        : failure('conflict', 'Request key was already used for a different command');
    }
    return await this._operations.current(id) ? failure('conflict', 'Another workflow owns this mission; stop it before restarting') : null;
  }

  /** Observe filesystem/configuration before locking; recheck authority in admission. */
  private async prepareAdmission(request: BoardCommandRequest): Promise<AdmissionPreparation | ApplicationOutcome<unknown>> {
    const loaded = await this._operations.readOnly(() => this._missions.load(missionId(request.missionId)));
    if (loaded.kind === 'unavailable') { return failure('unavailable', loaded.reason); }
    if (loaded.kind === 'missing' && request.kind !== 'draft:create') { return failure('unavailable', 'Mission authority could not find this mission'); }
    if (loaded.kind === 'found') {
      if (loaded.mission.repositoryId !== this._repository) { return failure('unavailable', 'Mission authority could not find this mission'); }
      const refusal = this.admissionEligibility(request, loaded);
      if (refusal) { return refusal; }
    }
    const draft = loaded.kind === 'missing' && request.kind === 'draft:create' ? await this._draftInput?.(request.missionId) ?? null : null;
    const agent = request.kind === 'active:execute' ? await this.resolveActiveAgent(request, loaded) : null;
    return { agent, draft };
  }

  private async resolveActiveAgent(request: BoardCommandRequest, loaded: MissionLoadResult): Promise<string> {
    if (request.agent) { return request.agent; }
    const owner = loaded.kind === 'found' && loaded.mission.status === 'active' ? loaded.mission.assignee : null;
    if (owner && await this._eligibleAgent(owner)) { return owner; }
    return this._selectAgent();
  }

  private boardAvailability(loaded: Extract<MissionLoadResult, { kind: 'found' }>, command: WorkflowCommand) {
    const approved = loaded.mission.review?.rounds.at(-1);
    const commandName = command.split(':')[0];
    return availableBoardCommands(loaded.mission, {
      reviewApproval: approved?.decision?.kind === 'approved' && !approved.decision.revocation
        ? { subject: approved.subject, approvedAt: approved.decision.decidedAt } : null,
      currentWork: null,
    }).find(action => action.command === commandName);
  }

  private admissionEligibility(request: BoardCommandRequest, loaded: Extract<MissionLoadResult, { kind: 'found' }>): ApplicationOutcome<unknown> | null {
    if (request.missionStatusAtRequest !== undefined && request.missionStatusAtRequest !== loaded.mission.status) {
      return failure('conflict', `Mission status changed: ${loaded.mission.status}`);
    }
    const expectedVersion = request.payload?.kind === 'handoff:record' ? request.payload.expectedVersion : undefined;
    if (expectedVersion !== undefined && expectedVersion !== loaded.version) { return failure('conflict', 'Mission version changed before admission'); }
    return this.boardAdmissionEligibility(request, loaded);
  }

  private boardAdmissionEligibility(request: BoardCommandRequest, loaded: Extract<MissionLoadResult, { kind: 'found' }>): ApplicationOutcome<unknown> | null {
    const command = request.kind as WorkflowCommand;
    const reviewMode = request.invocation?.command === 'review' ? reviewOperation(request.invocation.args) : 'status';
    if (!workflowEligible(command, loaded.mission.status, loaded.mission.review !== null && reviewStatus(loaded.mission.review) === 'approved', loaded.mission.review?.rounds.at(-1)?.phase === 'fixing', reviewMode)) { return rejected('validation', `${command} is not eligible in ${loaded.mission.status}`); }
    // Domain policy admits this explicit continuation even though the board
    // offers no review button in integration. All other requests use both checks.
    if (command === 'review:submit' && loaded.mission.status === 'integration' && reviewMode === 'continue') { return null; }
    const availability = this.boardAvailability(loaded, command);
    if (!availability?.enabled) { return rejected('validation', availability?.reason ?? 'Workflow action is not eligible'); }
    return null;
  }


  private async loadForAdmission(request: BoardCommandRequest, id: ReturnType<typeof missionId>, input: DraftInput | null): Promise<MissionLoadResult | ApplicationOutcome<unknown>> {
        let loaded = await this._missions.load(id);
        if (loaded.kind === 'missing' && request.kind === 'draft:create' && this._draftInput) {
          if (!input || input.status !== 'backlog') { return rejected('validation', 'Draft requires a backlog task or an existing backlog mission'); }
          if (request.missionStatusAtRequest !== undefined && request.missionStatusAtRequest !== 'backlog') { return failure('conflict', 'Draft source status changed'); }
          const intake = await new MissionIntakeService(this._missions).execute({ operationId: `${request.operationId}:intake`,
            missionId: id, repositoryId: this._repository, title: input.title, labels: input.labels, rawStatus: input.status,
            capabilities: new Set(['mission:intake']), idempotencyKey: `${request.operationId}:intake` });
          if (intake.status !== 'completed') { return intake; }
          loaded = await this._missions.load(id);
        }
    return loaded;
  }

  private async accept(request: BoardCommandRequest, loaded: Extract<Awaited<ReturnType<MissionTransitionStore['load']>>, { kind: 'found' }>, key: string, command: WorkflowCommand, agent: string | null): Promise<WorkflowAdmission> {
        const now = new Date().toISOString();
        const operation: WorkflowOperation = { ...workflowOperation({
          id: request.operationId, repositoryId: this._repository, missionId: loaded.mission.id,
          requestKey: key, command, generation: 0, phase: 'accepted', providerStarted: false, agent,
          reviewer: request.reviewer ?? null, originalStatus: loaded.mission.status,
          previousAssignee: loaded.mission.assignee, owner: null, createdAt: now, updatedAt: now, reason: null,
        }), invocation: request.invocation, payload: request.payload, requestedAgent: request.agent, pinnedAgent: request.pinnedAgent };
        if (command === 'active:execute' && agent) {
          const activation = await new MissionLifecycleService(this._missions).activate({
            operationId: operation.id, missionId: loaded.mission.id, expectedVersion: loaded.version,
            capabilities: new Set(['mission:transition']), agent: agentFamily(agent), occurredAt: now,
            idempotencyKey: `${operation.id}:activate`,
          });
          if (activation.status !== 'completed') { return activation; }
        }
        await this._operations.insert(operation);
        await this.publish(operation, 'running', 'preparing workflow');
        return { status: 'accepted' as const, operation };
  }

  operation(id: string): Promise<WorkflowOperation | null> {
    return this._operations.readOnly(() => this._operations.get(id));
  }
  current(mission: string): Promise<WorkflowOperation | null> {
    return this._operations.readOnly(() => this._operations.current(mission));
  }

  /** Claim before any external effect. Duplicate workers leave without executing. */
  async reserveLaunch(id: string): Promise<boolean> {
    const launcher = this._processes.identity();
    return this._operations.transaction(async () => {
      const operation = await this._operations.get(id);
      if (!operation || operation.phase !== 'accepted' || operation.owner) { return false; }
      if (operation.launcher && await this._processes.alive(operation.launcher) !== false) { return false; }
      await this._operations.replace({ ...operation, launcher }, operation.generation);
      return true;
    });
  }

  async run(id: string, execute?: (_request: BoardCommandRequest) => Promise<ApplicationOutcome<unknown>>): Promise<void> {
    const owner = this._processes.identity();
    const operation = await this._operations.transaction(async () => {
      const pending = await this._operations.get(id);
      if (!pending || pending.phase !== 'accepted' || pending.owner) { return null; }
      const claimed = { ...pending, ...claimWorkflow(pending, owner, new Date().toISOString()) };
      await this._operations.replace(claimed, pending.generation);
      await this.publish(claimed, 'running', 'preparing workflow');
      return claimed;
    });
    if (!operation) { return; }
    const request: BoardCommandRequest = {
      operationId: operation.id, missionId: operation.missionId, kind: operation.command,
      capabilities: new Set([operation.command]), agent: operation.command === 'active:execute' ? operation.agent : operation.requestedAgent ?? null, pinnedAgent: operation.pinnedAgent, reviewer: operation.reviewer,
      detached: false, payload: operation.payload,
    };
    let outcome: ApplicationOutcome<unknown>;
    try { outcome = await (execute ?? (r => this._dispatcher.dispatch(r)))(request); }
    catch (error) { outcome = failure('execution', message(error)); }
    await this._operations.transaction(async () => {
      const current = await this._operations.get(id);
      if (!current || current.generation !== operation.generation || current.phase === 'stopping' || !isOpenWorkflow(current)) { return; }
      if (outcome.status !== 'completed' && !current.providerStarted) { await this.compensate(current); }
      const ended: WorkflowOperation = { ...current, phase: outcome.status === 'completed' ? 'completed' : 'blocked', reason: outcome.error?.message ?? null, updatedAt: new Date().toISOString() };
      await this._operations.replace(ended, current.generation);
      await this.publish(ended, ended.phase === 'completed' ? 'ended' : 'blocked', ended.reason ?? 'workflow completed');
    });
  }

  async assertOwner(id: string, generation: number): Promise<void> {
    const current = await this._operations.get(id);
    if (!current) { throw new Error('Workflow owner is missing'); }
    requireWorkflowOwner(current, generation);
  }

  async progress(id: string, generation: number, phase: string, summary: string, agent?: string | null, started = false): Promise<void> {
    await this._operations.transaction(async () => {
      const current = await this._operations.get(id);
      if (!current) { throw new Error('Workflow owner is missing'); }
      requireWorkflowOwner(current, generation);
      const providerStarted = current.providerStarted || started;
      const next: WorkflowOperation = { ...current, providerStarted, agent: agent === undefined ? current.agent : agent,
        phase: phase === 'waiting' ? 'waiting' : phase === 'handoff' || phase === 'review' || phase === 'integrate' ? 'checking'
          : providerStarted ? 'running' : 'preparing', reason: summary, updatedAt: new Date().toISOString() };
      await this._operations.replace(next, generation);
    });
  }

  async startupFailed(id: string, reason: string): Promise<void> {
    await this._operations.transaction(async () => {
      const operation = await this._operations.get(id);
      if (!operation || operation.phase !== 'accepted' || operation.owner) { return; }
      await this.compensate(operation);
      const blocked: WorkflowOperation = { ...operation, phase: 'blocked', reason, updatedAt: new Date().toISOString() };
      await this._operations.replace(blocked, operation.generation);
      await this.publish(blocked, 'blocked', reason);
    });
  }

  private async compensate(operation: WorkflowOperation): Promise<void> {
    if (operation.command !== 'active:execute' || operation.originalStatus !== 'refined') { return; }
    const loaded = await this._missions.load(operation.missionId);
    if (loaded.kind !== 'found' || loaded.mission.status !== 'active') { return; }
    const outcome = await new MissionLifecycleService(this._missions).abortActivation({
      operationId: `${operation.id}:abort`, missionId: operation.missionId, expectedVersion: loaded.version,
      capabilities: new Set(['mission:transition']), assignee: operation.previousAssignee ? agentFamily(operation.previousAssignee) : null,
      actor: operation.agent ?? 'workflow', occurredAt: new Date().toISOString(),
    });
    if (outcome.status !== 'completed') { throw new Error(outcome.error?.message ?? 'Activation compensation failed'); }
  }

  async recover(operationId?: string): Promise<void> {
    const operations = await this._operations.readOnly(async () => {
      if (!operationId) { return this._operations.open(); }
      const operation = await this._operations.get(operationId);
      return operation && isOpenWorkflow(operation) ? [operation] : [];
    });
    for (const operation of operations) {
      if (operation.phase === 'stopping') { continue; }
      if (operation.phase === 'accepted' && !operation.owner) {
        if (operation.launcher && await this._processes.alive(operation.launcher) !== false) { continue; }
        try { await this._processes.launch(operation.id); } catch { /* try on next pass */ }
      } else if (operation.owner) {
        let liveness = await this._processes.alive(operation.owner);
        if (liveness === false && this._processes.effectsSettled && !await this._processes.effectsSettled(operation)) { liveness = null; }
        if (liveness === true) { continue; }
        await this._operations.transaction(async () => {
          const current = await this._operations.get(operation.id);
          if (!current || current.generation !== operation.generation || current.phase === 'stopping' || !isOpenWorkflow(current)) { return; }
          const interrupted: WorkflowOperation = { ...current, phase: liveness === false ? 'interrupted' : 'stopping', reason: liveness === false ? 'Workflow owner exited; reconcile external effects before explicitly resuming' : 'Workflow ownership is uncertain; replacement is refused until termination is confirmed', updatedAt: new Date().toISOString() };
          await this._operations.replace(interrupted, current.generation);
          await this.publish(interrupted, 'blocked', interrupted.reason!);
        });
      }
    }
  }

  async stop(mission: string, operationId?: string): Promise<ApplicationOutcome<unknown>> {
    const stopping = await this._operations.transaction(async () => {
      const current = await this._operations.current(mission);
      if (!current || operationId && current.id !== operationId) { return null; }
      const next: WorkflowOperation = { ...current, phase: 'stopping', updatedAt: new Date().toISOString() };
      await this._operations.replace(next, current.generation);
      await this.publish(next, 'running', 'waiting for owned workflow to stop');
      return next;
    });
    if (!stopping) { return completed({ stopped: true }); }
    const pendingGuidance = `Inspect px history ${mission} for surviving executions. Manually terminate a surviving process only after verifying its current start identity matches the retained workflow or run identity, then rerun px stop ${mission}.`;
    const [ownerStopped, launcherStopped] = await Promise.all([
      stopping.owner ? this._processes.stop(stopping.owner) : true,
      stopping.launcher ? this._processes.stop(stopping.launcher) : true,
    ]);
    if (this._processes.stopEffects && !await this._processes.stopEffects(stopping)) {
      return failure('conflict', `Stop is pending: attributed execution termination is unconfirmed. ${pendingGuidance}`);
    }
    if (this._processes.effectsSettled && !await this._processes.effectsSettled(stopping)) {
      return failure('conflict', `Stop is pending: external execution is not yet reconciled; replacement is refused. ${pendingGuidance}`);
    }
    if (!ownerStopped && stopping.owner && await this._processes.alive(stopping.owner) !== false) {
      return failure('conflict', `Stop is pending: termination is unconfirmed; replacement is refused. ${pendingGuidance}`);
    }
    if (!launcherStopped) { return failure('conflict', `Stop is pending: launcher termination is unconfirmed. ${pendingGuidance}`); }
    await this._operations.transaction(async () => {
      const current = await this._operations.get(stopping.id);
      if (current?.phase === 'stopped') { return; }
      if (!current || current.generation !== stopping.generation || current.phase !== 'stopping') { throw new Error('Stop ownership changed'); }
      const stopped = { ...current, ...settleWorkflowStop(current, new Date().toISOString()) };
      await this._operations.replace(stopped, current.generation);
      await this.publish(stopped, 'ended', 'workflow stopped; mission retained');
    });
    return completed({ stopped: true, operationId: stopping.id });
  }

  private async publish(operation: WorkflowOperation, state: 'running' | 'ended' | 'blocked', summary: string): Promise<void> {
    const phase: CurrentWorkPhase = operation.command === 'active:execute' ? 'execute'
      : operation.command === 'draft:create' ? 'draft' : operation.command === 'integrate:merge' ? 'integrate'
      : operation.command === 'review:submit' ? 'review' : 'handoff';
    const publication = currentWorkPublication({ slug: operation.missionId, operationId: operation.id, phase, summary, agent: operation.agent });
    if (!publication) { throw new Error('Invalid workflow publication'); }
    if (state === 'blocked') { await this._work.blocked(publication, operation.reason ?? summary); }
    else { await this._work[state === 'ended' ? 'ended' : 'running'](publication); }
  }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
