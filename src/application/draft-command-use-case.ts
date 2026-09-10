import { randomUUID } from 'node:crypto';
import type { DraftWorkflowPort, DraftWorkflowContext } from './ports/cli-workflows.js';
import {
  currentWorkPublication,
  NO_CURRENT_WORK_PORT,
  type CurrentWorkPort,
} from './recording/current-work-recorder.js';

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
    private readonly _currentWork: CurrentWorkPort = NO_CURRENT_WORK_PORT,
  ) {}

  /** CLI entry point. argv and options stay the CLI adapter's concern. */
  async execute(args: string[], options: Record<string, unknown> = {}): Promise<void> {
    await this.run(args, options, false);
  }

  /** Typed board entry point: the mission slug is the only input.
   * Runs the exact same nine-step sequence through the port; a workflow
   * abort throws instead of returning, so the caller maps it to a typed
   * failure/rejection. */
  async executeForSlug(slug: string): Promise<void> {
    await this.run([slug], {}, true);
  }

  private async run(args: string[], options: Record<string, unknown>, abortOnExit: boolean): Promise<void> {
    const abort = (context: DraftWorkflowContext): void => {
      if (abortOnExit) { throw new DraftWorkflowAbortedError(context.slug); }
    };

    // Step 1: Preflight — resolve slug, validate repo, baseline, config, task
    let ctx = this._workflow.preflight(args, options);
    if (ctx.exited) { abort(ctx); return; }

    // A draft agent can work for minutes or hours. Publish after preflight has
    // resolved the slug, so observability cannot turn invalid CLI input into a
    // new failure mode. The single operation id also keeps terminal events
    // correlated with the running fact they clear.
    const publication = currentWorkPublication({
      slug: ctx.slug,
      operationId: `draft:${ctx.slug}:${randomUUID()}`,
      phase: 'execute',
      summary: `px draft ${args.join(' ')}`.trim(),
      agent: ctx.agent,
    });
    if (publication) { await bestEffort(() => this._currentWork.running(publication)); }

    try {
      // Step 2: Setup — branch, worktree, graphify workspace, gitignore
      ctx = this._workflow.setup(ctx);
      if (ctx.exited) { abort(ctx); return; }

      // Step 3: Scaffold — MISSION.md, base branch record, backlog bootstrap
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
  } catch (error) {
    void error;
  }
}

// Re-export context type so callers can reference it
export type { DraftWorkflowContext };
