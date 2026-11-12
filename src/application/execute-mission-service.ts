import { continuePendingIntegrationRepair } from './integrate/repair-resumption.js';
import { failureReason, failureReasonFromCause } from '../domain/failure-reason.js';
import type { ReboundReason } from '../domain/rebound-policy.js';
import type { WorkflowReturnStage } from '../domain/board-event.js';
import { beginReviewPreparation, recordReviewPreparationFailure } from "./review-submission-service.js";
import { ExecutionStartService } from './execution-start-service.js';
import { assertWorkflowControl, authorizedExecutionStart, reportWorkflowProviderStarted } from './ports/mission-write-authorization.js';
import { MissionCheckpointService } from './mission-checkpoint-service.js';
import { recordImplementerLaunch } from './rebase-identity.js';
import type { ApplicationOutcome, Cancellation, Capability, DurableEvidence } from './contracts.js';
import { failure, rejected } from './contracts.js';
import { MissionLifecycleService, type MissionTransitionResult } from './mission-lifecycle-service.js';
import { missionId, isMissionSlugCandidate } from '../domain/mission.js';
import type {
  AgentLaunchOutcome,
  AgentLaunchPlan,
  ExecuteMissionPorts,
  TaskFileResolution,
} from './ports/execute-mission.js';
import { ExecuteReviewPreparationService } from "./execute-review-preparation-service.js";
import type { ProgressPort } from './ports.js';
import {
  reviewLoopPublisher,
  executionActivityIntent,
  NO_EXECUTION_ACTIVITY,
  type ExecutionActivityStage,
  type ExecutionActivityPort,
  type ExecutionActivityIntent,
} from './recording/execution-activity-recorder.js';

export interface ExecuteMissionRequest {
  /** Only the explicit operator CLI invocation may acknowledge retained stops. */
  readonly operatorInvocation?: boolean;
  readonly operationId: string;
  readonly slug: string;
  readonly agent?: string | null;
  /** Explicit automatic-review family; omitted lets review selection choose. */
  readonly reviewer?: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly cancellation?: Cancellation;
  /**
   * The dispatching host will not keep its process alive for this operation
   * (board fire-and-forget dispatch): the execute launch must unref its child
   * so q/Ctrl+C can exit the board while the action runs on (CP-4 ownership
   * rule). CLI callers omit it and await the agent in-process.
   */
  readonly detached?: boolean;
  readonly pinnedAgent?: boolean;
}

export interface ExecuteMissionResult {
  readonly agent: string;
}

/**
 * The workspace facts one execute run resolved, carried explicitly from step to
 * step. The workflow keeps no per-slug state of its own: two concurrent runs
 * are two independent values, not two entries in a shared map.
 */
interface ExecuteWorkspace {
  readonly worktree: string;
  readonly taskResolution: TaskFileResolution;
}

/**
 * `ExecuteMission` — the `px active` workflow.
 *
 * This use case owns, in this order:
 *
 *   1. request guards and cheap configured agent selection
 *   2. checked activation and attributable preparing work
 *   3. workspace preflight, prompt preparation and agent launch
 *   4. durable launch evidence and best-effort telemetry
 *   5. the post-record cancellation boundary, then review preparation and review
 *
 * It also owns the partial-failure policy: a launcher error or a non-zero agent
 * status stops the run before any durable record; a telemetry failure never
 * does; a cancellation observed after the durable record reports both evidence
 * records and makes no rollback claim.
 *
 * Every effect is delegated to a mechanism port (ADR 0051). No filesystem, Git,
 * subprocess, or database module is imported here.
 */
export class ExecuteMissionService {
  constructor(
    private readonly _ports: ExecuteMissionPorts,
    private readonly _progress?: ProgressPort,
    private readonly _currentWork: ExecutionActivityPort = NO_EXECUTION_ACTIVITY,
  ) { }

