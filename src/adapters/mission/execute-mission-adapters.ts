import { readAgentConfigOrExit } from '../agents/agents.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import missionStart from '../cli/mission-start.js';
import { buildCheckpointContext, buildExecutePrompt, enforceExecuteCommitSafety, runHandoffAndReview, selectLaunchAndRecord } from '../cli/commands/active.js';
import { getTaskStatus, resolveTaskFile } from '../backlog/backlog.js';
import { resolveAgentModel } from '../config/product-config.js';
import * as stats from '../cli/commands/stats.js';
import { resolveStageTelemetry } from '../agents/stage-telemetry.js';
import type { MissionTransitionStore, SessionMarkerPort } from '../../application/domain-ports.js';
import type {
  AgentExecutionPort,
  AgentLaunchOutcome,
  AgentLaunchPlan,
  AgentLaunchRequest,
  ExecuteMissionPorts,
  ExecuteTelemetryPort,
  ExecuteTelemetryRecord,
  HandoffReviewPort,
  HandoffReviewRequest,
  MissionWorkspacePort,
  TaskFileResolution,
} from '../../application/ports/execute-mission.js';
// Type-only import (erased at runtime): the plain overlay shape materialized at
// the composition root. No SQLite driver binding reaches this module.
import type { OperatorBlocklistOverlay } from '../sqlite/blocklist-snapshot.js';

export type { OperatorBlocklistOverlay };

/**
 * Narrow adapters behind the execute-workflow mechanism ports.
 *
 * Each class implements exactly one port and performs only its own mechanism's
 * effects: Git/worktree and Backlog-Markdown access, agent process launch, and
 * statistics writes. None of them sequences the workflow, decides a lifecycle
 * transition, or holds per-slug state — `ExecuteMissionService` owns all three
 * (ADR 0051).
 */

/** The legacy command helpers these adapters stand in front of. */
export interface ExecuteMissionRuntime {
  readonly preflight: typeof missionStart;
  readonly resolveWorktree: typeof resolveWorktree;
  readonly resolveTaskFile: typeof resolveTaskFile;
  readonly buildCheckpointContext: typeof buildCheckpointContext;
  readonly readAgentConfig: typeof readAgentConfigOrExit;
  readonly buildExecutePrompt: typeof buildExecutePrompt;
  readonly selectLaunchAndRecord: typeof selectLaunchAndRecord;
  readonly enforceExecuteCommitSafety: typeof enforceExecuteCommitSafety;
  readonly getTaskStatus: typeof getTaskStatus;
  readonly recordActiveStats: typeof stats.recordActiveStats;
  readonly resolveAgentModel: typeof resolveAgentModel;
  readonly resolveStageTelemetry: typeof resolveStageTelemetry;
  readonly runHandoffAndReview: typeof runHandoffAndReview;
}

export interface ExecuteMissionAdapterOptions {
  /** Application-owned Mission transition authority supplied by composition. */
  readonly missionTransitionStore: MissionTransitionStore;
  readonly operatorBlocklist?: OperatorBlocklistOverlay | null;
  /**
   * Shared session-marker authority from the composition root. When provided,
   * startAgent reuses the composition root's SQLite connection instead of
   * opening a separate one (avoids "database is locked" contention between
   * independent DatabaseSync handles on the same file).
   */
  readonly sessionMarkerPort?: SessionMarkerPort | null;
}

/** Preflight, worktree/task-file resolution, Backlog status reads, commit safety. */
export class MissionWorkspaceAdapter implements MissionWorkspacePort {
  constructor(
    private readonly _rootDir: string,
    private readonly _runtime: ExecuteMissionRuntime,
  ) {}

  async preflight(slug: string): Promise<boolean> {
    return Boolean(this._runtime.preflight([slug], { returnResult: true }).pass);
  }

  async resolveWorktree(slug: string): Promise<string | null> {
    return this._runtime.resolveWorktree(slug, { cwd: this._rootDir }) || null;
  }

  async resolveTaskFile(slug: string, worktree: string): Promise<TaskFileResolution> {
    return this._runtime.resolveTaskFile(slug, worktree);
  }

  async readTaskStatus(taskFile: string): Promise<string | null> {
    return this._runtime.getTaskStatus(taskFile) ?? null;
  }

  async enforceCommitSafety(request: { readonly slug: string; readonly worktree: string }): Promise<void> {
    this._runtime.enforceExecuteCommitSafety({ slug: request.slug, worktree: request.worktree });
  }
}

/** Agent configuration, prompt construction, and the agent process launch. */
export class AgentExecutionAdapter implements AgentExecutionPort {
  constructor(
    private readonly _runtime: ExecuteMissionRuntime,
    private readonly _operatorBlocklist: OperatorBlocklistOverlay | null = null,
    private readonly _sessionMarkerPort: SessionMarkerPort | null = null,
  ) {}

