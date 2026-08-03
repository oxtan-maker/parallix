import type { ApplicationOutcome, Cancellation, Capability, DurableEvidence } from './contracts.js';
import { failure, rejected } from './contracts.js';
import { MissionLifecycleService } from './mission-lifecycle-service.js';
import { agentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import type {
  AgentLaunchOutcome,
  AgentLaunchPlan,
  ExecuteMissionPorts,
  TaskFileResolution,
} from './ports/execute-mission.js';
import type { ProgressPort } from './ports.js';

export interface ExecuteMissionRequest {
  readonly operationId: string;
  readonly slug: string;
  readonly agent?: string | null;
  readonly capabilities: ReadonlySet<Capability>;
  readonly cancellation?: Cancellation;
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
  ) {}

  async execute(request: ExecuteMissionRequest): Promise<ApplicationOutcome<ExecuteMissionResult>> {
    if (!request.operationId || !request.slug) {return rejected('validation', 'operationId and slug are required');}
    if (!request.capabilities.has('active:execute')) {return rejected('capability', 'active:execute capability is required');}
    if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before launch');}

    const prepared = await this.resolveWorkspace(request.slug);
    if (typeof prepared === 'string') {return rejected('validation', prepared);}

    this.emit(request, 1, 'launch', 'launching execute agent');
    try {
      const plan = await this._ports.agentExecution.prepare({
        slug: request.slug,
        worktree: prepared.worktree,
      });
      const launch = await this.launchAgent(request, prepared, plan);
      const evidence: DurableEvidence[] = [
        { id: `${request.slug}:agent`, source: 'task-markdown', detail: 'execute agent launch completed' },
      ];

      this.emit(request, 2, 'record', 'recording durable launch evidence');
      evidence.push(await this.recordLaunch(request.slug, prepared, launch));

      if (request.cancellation?.requested) {
        return failure('cancelled', 'cancelled after durable launch; re-query task state', evidence);
      }

      this.emit(request, 3, 'handoff', 'starting handoff', launch.agent);
      const handedOff = await this._ports.handoffReview.runHandoffAndReview({
        slug: request.slug,
        worktree: prepared.worktree,
        agent: launch.agent,
        taskFile: prepared.taskResolution.ok ? prepared.taskResolution.taskFile ?? null : null,
      });
      if (!handedOff) {throw new Error('legacy handoff failed');}

      return { status: 'completed', value: { agent: launch.agent }, durableEvidence: evidence };
    } catch (error) {
      return failure('execution', error instanceof Error ? error.message : 'active execution failed');
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
    if (!slug.startsWith('task-')) {return 'slug must begin with task-';}
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
  ): Promise<AgentLaunchOutcome> {
    const launch = await this._ports.agentExecution.launch({
      slug: request.slug,
      worktree: prepared.worktree,
      plan,
      taskResolution: prepared.taskResolution,
      preselectedAgent: request.agent || null,
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
   * Make the launch durable: commit whatever the agent left behind, synchronize
   * the Mission lane when the launch left it unsynchronized, then record
   * telemetry.
   */
  private async recordLaunch(
    slug: string,
    prepared: ExecuteWorkspace,
    launch: AgentLaunchOutcome,
  ): Promise<DurableEvidence> {
    await this._ports.workspace.enforceCommitSafety({ slug, worktree: prepared.worktree });

    if (prepared.taskResolution.ok && prepared.taskResolution.taskFile) {
      const status = await this._ports.workspace.readTaskStatus(prepared.taskResolution.taskFile);
      // Whether the recorded lane still needs synchronizing is an observation of
      // the launch (a deferred rebase, or a task that is not yet active). What
      // the transition *is* — and whether it is legal from the current status —
      // is decided by `decideMission` inside the lifecycle use case, which then
      // writes through the Mission authority with the exact revision it read.
      if (launch.rebaseDeferred || (status && status !== 'active')) {
        await this.synchronizeLifecycle(slug, launch.agent);
      }
    }

    try {
      await this._ports.telemetry.recordLaunchTelemetry({
        slug,
        worktree: prepared.worktree,
        agent: launch.agent,
        launch,
      });
    } catch (error) {
      // Execute statistics are explicitly best-effort and cannot alter lifecycle success.
      void error;
    }

    return { id: `${slug}:active`, source: 'task-markdown', detail: 'task authority recorded active launch' };
  }

  /**
   * Route activation through the checked Mission boundary.
   *
   * The failure message is unchanged so the command layer's fail-closed
   * behavior and its existing operator text are preserved.
   */
  private async synchronizeLifecycle(slug: string, agent: string): Promise<void> {
    const outcome = await new MissionLifecycleService(this._ports.missionTransitions).activate({
      operationId: `active-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['mission:transition']),
      agent: agentFamily(agent),
      occurredAt: new Date().toISOString(),
    });
    if (outcome.status !== 'completed') {
      throw new Error('legacy task lifecycle synchronization failed');
    }
  }

  private emit(request: ExecuteMissionRequest, sequence: number, phase: string, message: string, agent?: string) {
    this._progress?.({ operationId: request.operationId, sequence, phase, message, timestamp: new Date().toISOString(), agent });
  }
}