  async execute(request: ExecuteMissionRequest): Promise<ApplicationOutcome<ExecuteMissionResult>> {
    assertWorkflowControl();
    const refusal = this.validateRequest(request);
    if (refusal) { return refusal; }
    let activation: MissionTransitionResult | null = null;
    let activationAgent: string | null = null;
    let agentStarted = false;
    try {
      await this.prepareOperatorResume(request);
      const resumed = await this.resumeIntegrationRepair(request);
      if (resumed && 'reviewRequired' in resumed) { return await this.reviewChangedRepair(request, resumed.reviewRequired); }
      if (resumed) { return resumed; }
      const selectedAgent = await this.resolveAgent(request);
      if (!selectedAgent) { throw new Error('Could not select an execute agent.'); }
      activation = await this.synchronizeLifecycle(request.slug, selectedAgent, request.operationId);
      activationAgent = selectedAgent;
      this.emit(request, 1, 'launch', 'preparing execute agent');
      await this.publishWork(request, 'execute', 'preparing execute agent', selectedAgent);
      const prepared = await this.resolveWorkspace(request.slug);
      if (typeof prepared === 'string') { throw new WorkspaceRefusal(prepared); }
      const plan = await this._ports.agentExecution.prepare({ slug: request.slug, worktree: prepared.worktree });
      const launch = await this.launchAgent(request, prepared, plan, selectedAgent, () => { agentStarted = true; }, activation.mission.review?.rounds.at(-1)?.implementer);
      const evidence: DurableEvidence[] = [
        { id: `${request.slug}:agent`, source: 'task-markdown', detail: 'execute agent launch completed' },
      ];

      this.emit(request, 2, 'record', 'recording durable launch evidence');
      evidence.push(await this.recordLaunch(request.slug, prepared, launch));

      if (request.cancellation?.requested) {
        await this.endWork(request);
        return failure('cancelled', 'cancelled after durable launch; re-query task state', evidence);
      }

      await this.review(request, prepared, launch.agent);
      await this.endWork(request);
      return { status: 'completed', value: { agent: launch.agent }, durableEvidence: evidence };
    } catch (error) {
      return this.failedExecution(request, error, activation, activationAgent, agentStarted);
    }
  }

  /** Review preparation and autonomous review after the implementer's work is committed. */
  private async review(request: ExecuteMissionRequest, prepared: ExecuteWorkspace, agent: string): Promise<void> {
    this.emit(request, 3, 'review-preparation', "starting review preparation", agent);
    await this.publishWork(request, 'review', 'preparing agent review', null);
    let preparationFailure: string | null = null;
    const reviewPublisher = reviewLoopPublisher(this._currentWork, { slug: request.slug, operationId: request.operationId });
    const reviewPreparationRequest = {
      slug: request.slug,
      worktree: prepared.worktree,
      agent,
      continueIntegrationRepair: async () => {
        const resumed = await this.resumeIntegrationRepair(request);
        // A changed repair already opened its fresh round; review preparation submits it next.
        if (!resumed || 'reviewRequired' in resumed) { return null; }
        if (resumed.status !== 'completed') { preparationFailure = resumed.error?.message ?? 'Integration repair retention stopped'; await reviewPublisher.onAutonomousStop(preparationFailure); }
        return resumed.status === 'completed';
      },
      beginReviewPreparation: async () => { await beginReviewPreparation(request.slug, { store: this._ports.missionTransitions, lifecycle: new MissionLifecycleService(this._ports.missionTransitions) }); },
      prepareImplementationRepair: (diagnostic: string, reason: ReboundReason,
        returnStage: WorkflowReturnStage) => recordReviewPreparationFailure(request.slug, diagnostic, {
        store: this._ports.missionTransitions, lifecycle: new MissionLifecycleService(this._ports.missionTransitions),
        checkpoints: new MissionCheckpointService(this._ports.missionTransitions),
      }, reason, returnStage),
      reviewer: request.reviewer,
      taskFile: prepared.taskResolution.ok ? prepared.taskResolution.taskFile ?? null : null,
      onImplementerLaunched: async (agent: string) => {
        await recordImplementerLaunch(request.slug, agent, this._ports.missionTransitions, new MissionLifecycleService(this._ports.missionTransitions));
      },
      // Autonomous review is real work by other families on this same
      // mission. It publishes through the same seam `px review` uses, so the
      // board follows the reviewer and the implementer answering findings
      // instead of freezing on the original implementer's review preparation.
      ...reviewPublisher,
      onAutonomousStop: async (reason: string) => { preparationFailure = reason; await reviewPublisher.onAutonomousStop(reason); },
    };
    const reviewed = await new ExecuteReviewPreparationService({
      checkpoints: this._ports.checkpointValidation,
      reviewPreparation: this._ports.reviewPreparationExecution,
      review: this._ports.autonomousReview,
      repairLaunch: this._ports.repairLaunch,
      output: this._ports.output,
    }).run(reviewPreparationRequest);
    if (!reviewed) { throw new Error(preparationFailure ?? "Review preparation and review failed"); }
  }

