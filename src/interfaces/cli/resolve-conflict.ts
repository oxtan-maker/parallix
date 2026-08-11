export interface ResolveConflictCliRequest { readonly args: readonly string[]; readonly explicitSlug?: string; }

export function parseResolveConflictCliRequest(args: string[]): ResolveConflictCliRequest {
  return { args: [...args], explicitSlug: args[0] };
}

export function renderResolveConflictUsage(): string {
  return 'Usage: px resolve-conflict [<slug>]';
}

export type ResolveConflictCliRunner = (_request: ResolveConflictCliRequest, _options: Record<string, unknown>) => Promise<void> | void;

export function createResolveConflictCommand(runner: ResolveConflictCliRunner) {
  return async (args: string[], options: Record<string, unknown> = {}): Promise<void> => {
    await runner(parseResolveConflictCliRequest(args), options);
  };
}
