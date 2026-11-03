import { recognizedFailureReason } from '../domain/failure-reason.js';

/** Only an adapter's hook evidence establishes a hook rejection. */
export function classifyHookFailure(result: { failureReason?: unknown } | string | null | undefined): { isHookFailure: boolean; hookType: string | null } {
  const reason = !result || typeof result === 'string' ? null : recognizedFailureReason(result.failureReason);
  const hook = reason?.context?.hook;
  return reason?.code === 'git-hook-failed'
    ? { isHookFailure: true, hookType: typeof hook === 'string' ? hook : null }
    : { isHookFailure: false, hookType: null };
}
