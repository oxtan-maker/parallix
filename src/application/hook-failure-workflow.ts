/**
 * Hook-failure classification and auto-bounce policy (TASK-2369.17).
 *
 * Command-neutral application module. Both rebase and integrate consume these
 * helpers. Owns the classification categories, retry budget, and rebounce
 * prompt template so a future policy change hits one file.
 *
 * Application layer: imports `cli-format`, `output-elision`, and `ports/rebase-workflow` only.
 */
import * as fmt from './presentation/cli-format.js';
import { elideBounceOutput } from './output-elision.js';
import type { RebaseWorkflowPort } from './ports/rebase-workflow.js';

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

/** Max retries for hook failure auto-bounce. */
export const MAX_HOOK_RETRY = 2;

/** Subset of the workflow port the hook rebounce policy depends on. */
export type HookRebouncePort = Pick<RebaseWorkflowPort,
  'startAgent' | 'readReviewState' | 'writeReviewState' | 'persistReviewState' | 'exit'
  | 'transitionTask' | 'applyAgentFallback' | 'selectAgent' | 'workflowLauncherStatus'
  | 'resolveTaskFile' | 'getTaskImplementer'>;

/**
 * Handle git hook failure with auto-bounce to implementer.
 * Returns true if auto-bounced (caller should retry), false if stranded.
 */
export async function handleHookFailureAutoBounce(
  slug: string,
  worktree: string,
  hookOutput: string,
  classification: { hookType: string | null },
  port: HookRebouncePort,
  {
    missionStore = null,
    recoveryCommand = 'git rebase --abort',
  }: { missionStore?: unknown; recoveryCommand?: string } = {},
): Promise<boolean> {
  // Read persisted retry count
  const persisted = await Promise.resolve(port.readReviewState(slug, worktree, missionStore)) as any;
  const retryCount = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? (Number((persisted.metadata as any).hookFailureRetryCount) || 0)
    : 0;

  if (retryCount >= MAX_HOOK_RETRY) {
    fmt.log.fail(`Hook failure: max retries exceeded (${MAX_HOOK_RETRY}). Mission stranded for ${slug}.`);
    fmt.log.fail(`Hook ${classification.hookType || 'failure'} failed ${retryCount} times. Human intervention required.`);
    fmt.log.fail(`Hook output:\n${hookOutput}`);
    return false;
  }

  const newRetryCount = retryCount + 1;

  // Build fix prompt
  const fixPrompt = [
    `GIT HOOK FAILURE — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    `Hook type: ${classification.hookType || 'unknown'}`,
    ``,
    `Hook output (use this to diagnose and fix):`,
    `---`,
    elideBounceOutput(hookOutput),
    `---`,
    ``,
    `Retry attempt: ${newRetryCount}/${MAX_HOOK_RETRY}`,
    ``,
    `Fix the underlying issue so the git hook passes.`,
    `After fixing, the operation will be retried automatically.`,
  ].join('\n');

  // Update retry count in metadata
  const metadata: Record<string, unknown> = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? { ...persisted.metadata }
    : {};
  metadata.hookFailureRetryCount = newRetryCount;

  try {
    if (persisted) {
      await port.persistReviewState(slug, { ...persisted, metadata }, worktree, missionStore);
    } else {
      await port.persistReviewState(slug, { metadata }, worktree, missionStore);
    }
  } catch (err: any) {
    fmt.log.fail(`Could not persist hook retry state: ${err.message || String(err)}. Falling back to manual recovery.`);
    return false;
  }

  // Resolve implementer
  const taskResolution = port.resolveTaskFile(slug, worktree) as any;
  let implementer = taskResolution.ok && taskResolution.task ? port.getTaskImplementer(taskResolution.task) : null;

  if (!implementer) {
    const status = port.workflowLauncherStatus?.() ?? { available: false, agent: null };
    if (status.available && status.agent) {
      implementer = port.selectAgent?.({ role: 'implementer' }) || status.agent;
    }
  }

  if (!implementer) {
    fmt.log.fail(`Could not determine implementer for ${slug}. Cannot auto-bounce.`);
    return false;
  }

  // Transition task back to active (implementer phase) without consuming reviewer cycle
  await port.transitionTask(slug, 'active', { rootDir: worktree, log: fmt.log.plain });
  fmt.log.info(`Auto-bouncing to implementer (${implementer}) with hook fix prompt. Retry ${newRetryCount}/${MAX_HOOK_RETRY}.`);

  // Launch implementer with the fix prompt
  try {
    const launchResult = await port.startAgent('act-on-review', {
      agent: implementer,
      prompt: fixPrompt,
      worktree,
      slug,
      role: 'implementer',
      exclude: [],
    });

    // Apply any agent fallback if needed
    await port.applyAgentFallback({
      role: 'implementer',
      original: implementer,
      launchResult,
      state: persisted || {},
      slug,
      worktree,
      taskResolution: { ok: taskResolution.ok, taskFile: taskResolution.taskFile },
      log: fmt.log.plain,
      writeReviewStateFn: port.writeReviewState,
      missionStore,
    });

    if (launchResult.result && launchResult.result.status !== 0) {
      fmt.log.fail(`Implementer (${launchResult.agent}) exited with status ${launchResult.result.status}. Mission stranded.`);
      return false;
    }
  } catch (err: any) {
    fmt.log.fail(`Could not launch implementer for hook fix: ${err.message || String(err)}. Falling back to hint.`);
    fmt.log.fail(`Hint: A git hook failed. Fix the issues reported above and try again.`);
    fmt.log.fail(`Recovery: ${fmt.command(recoveryCommand)}`);
    port.exit(1);
    return false;
  }

  return true;
}
