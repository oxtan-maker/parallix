/**
 * The squash step of a local landing: squash-merge with trailing backlog noise
 * preserved, stage the Backlog closeout, create the landed commit (bouncing a
 * hook failure through the rebound kernel), then sync, persist, clean up, and
 * prove the published tree.
 */
import path from 'node:path';
import * as fmt from '../presentation/cli-format.js';
import { rebound } from '../rebound-kernel.js';
import { abortWith, resolveBounceImplementer, type BounceSeams } from './support.js';
import { missionId } from '../../domain/mission.js';
import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

/** Run-scoped values the final `finally` block of `integrate()` still reads after a failure. */
export interface IntegrateRunState {
  temporaryStash: { created?: boolean, message?: string, rootDir?: string } | null;
  nextActionMessage: string | null;
}

export interface LandingRun {
  slug: string;
  context: any;
  missionServices: any;
  missionServicesFn?: Function;
  baseWorktree: string;
  baseBranch: string;
  seams: BounceSeams;
  state: IntegrateRunState;
}

interface SquashCollaborators {
  promoteTaskForIntegrationIfNeeded(_context: any, _options: { missionServicesFn?: Function }): Promise<unknown>;
}

export function createSquashLanding(ports: IntegrateWorkflowPorts, { promoteTaskForIntegrationIfNeeded }: SquashCollaborators) {
  const { backlog, checkout, landing, verification } = ports;
  const git = ports.git.git;

  /** Sync, persist, record stats, clean up, and run the post-integrate hook for a landed commit. */
  async function finishLanding(run: LandingRun, { branch, mergedCommit, stepLabel, variant }: { branch: string, mergedCommit: string, stepLabel: string, variant: string }) {
    const { slug, context, missionServices, baseWorktree, baseBranch, state } = run;
    // SC2 (task-2517): prove the Mission can accept the `integrate` decision
    // before any remote effect. `decideMission('integrate')` requires
    // `requireStatus(mission, ['integration'])`, so only `integration` and
    // `done` may reach the Forgejo sync-merge. The workflow restores an
    // approved `review` lane to `integration` before landing (SC1), so
    // admitting `review` here would be dead permissiveness — the decision runs
    // after the sync-merge and then rejects, stranding the shipped change SC2
    // exists to prevent. This is the landing-boundary defense; the closeout
    // decision (persist) still runs after the sync, so decideIntegration only
    // asserts merged:true once the provider sync actually succeeds.
    const lane = await missionServices.store.load(missionId(slug));
    if (
      lane.kind !== 'found'
      || (lane.mission.status !== 'integration'
        && lane.mission.status !== 'done')
    ) {
      const status = lane.kind === 'found' ? lane.mission.status : lane.kind;
      throw abortWith(landing, `Mission ${missionId(slug)} is ${status}; integration requires the integration lane. Aborting before any landing effect.`);
    }
    if (ports.productConfig.isForgejoReviewEnabled(baseWorktree)) {
      fmt.log.debug(`${stepLabel}: Syncing merged state to Forgejo...`);
      const syncResult = ports.forgejo.syncMerged(branch, mergedCommit, {
        rootDir: baseWorktree,
        forgejoUser: context.forgejoUser,
        token: context.forgejoToken,
        baseBranch: context.baseBranch,
      });
      if (!syncResult.ok) {
        landing.reportSyncMergedFailure(syncResult);
        throw landing.createAbort();
      }
    } else {
      fmt.log.debug(`${stepLabel}: Skipping Forgejo sync (review provider is not forgejo).`);
    }
    if (ports.fileSystem.existsSync(baseWorktree)) {
      state.nextActionMessage = `Next: cd ${baseWorktree}`;
    }
    await landing.persistLandedIntegrationOrAbort(slug, mergedCommit, missionServices, { rootDir: baseWorktree });
    await landing.recordPostIntegrationStatsOrAbort(slug, { rootDir: baseWorktree, missionStore: missionServices.store });
    if (!landing.cleanupMissionWorktree(slug)) {
      throw abortWith(landing, 'Mission worktree cleanup failed.');
    }
    fmt.log.pass('Mission worktree cleaned up.');
    checkout.maybeUpdateGraphifyOnPrimary(baseWorktree, { log: fmt.log.debug });
    landing.runPostIntegrateHookOrAbort(slug, { baseWorktree, baseBranch, variant });
  }

  /** `git merge --squash`, preserving trailing backlog noise across the merge. */
  function squashMerge({ baseWorktree }: LandingRun, branch: string) {
    fmt.log.debug('Step 3: Squash-merging the mission branch...');
    let noisePatchState: ReturnType<typeof checkout.prepareNoisePatchForSquash> | null = null;
    if (ports.missionPaths.softResetTrailingBacklogNoise(baseWorktree, git)) {
      noisePatchState = checkout.prepareNoisePatchForSquash(baseWorktree, { gitRunner: git });
      if (!noisePatchState.ok) {
        throw abortWith(landing, 'Could not preserve trailing backlog noise before squash merge.', ...(noisePatchState.error ? [noisePatchState.error] : []));
      }
    }
    if (git(['-C', baseWorktree, 'merge', '--squash', branch]).status !== 0) {
      noisePatchState?.cleanup?.();
      throw abortWith(landing, 'Squash merge failed.');
    }
    if (noisePatchState?.patchPath) {
      const restoreNoiseResult = checkout.restoreNoisePatchAfterSquash(baseWorktree, noisePatchState.patchPath, { gitRunner: git });
      noisePatchState.cleanup?.();
      if (!restoreNoiseResult.ok) {
        throw abortWith(landing, 'Could not restore trailing backlog noise after squash merge.', ...(restoreNoiseResult.error ? [restoreNoiseResult.error] : []));
      }
    }
  }

  /** Complete the Backlog task in the checkout and add its moved paths to the payload. */
  async function stageCloseout(run: LandingRun, mainTaskFile: string, intendedPayloadPaths: Set<string>) {
    const { slug, context, baseWorktree } = run;
    fmt.log.debug('Step 4: Final closeout checks in the local integration checkout...');
    // Do not dirty the primary checkout before the probe merge and squash have
    // completed. The task file is commonly part of the mission branch, so an
    // early promotion can make `merge --abort` fail and leave index conflicts.
    await promoteTaskForIntegrationIfNeeded(context, { missionServicesFn: run.missionServicesFn });
    if (!ports.fileSystem.existsSync(mainTaskFile)) { return; }
    backlog.completeTask(slug, baseWorktree);
    const originalTaskPath = path.relative(baseWorktree, mainTaskFile);
    intendedPayloadPaths.add(originalTaskPath);
    // Re-resolve because it moved
    const updatedResolution = backlog.resolveTaskFile(slug, baseWorktree);
    if (!updatedResolution.ok) { return; }
    const completedTaskPath = path.relative(baseWorktree, updatedResolution.taskFile as string);
    intendedPayloadPaths.add(completedTaskPath);
    checkout.rewriteWorktreePaths(updatedResolution.taskFile as string, slug, { rootDir: baseWorktree });
    if (git(['-C', baseWorktree, 'add', '-A', '--', originalTaskPath, completedTaskPath]).status !== 0) {
      throw abortWith(landing, 'Could not stage backlog closeout for the landed squash commit.');
    }
  }

  /** Create the landed squash commit; a hook failure bounces through the rebound kernel. */
  async function commitLandedSquash(run: LandingRun, commitArgs: string[], intendedPayloadPaths: Set<string>) {
    const { slug, context, baseWorktree, seams } = run;
    fmt.log.debug('Step 5: Creating the landed squash commit in the local integration checkout...');
    const commitResult = git(commitArgs);
    if (commitResult.status === 0) { return; }
    const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
    if (ports.gates.isIntendedPayloadAtHead(baseWorktree, intendedPayloadPaths, { gitRunner: git })) {
      fmt.log.pass(`Integration payload already landed in commit ${git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim()}.`);
      return;
    }
    fmt.log.fail('Could not create the squash commit in the local integration checkout.');
    if (output) { fmt.log.fail(output); }

    const strandHint = `The squash commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`;
    // SC2: Classify the squash-commit failure and bounce it through the one
    // rebound kernel. The kernel's verify re-runs the identical
    // `git commit --only` invocation, so `fixed` means the hook passes on
    // re-run — never merely that an agent ran. The kernel owns the
    // per-occurrence budget (2 attempts) in memory; nothing is persisted.
    const hookClassification = landing.classifyHookFailure(output);
    if (!hookClassification.isHookFailure) {
      fmt.log.info(strandHint);
      fmt.log.info(`For this mission, the relevant verification command is ${verification.formatVerificationCommand(context.area, baseWorktree)}`);
      throw landing.createAbort();
    }
    // No resolver could name an implementer — strand rather than launch with
    // an empty agent identity.
    const implementer = resolveBounceImplementer(context.taskAssignee ?? null, baseWorktree, seams);
    if (!implementer) {
      fmt.log.info(strandHint);
      throw landing.createAbort();
    }
    const outcome = await rebound(
      { kind: 'hook-failure', hook: hookClassification.hookType, operation: 'squash commit', output },
      {
        slug,
        worktree: baseWorktree,
        implementer,
        startAgent: seams.startAgentFn,
        transitionToImplementer: (bounceSlug: string) => seams.transitionTaskFn(bounceSlug, 'active'),
        applyAgentFallback: seams.applyAgentFallbackFn,
        verify: () => {
          const retryResult = git(commitArgs);
          return { ok: retryResult.status === 0, diagnostic: [retryResult.stdout, retryResult.stderr].filter(Boolean).join('\n').trim() };
        },
      },
    );
    if (outcome.outcome !== 'fixed') {
      // exhausted / human-only — strand with the existing operator hint.
      fmt.log.info(strandHint);
      throw landing.createAbort();
    }
    fmt.log.pass('Squash commit created after hook fix.');
  }

  async function squashAndLand(run: LandingRun, { branch, summary, landedFromSha, mainTaskFile }: { branch: string, summary: string, landedFromSha: string, mainTaskFile: string }) {
    const { context, baseWorktree, baseBranch } = run;
    squashMerge(run, branch);

    // Capture the squash payload before closeout changes the checkout. The
    // final commit names this set, so a concurrent bare board commit never
    // inherits ambient index entries from an earlier `git add -A`.
    const intendedPayloadPaths = new Set(
      git(['-C', baseWorktree, 'diff', '--cached', '--name-only', '--']).stdout
        .split('\n')
        .map(file => file.trim())
        .filter(Boolean),
    );
    await stageCloseout(run, mainTaskFile, intendedPayloadPaths);
    await commitLandedSquash(run, ['-C', baseWorktree, 'commit', '--only', '-m', `${branch}: ${summary}`, '--', ...intendedPayloadPaths], intendedPayloadPaths);

    const mergedCommit = git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();
    await finishLanding(run, { branch, mergedCommit, stepLabel: 'Step 6', variant: 'variant-b' });

    // Proof capture after post-integrate hook so it represents the
    // freshly rebuilt tree that will actually be published.
    const proofResult = verification.captureVerifiedTreeProof(context.area, baseWorktree, git);
    if (!proofResult.ok) {
      throw abortWith(landing, `Could not verify the exact tree being published: ${proofResult.error}`);
    }
    const proofCheck = verification.assertVerifiedTreeProof(proofResult.proof, baseWorktree, git);
    if (!proofCheck.ok) {
      throw abortWith(landing, `Verification proof is stale for the publish tree: ${proofCheck.error}`);
    }

    fmt.log.plain('');
    fmt.log.pass(`✓ integrated into ${baseBranch}`);
    fmt.log.plain(`  ${baseBranch}  ${landedFromSha} → ${mergedCommit}`);
  }

  return { squashAndLand, finishLanding };
}
