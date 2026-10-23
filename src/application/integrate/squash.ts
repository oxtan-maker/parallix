import type { IntegrationMissionServices, IntegrationMissionServicesFactory } from '../ports/integration-records.js';
import type { IntegrationContext } from './context.js';
import type { ParallixConfiguration } from '../ports/configuration.js';
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
import { prepareBacklogPayload } from './backlog-payload.js';
import { completeLandedCloseout } from './landed-closeout.js';
import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

/** Run-scoped values the final `finally` block of `integrate()` still reads after a failure. */
export interface IntegrateRunState {
  temporaryStash: { created?: boolean, message?: string, rootDir?: string } | null;
  nextActionMessage: string | null;
}

export interface LandingRun {
  configuration?: ParallixConfiguration;
  slug: string;
  context: IntegrationContext;
  missionServices: IntegrationMissionServices;
  missionServicesFn?: IntegrationMissionServicesFactory;
  baseWorktree: string;
  baseBranch: string;
  seams: BounceSeams;
  state: IntegrateRunState;
}

interface SquashCollaborators {
  promoteTaskForIntegrationIfNeeded(_context: IntegrationContext, _options: { missionServicesFn?: IntegrationMissionServicesFactory }): Promise<unknown>;
}

function composeSquashLandingDependencies(ports: IntegrateWorkflowPorts, { promoteTaskForIntegrationIfNeeded }: SquashCollaborators) {

  const { backlog, checkout, landing, verification } = ports;

  const git = ports.git.git;
  return { ports, promoteTaskForIntegrationIfNeeded, backlog, checkout, landing, verification, git };
}

export function createSquashLanding(ports: IntegrateWorkflowPorts, collaborators: SquashCollaborators) {
  return new SquashLanding(ports, collaborators).surface();
}

class SquashLanding {
  private readonly dependencies: ReturnType<typeof composeSquashLandingDependencies>;
  constructor(ports: IntegrateWorkflowPorts, collaborators: SquashCollaborators) { this.dependencies = composeSquashLandingDependencies(ports, collaborators); }

