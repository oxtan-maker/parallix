/**
 * Handoff CLI interface (TASK-2332.09).
 *
 * Owns argument parsing, request translation, exit-code mapping, and rendering.
 * It imports no adapter module: the workflow arrives as an already-constructed
 * `HandoffCommandUseCase` from the composition root.
 */
import * as fmt from '../../application/presentation/cli-format.js';
import type { HandoffCommandUseCase } from '../../application/handoff-command-use-case.js';

export interface HandoffCliRequest {
  readonly slug: string | undefined;
  readonly skipGate: boolean;
  readonly force: boolean;
}

/** Parse handoff CLI flags without consulting filesystem or adapter state. */
export function parseHandoffCliRequest(args: string[]): HandoffCliRequest {
  const positional: string[] = [];
  let skipGate = false;
  let force = false;
  for (const arg of args) {
    if (arg === '--no-gate') {
      if (skipGate) { throw new Error('--no-gate may be supplied only once.'); }
      skipGate = true;
    } else if (arg === '--force') {
      if (force) { throw new Error('--force may be supplied only once.'); }
      force = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown handoff option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { slug: positional[0], skipGate, force };
}

/**
 * Map a handoff outcome to a process exit code: 0 on success, 1 on failure.
 * Exposed separately so the mapping is testable without spawning a process.
 */
export function handoffExitCode(result: { ok: boolean }): number {
  return result.ok ? 0 : 1;
}

export function createHandoffCommand(useCase: HandoffCommandUseCase) {
  return async (args: string[], options: Record<string, unknown> = {}) => {
    // The slug stays optional because the use case infers it from the current
    // worktree when no positional is supplied.
    const request = parseHandoffCliRequest(args);
    const result = await useCase.execute(request, options);
    if (result.usage) {
      fmt.log.fail(result.error ?? 'Usage: node parallix handoff [<slug>] [--no-gate] [--force]');
    }
    if (handoffExitCode(result) !== 0) {
      process.exit(1);
    }
  };
}
