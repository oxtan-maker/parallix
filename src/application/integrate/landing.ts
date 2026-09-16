/**
 * Local (Variant B) landing: stash the integration checkout, probe-merge the
 * mission branch, recover backlog-only drift or a previously landed squash,
 * and hand a clean probe to the squash step.
 */
import * as fmt from '../presentation/cli-format.js';
import { abortWith, resolveIntegrationTaskPath } from './support.js';
import { createSquashLanding, type LandingRun } from './squash.js';
import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export function createMissionLanding(ports: IntegrateWorkflowPorts, collaborators: Parameters<typeof createSquashLanding>[1]) {
  const { checkout, landing, missionPaths } = ports;
  const git = ports.git.git;
  const { squashAndLand, finishLanding } = createSquashLanding(ports, collaborators);

  /**
   * Fetch and advance the local base branch, then retry the probe merge.
   * Either refresh failure aborts: retrying against an unrefreshed base would
   * violate the requirement to retry against the updated base.
   */
  function retryProbeAfterBaseRefresh(run: LandingRun, branch: string, abortFailed: boolean) {
    const { baseWorktree, baseBranch } = run;
    // Safe cleanup: if abort failed, use reset --hard to clear stale merge state.
    // After a successful reset the fallback after retry uses the normal
    // conflict-resolution flow, not the generic abort-failure path.
    if (abortFailed) {
      if (git(['-C', baseWorktree, 'reset', '--hard', 'HEAD']).status !== 0) {
        throw abortWith(landing, '[RETRY] Could not clean up after backlog-only conflict merge.');
      }
    }
    if (git(['-C', baseWorktree, 'fetch', '--all', '--prune']).status !== 0) {
      throw abortWith(landing, '[RETRY] Could not fetch remote refs — aborting integration.');
    }
    if (git(['-C', baseWorktree, 'pull', '--ff-only']).status !== 0) {
      throw abortWith(landing, `[RETRY] Could not fast-forward ${baseBranch} — aborting integration.`);
    }
    fmt.log.info(`Base branch ${baseBranch} refreshed via fast-forward.`);

    const retryMerge = git(['-C', baseWorktree, 'merge', '--no-commit', '--no-ff', branch]);
    const retryAbort = git(['-C', baseWorktree, 'merge', '--abort']);
    if (retryAbort.status !== 0 && !landing.isNoMergeToAbortResult(retryAbort)) {
      fmt.log.fail('[RETRY] Dry-run merge retry could not be aborted cleanly.');
      return { abortFailed: true, clean: false };
    }
    if (retryMerge.status === 0) {
      fmt.log.pass('Probe merge retry succeeded — proceeding to squash-merge.');
      return { abortFailed: false, clean: true };
    }
    return { abortFailed: false, clean: false };
  }

  function reportMergeConflicts(run: LandingRun, conflictFiles: string[]): never {
    const { slug, context } = run;
    fmt.log.fail('Merge conflicts detected. Rebase the mission branch before integrating.');
    if (conflictFiles.length > 0) {
      fmt.log.info(`Conflicting files (${conflictFiles.length}):`);
      conflictFiles.forEach(file => fmt.log.info(`  - ${file}`));
    }
    fmt.log.info('Conflict helper path:');
    ports.agents.describeReviewMatrix().forEach(line => fmt.log.info(line));
    checkout.buildConflictResolutionPrompt(slug, context.area, { baseBranch: context.baseBranch || '' }).forEach(line => fmt.log.info(line));
    throw landing.createAbort();
  }

  /** Resume from the sync-merged step when an earlier run already landed the squash commit. */
  async function resumeLandedSquash(run: LandingRun, branch: string, existingSquash: string, landedFromSha: string) {
    const { baseBranch } = run;
    fmt.log.warn(`Squash commit already exists on local ${baseBranch} from a previous partial integration (${existingSquash.slice(0, 12)}). Resuming from sync-merged step.`);
    await finishLanding(run, { branch, mergedCommit: existingSquash, stepLabel: 'Step 6 (resume)', variant: 'variant-b-resumed' });
    fmt.log.plain('');
    fmt.log.pass(`✓ integrated into ${baseBranch} (resumed from partial state)`);
    fmt.log.plain(`  ${baseBranch}  ${landedFromSha} → ${existingSquash}`);
  }

  /**
   * Probe-merge the mission branch. Returns true when the squash step should
   * run; false when an earlier landing was resumed instead. Conflicts abort.
   */
  async function probeMerge(run: LandingRun, branch: string, landedFromSha: string): Promise<boolean> {
    const { slug, baseWorktree } = run;
    fmt.log.debug(`Step 2: Checking merge conflicts against local ${run.baseBranch} in the base worktree...`);
    const dryMerge = git(['-C', baseWorktree, 'merge', '--no-commit', '--no-ff', branch]);
    const abortResult = git(['-C', baseWorktree, 'merge', '--abort']);
    // When the probe was clean, a failed abort may leave the base in a dirty merge state.
    let abortFailed = abortResult.status !== 0 && !landing.isNoMergeToAbortResult(abortResult);
    if (dryMerge.status === 0) {
      if (abortFailed) {
        throw abortWith(landing, 'Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.');
      }
      return true;
    }

    // Classify conflicts BEFORE deciding on abort failure, so backlog-only
    // classification can rescue an unabortable merge.
    const conflictOutput = [dryMerge.stdout, dryMerge.stderr].filter(Boolean).join('\n');
    const conflictFiles = missionPaths.parseConflictFilesFromMergeOutput(conflictOutput);
    if (checkout.areAllBacklogOnlyConflicts(conflictFiles) && conflictFiles.length > 0) {
      fmt.log.info('Backlog-only conflicts detected — refreshing base branch and retrying probe merge...');
      const retry = retryProbeAfterBaseRefresh(run, branch, abortFailed);
      if (retry.clean) { return true; }
      abortFailed = retry.abortFailed;
    }
    if (abortFailed) {
      throw abortWith(landing, 'Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.');
    }
    const existingSquash = checkout.findExistingSquashCommit(baseWorktree, slug);
    if (!existingSquash) { reportMergeConflicts(run, conflictFiles); }
    await resumeLandedSquash(run, branch, existingSquash, landedFromSha);
    return false;
  }

  async function publishMission(run: LandingRun) {
    const { slug, context, baseWorktree, baseBranch, state } = run;
    state.temporaryStash = checkout.stashMainCheckoutIfNeeded({ slug, dirtyEntries: context.mainDirtyEntries, rootDir: baseWorktree });

    // End-context check: if we are in the worktree that is about to be deleted,
    // move the Node process to the base worktree to avoid being left in a ghost directory.
    const missionWorktree = missionPaths.conventionalWorktreePath(slug);
    if (process.cwd() === missionWorktree || process.cwd().startsWith(missionWorktree + '/')) {
      fmt.log.info(`Moving process directory to ${baseWorktree} before mission worktree deletion.`);
      process.chdir(baseWorktree);
    }

    const branch = missionPaths.missionBranchName(slug, baseWorktree);
    // TASK-2479: capture the pre-integration base-branch tip so the landing
    // result can show the `<before> → <after>` SHA transition.
    const landedFromSha = git(['-C', baseWorktree, 'rev-parse', baseBranch]).stdout.trim();
    const summary = (missionPaths.missionTitle(slug) || slug).replace(/\s+/g, ' ').trim();
    // A DB-owned adhoc identity has no Backlog task file; the closeout is
    // best-effort and guards every task-file access, so mainTaskFile stays empty.
    const mainTaskFile = resolveIntegrationTaskPath(context.task?.taskFile, context.missionWorktree, baseWorktree);
    if (mainTaskFile === null) {
      throw abortWith(landing, baseWorktree
        ? 'Mission task file is outside the integration checkout; refusing to stage an unsafe closeout path.'
        : 'Integration base worktree is unavailable; refusing to stage backlog closeout.');
    }
    fmt.log.debug(`Selecting integration variant: Variant B (local squash-merge)`);
    fmt.log.debug(`\nStep 1: Using base worktree ${baseWorktree} on ${baseBranch} as the squash-merge target...`);

    if (await probeMerge(run, branch, landedFromSha)) {
      await squashAndLand(run, { branch, summary, landedFromSha, mainTaskFile });
    }
  }

  return { publishMission };
}
