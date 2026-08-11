export interface ConfigCliRequest { readonly args: readonly string[]; }

export function parseConfigCliRequest(args: string[]): ConfigCliRequest {
  return { args: [...args] };
}

export function renderConfig(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export type ConfigCliRunner = (_request: ConfigCliRequest, _options: Record<string, unknown>) => Promise<void> | void;

export function createConfigCommand(runner: ConfigCliRunner) {
  return async (args: string[] = [], options: Record<string, unknown> = {}): Promise<void> => {
    await runner(parseConfigCliRequest(args), options);
  };
}
