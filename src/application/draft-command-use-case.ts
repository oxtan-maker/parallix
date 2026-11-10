import { randomUUID } from 'node:crypto';
import type { DraftWorkflowPort, DraftWorkflowContext } from './ports/cli-workflows.js';
import {
  executionActivityIntent,
  NO_EXECUTION_ACTIVITY,
  type ExecutionActivityPort,
} from './recording/execution-activity-recorder.js';
import * as fmt from './presentation/cli-format.js';

export type DraftImplementerLog = (_message: string) => void;

export interface DraftImplementerRecordingPort {
  getTaskStatus(taskFile: string): string | null;
  transitionTask(
    slug: string,
    status: string,
    options: {
      implementer: string;
      rootDir: string;
      log: DraftImplementerLog;
    },
  ): boolean | Promise<boolean>;
  resolveRoot(worktree: string, slug: string): string;
}

export interface DraftImplementerRecordingRequest {
  selected: string;
  actual: string;
  taskResolution?: { ok: boolean; taskFile?: string } | null;
  slug: string;
  worktree: string;
  log: DraftImplementerLog;
  plumbingLog: DraftImplementerLog;
}

/**
 * A draft workflow step signalled exit (its exit function was called).
 *
 * The CLI entry treats an exited context as a normal return; the typed board
 * entry converts it into this error so a duplicate worktree, an unresolvable
 * task, or any other abort can never surface as a completed move.
 */
export class DraftWorkflowAbortedError extends Error {
  constructor(readonly slug: string) {
    super(`draft workflow for ${slug} aborted before completion`);
    this.name = 'DraftWorkflowAbortedError';
  }
}

/** CLI-independent application entry point for the draft workflow.
 * Owns the complete workflow sequence through port methods. */
export class DraftCommandUseCase {
  constructor(
    private readonly _workflow: DraftWorkflowPort,
    private readonly _currentWork: ExecutionActivityPort = NO_EXECUTION_ACTIVITY,
  ) {}

  /** CLI entry point. argv and options stay the CLI adapter's concern. */
  async execute(args: string[], options: Record<string, unknown> = {}): Promise<void> {
    await this.run(args, options, false);
  }

  /** Typed board entry point: mission identity and optional explicit family.
   * Runs the exact same nine-step sequence through the port; a workflow
   * abort throws instead of returning, so the caller maps it to a typed
   * failure/rejection. */
  async executeForSlug(slug: string, agent?: import('../domain/agents.js').AgentFamily): Promise<void> {
    await this.run(agent ? [slug, '--agent', agent] : [slug], agent ? { pinnedAgent: true } : {}, true);
  }

  private async run(args: string[], options: Record<string, unknown>, abortOnExit: boolean): Promise<void> {
    const abort = (context: DraftWorkflowContext): void => {
      if (abortOnExit) { throw new DraftWorkflowAbortedError(context.slug); }
    };

    // Step 1: Preflight — resolve slug, validate repo, baseline, config, task
    // (awaited: it probes the operator store for an existing DB-owned mission)
    let ctx = await this._workflow.preflight(args, options);
    if (ctx.exited) { abort(ctx); return; }

    // A draft agent can work for minutes or hours. Publish after preflight has
    // resolved the slug, so observability cannot turn invalid CLI input into a
    // new failure mode. The single operation id also keeps terminal events
    // correlated with the running fact they clear.
    const publication = executionActivityIntent({
      slug: ctx.slug,
      operationId: `draft:${ctx.slug}:${randomUUID()}`,
      phase: 'draft',
      summary: `px draft ${args.join(' ')}`.trim(),
      agent: ctx.agent,
    });
    if (publication) { await bestEffort(() => this._currentWork.running(publication)); }

    try {
      // Step 2: Setup — branch, worktree, graphify workspace, gitignore
      ctx = this._workflow.setup(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 3: Scaffold — typed contract preparation, base branch record, backlog bootstrap
      ctx = this._workflow.scaffold(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 4: Intake — materialize mission in SQLite (async)
      ctx = await this._workflow.intake(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 5: Transition — backlog task to target status (async)
      ctx = await this._workflow.transition(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 6: Launch agent — read config, select, launch, record (async)
      ctx = await this._workflow.launchAgent(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 7: Post-process — normalize classification and re-assert base (async)
      ctx = await this._workflow.postProcess(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 8: Commit safety — capture uncommitted changes
      ctx = this._workflow.commitSafety(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 9: Final transition to 'ready'
      await this._workflow.finalTransition(ctx);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'draft operation cannot continue autonomously';
      if (publication) { await bestEffort(() => this._currentWork.blocked(publication, reason)); }
      throw error;
    }
    if (publication) { await bestEffort(() => this._currentWork.ended(publication)); }
  }
}

async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch {}
}

/** Owns the post-launch decision to project the actual draft agent into Backlog. */
export async function recordDraftImplementerAssignment(
  request: DraftImplementerRecordingRequest,
  port: DraftImplementerRecordingPort,
): Promise<string> {
  const { selected, actual, taskResolution, slug, worktree, log, plumbingLog } = request;
  if (!taskResolution?.ok || !taskResolution.taskFile || !actual) {
    return actual || selected;
  }

  if (selected && actual !== selected) {
    log(fmt.status('INFO', `Draft agent fell back from ${fmt.agent(selected)} to ${fmt.agent(actual)}; enforcing backlog assignee.`));
  } else {
    plumbingLog(fmt.status('INFO', `Enforcing draft agent ${fmt.agent(actual)} as assignee...`));
  }

  const currentStatus = port.getTaskStatus(taskResolution.taskFile);
  if (!currentStatus || !await port.transitionTask(slug, currentStatus, {
    implementer: actual,
    rootDir: port.resolveRoot(worktree, slug),
    log: plumbingLog,
  })) {
    log(fmt.status('WARN', `Could not enforce draft agent ${fmt.agent(actual)} in backlog task.`));
  }
  return actual;
}

// Re-export context type so callers can reference it
export type { DraftWorkflowContext };
