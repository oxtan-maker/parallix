export interface ActiveCliRequest {
  readonly args: readonly string[];
  readonly explicitSlug?: string;
  readonly implementer?: string;
}

export function parseActiveCliRequest(args: string[]): ActiveCliRequest {
  const positional = args.filter(arg => !arg.startsWith('--'));
  const implementerIndex = args.indexOf('--implementer');
  const implementer = implementerIndex === -1 ? undefined : args[implementerIndex + 1];
  return { args: [...args], explicitSlug: positional[0], implementer };
}

export function renderActiveProgress(event: { phase: string; agent?: string }, log: (_message: string) => void): void {
  if (event.phase === 'launch') { log('Launching execute agent...'); }
  if (event.phase === 'handoff') { log(`\nExecute agent (${event.agent}) completed successfully. Starting automated handoff...`); }
}

export type ActiveCliRunner = (_request: ActiveCliRequest, _options: Record<string, unknown>) => Promise<void> | void;

export function createActiveCommand(runner: ActiveCliRunner) {
  return async (args: string[], options: Record<string, unknown> = {}): Promise<void> => {
    await runner(parseActiveCliRequest(args), options);
  };
}
