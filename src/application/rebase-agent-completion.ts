import type { RebaseWorkflowPort } from './ports/rebase-workflow.js';
import { rebound } from './rebound-kernel.js';
import * as fmt from './presentation/cli-format.js';

/** Certify agent output using the existing Git snapshot and branch ports. */
export async function recoverAgentRebaseCompletion(
  port: RebaseWorkflowPort, slug: string, worktree: string, expectedBranch: string, implementer: string,
): Promise<{ implementer: string; repaired: boolean } | null> {
  const verify = () => {
    const state = port.detectRebaseState(worktree);
    const branch = port.getCurrentBranch(worktree);
    const diagnostic = [
      ...(state.inProgress ? ['Rebase is still in progress.'] : []),
      ...state.unmergedFiles.map(file => `Unmerged: ${file}`),
      ...(branch !== expectedBranch ? [`Expected checkout ${expectedBranch}, found ${branch || '(detached HEAD)'}.`] : []),
    ].join('\n');
    return { ok: !diagnostic, diagnostic };
  };
  const remaining = verify();
  if (remaining.ok) { return { implementer, repaired: false }; }
  const outcome = await rebound(
    { kind: 'artifact-incomplete', role: 'implementer', diagnostic: remaining.diagnostic },
    {
      slug, worktree, implementer, verify, log: fmt.log.plain, error: fmt.log.plain,
      inspectFailedRepair: true,
      repairPrompt: `complete the rebase, ensuring the checkout ends at ${expectedBranch}`,
      step: 'conflict-resolution',
      startAgent: port.startAgent,
      transitionToImplementer: typeof port.missionServices === 'function'
        ? bounceSlug => port.transitionTask(bounceSlug, 'active', { rootDir: worktree, log: fmt.log.plain })
        : undefined,
      applyAgentFallback: async ({ launchResult, original }) =>
        await port.applyAgentFallback({ role: 'implementer', original, launchResult, state: {}, slug,
          worktree, log: fmt.log.plain, writeReviewStateFn: port.writeReviewState }) as string || original,
    },
  );
  if (outcome.outcome === 'fixed') { return { implementer: outcome.implementer, repaired: true }; }
  fmt.log.fail(`Rebase completion recovery ${outcome.outcome}. Skipping automatic push.`);
  fmt.log.fail(verify().diagnostic || outcome.diagnostic);
  fmt.log.info(`Recovery: Resolve and stage remaining conflicts, then git rebase --continue; checkout ${expectedBranch} and inspect git status. To abandon the rebase, run git rebase --abort.`);
  port.exit(1);
  return null;
}