  async prepare(request: { readonly slug: string; readonly worktree: string }): Promise<AgentLaunchPlan> {
    const checkpointContext = this._runtime.buildCheckpointContext(request.slug);
    const agentConfig = this.resolveAgentConfig();
    return {
      agentConfig,
      prompt: this._runtime.buildExecutePrompt(request.slug, checkpointContext, { rootDir: request.worktree }),
    };
  }

  async launch(request: AgentLaunchRequest): Promise<AgentLaunchOutcome> {
    const launch = await this._runtime.selectLaunchAndRecord({
      slug: request.slug,
      worktree: request.worktree,
      preselectedAgent: request.preselectedAgent,
      agentConfig: request.plan.agentConfig as object,
      taskResolution: request.taskResolution,
      prompt: request.plan.prompt,
      sessionMarkerPort: this._sessionMarkerPort,
      onAgentLaunched: request.onAgentChanged,
    });
    const result = launch.result;
    return {
      agent: launch.agent,
      rebaseDeferred: Boolean(launch.rebaseDeferred),
      errored: Boolean(result?.error),
      errorMessage: result?.error ? (result.error.message ?? String(result.error)) : null,
      exitStatus: typeof result?.status === 'number' ? result.status : null,
      detail: result ?? null,
    };
  }

  /**
   * Read the file-based agent config and, when SQLite is enabled, overlay the
   * operator-local blocklist as the sole authority for that field. Repository
   * (config file) authority is preserved for every other field (steps,
   * eligibility, weights). Fully synchronous — the async materialization
   * already happened once at the composition root.
   */
  private resolveAgentConfig(): object {
    const fileConfig = this._runtime.readAgentConfig() as Record<string, unknown>;
    if (!this._operatorBlocklist) {
      return fileConfig;
    }
    return { ...fileConfig, blocklist: this._operatorBlocklist };
  }
}

/**
 * The launcher run record the agent adapter carried across as
 * `AgentLaunchOutcome.detail`. Only this adapter reads it.
 */
interface AgentRunDetail {
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly telemetry?: { provider?: string } & Record<string, unknown>;
}

/** Execute statistics and stage telemetry writes. */
export class ExecuteTelemetryAdapter implements ExecuteTelemetryPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}

  async recordLaunchTelemetry(record: ExecuteTelemetryRecord): Promise<void> {
    const result = (record.launch.detail ?? undefined) as AgentRunDetail | undefined;
    const sinceMs = result?.startedAt ? Date.parse(result.startedAt) : 0;
    this._runtime.recordActiveStats({
      slug: record.slug,
      rootDir: record.worktree,
      implementer: record.agent,
      model: this._runtime.resolveAgentModel(record.agent, record.worktree) ?? undefined,
      telemetry: this._runtime.resolveStageTelemetry({ worktree: record.worktree, result, sinceMs }),
      durationMinutes: result?.startedAt && result.endedAt
        ? (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000
        : 0,
    });
  }
}

/** The handoff and autonomous-review pipeline. */
export class HandoffReviewAdapter implements HandoffReviewPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}

  async runHandoffAndReview(request: HandoffReviewRequest): Promise<boolean> {
    return Boolean(await this._runtime.runHandoffAndReview(
      request.slug,
      request.worktree,
      request.agent,
      { taskFile: request.taskFile ?? undefined },
    ));
  }
}

/**
 * Build the execute-workflow mechanism set for one repository root.
 *
 * Composition supplies the lifecycle authority and shared operator-state
 * ports. This adapter never imports or reconstructs the application graph.
 */
export function createExecuteMissionPorts(
  rootDir: string,
  options: ExecuteMissionAdapterOptions,
  runtime?: ExecuteMissionRuntime,
): ExecuteMissionPorts {
  if (!options?.missionTransitionStore) {
    throw new Error('composition must supply a mission transition store');
  }
  const resolved = runtime || createDefaultExecuteMissionRuntime();
  return {
    workspace: new MissionWorkspaceAdapter(rootDir, resolved),
    agentExecution: new AgentExecutionAdapter(
      resolved,
      options.operatorBlocklist ?? null,
      options.sessionMarkerPort ?? null,
    ),
    missionTransitions: options.missionTransitionStore,
    telemetry: new ExecuteTelemetryAdapter(resolved),
    handoffReview: new HandoffReviewAdapter(resolved),
  };
}

export function createDefaultExecuteMissionRuntime(): ExecuteMissionRuntime {
  return {
    preflight: missionStart,
    resolveWorktree,
    resolveTaskFile,
    buildCheckpointContext,
    readAgentConfig: readAgentConfigOrExit,
    buildExecutePrompt,
    selectLaunchAndRecord,
    enforceExecuteCommitSafety,
    getTaskStatus,
    recordActiveStats: stats.recordActiveStats,
    resolveAgentModel,
    resolveStageTelemetry,
    runHandoffAndReview,
  };
}
