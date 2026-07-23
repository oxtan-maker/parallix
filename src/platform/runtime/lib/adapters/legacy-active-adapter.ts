import { readAgentConfigOrExit } from '../agents/agents.js';
import { resolveWorktree } from '../core/mission-utils.js';
import missionStart from '../commands/mission-start.js';
import { buildCheckpointContext, buildExecutePrompt, enforceExecuteCommitSafety, runHandoffAndReview, selectLaunchAndRecord } from '../commands/active.js';
import { getTaskStatus, resolveTaskFile, transitionTask } from '../tools/backlog.js';
import { resolveAgentModel } from '../core/product-config.js';
import * as stats from '../commands/stats.js';
import { resolveStageTelemetry } from '../agents/stage-telemetry.js';
import type { DurableEvidence } from '../application/contracts.js';
import type { ActiveLaunch, ActivePort } from '../application/ports.js';
// Type-only import (erased at runtime): the plain overlay shape materialized at
// the composition root. No SQLite driver binding reaches this module (SC2).
import type { OperatorBlocklistOverlay } from '../../../../adapters/sqlite/blocklist-snapshot.js';

export type { OperatorBlocklistOverlay };

export interface LegacyActiveAdapterOptions {
  readonly operatorBlocklist?: OperatorBlocklistOverlay | null;
}

export class LegacyActiveAdapter implements ActivePort {
  private readonly _runs = new Map<string, LegacyLaunchRun>();
  private readonly _runtime: LegacyActiveRuntime;
  private readonly _operatorBlocklist: OperatorBlocklistOverlay | null;

  constructor(
    private readonly _rootDir: string,
    runtime?: LegacyActiveRuntime,
    options?: LegacyActiveAdapterOptions,
  ) {
    // The command imports the composition root, which imports this adapter.
    // Resolve command exports when an adapter is actually constructed so that
    // this circular module graph cannot capture uninitialized helper bindings.
    this._runtime = runtime || createDefaultLegacyActiveRuntime();
    this._operatorBlocklist = options?.operatorBlocklist ?? null;
  }

  async validateSlug(slug: string): Promise<string | null> {
    if (!slug.startsWith('task-')) {return 'slug must begin with task-';}
    const preflight = this._runtime.preflight([slug], { returnResult: true });
    if (!preflight.pass) {return 'execute preflight failed';}
    const worktree = this._runtime.resolveWorktree(slug, { cwd: this._rootDir });
    if (!worktree) {return 'dedicated execute worktree is required';}
    const taskResolution = this._runtime.resolveTaskFile(slug, worktree);
    const checkpointContext = this._runtime.buildCheckpointContext(slug);
    this._runs.set(slug, {
      worktree,
      taskResolution,
      agentConfig: this.resolveAgentConfig(),
      prompt: this._runtime.buildExecutePrompt(slug, checkpointContext, { rootDir: worktree }),
    });
    return null;
  }

  async launch(slug: string, agent?: string | null): Promise<ActiveLaunch> {
    const run = this.requireRun(slug);
    const launch = await this._runtime.selectLaunchAndRecord({
      slug,
      worktree: run.worktree,
      preselectedAgent: agent || null,
      agentConfig: run.agentConfig,
      taskResolution: run.taskResolution,
      prompt: run.prompt,
    });
    if (launch.result.error) {
      throw new Error(`Could not start execute agent (${launch.agent}): ${launch.result.error.message}`);
    }
    if (typeof launch.result.status === 'number' && launch.result.status !== 0) {
      throw new Error(`Execute agent (${launch.agent}) exited with status ${launch.result.status}.`);
    }
    run.launch = launch;
    return { agent: launch.agent, evidence: { id: `${slug}:agent`, source: 'task-markdown', detail: 'legacy agent launch completed' } };
  }

  async recordLaunch(slug: string, agent: string): Promise<DurableEvidence> {
    const run = this.requireRun(slug);
    if (!run.launch) {throw new Error('launch must complete before lifecycle synchronization');}
    this._runtime.enforceExecuteCommitSafety({ slug, worktree: run.worktree });
    if (run.taskResolution.ok && run.taskResolution.taskFile) {
      const status = this._runtime.getTaskStatus(run.taskResolution.taskFile);
      if ((run.launch.rebaseDeferred || (status && status !== 'active'))
        && !this._runtime.transitionTask(slug, 'active', { rootDir: run.worktree })) {
        throw new Error('legacy task lifecycle synchronization failed');
      }
    }
    try {
      const result = run.launch.result;
      const sinceMs = result?.startedAt ? Date.parse(result.startedAt) : 0;
      this._runtime.recordActiveStats({
        slug,
        rootDir: run.worktree,
        implementer: agent,
        model: this._runtime.resolveAgentModel(agent, run.worktree) ?? undefined,
        telemetry: this._runtime.resolveStageTelemetry({ worktree: run.worktree, result, sinceMs }),
        durationMinutes: result?.startedAt && result.endedAt ? (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000 : 0,
      });
    } catch (error) {
      // Legacy execute statistics are explicitly best-effort and cannot alter lifecycle success.
      void error;
    }
    return { id: `${slug}:active`, source: 'task-markdown', detail: 'legacy task authority recorded active launch' };
  }

  async handoff(slug: string, agent: string): Promise<void> {
    const run = this.requireRun(slug);
    this._runs.delete(slug);
    if (!await this._runtime.runHandoffAndReview(slug, run.worktree, agent, { taskFile: run.taskResolution.ok ? run.taskResolution.taskFile : undefined })) {
      throw new Error('legacy handoff failed');
    }
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

  private requireRun(slug: string): LegacyLaunchRun {
    const run = this._runs.get(slug);
    if (!run) {throw new Error('validated active lifecycle context is required');}
    return run;
  }
}

export interface LegacyActiveRuntime {
  readonly preflight: typeof missionStart;
  readonly resolveWorktree: typeof resolveWorktree;
  readonly resolveTaskFile: typeof resolveTaskFile;
  readonly buildCheckpointContext: typeof buildCheckpointContext;
  readonly readAgentConfig: typeof readAgentConfigOrExit;
  readonly buildExecutePrompt: typeof buildExecutePrompt;
  readonly selectLaunchAndRecord: typeof selectLaunchAndRecord;
  readonly enforceExecuteCommitSafety: typeof enforceExecuteCommitSafety;
  readonly getTaskStatus: typeof getTaskStatus;
  readonly transitionTask: typeof transitionTask;
  readonly recordActiveStats: typeof stats.recordActiveStats;
  readonly resolveAgentModel: typeof resolveAgentModel;
  readonly resolveStageTelemetry: typeof resolveStageTelemetry;
  readonly runHandoffAndReview: typeof runHandoffAndReview;
}

function createDefaultLegacyActiveRuntime(): LegacyActiveRuntime {
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
    transitionTask,
    recordActiveStats: stats.recordActiveStats,
    resolveAgentModel,
    resolveStageTelemetry,
    runHandoffAndReview,
  };
}

interface LegacyLaunchRun {
  readonly worktree: string;
  readonly taskResolution: { readonly ok: boolean; readonly taskFile?: string };
  readonly agentConfig: object;
  readonly prompt: string;
  launch?: Awaited<ReturnType<typeof selectLaunchAndRecord>>;
}