  /** Sync, persist, record stats, clean up, and run the post-integrate hook for a landed commit. */
  async finishLanding(run: LandingRun, { branch, mergedCommit, stepLabel, variant }: { branch: string, mergedCommit: string, stepLabel: string, variant: string }) {
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
      throw abortWith(this.dependencies.landing, `Mission ${missionId(slug)} is ${status}; integration requires the integration lane. Aborting before any landing effect.`);
    }
    if (this.dependencies.ports.productConfig.isForgejoReviewEnabled(baseWorktree)) {
      fmt.log.debug(`${stepLabel}: Syncing merged state to Forgejo...`, run.configuration?.runtime.debug);
      const syncResult = this.dependencies.ports.forgejo.syncMerged(branch, mergedCommit, {
        rootDir: baseWorktree,
        forgejoUser: context.forgejoUser,
        token: context.forgejoToken,
        baseBranch: context.baseBranch,
      });
      if (!syncResult.ok) {
        this.dependencies.landing.reportSyncMergedFailure(syncResult);
        throw this.dependencies.landing.createAbort();
      }
    } else {
      fmt.log.debug(`${stepLabel}: Skipping Forgejo sync (review provider is not forgejo).`, run.configuration?.runtime.debug);
    }
    if (this.dependencies.ports.fileSystem.existsSync(baseWorktree)) {
      state.nextActionMessage = `Next: cd ${baseWorktree}`;
    }
    await completeLandedCloseout({
      slug, landedCommit: mergedCommit, missionServices, baseWorktree, baseBranch, variant, landing: this.dependencies.landing,
    });
  }

  /** `git merge --squash`, preserving trailing backlog noise across the merge. */
  squashMerge({ baseWorktree, configuration }: LandingRun, branch: string) {
    fmt.log.debug('Step 3: Squash-merging the mission branch...', configuration?.runtime.debug);
    let noisePatchState: ReturnType<typeof this.dependencies.checkout.prepareNoisePatchForSquash> | null = null;
    if (this.dependencies.ports.missionPaths.softResetTrailingBacklogNoise(baseWorktree, this.dependencies.git)) {
      noisePatchState = this.dependencies.checkout.prepareNoisePatchForSquash(baseWorktree, { gitRunner: this.dependencies.git });
      if (!noisePatchState.ok) {
        throw abortWith(this.dependencies.landing, 'Could not preserve trailing backlog noise before squash merge.', ...(noisePatchState.error ? [noisePatchState.error] : []));
      }
    }
    if (this.dependencies.git(['-C', baseWorktree, 'merge', '--squash', branch]).status !== 0) {
      noisePatchState?.cleanup?.();
      throw abortWith(this.dependencies.landing, 'Squash merge failed.');
    }
    if (noisePatchState?.patchPath) {
      const restoreNoiseResult = this.dependencies.checkout.restoreNoisePatchAfterSquash(baseWorktree, noisePatchState.patchPath, { gitRunner: this.dependencies.git });
      noisePatchState.cleanup?.();
      if (!restoreNoiseResult.ok) {
        throw abortWith(this.dependencies.landing, 'Could not restore trailing backlog noise after squash merge.', ...(restoreNoiseResult.error ? [restoreNoiseResult.error] : []));
      }
    }
  }

  /** Complete the Backlog task in the checkout and add its moved paths to the payload. */
  async stageCloseout(run: LandingRun, mainTaskFile: string, intendedPayloadPaths: Set<string>) {
    const { slug, context, baseWorktree } = run;
    fmt.log.debug('Step 4: Final closeout checks in the local integration checkout...', run.configuration?.runtime.debug);
    // Do not dirty the primary checkout before the probe merge and squash have
    // completed. The task file is commonly part of the mission branch, so an
    // early promotion can make `merge --abort` fail and leave index conflicts.
    await this.dependencies.promoteTaskForIntegrationIfNeeded(context, { missionServicesFn: run.missionServicesFn });
    if (!this.dependencies.ports.fileSystem.existsSync(mainTaskFile)) { return; }
    this.dependencies.backlog.completeTask(slug, baseWorktree);
    const originalTaskPath = path.relative(baseWorktree, mainTaskFile);
    intendedPayloadPaths.add(originalTaskPath);
    // Re-resolve because it moved. The completed copy is the canonical record
    // the stale-copy guards (task-2534) check every later landing against.
    const updatedResolution = this.dependencies.backlog.resolveTaskFile(slug, baseWorktree);
    if (!updatedResolution.ok) { return; }
    const completedTaskPath = path.relative(baseWorktree, updatedResolution.taskFile as string);
    intendedPayloadPaths.add(completedTaskPath);
    this.dependencies.checkout.rewriteWorktreePaths(updatedResolution.taskFile as string, slug, { rootDir: baseWorktree });
    if (this.dependencies.git(['-C', baseWorktree, 'add', '-A', '--', originalTaskPath, completedTaskPath]).status !== 0) {
      throw abortWith(this.dependencies.landing, 'Could not stage backlog closeout for the landed squash commit.');
    }
    // task-2537: the move above can leave the source path outside everything
    // git knows. A task file authored on the mission branch has no base-branch
    // entry, so once closeout moves it to `backlog/completed/` it is in neither
    // the index nor `HEAD` — and `git commit --only` fails-closed on such a
    // pathspec, aborting the whole landing over a path that carries no change.
    // Drop it from the payload instead. A path still in `HEAD` but gone from
    // the index is a staged deletion and stays: that is how a base-tracked task
    // file lands its removal.
    if (!this.isLivePathspec(baseWorktree, originalTaskPath)) {
      intendedPayloadPaths.delete(originalTaskPath);
      fmt.log.debug(`Closeout moved ${originalTaskPath} and the base branch never tracked it; it is in neither the index nor HEAD, so it carries no change to land.`, run.configuration?.runtime.debug);
    }
  }

  /** Whether `git commit --only` can name `pathspec`: an index entry, or a `HEAD` entry staged for deletion. */
  isLivePathspec(baseWorktree: string, pathspec: string): boolean {
    if (this.dependencies.git(['-C', baseWorktree, 'ls-files', '--error-unmatch', '-z', '--', pathspec]).status === 0) { return true; }
    return this.dependencies.git(['-C', baseWorktree, 'cat-file', '-e', `HEAD:${pathspec}`]).status === 0;
  }

  /** Paths whose staged tree entries differ from the gated mission-tip tree. */
  stagedPayloadTreeMismatches(baseWorktree: string, missionTip: string, paths: ReadonlySet<string>): string[] {
    const pathspecs = [...paths];
    if (pathspecs.length === 0) { return []; }
    const entries = (args: string[]) => new Map(
      this.dependencies.git(args).stdout.split('\0').filter(Boolean).map(line => {
        const [metadata, file] = line.split('\t');
        const fields = metadata.split(' ');
        const object = fields[1] === 'blob' ? fields[2] : fields[1];
        return [file, `${fields[0]} ${object}`] as const;
      }),
    );
    const staged = entries(['-C', baseWorktree, 'ls-files', '-s', '-z', '--', ...pathspecs]);
    const expected = entries(['-C', baseWorktree, 'ls-tree', '-r', '-z', missionTip, '--', ...pathspecs]);
    return pathspecs.filter(file => staged.get(file) !== expected.get(file));
  }

  /** Create the landed squash commit; a hook failure bounces through the rebound kernel. */
  async commitLandedSquash(run: LandingRun, commitArgs: string[], intendedPayloadPaths: Set<string>) {
    const { slug, context, baseWorktree, seams, missionServices } = run;
    fmt.log.debug('Step 5: Creating the landed squash commit in the local integration checkout...', run.configuration?.runtime.debug);
    const commitResult = this.dependencies.git(commitArgs);
    if (commitResult.status === 0) { return; }
    const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
    if (this.dependencies.ports.gates.isIntendedPayloadAtHead(baseWorktree, intendedPayloadPaths, { gitRunner: this.dependencies.git })) {
      fmt.log.pass(`Integration payload already landed in commit ${this.dependencies.git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim()}.`);
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
    const hookClassification = this.dependencies.landing.classifyHookFailure(output);
    if (!hookClassification.isHookFailure) {
      fmt.log.info(strandHint);
      fmt.log.info(`For this mission, the relevant verification command is ${this.dependencies.verification.formatVerificationCommand(context.area, baseWorktree)}`);
      throw this.dependencies.landing.createAbort();
    }
    // No resolver could name an implementer — strand rather than launch with
    // an empty agent identity.
    const implementer = resolveBounceImplementer(context.taskAssignee ?? null, baseWorktree, seams);
    if (!implementer) {
      fmt.log.info(strandHint);
      throw this.dependencies.landing.createAbort();
    }
    const outcome = await rebound(
      { kind: 'hook-failure', hook: hookClassification.hookType, operation: 'squash commit', output },
      {
        slug,
        worktree: baseWorktree,
        implementer,
        startAgent: seams.startAgentFn,
        readHead: () => {
          const result = this.dependencies.git(['-C', baseWorktree, 'rev-parse', 'HEAD']);
          return result.status === 0 ? result.stdout.trim() : null;
        },
        // This repair completes the pending integration commit; it does not
        // return the reviewed mission to implementation.
        transitionToImplementer: (bounceSlug: string) => seams.transitionTaskFn(bounceSlug, 'ready-for-integration'),
        applyAgentFallback: ({ launchResult, original }) => seams.applyAgentFallbackFn({
          launchResult,
          original,
          role: 'implementer',
          slug,
          worktree: baseWorktree,
          state: context.reviewState ?? {},
          taskResolution: context.task,
          missionStore: missionServices.store,
        }),
        verify: () => {
          const retryResult = this.dependencies.git(commitArgs);
          return { ok: retryResult.status === 0, diagnostic: [retryResult.stdout, retryResult.stderr].filter(Boolean).join('\n').trim() };
        },
      },
    );
    if (outcome.outcome !== 'fixed') {
      // exhausted / human-only — strand with the existing operator hint.
      fmt.log.info(strandHint);
      throw this.dependencies.landing.createAbort();
    }
    fmt.log.pass('Squash commit created after hook fix.');
  }

  async squashAndLand(run: LandingRun, { branch, summary, landedFromSha, mainTaskFile }: { branch: string, summary: string, landedFromSha: string, mainTaskFile: string }) {
    const { slug, baseWorktree, baseBranch } = run;
    // A rejected candidate has not crossed the commit boundary.  Reset only the
    // merge state back to HEAD: `--merge` removes the squash-owned index and
    // worktree entries while preserving unrelated local edits in the primary
    // checkout.  This makes a rejection retryable without discarding operator
    // work that was present before integration started.
    const abandonSquash = (payloadPaths: Iterable<string> = []): string | null => {
      const paths = [...payloadPaths];
      const preClean = paths.length > 0
        ? this.dependencies.git(['-C', baseWorktree, 'clean', '-q', '-f', '--', ...paths])
        : { status: 0, stdout: '', stderr: '' };
      const reset = preClean.status === 0
        ? this.dependencies.git(['-C', baseWorktree, 'reset', '-q', '--merge', 'HEAD'])
        : preClean;
      // A payload path deliberately removed from the index before rejection is
      // untracked by the time `--merge` runs.  Clean only the captured
      // integration payload paths; never use a broad clean that could erase
      // unrelated operator files.
      const clean = reset.status === 0 && paths.length > 0
        ? this.dependencies.git(['-C', baseWorktree, 'clean', '-q', '-f', '--', ...paths])
        : { status: 0, stdout: '', stderr: '' };
      if (reset.status === 0 && clean.status === 0) { return null; }
      const detail = [reset.stdout, reset.stderr, clean.stdout, clean.stderr].filter(Boolean).join('\n').trim();
      return `Could not clean up the rejected squash payload; inspect ${baseWorktree} before retrying integrate.${detail ? ` ${detail}` : ''}`;
    };
    const rejectSquash = (message: string, payloadPaths: Iterable<string> = [], ...details: string[]) => {
      const cleanupError = abandonSquash(payloadPaths);
      throw abortWith(this.dependencies.landing, message, ...details, ...(cleanupError ? [cleanupError] : []));
    };
    this.squashMerge(run, branch);

    // Capture the squash payload before closeout changes the checkout. The
    // final commit names this set, so a concurrent bare board commit never
    // inherits ambient index entries from an earlier `git add -A`.
    const capturePayloadPaths = () => new Set(
      // `-z` emits NUL-delimited RAW paths. Without it, git quotes and escapes
      // special filenames (backslash, non-ASCII) as `"...\342\200\224..."`; that
      // quoted form is not a valid `git commit --only` pathspec, so the landed
      // squash aborts with "pathspec did not match any git-known files" (task-2533).
      // Split on NUL so every captured path stays a literal pathspec. Do NOT
      // trim: filenames may legally start or end with whitespace, and trimming
      // would corrupt that pathspec (task-2533 codex review L206).
      this.dependencies.git(['-C', baseWorktree, 'diff', '--cached', '--name-only', '-z', '--no-renames', '--']).stdout
        .split('\0')
        .filter(Boolean),
    );
    let removedStalePaths: Set<string>;
    try { removedStalePaths = prepareBacklogPayload(this.dependencies.ports, baseWorktree, 'HEAD'); }
    catch (error) {
      rejectSquash(`Could not prepare backlog payload: ${(error as Error).message}`, capturePayloadPaths());
      return;
    }
    const intendedPayloadPaths = capturePayloadPaths();
    const treeMismatches = this.stagedPayloadTreeMismatches(baseWorktree, branch, new Set([...intendedPayloadPaths].filter(file => !removedStalePaths.has(file))));
    if (treeMismatches.length > 0) {
      rejectSquash(
        `Staged squash payload does not match gated mission tip ${branch}: ${treeMismatches.join(', ')}`,
        intendedPayloadPaths,
      );
    }
    await this.stageCloseout(run, mainTaskFile, intendedPayloadPaths);
    const guardHead = this.dependencies.git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();
    const tierGuardResult = this.dependencies.ports.gates.runStagedTierGuards?.(baseWorktree, intendedPayloadPaths) ?? { ok: true };
    if (!tierGuardResult.ok) {
      rejectSquash(`Staged squash fails fast tier guards before commit: ${tierGuardResult.error || 'test-categories, default-test-suite, or file-size-cap failed'}`, intendedPayloadPaths);
    }
    if (this.dependencies.git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim() !== guardHead
      || this.dependencies.git(['-C', baseWorktree, 'diff', '--quiet', '--', ...intendedPayloadPaths]).status !== 0
      || this.dependencies.git(['-C', baseWorktree, 'ls-files', '--others', '-z', '--', ...intendedPayloadPaths]).stdout.length > 0) {
      rejectSquash('Landing payload changed during final-tree guards; retry integration.', intendedPayloadPaths);
    }
    if (tierGuardResult.tree) { fmt.log.info(`Final landing tree guards passed: tree=${tierGuardResult.tree}`); }
    // Fail-closed backstop: nothing may land while the repository still holds a
    // `backlog/tasks/` copy of a completed or archived task (task-2534).
    const remainingDuplicates = this.dependencies.backlog.checkBacklogIntegrity(baseWorktree)
      .filter(issue => issue.type === 'duplicate-completed');
    if (remainingDuplicates.length > 0) {
      rejectSquash(
        `Stale backlog copies remain after closeout: ${remainingDuplicates.map(issue => issue.file).join(', ')}`,
        intendedPayloadPaths,
        `Remove them on ${baseBranch} (git rm) and retry integrate.`,
      );
    }
    // TASK-2595: the landed commit reads like the mission, not the machinery —
    // the subject is the recorded mission title (`summary`) and the body
    // records the mission task reference. Landed-squash detectors key on the
    // `Task: <slug>` body line (isLandedSquashMessage), so keep the two in
    // step when the message shape ever changes again.
    await this.commitLandedSquash(run, ['-C', baseWorktree, 'commit', '--only', '-m', summary, '-m', `Task: ${slug}`, '--', ...intendedPayloadPaths], intendedPayloadPaths);

    const mergedCommit = this.dependencies.git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();
    await this.finishLanding(run, { branch, mergedCommit, stepLabel: 'Step 6', variant: 'variant-b' });

    fmt.log.plain('');
    fmt.log.pass(`✓ integrated into ${baseBranch}`);
    fmt.log.plain(`  ${baseBranch}  ${landedFromSha} → ${mergedCommit}`);
  }

  surface() {
    return { squashAndLand: this.squashAndLand.bind(this), finishLanding: this.finishLanding.bind(this) };
  }
}
