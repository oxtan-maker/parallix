import { readAgentConfigOrExit } from '../agents/agents.js';
import { selectAgent } from '../agents/agents.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import startupPreflight from '../cli/startup-preflight.js';
import { buildCheckpointContext, buildExecutePrompt, enforceExecuteCommitSafety, selectLaunchAndRecord } from '../cli/commands/active.js';
import { validateCheckpointsBeforeHandoff } from './checkpoint-validation.js';
import { getTaskStatus, resolveTaskFile } from '../backlog/backlog.js';
import { resolveAgentModel } from '../config/product-config.js';
import * as stats from '../cli/commands/stats.js';
import { resolveStageTelemetry } from '../agents/stage-telemetry.js';
import { git as awaitableGit } from '../git/git.js';
import * as agents from '../agents/agents.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { performHandoff } from '../cli/commands/handoff.js';
import { recordStageStatsSafe, startReviewLoop } from '../review/review-loop.js';
import * as repairHandoff from '../cli/commands/repair-handoff.js';
import type { MissionTransitionStore, SessionMarkerPort } from '../../application/domain-ports.js';
import type {
  AgentExecutionPort,
  AgentLaunchOutcome,
  AgentLaunchPlan,
  AgentLaunchRequest,
  ExecuteMissionPorts,
  ExecuteTelemetryPort,
  ExecuteTelemetryRecord,
  MissionWorkspacePort,
  TaskFileResolution,
  CheckpointValidationPort,
  CheckpointValidationRequest,
  CheckpointValidationVerdict,
  HandoffExecutionPort,
  HandoffRunRequest,
  HandoffRunResult,
  AutonomousReviewPort,
  AutonomousReviewRequest,
  ExecuteRepairLaunchPort,
  ExecuteOperatorOutputPort,
} from '../../application/ports/execute-mission.js';
// Type-only import (erased at runtime): the plain overlay shape materialized at
// the composition root. No SQLite driver binding reaches this module.
import type { OperatorBlocklistOverlay } from '../sqlite/blocklist-snapshot.js';
import type { MissionLaunchContext } from '../../application/mission-brief-service.js';
import { renderLaunchContext } from '../../application/mission-brief-service.js';

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

/** The command helpers these adapters stand in front of. */
export interface ExecuteMissionRuntime {
  readonly preflight: typeof startupPreflight;
  readonly resolveWorktree: typeof resolveWorktree;
  readonly resolveTaskFile: typeof resolveTaskFile;
  readonly buildCheckpointContext: typeof buildCheckpointContext;
  /** Read the persisted execution context plus latest checkpoint for a slug, or
   * null when neither exists. The checkpoint keeps the file-backed resume signal
   * alive even when the agent starts from persisted facts. */
  readonly resolveExecutionContext: (_slug: string) => Promise<MissionLaunchContext | null>;
  readonly readAgentConfig: typeof readAgentConfigOrExit;
  readonly buildExecutePrompt: typeof buildExecutePrompt;
  readonly selectLaunchAndRecord: typeof selectLaunchAndRecord;
  readonly enforceExecuteCommitSafety: typeof enforceExecuteCommitSafety;
  readonly getTaskStatus: typeof getTaskStatus;
  readonly recordActiveStats: typeof stats.recordActiveStats;
  readonly resolveAgentModel: typeof resolveAgentModel;
  readonly resolveStageTelemetry: typeof resolveStageTelemetry;
  /** Individual post-execute mechanisms. The application service owns their ordering. */
  readonly performHandoff: typeof performHandoff;
  readonly startReviewLoop: typeof startReviewLoop;
  readonly repairHandoff: typeof repairHandoff.default;
  readonly validateCheckpointsBeforeHandoff: typeof validateCheckpointsBeforeHandoff;
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
    // `active` owns the operator story (mission -> implementer -> live work),
    // so its preflight is quiet: routine PASS diagnostics are dropped while
    // FAIL/WARN and the USABLE verdict still surface. draft/review/verify-env
    // keep their own full diagnostic preflight via the workflow port. The
    // mission worktree the preflight validates against is resolved inside the
    // preflight mechanism from the slug, so this stays a single port call and
    // the use case owns worktree resolution after preflight.
    return Boolean(this._runtime.preflight([slug], {
      returnResult: true,
      quiet: true,
    }).pass);
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
    // The recorded brief is the authoritative launch context; the file-backed
    // checkpoint context is the legacy fallback for a Mission drafted before
    // one was recorded. Resolving first skips the checkpoint read entirely, so
    // a resume starts without reading MISSION.md or any CP-N.md, and the
    // resolved context still carries the latest checkpoint as the resume
    // signal.
    const persisted = await this._runtime.resolveExecutionContext(request.slug);
    const launchContext = persisted
      ? renderLaunchContext(persisted)
      : this._runtime.buildCheckpointContext(request.slug);
    const agentConfig = this.resolveAgentConfig();
    return {
      agentConfig,
      // `startAgent` checks the selected launcher's health after the Mission
      // transition; do not block the active lifecycle on a CLI probe here.
      agent: selectAgent('active', { config: agentConfig, checkAvailability: false }),
      prompt: this._runtime.buildExecutePrompt(request.slug, launchContext, { rootDir: request.worktree }),
    };
  }

  async launch(request: AgentLaunchRequest): Promise<AgentLaunchOutcome> {
    const launch = await this._runtime.selectLaunchAndRecord({
      slug: request.slug,
      worktree: request.worktree,
      preselectedAgent: request.preselectedAgent ?? request.plan.agent ?? null,
      agentConfig: request.plan.agentConfig as object,
      taskResolution: request.taskResolution,
      prompt: request.plan.prompt,
      sessionMarkerPort: this._sessionMarkerPort,
      onAgentLaunched: request.onAgentChanged,
      onActivated: request.onActivated,
      authorityAlreadyActive: request.authorityAlreadyActive === true,
      unrefChild: request.detached === true,
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

/** Typed mechanism adapters; ExecuteHandoffService owns their ordering. */
class CheckpointValidationAdapter implements CheckpointValidationPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}
  async validateBeforeHandoff(request: CheckpointValidationRequest): Promise<CheckpointValidationVerdict> {
    return this._runtime.validateCheckpointsBeforeHandoff(request.slug, request.worktree, { log: request.log, error: request.error }) as Promise<CheckpointValidationVerdict>;
  }
}

class HandoffExecutionAdapter implements HandoffExecutionPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}
  async run(request: HandoffRunRequest): Promise<HandoffRunResult> {
    const result = await this._runtime.performHandoff(request.slug, { forgejoUser: request.agent, worktree: request.worktree, force: request.force });
    const { gateFailure, ...handoff } = result;
    return gateFailure
      ? { ...handoff, gateFailure: { kind: 'gate-failure', ...gateFailure } }
      : handoff;
  }
  async repairHygiene(request: { slug: string; worktree: string; taskFile: string | null; error: string; log: (_message: string) => void; outputError: (_message: string) => void }) {
    const result = await this._runtime.repairHandoff(request.slug, request.worktree, request.error, { log: request.log, error: request.outputError });
    return result.blocker ? { repaired: result.repaired, blocker: result.blocker } : { repaired: result.repaired };
  }
  classifyFailure(error: string) {
    const classified = repairHandoff.classifyError(error);
    return classified ? { failureClass: classified.failureClass, dispatchAction: classified.dispatchAction } : null;
  }
  isRelaunchableFailure(error: string) { return repairHandoff.isRelaunchableError(error); }
}

