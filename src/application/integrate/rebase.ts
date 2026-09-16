/**
 * Integration-time rebase: run the shared `px rebase` workflow against the
 * resolved ADR 0043 target, or predict (without mutating) whether a dry run
 * would need one and whether it would conflict.
 */
import * as fmt from '../presentation/cli-format.js';
import { runRebaseWorkflow } from '../rebase-workflow.js';
import { abortWith } from './support.js';
import type { IntegrateGitRunner, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export interface IntegrationRebaseTarget {
  baseWorktree: string;
  baseBranch: string;
  git: IntegrateGitRunner;
}

/** True when a rebase conflict prediction is unavailable (e.g. unrelated histories). */
export interface IntegrationRebasePrediction {
  needed: boolean;
  wouldConflict: boolean;
}

export function createIntegrationRebase({ missionPaths, rebase, landing }: IntegrateWorkflowPorts) {
  /**
   * Rebase the mission onto its resolved local primary/parent (ADR 0043) before
   * integration gates run and before the probe merge, so gates and the merge see
   * the actual merge base. Reuses the shared `px rebase` workflow so integration
   * never re-implements base-branch resolution, conflict classification, or the
   * agent-assisted conflict path.
   *
   * The shared workflow is a terminal command: it signals completion by calling
   * `port.exit()`. Integration must continue past a clean rebase, so this wraps
   * the call in a port whose exit only records the code instead of terminating
   * the process. A recorded exit of 1 means the workflow dead-ended (conflict
   * stranded, no implementer, bad root); it has already printed its recovery
   * diagnostics, so integration aborts without adding its own instructions.
   */
  async function runIntegrationRebase(
    slug: string,
    { baseWorktree, baseBranch, git, missionServicesFn }: IntegrationRebaseTarget & { missionServicesFn?: Function },
  ): Promise<void> {
    let rebaseExitCode: number | null = null;
    const port = rebase.createRebaseWorkflowPort({
      gitFn: git,
      // Pass the factory, not the resolved services object: `createRebaseWorkflowPort`
      // only installs the rebound hook-failure path when `missionServicesFn` is a
      // function, so the mission's agent-assisted conflict path survives here too.
      missionServicesFn,
      // Do not terminate the process: a clean rebase (exit 0) must let integrate
      // continue to the gates; only a dead-end (exit 1) aborts.
      exitFn: (code: number) => { rebaseExitCode = code; },
    });
    // Pin the root, current-branch, and target seams so the workflow rebases the
    // mission onto the exact ADR 0043 target integrate already resolved, instead
    // of re-resolving it against the ambient git state. This is the same
    // single-source pattern rebaseBeforeReviewRound uses for port.cwd: the
    // mission branch name is `mission/<slug>` and the primary branch is the
    // resolved target regardless of which worktree is passed.
    port.cwd = () => baseWorktree;
    port.getCurrentBranch = () => missionPaths.missionBranchName(slug, baseWorktree);
    port.resolveMissionBaseBranch = () => baseBranch;
    try {
      await runRebaseWorkflow([slug], port);
    } catch (error) {
      throw abortWith(landing, `Integration-time rebase aborted: ${(error as Error)?.message || String(error)}`);
    }
    // The workflow reports a completed rebase with exit 0 and dead-ends with any
    // non-zero code, but a clean-start round that pauses on conflicts exits 0
    // with the rebase still in progress. Treat anything other than 0 as a dead
    // end, then confirm the rebase actually finished: no `rebase --show-current`
    // and the resolved primary branch is an ancestor of the mission HEAD. Only
    // then announce the rebase and continue to the gates (F1 / task-2506).
    if (rebaseExitCode !== 0) {
      throw abortWith(landing, `Integration-time rebase dead-ended with exit code ${rebaseExitCode}.`);
    }
    const rebaseInProg = git(['-C', baseWorktree, 'rebase', '--show-current']).stdout.trim().length > 0;
    const missionSha = git(['-C', baseWorktree, 'rev-parse', missionPaths.missionBranchName(slug, baseWorktree)]).stdout.trim();
    const baseSha = git(['-C', baseWorktree, 'rev-parse', baseBranch]).stdout.trim();
    // Base ancestry: the resolved primary must be an ancestor of the mission HEAD
    // once the rebase completes. This is the same `--is-ancestor` idiom the
    // rebase workflow's own verifyBaseAncestry gates on, so a clean rebase that
    // never actually applied the primary fails here instead of at the probe merge.
    const ancestry = git(['-C', baseWorktree, 'merge-base', '--is-ancestor', baseSha, missionSha]);
    const ancestryOk = rebaseInProg === false && baseSha.length > 0 && ancestry.status === 0;
    if (!ancestryOk) {
      throw abortWith(landing, `Integration-time rebase did not complete cleanly (inProgress=${rebaseInProg}, target=${baseSha}).`);
    }
    fmt.log.info(`Rebased ${fmt.branch(missionPaths.missionBranchName(slug, baseWorktree))} onto the primary branch. Integration gates and the probe merge now run against the rebased branch.`);
  }

  /**
   * Non-mutating prediction of whether `px integrate --dry-run` would need a
   * rebase and whether that rebase would conflict. Resolves the same ADR 0043
   * target `px rebase` uses. Never touches the working tree or HEAD: it reads
   * trees and runs `git merge-tree`, whose only side effect is a transient tree
   * object, so the mission branch's HEAD is left unchanged.
   */
  function predictIntegrationRebase(slug: string, { baseWorktree, baseBranch, git }: IntegrationRebaseTarget): IntegrationRebasePrediction {
    // The caller resolves the ADR 0043 target once (context.baseBranch) so this
    // prediction reuses that same target instead of resolving it a second time.
    const target = baseBranch || 'main';
    const branch = missionPaths.missionBranchName(slug, baseWorktree);
    const missionSha = git(['-C', baseWorktree, 'rev-parse', branch]).stdout.trim();
    const baseSha = git(['-C', baseWorktree, 'rev-parse', target]).stdout.trim();
    const mergeBase = git(['-C', baseWorktree, 'merge-base', missionSha, baseSha]).stdout.trim();
    // Primary is already an ancestor of the mission branch: nothing to rebase.
    if (mergeBase === baseSha) { return { needed: false, wouldConflict: false }; }
    // Primary has advanced. Predict a rebase conflict with a virtual 3-way merge
    // (`git merge-tree --write-tree`), which reports conflicts through a
    // non-zero exit without rebasing. A 128 (unrelated histories / unsupported
    // git) leaves the conflict flag unset rather than guessing.
    const result = git(['-C', baseWorktree, 'merge-tree', '--write-tree', target, branch]);
    if (result.status === 128) { return { needed: true, wouldConflict: false }; }
    return { needed: true, wouldConflict: result.status !== 0 };
  }

  return { runIntegrationRebase, predictIntegrationRebase };
}