  /** Pending retained approval is settled by the shared continuation before any launch or review entry. */
  private async resumeIntegrationRepair(request: ExecuteMissionRequest): Promise<ApplicationOutcome<ExecuteMissionResult> | { readonly reviewRequired: string | null } | null> {
    const next = await continuePendingIntegrationRepair(request.slug, this._ports.missionTransitions, this._ports.integrationRepair);
    switch (next.kind) {
      case 'not-pending': return null;
      case 'review-required': return { reviewRequired: next.implementer };
      case 'unavailable':
        return failure('unavailable', 'Integration repair certification is unavailable; resume with px integrate before review submission.', [], failureReason('approval-retention-pending', 'lifecycle'));
      case 'retained':
        this._ports.output.log(`Original approval retained for ${request.slug}; human px integrate ${request.slug} is required to land.`);
        return { status: 'completed', value: { agent: next.implementer ?? 'workflow' }, durableEvidence: [{ id: `${request.slug}:approval-retention`, source: 'mission-store', detail: 'Existing integration repair certification and approval retention completed; no agent launched' }] };
      case 'landed':
        this._ports.output.log(`Integration repair for ${request.slug} already landed; no review, launch or px integrate is owed.`);
        return { status: 'completed', value: { agent: next.implementer ?? 'workflow' }, durableEvidence: [{ id: `${request.slug}:integration-repair-landed`, source: 'mission-store', detail: 'The Mission already landed; the repair obligation is closed and no agent launched' }] };
      case 'blocked':
        return failure('validation', `Integration repair retention remains unproven; resume certification with px integrate ${request.slug}.`, [], failureReason('approval-retention-pending', 'lifecycle', { outcome: 'blocked' }));
    }
  }

  /**
   * A changed repair withdrew the stale approval; the committed repair needs a
   * fresh review by the implementer the continuation reports, never the family
   * this execute call happened to request.
   */
  private async reviewChangedRepair(request: ExecuteMissionRequest, implementer: string | null): Promise<ApplicationOutcome<ExecuteMissionResult>> {
    const evidence: DurableEvidence[] = [{ id: `${request.slug}:approval-retention`, source: 'mission-store',
      detail: 'Integration repair changed the approved patch; the original approval was withdrawn and no execute agent launched' }];
    if (request.cancellation?.requested) { return failure('cancelled', 'cancelled after integration repair assessment; re-query task state', evidence); }
    if (!implementer) { throw new Error(`Integration repair changed the approved patch but no implementer is recorded; resume px review ${request.slug}.`); }
    const prepared = await this.resolveWorkspace(request.slug);
    if (typeof prepared === 'string') { throw new WorkspaceRefusal(prepared); }
    await this.review(request, prepared, implementer);
    await this.endWork(request);
    return { status: 'completed', value: { agent: implementer }, durableEvidence: evidence };
  }

  private async resolveAgent(request: ExecuteMissionRequest): Promise<string | null | undefined> {
    if (request.agent) { return request.agent; }
    const loaded = await this._ports.missionTransitions.load(missionId(request.slug));
    const owner = loaded.kind === 'found' && loaded.mission.status === 'active' ? loaded.mission.assignee : null;
    if (owner && await this._ports.agentExecution.eligible(owner)) { return owner; }
    return this._ports.agentExecution.select?.(request.slug);
  }

  private validateRequest(request: ExecuteMissionRequest): ApplicationOutcome<ExecuteMissionResult> | null {
    if (!request.operationId || !request.slug) { return rejected('validation', 'operationId and slug are required'); }
    if (!request.capabilities.has('active:execute')) { return rejected('capability', 'active:execute capability is required'); }
    if (request.cancellation?.requested) { return failure('cancelled', 'cancelled before launch'); }

    if (!isMissionSlugCandidate(request.slug)) { return rejected('validation', 'slug is not a recognized mission identity'); }
    return null;
  }

