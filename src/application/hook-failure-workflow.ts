/**
 * Hook-failure detection (TASK-2369.17, reduced by TASK-2377.05).
 *
 * Command-neutral application module. Both rebase and integrate consume this
 * helper to decide whether a Git failure is a hook failure at all. The
 * standalone auto-bounce policy that used to live here — its handler, its retry
 * cap, its injection port, and the persisted retry counter it wrote into review
 * state — was deleted by TASK-2377.05 once every consumer moved to the rebound
 * kernel (`src/application/rebound-kernel.ts`), which owns classification, the
 * fix prompt, the launch, and the per-occurrence in-memory budget in one place.
 *
 * Application layer: no imports.
 */

/**
 * Classify git hook failure from command output.
 * Detects pre-commit, pre-push, post-commit, and generic hook failures.
 */
export function classifyHookFailure(output: string): { isHookFailure: boolean; hookType: string | null } {
  if (!output) {
    return { isHookFailure: false, hookType: null };
  }
  const lower = output.toLowerCase();
  // Check specific hook types first (more specific match wins)
  if (/pre-commit/i.test(lower)) {
    return { isHookFailure: true, hookType: 'pre-commit' };
  }
  if (/pre-push/i.test(lower)) {
    return { isHookFailure: true, hookType: 'pre-push' };
  }
  if (/post-commit/i.test(lower)) {
    return { isHookFailure: true, hookType: 'post-commit' };
  }
  // Generic hook keyword match — require failure phrasing to avoid
  // false positives from paths like "post-integrate-hook.ts"
  if (/hook.*(failed|failure|error)/i.test(lower)) {
    return { isHookFailure: true, hookType: 'hook' };
  }
  return { isHookFailure: false, hookType: null };
}
