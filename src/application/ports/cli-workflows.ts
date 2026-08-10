/** Application-owned ports for CLI workflow execution. Concrete implementations
 * are supplied only by the composition root. */
export interface IntegrateWorkflowPort {
  execute(_args: string[], _options?: Record<string, unknown>): Promise<unknown> | unknown;
}