  private async prepareOperatorResume(request: ExecuteMissionRequest): Promise<void> {
    if (request.operatorInvocation) {
      await new MissionCheckpointService(this._ports.missionTransitions).acknowledgeOperatorResume({
        operationId: request.operationId, missionId: missionId(request.slug),
        capabilities: new Set(['checkpoint:record']), actor: 'px active operator', occurredAt: new Date().toISOString(),
      });
    }
    await this.assertNoRecordedStop(request.slug);
  }

  private async assertNoRecordedStop(slug: string): Promise<void> {
    const loaded = await this._ports.missionTransitions.load(missionId(slug));
    if (loaded.kind !== 'found') { return; }
    const checkpoint = loaded.mission.checkpoints.find(cp => cp.repair?.blocker);
    if (checkpoint?.repair?.blocker) {
      throw new Error(`Blocked at ${checkpoint.name}: ${checkpoint.repair.blocker.diagnostic}`);
    }
  }

  private async failedExecution(request: ExecuteMissionRequest, error: unknown, activation: MissionTransitionResult | null, activationAgent: string | null, agentStarted: boolean): Promise<ApplicationOutcome<ExecuteMissionResult>> {
    let message = error instanceof Error ? error.message : 'active execution failed';
    if (!authorizedExecutionStart() && activation?.from === 'refined' && activationAgent && !agentStarted) {
      try {
        await this.abortActivation(request.slug, activation, activationAgent);
      } catch (compensationError) {
        const compensationMessage = compensationError instanceof Error
          ? compensationError.message
          : 'Could not undo failed activation';
        message = `${message}; ${compensationMessage}`;
      }
    }
    // The in-call retry/failover loop already tried every eligible family. If
    // it still could not finish, the run is not "running slowly" — the board
    // must stop showing it as working and say why an operator is needed.
    await this.blockWork(request, message);
    return error instanceof WorkspaceRefusal ? rejected('validation', message) : failure('execution', message, [], failureReasonFromCause(error, 'review-preparation'));
  }

  /**
   * Resolve the workspace, or return the operator message that refuses the run.
   *
   * These three refusals are the command layer's contract: `px active` maps
   * `execute preflight failed` and `dedicated execute worktree is required` to
   * their own remediation text.
   */
  private async resolveWorkspace(slug: string): Promise<ExecuteWorkspace | string> {
    if (!isMissionSlugCandidate(slug)) { return 'slug is not a recognized mission identity'; }
    if (!await this._ports.workspace.preflight(slug)) { return 'execute preflight failed'; }
    const worktree = await this._ports.workspace.resolveWorktree(slug);
    if (!worktree) { return 'dedicated execute worktree is required'; }
    return { worktree, taskResolution: await this._ports.workspace.resolveTaskFile(slug, worktree) };
  }

  /**
   * Start the agent and turn the launcher's raw facts into the operator
   * messages the command layer already parses (it reads an exit status back out
   * of `exited with status N`).
   */
  private async launchAgent(
    request: ExecuteMissionRequest,
    prepared: ExecuteWorkspace,
    plan: AgentLaunchPlan,
    selectedAgent: string,
    onStarted: () => void,
    recordedReviewImplementer?: string,
  ): Promise<AgentLaunchOutcome> {
    const launch = await this._ports.agentExecution.launch({
      slug: request.slug,
      worktree: prepared.worktree,
      plan,
      taskResolution: prepared.taskResolution,
      preselectedAgent: selectedAgent,
      pinnedAgent: request.pinnedAgent,
      detached: request.detached === true,
      // A usage block reroutes the same operation to the next eligible family.
      // Republishing here keeps that one mission WORKING with an updated agent
      // instead of producing an attention item for an autonomous review preparation.
      // Awaited, not fire-and-forget: this write is authoritative for what the
      // board shows, so it has to land before the run publishes its next
      // state. A dropped promise here reorders the board behind reality.
      onAgentChanged: async (agent, model) => {
        onStarted();
        await reportWorkflowProviderStarted(agent);
        await recordImplementerLaunch(request.slug, agent, this._ports.missionTransitions, new MissionLifecycleService(this._ports.missionTransitions));
        await this.publishWork(request, 'execute', `running execute agent (${agent})`, agent, model);
      },
    });
    if (!launch.errored) { onStarted(); await reportWorkflowProviderStarted(launch.agent); }
    await this.assertNoRecordedStop(request.slug);
    if (launch.errored) {
      throw new Error(`Could not start execute agent (${launch.agent}): ${launch.errorMessage}`);
    }
    if (typeof launch.exitStatus === 'number' && launch.exitStatus !== 0) {
      throw new Error(`Execute agent (${launch.agent}) exited with status ${launch.exitStatus}.`);
    }
    // A launcher may report its actual fallback only in its result.
    if (launch.agent !== selectedAgent || (recordedReviewImplementer && recordedReviewImplementer !== launch.agent)) {
      await recordImplementerLaunch(request.slug, launch.agent, this._ports.missionTransitions, new MissionLifecycleService(this._ports.missionTransitions));
    }
    return launch;
  }

