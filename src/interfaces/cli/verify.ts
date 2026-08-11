export interface VerifyCliRequest { readonly args: readonly string[]; readonly area?: string; }

export function parseVerifyCliRequest(args: string[]): VerifyCliRequest {
  return { args: [...args], area: args[0] };
}

export function renderVerifyStart(request: VerifyCliRequest): string {
  return `Running verification gate for area: ${request.area || 'docs'}...`;
}

export type VerifyCliRunner = (_request: VerifyCliRequest, _options: Record<string, unknown>) => unknown;

export function createVerifyCommand(runner: VerifyCliRunner) {
  return (args: string[], options: Record<string, unknown> = {}) => runner(parseVerifyCliRequest(args), options);
}
