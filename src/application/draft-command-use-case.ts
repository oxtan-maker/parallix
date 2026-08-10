import type { DraftWorkflowPort, DraftWorkflowContext } from './ports/cli-workflows.js';

/** CLI-independent application entry point for the draft workflow.
 * Owns the complete workflow sequence through port methods. */
export class DraftCommandUseCase {
  constructor(private readonly _workflow: DraftWorkflowPort) {}

  async execute(args: string[], options: Record<string, unknown> = {}): Promise<void> {
    // Step 1: Preflight — resolve slug, validate repo, baseline, config, task
    let ctx = this._workflow.preflight(args, options);
    if (ctx.exited) { return; }

    // Step 2: Setup — branch, worktree, graphify workspace, gitignore
    ctx = this._workflow.setup(ctx);
    if (ctx.exited) { return; }

    // Step 3: Scaffold — MISSION.md, base branch record, backlog bootstrap
    ctx = this._workflow.scaffold(ctx);
    if (ctx.exited) { return; }

    // Step 4: Intake — materialize mission in SQLite (async)
    ctx = await this._workflow.intake(ctx);
    if (ctx.exited) { return; }

    // Step 5: Transition — backlog task to target status (async)
    ctx = await this._workflow.transition(ctx);
    if (ctx.exited) { return; }

    // Step 6: Launch agent — read config, select, launch, record (async)
    ctx = await this._workflow.launchAgent(ctx);
    if (ctx.exited) { return; }

    // Step 7: Post-process — classification normalize, label sync, re-assert base (async)
    ctx = await this._workflow.postProcess(ctx);
    if (ctx.exited) { return; }

    // Step 8: Commit safety — capture uncommitted changes
    ctx = this._workflow.commitSafety(ctx);
    if (ctx.exited) { return; }

    // Step 9: Final transition to 'ready'
    await this._workflow.finalTransition(ctx);
  }
}

// Re-export context type so callers can reference it
export type { DraftWorkflowContext };