class AutonomousReviewAdapter implements AutonomousReviewPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}
  async start(request: AutonomousReviewRequest): Promise<void> {
    await this._runtime.startReviewLoop(request.slug, { implementer: request.implementer, worktree: request.worktree, skipHandoff: true, recordStageStatsSafeFn: recordStageStatsSafe, onAgentLaunched: request.onAgentLaunched, onAutonomousStop: request.onAutonomousStop });
  }
}

class RepairLaunchAdapter implements ExecuteRepairLaunchPort {
  available(agent: string) { return agents.workflowLauncherStatus(agent); }
  readHead(worktree: string) {
    const result = (awaitableGit as any)(['-C', worktree, 'rev-parse', 'HEAD']);
    return result.status === 0 ? result.stdout.trim() : null;
  }
  async launch(request: { slug: string; worktree: string; agent: string; prompt: string; sessionPolicy?: unknown }): Promise<unknown> {
    const status = this.available(request.agent);
    if (!status.supported) { throw new Error(`Agent ${request.agent} is not available for relaunch: ${status.detail || status.reason || 'unknown'}`); }
    return agents.startAgent('active', {
      prompt: request.prompt, worktree: request.worktree, agent: request.agent, slug: request.slug, role: 'implementer', sessionPolicy: request.sessionPolicy as any,
      onLaunch: ({ agent }: { agent: string }) => fmt.log.plain(`Relaunched ${fmt.agent(agent)} for repair. Session persistence will be used if available.`),
    });
  }
}

class CliOutputAdapter implements ExecuteOperatorOutputPort {
  log(message: string) { fmt.log.plain(message); }
  error(message: string) { fmt.log.plainError(message); }
  command(command: string) { return fmt.command(command); }
  formatSlug(slug: string) { return fmt.slug(slug); }
  formatAgent(agent: string) { return fmt.agent(agent); }
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
    checkpointValidation: new CheckpointValidationAdapter(resolved),
    handoffExecution: new HandoffExecutionAdapter(resolved),
    autonomousReview: new AutonomousReviewAdapter(resolved),
    repairLaunch: new RepairLaunchAdapter(),
    output: new CliOutputAdapter(),
  };
}

export function createDefaultExecuteMissionRuntime(): ExecuteMissionRuntime {
  return {
    preflight: startupPreflight,
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
    performHandoff,
    startReviewLoop,
    repairHandoff: repairHandoff.default,
    validateCheckpointsBeforeHandoff,
    resolveExecutionContext: async () => null,
  };
}
