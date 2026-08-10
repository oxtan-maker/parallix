import type { IntegrateWorkflowPort } from './ports/cli-workflows.js';

/** CLI-independent application entry point for the integration workflow. */
export class IntegrateCommandUseCase {
  constructor(private readonly _workflow: IntegrateWorkflowPort) {}

  execute(args: string[], options: Record<string, unknown> = {}): Promise<unknown> | unknown {
    return this._workflow.execute(args, options);
  }
}
