import { commandErrorMessage } from '../cli/commands/agent-result.js';
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import { readAgentConfig } from '../agents/agents.js';
import { selectAgent, eligibleAgentsForStep } from '../agents/agents.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import startupPreflight from '../cli/startup-preflight.js';
import { buildCheckpointContext, buildExecutePrompt, enforceExecuteCommitSafety, selectLaunchAndRecord } from '../cli/commands/active.js';
import { validateCheckpointsBeforeReviewPreparation } from './checkpoint-validation.js';
import { getTaskStatus, resolveTaskFile } from '../backlog/backlog.js';
import * as stats from '../cli/commands/stats.js';
import { resolveStageTelemetry } from '../agents/stage-telemetry.js';
import { git as awaitableGit } from '../git/git.js';
import * as agents from '../agents/agents.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { performReviewPreparation } from "../cli/commands/review-preparation.js";
import { createReviewLoopPorts } from '../review/review-loop.js';
import { runReviewLoop } from '../../application/review-loop/review-loop.js';
import * as repairReviewPreparation from "../cli/commands/repair-review-preparation.js";
import type { MissionTransitionStore, SessionMarkerPort } from '../../application/domain-ports.js';
import { backlogMirrorOwnership, missionId } from '../../domain/mission.js';
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
  ReviewPreparationExecutionPort,
  ReviewPreparationRunRequest,
  ReviewPreparationRunResult,
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
import { liveMissionExecutionContext, type MissionExecutionContextResolution } from '../../application/ports/mission-execution-context.js';
import { resolveMissionExecutionContext } from '../git/mission-execution-context.js';

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
  readonly preflight: (...args: Parameters<typeof startupPreflight>) => Pick<ReturnType<typeof startupPreflight>, 'pass'>;
  readonly resolveWorktree: typeof resolveWorktree;
  readonly resolveTaskFile: typeof resolveTaskFile;
  readonly buildCheckpointContext: typeof buildCheckpointContext;
  /** Read the persisted execution context plus latest checkpoint for a slug, or
   * null when neither exists. The checkpoint keeps the file-backed resume signal
   * alive even when the agent starts from persisted facts. */
  readonly resolveExecutionContext: (_slug: string) => Promise<MissionLaunchContext | null>;
  readonly resolveMutationContext: (_slug: string, _root: string) => MissionExecutionContextResolution;
  readonly readAgentConfig: typeof readAgentConfig;
  readonly buildExecutePrompt: typeof buildExecutePrompt;
  readonly selectLaunchAndRecord: (...args: Parameters<typeof selectLaunchAndRecord>) => Promise<Pick<Awaited<ReturnType<typeof selectLaunchAndRecord>>, 'agent' | 'result' | 'rebaseDeferred'>>;
  readonly enforceExecuteCommitSafety: (...args: Parameters<typeof enforceExecuteCommitSafety>) => void;
  readonly getTaskStatus: typeof getTaskStatus;
  readonly recordActiveStats: (options: NonNullable<Parameters<typeof stats.recordActiveStats>[0]> & { slug: string; rootDir: string; implementer: string }) => void;
  readonly resolveStageTelemetry: (options: NonNullable<Parameters<typeof resolveStageTelemetry>[0]>) => ReturnType<typeof resolveStageTelemetry>;
  /** Individual post-execute mechanisms. The application service owns their ordering. */
  readonly performReviewPreparation: (slug: string, options: { forgejoUser?: string; force?: boolean; executionContext: import('../../application/ports/mission-execution-context.js').LiveMissionExecutionContext }) => ReturnType<typeof performReviewPreparation>;
  /** Binds the review-loop mechanisms; the application review loop sequences them. */
  readonly reviewLoopMechanisms: typeof createReviewLoopPorts;
  readonly repairReviewPreparation: (...args: Parameters<typeof repairReviewPreparation.repairReviewPreparation>) => Promise<{ repaired: boolean; blocker?: string | null }>;
  readonly validateCheckpointsBeforeReviewPreparation: typeof validateCheckpointsBeforeReviewPreparation;
}

