import type { ApplicationOutcome, Cancellation, Capability, DurableEvidence } from './contracts.js';
import { failure, rejected } from './contracts.js';
import { MissionLifecycleService, type MissionTransitionResult } from './mission-lifecycle-service.js';
import { agentFamily } from '../domain/agents.js';
import { missionId, isMissionSlugCandidate } from '../domain/mission.js';
import type {
  AgentLaunchOutcome,
  AgentLaunchPlan,
  ExecuteMissionPorts,
  TaskFileResolution,
} from './ports/execute-mission.js';
import { ExecuteHandoffService } from './execute-handoff-service.js';
import type { ProgressPort } from './ports.js';
import {
  reviewLoopPublisher,
  currentWorkPublication,
  NO_CURRENT_WORK_PORT,
  type CurrentWorkPhase,
  type CurrentWorkPort,
  type CurrentWorkPublication,
} from './recording/current-work-recorder.js';

export interface ExecuteMissionRequest {
  readonly operationId: string;
  readonly slug: string;
  readonly agent?: string | null;
  readonly capabilities: ReadonlySet<Capability>;
  readonly cancellation?: Cancellation;
  /**
   * The dispatching host will not keep its process alive for this operation
   * (board fire-and-forget dispatch): the execute launch must unref its child
   * so q/Ctrl+C can exit the board while the action runs on (CP-4 ownership
   * rule). CLI callers omit it and await the agent in-process.
   */
  readonly detached?: boolean;
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
 *   1. request guards and the pre-launch cancellation boundary
 *   2. workspace resolution (preflight, worktree, task file)
 *   3. agent preparation and launch
 *   4. the durable launch record (commit safety + evidence)
 *   5. lifecycle synchronization through the checked Mission authority
 *   6. best-effort telemetry
 *   7. the post-record cancellation boundary, then handoff and review
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
    private readonly _currentWork: CurrentWorkPort = NO_CURRENT_WORK_PORT,
  ) {}

  async execute(request: ExecuteMissionRequest): Promise<ApplicationOutcome<ExecuteMissionResult>> {
    if (!request.operationId || !request.slug) {return rejected('validation', 'operationId and slug are required');}
    if (!request.capabilities.has('active:execute')) {return rejected('capability', 'active:execute capability is required');}
    if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before launch');}

    const prepared = await this.resolveWorkspace(request.slug);
    if (typeof prepared === 'string') {return rejected('validation', prepared);}

    this.emit(request, 1, 'launch', 'launching execute agent');
    await this.publishWork(request, 'execute', 'launching execute agent', null);
    let activation: MissionTransitionResult | null = null;
    let activationAgent: string | null = null;
    let agentStarted = false;
    try {
      const plan = await this._ports.agentExecution.prepare({
        slug: request.slug,
        worktree: prepared.worktree,
      });
      const selectedAgent = request.agent || plan.agent;
      if (!selectedAgent) { throw new Error('Could not select an execute agent.'); }
      // Persist before provider startup. A launch callback updates this only
      // when a usage fallback actually chooses another family.
      activation = await this.synchronizeLifecycle(request.slug, selectedAgent);
      activationAgent = selectedAgent;
      const launch = await this.launchAgent(request, prepared, plan, selectedAgent, () => { agentStarted = true; });
      const evidence: DurableEvidence[] = [
        { id: `${request.slug}:agent`, source: 'task-markdown', detail: 'execute agent launch completed' },
      ];

      this.emit(request, 2, 'record', 'recording durable launch evidence');
      evidence.push(await this.recordLaunch(request.slug, prepared, launch));

      if (request.cancellation?.requested) {
        await this.endWork(request);
        return failure('cancelled', 'cancelled after durable launch; re-query task state', evidence);
      }

      this.emit(request, 3, 'handoff', 'starting handoff', launch.agent);
      await this.publishWork(request, 'handoff', 'handing off and reviewing', null);
      const handoffRequest = {
        slug: request.slug,
        worktree: prepared.worktree,
        agent: launch.agent,
        taskFile: prepared.taskResolution.ok ? prepared.taskResolution.taskFile ?? null : null,
        // Autonomous review is real work by other families on this same
        // mission. It publishes through the same seam `px review` uses, so the
        // board follows the reviewer and the implementer answering findings
        // instead of freezing on the original implementer's handoff.
        ...reviewLoopPublisher(this._currentWork, {
          slug: request.slug,
          operationId: request.operationId,
        }),
      };
      const handedOff = await new ExecuteHandoffService({
        checkpoints: this._ports.checkpointValidation,
        handoff: this._ports.handoffExecution,
        review: this._ports.autonomousReview,
        repairLaunch: this._ports.repairLaunch,
        output: this._ports.output,
      }).run(handoffRequest);
      if (!handedOff) {throw new Error('handoff and review failed');}

      await this.endWork(request);
      return { status: 'completed', value: { agent: launch.agent }, durableEvidence: evidence };
    } catch (error) {
      let message = error instanceof Error ? error.message : 'active execution failed';
      if (activation?.from === 'refined' && activationAgent && !agentStarted) {
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
      return failure('execution', message);
    }
  }

  /**
   * Resolve the workspace, or return the operator message that refuses the run.
   *
   * These three refusals are the command layer's contract: `px active` maps
   * `execute preflight failed` and `dedicated execute worktree is required` to
   * their own remediation text.
   */
  private async resolveWorkspace(slug: string): Promise<ExecuteWorkspace | string> {
    if (!isMissionSlugCandidate(slug)) {return 'slug is not a recognized mission identity';}
    if (!await this._ports.workspace.preflight(slug)) {return 'execute preflight failed';}
    const worktree = await this._ports.workspace.resolveWorktree(slug);
    if (!worktree) {return 'dedicated execute worktree is required';}
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
  ): Promise<AgentLaunchOutcome> {
    const launch = await this._ports.agentExecution.launch({
      slug: request.slug,
      worktree: prepared.worktree,
      plan,
      taskResolution: prepared.taskResolution,
      preselectedAgent: selectedAgent,
      detached: request.detached === true,
      authorityAlreadyActive: true,
      // A usage block reroutes the same operation to the next eligible family.
      // Republishing here keeps that one mission WORKING with an updated agent
      // instead of producing an attention item for an autonomous handoff.
      // Awaited, not fire-and-forget: this write is authoritative for what the
      // board shows, so it has to land before the run publishes its next
      // state. A dropped promise here reorders the board behind reality.
      onAgentChanged: async (agent) => {
        onStarted();
        if (agent !== selectedAgent) { await this.synchronizeLifecycle(request.slug, agent); }
        await this.publishWork(request, 'execute', `running execute agent (${agent})`, agent);
      },
    });
    if (launch.errored) {
      throw new Error(`Could not start execute agent (${launch.agent}): ${launch.errorMessage}`);
    }
    if (typeof launch.exitStatus === 'number' && launch.exitStatus !== 0) {
      throw new Error(`Execute agent (${launch.agent}) exited with status ${launch.exitStatus}.`);
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
  private async synchronizeLifecycle(slug: string, agent: string): Promise<MissionTransitionResult> {
    const outcome = await new MissionLifecycleService(this._ports.missionTransitions).activate({
      operationId: `active-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['mission:transition']),
      agent: agentFamily(agent),
      occurredAt: new Date().toISOString(),
    });
    if (outcome.status !== 'completed' || !outcome.value) {
      throw new Error(`legacy task lifecycle synchronization failed: ${outcome.error?.message ?? outcome.status}`);
    }
    return outcome.value;
  }

  private async abortActivation(slug: string, activation: MissionTransitionResult, agent: string): Promise<void> {
    const outcome = await new MissionLifecycleService(this._ports.missionTransitions).abortActivation({
      operationId: `abort-active-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['mission:transition']),
      assignee: activation.previousAssignee,
      actor: agent,
      occurredAt: new Date().toISOString(),
    });
    if (outcome.status !== 'completed') {
      throw new Error(`Could not undo failed activation: ${outcome.error?.message ?? outcome.status}`);
    }
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

  private publication(request: ExecuteMissionRequest, phase: CurrentWorkPhase, summary: string, agent: string | null): CurrentWorkPublication | null {
    return currentWorkPublication({
      slug: request.slug,
      operationId: request.operationId,
      phase,
      summary,
      agent,
    });
  }

  private async publishWork(request: ExecuteMissionRequest, phase: CurrentWorkPhase, summary: string, agent: string | null): Promise<void> {
    const publication = this.publication(request, phase, summary, agent);
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
  } catch {}
}