  /**
   * Make the completed launch durable: commit whatever the agent left behind
   * and record telemetry. Lifecycle activation happened before provider startup.
   */
  private async recordLaunch(
    slug: string,
    prepared: ExecuteWorkspace,
    launch: AgentLaunchOutcome,
  ): Promise<DurableEvidence> {
    await this._ports.workspace.enforceCommitSafety({ slug, worktree: prepared.worktree });

    try {
      await this._ports.telemetry.recordLaunchTelemetry({
        slug,
        worktree: prepared.worktree,
        agent: launch.agent,
        launch,
      });
    } catch {
      // Execute statistics are explicitly best-effort and cannot alter lifecycle success.
    }

    return { id: `${slug}:active`, source: 'task-markdown', detail: 'task authority recorded active launch' };
  }

  /**
   * Route activation through the checked Mission boundary.
   *
   * The failure keeps its existing operator prefix and carries the Mission
   * authority's reason (for example, which contract parts are missing).
   */
  private async synchronizeLifecycle(slug: string, agent: string, operationId?: string): Promise<MissionTransitionResult> {
    const start = new ExecutionStartService(this._ports.missionTransitions);
    const accepted = authorizedExecutionStart();
    return accepted ? start.continue(accepted) : start.start(slug, agent, operationId ?? `active-${slug}`);
  }

  private abortActivation(slug: string, activation: MissionTransitionResult, agent: string): Promise<void> {
    return new ExecutionStartService(this._ports.missionTransitions).compensate({ id: `active-${slug}`, missionId: missionId(slug), agent,
      originalStatus: activation.from, previousAssignee: activation.previousAssignee, activationVersion: activation.version });
  }

  private emit(request: ExecuteMissionRequest, sequence: number, phase: string, message: string, agent?: string) {
    this._progress?.({ operationId: request.operationId, sequence, phase, message, timestamp: new Date().toISOString(), agent });
  }

  // -----------------------------------------------------------------------
  // Current work — the board's mission-scoped "who is working on this now?"
  //
  // Publication is best-effort in both directions: a recorder outage must not
  // fail a launch, and a launch failure must not be hidden behind a recorder
  // error. The reader ages an unterminated fact out on its own.
  // -----------------------------------------------------------------------

  private publication(request: ExecuteMissionRequest, phase: ExecutionActivityStage, summary: string, agent: string | null,
    model: string | null = null): ExecutionActivityIntent | null {
    return executionActivityIntent({
      slug: request.slug,
      operationId: request.operationId,
      phase,
      summary,
      agent,
      model,
    });
  }

  private async publishWork(request: ExecuteMissionRequest, phase: ExecutionActivityStage, summary: string, agent: string | null,
    model: string | null = null): Promise<void> {
    const publication = this.publication(request, phase, summary, agent, model);
    if (publication) { await bestEffort(() => this._currentWork.running(publication)); }
  }

  private async endWork(request: ExecuteMissionRequest): Promise<void> {
    const publication = this.publication(request, 'execute', 'execute run finished', null);
    if (publication) { await bestEffort(() => this._currentWork.ended(publication)); }
  }

  private async blockWork(request: ExecuteMissionRequest, reason: string): Promise<void> {
    const publication = this.publication(request, 'execute', 'execute run cannot continue', null);
    if (publication) { await bestEffort(() => this._currentWork.blocked(publication, reason)); }
  }
}

/**
 * Publication is observability, not the operation. A recorder outage must not
 * turn a completed launch into a failed one.
 */
async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch { }
}

class WorkspaceRefusal extends Error {}