export interface ExecuteMissionAdapterOptions {
  readonly configuration?: ParallixConfiguration;
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
    private readonly _missionStore: MissionTransitionStore,
    private readonly _operatorBlocklist: OperatorBlocklistOverlay | null = null,
    private readonly _sessionMarkerPort: SessionMarkerPort | null = null,
    private readonly _configuration: ParallixConfiguration = DEFAULT_CONFIGURATION,
  ) {}

  async eligible(agent: string): Promise<boolean> {
    const eligible = eligibleAgentsForStep('active', { config: this.readAgentConfig(), runtimeBlocklist: this._operatorBlocklist, configuration: this._configuration });
    const override = this._configuration.agents.override;
    if (override && eligible.includes(override) && override !== agent) { return false; }
    return eligible.includes(agent);
  }

  async select(_slug: string): Promise<string | null> {
    return selectAgent('active', { config: this.readAgentConfig(), runtimeBlocklist: this._operatorBlocklist, checkAvailability: false, configuration: this._configuration });
  }

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
    const agentConfig = this.readAgentConfig();
    const loaded = await this._missionStore.load(missionId(request.slug));
    if (loaded.kind === 'unavailable') { throw new Error(`Cannot resolve Mission prompt authority: ${loaded.reason}`); }
    const dbOwnedNoMirror = loaded.kind === 'found' && backlogMirrorOwnership(loaded.mission).kind === 'none';
    return {
      agentConfig,
      // `startAgent` checks the selected launcher's health after the Mission
      // transition; do not block the active lifecycle on a CLI probe here.
      prompt: this._runtime.buildExecutePrompt(request.slug, launchContext, { rootDir: request.worktree, dbOwnedNoMirror }),
    };
  }

  async launch(request: AgentLaunchRequest): Promise<AgentLaunchOutcome> {
    const launch = await this._runtime.selectLaunchAndRecord({
      slug: request.slug,
      worktree: request.worktree,
      preselectedAgent: request.preselectedAgent ?? request.plan.agent ?? null,
      pinnedAgent: request.pinnedAgent,
      agentConfig: request.plan.agentConfig as object,
      runtimeBlocklist: this._operatorBlocklist,
      taskResolution: request.taskResolution,
      prompt: request.plan.prompt,
      sessionMarkerPort: this._sessionMarkerPort,
      onAgentLaunched: request.onAgentChanged,
      unrefChild: request.detached === true,
    });
    const result = launch.result;
    return {
      agent: launch.agent,
      rebaseDeferred: Boolean(launch.rebaseDeferred),
      errored: Boolean(result?.error),
      errorMessage: result?.error ? (commandErrorMessage(result.error) ?? String(result.error)) : null,
      exitStatus: typeof result?.status === 'number' ? result.status : null,
      detail: result ?? null,
    };
  }

  /**
   * The file-based agent config, including explicit local blocklist entries.
   * Selection interprets the once-materialized SQLite rows beneath those
   * entries at each synchronous call, so no block decision is frozen here.
   */
  private readAgentConfig(): object {
    return this._runtime.readAgentConfig() as object;
  }
}

/**
 * The launcher run record the agent adapter carried across as
 * `AgentLaunchOutcome.detail`. Only this adapter reads it.
 */
interface AgentRunDetail {
  readonly runId?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly telemetry?: Record<string, unknown>;
  readonly providerResources?: import('../../application/run-history-types.js').ProviderResourceObservation | null;
}

/** Execute statistics and stage telemetry writes. */
export class ExecuteTelemetryAdapter implements ExecuteTelemetryPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}

  async recordLaunchTelemetry(record: ExecuteTelemetryRecord): Promise<void> {
    const result = (record.launch.detail ?? undefined) as AgentRunDetail | undefined;
    const sinceMs = result?.startedAt ? Date.parse(result.startedAt) : 0;
    this._runtime.recordActiveStats({
      slug: record.slug,
      runId: result?.runId,
      rootDir: record.worktree,
      implementer: record.agent,
      telemetry: this._runtime.resolveStageTelemetry({ worktree: record.worktree, result, sinceMs }),
      durationMinutes: result?.startedAt && result.endedAt
        ? (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000
        : undefined,
    });
  }
}

/** Typed mechanism adapters; ExecuteReviewPreparationService owns their ordering. */
class CheckpointValidationAdapter implements CheckpointValidationPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}
  async validateBeforeReviewPreparation(request: CheckpointValidationRequest): Promise<CheckpointValidationVerdict> {
    return this._runtime.validateCheckpointsBeforeReviewPreparation(request.slug, request.worktree, { log: request.log, error: request.error }) as Promise<CheckpointValidationVerdict>;
  }
}

class ReviewPreparationExecutionAdapter implements ReviewPreparationExecutionPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}
  async run(request: ReviewPreparationRunRequest): Promise<ReviewPreparationRunResult> {
    const live = liveMissionExecutionContext(request.slug, this._runtime.resolveMutationContext(request.slug, request.worktree));
    if (!live.ok) { return { ok: false, reason: 'mutation-context-unavailable', error: live.reason, recoveryAttempted: true }; }
    const result = await this._runtime.performReviewPreparation(request.slug, { forgejoUser: request.agent, executionContext: live.context, force: request.force });
    const { gateFailure, ...reviewPreparation } = result;
    return gateFailure
      ? { ...reviewPreparation, gateFailure: { kind: 'gate-failure', ...gateFailure } }
      : reviewPreparation;
  }
  async repairHygiene(request: { slug: string; worktree: string; taskFile: string | null; error: string; failureReason?: import('../../domain/failure-reason.js').FailureReason; log: (_message: string) => void; outputError: (_message: string) => void }) {
    const result = await this._runtime.repairReviewPreparation(request.slug, request.worktree, request.error, { log: request.log, error: request.outputError, failureReason: request.failureReason });
    return result.blocker ? { repaired: result.repaired, blocker: result.blocker } : { repaired: result.repaired };
  }

}

