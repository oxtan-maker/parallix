import type { RebaseWorkflowPort } from './ports/rebase-workflow.js';
import { runRebaseWorkflow } from './rebase-workflow.js';

/** CLI-independent application entry point for the rebase workflow (TASK-2332.12). */
export class RebaseCommandUseCase {
  constructor(private readonly _workflow: RebaseWorkflowPort) {}

  /** Run the rebase workflow for the given argv tail. */
  execute(args: string[]): Promise<void> {
    return runRebaseWorkflow(args, this._workflow);
  }
}
