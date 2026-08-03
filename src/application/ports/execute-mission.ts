import type { MissionTransitionStore } from '../domain-ports.js';

/**
 * Mechanism ports for the execute (`px active`) workflow.
 *
 * Each port is named for the external mechanism it stands in front of — a
 * workspace, an agent process, the Mission authority, a statistics writer, a
 * handoff/review pipeline — rather than for a phase of the legacy command. The
 * ordering between them, the partial-failure policy, and the cancellation
 * boundaries are owned by `ExecuteMissionService`, never by an adapter
 * (ADR 0051: adapters do not choose lifecycle transitions or policy).
 *
 * Every value crossing these interfaces is a plain, serializable-shaped record.
 * No filesystem handle, Git runner, child process, or SQLite driver type is
 * named here.
 */

/** How a slug resolved to a task file inside the mission worktree. */
export interface TaskFileResolution {
  readonly ok: boolean;
  readonly taskFile?: string;
}

/**
 * The mission workspace: preflight, worktree and task-file resolution, the
 * post-agent commit-safety harness, and Backlog status reads.
 *
 * Implementations own the Git and filesystem effects; the use case only
 * consumes their verdicts.
 */
export interface MissionWorkspacePort {
  /** `false` when execute preflight refuses the slug. */
  preflight(_slug: string): Promise<boolean>;
  /** The dedicated execute worktree, or `null` when the mission has none. */
  resolveWorktree(_slug: string): Promise<string | null>;
  resolveTaskFile(_slug: string, _worktree: string): Promise<TaskFileResolution>;
  /** Backlog lane recorded for the task file, or `null` when unreadable. */
  readTaskStatus(_taskFile: string): Promise<string | null>;
  /**
   * Commit whatever the agent left behind. Throws when the worktree holds
   * unresolved conflicts or the fallback commit fails; the use case treats that
   * throw as an execution failure of the launch.
   */
  enforceCommitSafety(_request: { readonly slug: string; readonly worktree: string }): Promise<void>;
}

/**
 * Everything needed to start one agent process, resolved before the launch and
 * carried by the use case as an explicit value.
 */
export interface AgentLaunchPlan {
  readonly prompt: string;
  /**
   * Agent configuration (eligibility, steps, weights, operator blocklist
   * overlay) resolved by the adapter. Opaque to the application layer: it is
   * handed straight back to `launch`.
   */
  readonly agentConfig: unknown;
}

export interface AgentLaunchRequest {
  readonly slug: string;
  readonly worktree: string;
  readonly plan: AgentLaunchPlan;
  readonly taskResolution: TaskFileResolution;
  /** Operator-pinned implementer family, or `null` to let selection choose. */
  readonly preselectedAgent: string | null;
}

/**
 * The raw facts about one agent run. The application layer turns these into
 * operator messages and lifecycle decisions; the adapter never does.
 */
export interface AgentLaunchOutcome {
  /** The family that actually ran — may differ from the preselection after a limit-hit fallback. */
  readonly agent: string;
  /** The launch already moved the task to `active` and deferred its rebase. */
  readonly rebaseDeferred: boolean;
  /**
   * The launcher reported an error. Carried separately from `errorMessage`
   * because a launcher error is a fact about the run, not about its text — an
   * error whose message is empty still failed the launch.
   */
  readonly errored: boolean;
  /** Launcher error text, or `null` when the process started. */
  readonly errorMessage: string | null;
  /** Process exit status when the launcher reported one. */
  readonly exitStatus: number | null;
  /**
   * Adapter-owned run detail (timings, transcript handles). Returned verbatim
   * to `ExecuteTelemetryPort`; the application layer never inspects it.
   */
  readonly detail: unknown;
}

/** The agent process mechanism: configuration, prompt delivery, and launch. */
export interface AgentExecutionPort {
  /** Resolve the agent configuration and the execute prompt for this worktree. */
  prepare(_request: { readonly slug: string; readonly worktree: string }): Promise<AgentLaunchPlan>;
  launch(_request: AgentLaunchRequest): Promise<AgentLaunchOutcome>;
}

export interface ExecuteTelemetryRecord {
  readonly slug: string;
  readonly worktree: string;
  readonly agent: string;
  readonly launch: AgentLaunchOutcome;
}

/**
 * Execute statistics and stage telemetry.
 *
 * Explicitly best-effort: the use case swallows failures here so a telemetry
 * outage cannot turn a completed launch into a failed one.
 */
export interface ExecuteTelemetryPort {
  recordLaunchTelemetry(_record: ExecuteTelemetryRecord): Promise<void>;
}

export interface HandoffReviewRequest {
  readonly slug: string;
  readonly worktree: string;
  readonly agent: string;
  readonly taskFile: string | null;
}

/**
 * The handoff and autonomous-review pipeline. Its internal repair, relaunch,
 * and retry loops are mechanism detail; the use case observes only the final
 * verdict.
 */
export interface HandoffReviewPort {
  runHandoffAndReview(_request: HandoffReviewRequest): Promise<boolean>;
}

/**
 * The complete mechanism set `ExecuteMissionService` sequences.
 *
 * `missionTransitions` is the checked Mission authority itself rather than a
 * bespoke lifecycle port: the use case drives it through
 * `MissionLifecycleService`, so every execute-path status change is a checked
 * read-revision write and no adapter can choose a transition.
 */
export interface ExecuteMissionPorts {
  readonly workspace: MissionWorkspacePort;
  readonly agentExecution: AgentExecutionPort;
  readonly missionTransitions: MissionTransitionStore;
  readonly telemetry: ExecuteTelemetryPort;
  readonly handoffReview: HandoffReviewPort;
}