class AutonomousReviewAdapter implements AutonomousReviewPort {
  constructor(private readonly _runtime: ExecuteMissionRuntime) {}
  async start(request: AutonomousReviewRequest): Promise<void> {
    const live = liveMissionExecutionContext(request.slug, this._runtime.resolveMutationContext(request.slug, request.worktree));
    if (!live.ok) { throw new Error(live.reason); }
    const mechanisms = this._runtime.reviewLoopMechanisms(request.slug, { worktree: live.context.missionWorktree, executionContext: live.context }, {
      executionContext: live.context, onAgentLaunched: request.onAgentLaunched, onAutonomousStop: request.onAutonomousStop,
    });
    await runReviewLoop({ slug: request.slug, implementer: request.implementer, reviewer: request.reviewer, skipReviewPreparation: true }, mechanisms);
  }
}

class RepairLaunchAdapter implements ExecuteRepairLaunchPort {
  constructor(private readonly _configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {}
  available(agent: string, worktree?: string) { return agents.workflowLauncherStatus(agent, worktree, this._configuration); }
  readHead(worktree: string) {
    const result = awaitableGit(['-C', worktree, 'rev-parse', 'HEAD']);
    return result.status === 0 ? result.stdout.trim() : null;
  }
  async launch(request: Parameters<ExecuteRepairLaunchPort['launch']>[0]) {
    const status = this.available(request.agent, request.worktree);
    if (!status.supported) { throw new Error(`Agent ${request.agent} is not available for relaunch: ${status.detail || status.reason || 'unknown'}`); }
    return agents.startAgent('active', { configuration: this._configuration,
      prompt: request.prompt, worktree: request.worktree, agent: request.agent, slug: request.slug, role: 'implementer', sessionPolicy: request.sessionPolicy,
      onLaunch: async ({ agent, model }: { agent: string; model: string | null }) => {
        await request.onAgentChanged?.(agent, model);
        fmt.log.plain(`Relaunched ${fmt.agent(agent)} for repair. Session persistence will be used if available.`);
      },
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
  const resolved = runtime || createDefaultExecuteMissionRuntime(options.configuration);
  return {
    workspace: new MissionWorkspaceAdapter(rootDir, resolved),
    agentExecution: new AgentExecutionAdapter(
      resolved,
      options.missionTransitionStore,
      options.operatorBlocklist ?? null,
      options.sessionMarkerPort ?? null,
      options.configuration,
    ),
    missionTransitions: options.missionTransitionStore,
    telemetry: new ExecuteTelemetryAdapter(resolved),
    checkpointValidation: new CheckpointValidationAdapter(resolved),
    reviewPreparationExecution: new ReviewPreparationExecutionAdapter(resolved),
    autonomousReview: new AutonomousReviewAdapter(resolved),
    repairLaunch: new RepairLaunchAdapter(options.configuration),
    output: new CliOutputAdapter(),
  };
}

export function createDefaultExecuteMissionRuntime(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): ExecuteMissionRuntime {
  return {
    preflight: (args, options) => startupPreflight(args, { ...options, configuration }),
    resolveWorktree,
    resolveTaskFile,
    buildCheckpointContext,
    readAgentConfig: (file, options) => readAgentConfig(file, { ...options, configuration }),
    buildExecutePrompt,
    selectLaunchAndRecord: options => selectLaunchAndRecord({ ...options, configuration }),
    enforceExecuteCommitSafety,
    getTaskStatus,
    recordActiveStats: options => stats.recordActiveStats({ ...options, configuration }),
    resolveStageTelemetry,
    performReviewPreparation: (slug, options) => performReviewPreparation(slug, { ...options, configuration }),
    reviewLoopMechanisms: (slug, target, bindings) => createReviewLoopPorts(slug, target, { ...bindings, configuration }),
    repairReviewPreparation: (slug, worktree, errorMsg, options) => repairReviewPreparation.default(slug, worktree, errorMsg, { ...options, configuration }),
    validateCheckpointsBeforeReviewPreparation,
    resolveMutationContext: (slug, root) => resolveMissionExecutionContext(slug, root, configuration),
    resolveExecutionContext: async () => null,
  };
}
