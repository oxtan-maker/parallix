export interface SetupCliRequest { readonly args: readonly string[]; readonly nonInteractive: boolean; }

export function parseSetupCliRequest(args: string[]): SetupCliRequest {
  return { args: [...args], nonInteractive: args.includes('--non-interactive') };
}

export function renderSetupMode(request: SetupCliRequest): string {
  return request.nonInteractive ? 'Non-interactive setup' : 'Interactive setup';
}

export type SetupCliRunner = (_request: SetupCliRequest, _options: Record<string, unknown>) => Promise<void> | void;

export function createSetupCommand(runner: SetupCliRunner) {
  return async (args: string[], options: Record<string, unknown> = {}): Promise<void> => {
    await runner(parseSetupCliRequest(args), options);
  };
}
