/**
 * Structured launcher spawn failure (TASK-2760).
 *
 * A child that never started reports no exit status. The spawn error's code,
 * message and any signal are the only evidence of why, so they are retained
 * as values instead of collapsing into an ambiguous null exit.
 */
export interface LaunchFailure {
  readonly code: string | null;
  readonly message: string | null;
  readonly signal: string | null;
}

/**
 * Spawn errors that recur for an unchanged launch: the operating system
 * refused the same command line and would refuse it again.
 */
const DETERMINISTIC_LAUNCH_ERRORS = new Set(['E2BIG', 'ENAMETOOLONG', 'ENOENT', 'EACCES', 'ENOEXEC']);

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The launch failure a result carries, or null when the child ran and exited with a status. */
export function launchFailureOf(result: { status?: number | null; signal?: unknown; error?: unknown } | null | undefined): LaunchFailure | null {
  if (!result) { return null; }
  const error = (result.error ?? null) as { code?: unknown; message?: unknown } | null;
  const signal = text(result.signal);
  if (typeof result.status === 'number' && !error) { return null; }
  if (!error && !signal) { return null; }
  return { code: text(error?.code), message: text(error?.message), signal };
}

export function isDeterministicLaunchFailure(failure: LaunchFailure): boolean {
  return failure.code !== null && DETERMINISTIC_LAUNCH_ERRORS.has(failure.code);
}

/** Operator-facing explanation with the next action for a known failure. */
export function describeLaunchFailure(failure: LaunchFailure): string {
  const facts = [
    failure.code ? `code ${failure.code}` : null,
    failure.signal ? `signal ${failure.signal}` : null,
    failure.message ? `message "${failure.message}"` : null,
  ].filter(Boolean).join(', ');
  const advice = failure.code === 'E2BIG'
    ? ' The launch command line exceeded the operating system argument-size limit (Linux caps one argument at 128 KiB); the same launch cannot succeed, so pass the prompt on stdin or use an agent family that does.'
    : isDeterministicLaunchFailure(failure)
      ? ' The operating system refused this launcher command; retrying it unchanged cannot succeed.'
      : '';
  return `${facts || 'no exit status, error or signal reported'}.${advice}`;
}
