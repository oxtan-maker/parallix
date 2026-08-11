export interface DiffCliRequest { readonly args: readonly string[]; readonly explicitSlug?: string; }

export function parseDiffCliRequest(args: string[]): DiffCliRequest {
  return { args: [...args], explicitSlug: args.find(arg => !arg.startsWith('--')) };
}

export function renderDiffUsage(): string {
  return 'Usage: node parallix diff [<slug>]';
}

export type DiffCliRunner = (_request: DiffCliRequest, _options: Record<string, unknown>) => Promise<void> | void;

export function createDiffCommand(runner: DiffCliRunner) {
  return async (args: string[], options: Record<string, unknown> = {}): Promise<void> => {
    await runner(parseDiffCliRequest(args), options);
  };
}
