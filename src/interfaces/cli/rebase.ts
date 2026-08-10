import * as fmt from '../../application/presentation/cli-format.js';
import type { RebaseCommandUseCase } from '../../application/rebase-command-use-case.js';

/** Public invocation shape of `px rebase`. */
export interface RebaseCliRequest {
  readonly explicitSlug?: string;
  readonly push: boolean;
  /** Options the command does not recognize; preserved and passed through. */
  readonly unknownFlags: readonly string[];
}

export const REBASE_USAGE = 'Usage: px rebase [<slug>] [--push]';

/**
 * Parse the public CLI flags without consulting the filesystem or adapter state.
 *
 * `--push` and a single positional slug are the whole surface (TASK-2332.12 A2).
 * Unrecognized options are collected rather than rejected: the pre-extraction
 * command ignored them, and rejecting them would change exit codes for inputs
 * that used to rebase successfully.
 */
export function parseRebaseCliRequest(args: string[]): RebaseCliRequest {
  const positional: string[] = [];
  const unknownFlags: string[] = [];
  let push = false;
  for (const arg of args) {
    if (arg === '--push') { push = true; }
    else if (arg.startsWith('--')) { unknownFlags.push(arg); }
    else { positional.push(arg); }
  }
  return { explicitSlug: positional[0], push, unknownFlags };
}

/** Render the usage line for an invocation that carries no resolvable mission. */
export function renderRebaseUsage(): string {
  return REBASE_USAGE;
}

/** Render the advisory shown for options the command does not recognize. */
export function renderUnknownRebaseOptions(request: RebaseCliRequest): string | null {
  if (request.unknownFlags.length === 0) { return null; }
  return `Ignoring unrecognized rebase option(s): ${request.unknownFlags.join(', ')}. ${REBASE_USAGE}`;
}

/** Invocation the CLI interface delegates to; supplied by the composition root. */
export type RebaseCliRunner = (_args: string[], _options: Record<string, unknown>) => Promise<unknown> | unknown;

/**
 * Build the `px rebase` command: parse flags, render the parse advisories,
 * delegate to the application use case, and map the workflow's outcome onto a
 * process exit code.
 */
export function createRebaseCommand(runner: RebaseCliRunner) {
  return async (args: string[], options: Record<string, unknown> = {}): Promise<number> => {
    const request = parseRebaseCliRequest(args);
    // Debug-only: the pre-extraction command ignored unrecognized options
    // silently, so the default output stays byte-identical (SC7).
    const advisory = renderUnknownRebaseOptions(request);
    if (advisory) { fmt.log.debug(advisory); }
    let exitCode = 0;
    const exitFn = typeof options.exitFn === 'function'
      ? options.exitFn as (_code: number) => void
      : (code: number) => { exitCode = code; process.exit(code); };
    await runner(args, { ...options, exitFn: (code: number) => { exitCode = code; exitFn(code); } });
    return exitCode;
  };
}

/** Convenience binding for a pre-composed use case instance. */
export function createRebaseCommandForUseCase(useCase: RebaseCommandUseCase) {
  return createRebaseCommand(args => useCase.execute(args));
}
