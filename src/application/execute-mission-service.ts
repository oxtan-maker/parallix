import type { ApplicationOutcome, Cancellation, Capability, DurableEvidence } from './contracts.js';
import { failure, rejected } from './contracts.js';
import { MissionLifecycleService } from './mission-lifecycle-service.js';
import { checkLifecycleDeadline, monotonicNowMs } from './lifecycle-timing.js';
import { agentFamily } from '../domain/agents.js';
import { missionId, isMissionSlugCandidate } from '../domain/mission.js';
import type {
  AgentLaunchOutcome,
  AgentLaunchPlan,
  ExecuteMissionPorts,
  TaskFileResolution,
} from './ports/execute-mission.js';
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
 *   3. agent preparation and launch, with the authoritative active boundary
 *      committing at launch confirmation (fail-closed, ADR 0053 rule 5)
 *   4. the durable launch record (commit safety + evidence)
 *   5. best-effort telemetry
 *   6. the post-record cancellation boundary, then handoff and review
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
        await this.endWork(request);
        return failure('cancelled', 'cancelled after durable launch; re-query task state', evidence);
      }

      this.emit(request, 3, 'handoff', 'starting handoff', launch.agent);
      await this.publishWork(request, 'handoff', 'handing off and reviewing', null);
      const handedOff = await this._ports.handoffReview.runHandoffAndReview({
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
      });
      if (!handedOff) {throw new Error('handoff and review failed');}

      await this.endWork(request);
      return { status: 'completed', value: { agent: launch.agent }, durableEvidence: evidence };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'active execution failed';
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
  ): Promise<AgentLaunchOutcome> {
    const launch = await this._ports.agentExecution.launch({
      slug: request.slug,
      worktree: prepared.worktree,
      plan,
      taskResolution: prepared.taskResolution,
      preselectedAgent: request.agent || null,
      detached: request.detached === true,
      // A usage block reroutes the same operation to the next eligible family.
      // Republishing here keeps that one mission WORKING with an updated agent
      // instead of producing an attention item for an autonomous handoff.
      // Awaited, not fire-and-forget: this write is authoritative for what the
      // board shows, so it has to land before the run publishes its next
      // state. A dropped promise here reorders the board behind reality.
      onAgentChanged: (agent) => this.publishWork(request, 'execute', `running execute agent (${agent})`, agent),
      // TASK-2582: the authoritative active boundary persists as the launch
      // is confirmed, before destination-state work proceeds — not after the
      // agent finishes. A rejection propagates as a launch failure and stops
      // the run. The launcher fires this for every family it actually starts,
      // so an automatic fallback re-asserts the boundary with the new agent
      // and no second lane event (activation is idempotent on an active lane).
      onActivated: (agent, startedAtMs) => this.activateAtBoundary(request.slug, agent, startedAtMs),
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
   * Make the launch durable: commit whatever the agent left behind, then
   * record telemetry.
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
   * Persist the `active` boundary the moment the launcher confirms the spawn.
   *
   * The destination state and its lane event commit before destination-state
   * work proceeds (TASK-2582): a slow agent run, Git operation, or gate can
   * no longer delay the transition, and a persistence failure throws so the
   * run stops before any success output or Backlog promotion. An unavailable
   * operator database fails closed like any other persistence failure
   * (ADR 0053 rule 5): active work and handoff never run over an uncommitted
   * lane.
   */
  private async activateAtBoundary(slug: string, agent: string, workStartedAtMs = monotonicNowMs()): Promise<void> {
    // Production launchers carry the monotonic timestamp of the real child
    // spawn — destination-work start (TASK-2582 SC8) — so the budget covers
    // work-start → persistence, not pre-spawn launch prep. The default keeps
    // injected launchers that call the boundary immediately compatible.
    const outcome = await this.activateMission(slug, agent);
    if (outcome.status === 'completed') {
      checkLifecycleDeadline({ startedAtMs: workStartedAtMs, what: `active lifecycle boundary for ${slug}` });
      return;
    }
    // ADR 0053 rule 5: database-owned mutations fail closed when the database
    // is unavailable or corrupt. An activation that cannot commit must stop
    // the run — no active work, no handoff — never skip (TASK-2582 F9).
    throw new Error(`active lifecycle boundary for ${slug} failed: ${outcome.error?.message ?? outcome.status}`);
  }

  /**
   * Route activation through the checked Mission boundary.
   */

  private async activateMission(slug: string, agent: string) {
    return new MissionLifecycleService(this._ports.missionTransitions).activate({
      operationId: `active-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['mission:transition']),
      agent: agentFamily(agent),
      occurredAt: new Date().toISOString(),
    });
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
