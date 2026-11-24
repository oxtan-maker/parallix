import { retainedApprovalFeedbackAllowsLanding } from './integrate/approval-retention.js';
import { resumeOrPreviewPendingIntegrationRepair } from './integrate/repair-resumption.js';
import { runIntegrateEntry, runReviewStepTestsEntry } from './integrate-entry.js';
import { reviewBeforeIntegration } from './integrate/review-before-integration.js';
import type { MissionLoadResult } from './domain-ports.js';
import type { IntegrationMissionServices, IntegrationMissionServicesFactory } from './ports/integration-records.js';
import type { IntegrationContext } from './integrate/context.js';
import { withBaseMutation } from './integrate/base-mutation.js';
import { prepareBacklogPayload } from './integrate/backlog-payload.js';
import type { ParallixConfiguration } from "./ports/configuration.js";
import type { VerificationActionPolicyFactory } from './ports/verification-policy.js';
import type { MissionExecutionContext } from './ports/mission-execution-context.js';
import { liveMissionExecutionContext } from './ports/mission-execution-context.js';
/**
 * Integrate workflow use case — the `px integrate` sequence (TASK-2512).
 *
 * This module owns the order of the run: argument parsing, the authoritative
 * Mission load, lifecycle recovery, preflight, the integration-time rebase,
 * recorded tests, readiness, and landing dispatch. Each step lives in its own module under `./integrate/`.
 *
 * Every concrete mechanism is reached through `IntegrateWorkflowPorts`
 * (`./ports/integrate-workflow.js`), which the CLI adapter binds; no adapter
 * module is imported here (ADR 0037, ADR 0051).
 */
import * as fmt from './presentation/cli-format.js';
import { createIntegrationStrategy } from './services/integration-dispatch.js';
import { backlogMirrorOwnership, missionId } from '../domain/mission.js';
import { integrationRepairNeedsReview } from './integration-repair-review.js';
import { admitIntegrationApproval, evaluateTaskStatusForIntegration, previewIntegrationShortcut, recoveryEstablishesApproval, resolveAuthoritativeApprovalAt } from './integrate/approval.js';
import { createIntegrationContextBuilder } from './integrate/context.js';
import { createIntegrationGateStep, type IntegrateSeams } from './integrate/gates.js';
import { createGithubPrLanding } from './integrate/github-pr.js';
import { createMissionLanding } from './integrate/landing.js';
import { createIntegrationPreflight } from './integrate/preflight.js';
import { buildIntegrationReadiness, printIntegrationReadiness } from './integrate/readiness.js';
import { createIntegrationRebase } from './integrate/rebase.js';
import { assertRecoveredIntegrationHandoff, createMissionRecovery, retainsCloseoutBacklogPromotion } from './integrate/recovery.js';
import { recoverLandedIntegration } from './integrate/landed-recovery.js';
import type { IntegrateRunState } from './integrate/squash.js';
import {
  VARIANT_B_AUTOMATION_SUMMARY,
  abortWith,
  parseIntegrateArgs,
  resolveBounceImplementer,
  resolveIntegrationTaskPath,
  type IntegrateRequest,
} from './integrate/support.js';
import type { IntegrateWorkflowPorts } from './ports/integrate-workflow.js';
import { fixedVerificationNextAction } from './verification-policy/fixed-next-action.js';
import { createTestsActionExecutor, requireCurrentIntegrationTests, runPolicyTestsAction, type PolicyTestsActionOptions } from './integrate/tests-action.js';

/** The injection seams `px integrate` callers and the characterization suites bind. */
export interface IntegrateOptions extends Partial<IntegrateSeams> {
  configuration?: ParallixConfiguration;
  /** Composed only with operator-state authority; off mode returns no observer. */
  verificationActionPolicy?: VerificationActionPolicyFactory;
  /** Direct CLI entry is an operator action; lead, board and recovery are not. */
  operatorInvocation?: boolean;
  missionServicesFn?: IntegrationMissionServicesFactory;
  /** Board composition receives the terminal status without terminating the UI process. */
  exitFn?: (_code: number, _reason?: string | null) => void;
  /** The outer `px integrate` publication nested repair and review report into (TASK-2620). */
  nestedWork?: unknown;
  /**
   * Any checkout of the Mission's repository an admitting composition (the board
   * host) locates it from; defaults to the process working directory. It only
   * finds the repository: the entry resolves the Mission and receiving-base
   * checkouts itself, after it holds the integration claim.
   */
  executionRoot?: string;
}

/** A run always carries the resolved checkouts its nested steps depend on. */
export type ResolvedIntegrateOptions = IntegrateOptions & { executionContext: MissionExecutionContext };
function composeIntegrateWorkflowDependencies(ports: IntegrateWorkflowPorts) {
  const { landing, missionPaths } = ports;

  const { buildIntegrationContext } = createIntegrationContextBuilder(ports);

  const { recoverMissionForIntegration, promoteTaskForIntegrationIfNeeded } = createMissionRecovery(ports);

  const { runIntegrationRebase, predictIntegrationRebase, recordIntegrationRebaseInapplicable } = createIntegrationRebase(ports);

  const { printIntegrationPreflight } = createIntegrationPreflight(ports);

  // Only the policy tests action starts gates; integrate itself reads their recorded result.
  const { runRequiredLocalGates } = createIntegrationGateStep(ports);
  const { landThroughGithubPr } = createGithubPrLanding(ports);

  const { publishMission } = createMissionLanding(ports, { promoteTaskForIntegrationIfNeeded });
  return { ports, landing, missionPaths, buildIntegrationContext, recoverMissionForIntegration, promoteTaskForIntegrationIfNeeded,
    runIntegrationRebase, predictIntegrationRebase, recordIntegrationRebaseInapplicable,
    printIntegrationPreflight, runRequiredLocalGates, landThroughGithubPr, publishMission };
}

export function createIntegrateWorkflow(ports: IntegrateWorkflowPorts) {
  return new IntegrateWorkflow(ports).surface();
}

class IntegrateWorkflow {
  private readonly dependencies: ReturnType<typeof composeIntegrateWorkflowDependencies>;
  constructor(ports: IntegrateWorkflowPorts) { this.dependencies = composeIntegrateWorkflowDependencies(ports); }

  // TASK-2517 CP-3: a mission whose squash already landed on the base branch but
  // whose aggregate is stranded in `active`/`review` has no remote effect left to
  // perform. Recover the lane through the same authoritative recovery that owns
  // the timestamps (never assign Mission.status), close it to `done`, and remove
  // the worktree and local branch. Every effect reuses a tested integration
  // port, so the closeout performs zero new remote side effects.
  /** @param {string} slug @param {any} missionServices @param {MissionExecutionContext} execution */
  async recoverLandedCloseout(slug: string, missionServices: IntegrationMissionServices, execution: MissionExecutionContext): Promise<0> {
    // The landing already happened on the resolved receiving base; the closeout
    // runs there and never re-derives the base from a working directory.
    const baseBranch = execution.baseBranch;
    const baseWorktree = execution.baseWorktree;
    const missionWorktree = this.dependencies.missionPaths.conventionalWorktreePath(slug);
    if (this.dependencies.ports.process.cwd() === missionWorktree || this.dependencies.ports.process.cwd().startsWith(missionWorktree + '/')) {
      this.dependencies.ports.process.chdir(baseWorktree);
    }
    await recoverLandedIntegration(
      slug,
      missionServices,
      baseWorktree,
      {
        findSquashCommit: this.dependencies.ports.checkout.findLandedSquashOnBaseBranch,
        recoverMissionForIntegration: this.dependencies.recoverMissionForIntegration,
        persistLandedIntegrationOrAbort: this.dependencies.ports.landing.persistLandedIntegrationOrAbort,
        recordPostIntegrationStatsOrAbort: this.dependencies.ports.landing.recordPostIntegrationStatsOrAbort,
        closeLandedIntegrationOrAbort: this.dependencies.ports.landing.closeLandedIntegrationOrAbort,
        cleanupMissionWorktree: this.dependencies.ports.landing.cleanupMissionWorktree,
        runPostIntegrateHookOrAbort: this.dependencies.ports.landing.runPostIntegrateHookOrAbort,
        updateGraphifyRepository: this.dependencies.ports.landing.updateGraphifyRepository,
        createAbort: this.dependencies.landing.createAbort,
        baseBranch,
        hasIntegrationMeasurement: this.dependencies.landing.hasIntegrationMeasurement,
        hasCleanupArtifacts: (mission: string) => {
          const branch = this.dependencies.missionPaths.missionBranchName(mission, baseWorktree);
          return this.dependencies.ports.fileSystem.existsSync(this.dependencies.missionPaths.conventionalWorktreePath(mission))
            || this.dependencies.ports.git.git(['-C', baseWorktree, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
        },
        // The closeout itself tolerates a removed checkout; only the lane restore needs
        // the live one, so it receives the validated resolution rather than a guess.
        liveExecutionContext: liveMissionExecutionContext(slug, { ok: true, context: execution }),
      },
    );
    return 0;
  }

  /**
   * Read the authoritative Mission (SQLite) and fold its lifecycle facts into
   * the context. Database unavailability fails the operation (fail-closed).
   */
  async loadMissionAuthority(slug: string, context: IntegrationContext, missionServices: IntegrationMissionServices) {
    const missionLoad = await missionServices.store.load(missionId(slug));
    if (missionLoad.kind === 'unavailable') {
      throw abortWith(this.dependencies.landing, `Mission store unavailable: ${missionLoad.reason}. Integration cannot proceed on legacy files.`);
    }
    if (missionLoad.kind === 'missing') {
      throw abortWith(this.dependencies.landing, `Mission ${missionId(slug)} not found in SQLite. Materialize through the intake boundary before integration.`);
    }
    if (missionLoad.kind === 'found') {
      context.mirrorOwnership = backlogMirrorOwnership(missionLoad.mission);
      context.missionStatus = missionLoad.mission.status;
      context.missionBrief = missionLoad.mission.brief ?? null;
      context.missionLabels = missionLoad.mission.labels;
      context.recordedContract = Boolean(missionLoad.mission.brief);
      context.missionReview = missionLoad.mission.review;
      context.missionVersion = missionLoad.version;
      // Use the Mission store review as approval source when Forgejo is unavailable.
      if (context.approval.ok !== true && missionLoad.mission.review) {
        const rounds = missionLoad.mission.review.rounds;
        if (rounds[rounds.length - 1]?.decision?.kind === 'approved') {
          // `providerDisabled` records that no review provider is configured
          // at all (review.provider !== 'forgejo'), as opposed to a
          // configured provider that could not be reached. Recovery may only
          // treat the stored decision as the sole approval authority in the
          // former case (see recoverMissionForIntegration).
          const providerDisabled = context.approval.error === 'forgejo-off';
          context.approval = { ok: true, reviewState: 'APPROVED', source: 'mission-store', providerDisabled };
        }
      }
    }
    return missionLoad;
  }

  /** Fail closed when the revision an approval names cannot be inspected. */
  requireReadableApprovedRevision(context: IntegrationContext, missionLoad: MissionLoadResult) {
    const round = missionLoad?.kind === 'found' ? missionLoad.mission.review?.rounds.at(-1) : null;
    const revision = round?.decision?.kind === 'approved' ? round.decision.revision : null;
    if (!revision) { return; }
    const readable = this.dependencies.ports.git.git(['-C', context.baseWorktree, 'cat-file', '-e', `${revision}^{commit}`]);
    if (readable.status === 0) { return; }
    throw abortWith(this.dependencies.landing,
      `Approved revision ${revision} cannot be read; integration cannot prove approval coverage for the landing payload.`,
      `Fetch or restore revision ${revision}, then run px review ${context.slug} to establish review for the current branch before retrying integrate.`);
  }

  /**
   * Rebase the mission onto its resolved local primary/parent (ADR 0043)
   * before recorded-tests admission and the probe merge, so both evaluate the
   * candidate on its actual merge base (task-2506). A dry run only reports the
   * need / conflict and never touches the branch.
   */
  async rebaseForIntegration(slug: string, context: IntegrationContext, dryRun: boolean, missionServicesFn?: IntegrationMissionServicesFactory) {
    const { baseWorktree, baseBranch } = context;
    const git = this.dependencies.ports.git.git;
    if (!dryRun) {
      // SC5 / AC6: if a previous partial integration already landed the mission
      // squash onto the local base, rebasing the full mission history onto that
      // base conflicts and never reaches the resume path (the 2026-09-15
      // dead-end). Detect the landed squash here, before the rebase, and skip it
      // so the publish step resumes the landing closeout instead of replaying
      // mission history.
      const existingSquash = this.dependencies.ports.checkout.findLandedSquashOnBaseBranch(baseWorktree, slug);
      if (existingSquash) {
        fmt.log.info(`Landed squash ${existingSquash.slice(0, 12)} already on ${baseBranch}; skipping rebase and resuming landing closeout.`);
        await this.dependencies.recordIntegrationRebaseInapplicable(slug,
          { baseWorktree, baseBranch, git, executionContext: {
            missionId: slug, missionWorktree: context.missionWorktree, missionBranch: context.branch, baseWorktree, baseBranch,
          } }, 'landing-already-present');
        return;
      }
      await this.dependencies.runIntegrationRebase(slug, {
        baseWorktree,
        baseBranch,
        git,
        missionServicesFn,
        executionContext: {
          missionId: slug,
          missionWorktree: context.missionWorktree,
          missionBranch: context.branch,
          baseWorktree,
          baseBranch,
        },
      });
      const checkout = this.dependencies.ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: String(baseWorktree) });
      const removed = context.mirrorOwnership.kind === 'none'
        ? new Set<string>()
        : prepareBacklogPayload(this.dependencies.ports, checkout, baseBranch);
      if (removed.size > 0 && git(['-C', checkout, 'commit', '--only', '-m', 'Remove stale completed-task copies before integration', '--', ...removed]).status !== 0) {
        throw abortWith(this.dependencies.landing, 'Could not commit stale backlog cleanup before recorded-tests admission.');
      }
      // Repo-owned metadata such as a version bump is committed onto the
      // rebased mission branch here, so it is computed from the current base,
      // read against the recorded tests below, and squashed into the one mission commit.
      // Amending after landing is not an option: Forgejo sync, closeout, and
      // github-publish all bind to the landed commit SHA.
      this.dependencies.landing.runPreCommitHookOrAbort(slug, {
        missionWorktree: this.dependencies.ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree }),
        baseWorktree,
        baseBranch,
        variant: 'variant-b',
      });
      return;
    }
    const prediction = this.dependencies.predictIntegrationRebase(slug, { baseWorktree, baseBranch, git });
    if (!prediction.needed) {
      fmt.log.info(`No rebase required: ${baseBranch} is already an ancestor of ${context.branch}.`);
    } else if (prediction.wouldConflict) {
      // --dry-run never started a rebase, so `git rebase --abort` does not
      // apply; only the agent-assisted conflict resolver can fix it.
      fmt.log.warn('Rebase onto ' + baseBranch + ' would conflict. Resolve the conflict before integrating (--dry-run did not start a rebase, so `git rebase --abort` does not apply):');
      fmt.log.info(`  ${fmt.command(`px resolve-conflict ${slug}`)}`);
    } else {
      fmt.log.info(`Rebase required: ${baseBranch} advanced since the mission branch. px integrate rebases, then reads the recorded tests.`);
    }
  }

  /** Returns 0 when the run may keep its exit code, 1 when restoring the stash failed. */
  restoreTemporaryStash(slug: string, stash: IntegrateRunState['temporaryStash']): 0 | 1 {
    if (!stash?.created) { return 0; }
    const restoreResult = this.dependencies.ports.checkout.restoreMainCheckoutStash(stash);
    if (restoreResult.status === 0) { return 0; }
    // A stash pop can fail on a pure file-collision when a stashed untracked
    // working-tree file (e.g. a first-run config/agents.json) was committed by
    // the landed squash merge and now already exists on disk. In that case the
    // data is preserved and the temporary stash can be dropped; only a genuine
    // conflict (or a missing file) should fail the run.
    const stashRootDir = stash.rootDir as string;
    if (this.dependencies.ports.checkout.maybeDropStashAfterCollision(restoreResult, stashRootDir, { expectedObjectId: stash.objectId, marker: stash.message })) {
      fmt.log.info('[RESTORE] Stashed working-tree change was preserved on disk by the landed commit; dropped the temporary stash.');
      return 0;
    }
    this.dependencies.ports.checkout.reportStashPopFailure(slug, restoreResult, { rootDir: stashRootDir, stash });
    return 1;
  }

  private async tryResumeIntegration(slug: string, request: IntegrateRequest, missionServices: IntegrationMissionServices, seams: IntegrateSeams, execution: MissionExecutionContext): Promise<0 | null> {
    // TASK-2517 CP-3: a landed-but-stranded mission short-circuits the whole run —
    // no rebase, no gates, no publish — and closes directly.
    if (request.recoverLanded) {
      await this.recoverLandedCloseout(slug, missionServices, execution);
      return 0;
    }
    const existing = await missionServices.store.load(missionId(slug));
    if (existing.kind === 'found' && existing.mission.status === 'done' && existing.mission.closedAt) {
      const landed = this.dependencies.ports.checkout.findLandedSquashOnBaseBranch(execution.baseWorktree, slug);
      if (!landed) {
        throw abortWith(this.dependencies.landing, `Mission ${slug} is closed in SQLite, but its landed commit is absent from the base branch. Inspect the lifecycle record before retrying integration.`);
      }
      const primary = execution.baseWorktree;
      const branch = this.dependencies.missionPaths.missionBranchName(slug, primary);
      const branchExists = this.dependencies.ports.git.git(['-C', primary, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
      if (branchExists || this.dependencies.ports.fileSystem.existsSync(this.dependencies.missionPaths.conventionalWorktreePath(slug))) {
        throw abortWith(this.dependencies.landing, `Mission ${slug} is marked closed but its branch or worktree remains. Preserve any work in the mission worktree, then run px integrate ${slug} --recover-landed to finish closeout.`);
      }
      fmt.log.info(`Mission ${slug} already integrated as ${landed.slice(0, 12)}; no tests admission or merge rerun.`);
      return 0;
    }
    const repair = await resumeOrPreviewPendingIntegrationRepair(slug, existing, missionServices,
      this.dependencies.ports, execution, seams, request.dryRun);
    if (repair.kind === 'found' && integrationRepairNeedsReview(repair.mission)) {
      const next = fixedVerificationNextAction({ mission: repair.mission });
      if (next.kind !== 'agent-review' && next.kind !== 'repair') { return null; }
      return reviewBeforeIntegration(slug, this.executionContextFor(slug, execution).missionWorktree, this.dependencies.ports.landing, seams.reReviewFn);
    }
    return null;
  }

  private resolveMissionHead(slug: string, context: IntegrationContext): void {
    const integrationCheckout = this.dependencies.ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: context.baseWorktree });
    const headResolution = this.dependencies.ports.git.git(['-C', integrationCheckout, 'rev-parse', 'HEAD']);
    context.missionHeadSha = headResolution.status === 0 ? String(headResolution.stdout || '').trim() : null;
  }

  private landingNeedsRebase(slug: string, context: IntegrationContext): boolean {
    // A squash does not preserve mission ancestry. An already-landed payload
    // must reach the existing closeout path instead of retrying its landing.
    if (this.dependencies.ports.checkout.findLandedSquashOnBaseBranch(context.baseWorktree, slug)) { return false; }
    return this.dependencies.predictIntegrationRebase(slug, {
      baseWorktree: context.baseWorktree, baseBranch: context.baseBranch, git: this.dependencies.ports.git.git,
    }).needed;
  }

  /**
   * The context must describe the Mission being integrated. This runs before
   * any recovery, closed-Mission or repair branch reads it, so a context for
   * another Mission can never drive closeout or repair against its base.
   */
  private validatedExecutionContext(slug: string, execution: MissionExecutionContext): MissionExecutionContext {
    if (execution.missionId !== slug) {
      throw abortWith(this.dependencies.landing, `Execution context for ${execution.missionId} cannot integrate mission ${slug}.`);
    }
    return execution;
  }

  /** The resolved checkouts are required: a mismatched identity or a landed Mission without a checkout stops the run. */
  private executionContextFor(slug: string, execution: MissionExecutionContext): MissionExecutionContext & { missionWorktree: string } {
    const validated = this.validatedExecutionContext(slug, execution);
    const missionWorktree = validated.missionWorktree;
    if (!missionWorktree) {
      throw abortWith(this.dependencies.landing, `Mission ${slug}: its landing is proven on ${execution.baseBranch}, but no mission checkout remains. Run px integrate ${slug} --recover-landed to finish closeout.`);
    }
    return { ...execution, missionWorktree };
  }

  async runIntegration(slug: string, request: IntegrateRequest, options: ResolvedIntegrateOptions, seams: IntegrateSeams, state: IntegrateRunState): Promise<0 | 1> {
    const { dryRun } = request;
    const { missionServicesFn, executionContext } = options;
    if (typeof missionServicesFn !== 'function') { throw new Error('integrate command requires injected mission services'); }
    // Resolve the authoritative store before buildIntegrationContext so the
    // reviewer lookup (TASK-2420 review round 2, F1) receives its `missionStore`
    // argument; the store is rootDir-independent.
    const execution = this.validatedExecutionContext(slug, executionContext);
    const missionServices = await missionServicesFn(this.dependencies.ports.process.cwd());
    const resumed = await this.tryResumeIntegration(slug, request, missionServices, seams, execution);
    if (resumed !== null) { return resumed; }
    const checkouts = this.executionContextFor(slug, execution);
    const context: IntegrationContext = await this.dependencies.buildIntegrationContext(slug, {
      missionStore: missionServices.store,
      executionContext: checkouts,
      getCurrentBranchFn: () => this.dependencies.ports.git.getCurrentBranch(checkouts.missionWorktree),
    });
    const missionLoad = await this.loadMissionAuthority(slug, context, missionServices);
    this.requireReadableApprovedRevision(context, missionLoad);

    // Admission runs in both modes: a dry run predicts the same refusal at the same point; only the real run may record the human approval.
    if (missionLoad.kind === 'found') { await admitIntegrationApproval(context, missionLoad, missionServices, this.dependencies.ports, { dryRun }); }
    // Recovery owns the lane; Backlog promotion stays delayed until closeout because it can be part of the candidate branch, never lifecycle authority.
    // The retention keeps a promotion the shortcut already deferred: that admission moved the lane out of `review` itself.
    if (!dryRun) {
      context.promoteBacklogOnCloseout = retainsCloseoutBacklogPromotion(context);
      await this.dependencies.recoverMissionForIntegration(context, { missionServices });
      const recovered = await missionServices.store.load(missionId(slug));
      assertRecoveredIntegrationHandoff(recovered, this.dependencies.landing, slug);
    }

    const { failures } = this.dependencies.printIntegrationPreflight(context, { gitFn: this.dependencies.ports.git.git, configuration: options.configuration });
    if (failures.length > 0) { throw abortWith(this.dependencies.landing, `\nIntegration preflight failed. Blocked by ${failures.join(', ')}. Resolve the blockers above, then retry: px integrate ${slug} --dry-run`); }

    previewIntegrationShortcut({ dryRun, context, missionLoad, ports: this.dependencies.ports });
    // TASK-2625: a resolvable mission HEAD only enables recording the integration-validation marker. It is keyed on
    // the commit the rebound verify rerun ran green against (its finalized `tree.commit`); a later integrate looks it
    // up against the post-rebase finalized commit, which may differ only in backlog bookkeeping (TASK-2646). Absent,
    // no marker is recorded and the full suite runs.
    this.resolveMissionHead(slug, context);

    await this.rebaseForIntegration(slug, context, dryRun, missionServicesFn);

    // Resolve the repository's integration mode and build the capability
    // boundary. An invalid mode throws the actionable configuration error here
    // (fail closed) before any merge authority is exercised. From now on the
    // real integration operations run through `strategy.run`, so a non-local
    // mode refuses the local primary merge / unimplemented steps instead of
    // silently performing them (SC4 / SC6).
    const strategy = createIntegrationStrategy(this.dependencies.ports.productConfig.resolveIntegrationMode(context.baseWorktree));
    // Integration never starts a gate. It reads the run the tests action recorded
    // and refuses, naming tests, when that run does not cover the candidate.
    const readRecordedTests = () => strategy.run('run-required-local-gates', async () =>
      requireCurrentIntegrationTests(this.dependencies.ports, slug, context.baseWorktree));
    let verificationEvidence = await readRecordedTests();
    // A recorded run certifies a particular landing candidate. If the primary
    // advanced since, rebase again and re-read it; never squash a comparison
    // tree the recorded tests did not see.
    if (!dryRun && this.landingNeedsRebase(slug, context)) {
      fmt.log.info(`${context.baseBranch} advanced; rebasing and re-reading the recorded tests for the updated landing candidate.`);
      await this.rebaseForIntegration(slug, context, false, missionServicesFn);
      verificationEvidence = await readRecordedTests();
    }
    printIntegrationReadiness(buildIntegrationReadiness(context, { verification: verificationEvidence }, this.dependencies.missionPaths.getPrimaryBranch));

    if (dryRun) {
      await this.dependencies.promoteTaskForIntegrationIfNeeded(context, { dryRun: true, missionServicesFn });
      fmt.log.pass('Dry run complete. Integration preflight passed.');
      return 0;
    }
    // TASK-2517 SC1: an integration-gate rebound bounced the lane back to
    // `active` to run the implementer. The recorded tests are current, but the lane is
    // still where the bounce left it, and `decideIntegration` only accepts
    // `integration`. Restore it through the same recovery that owns the
    // authoritative timestamps — before any landing effect, never after.
    const restored = await this.dependencies.recoverMissionForIntegration(context, { missionServices });
    if (restored.status !== 'integration' && restored.status !== 'done') {
      throw abortWith(this.dependencies.landing, `Mission ${slug} is ${restored.status} after the recorded-tests check; integration requires the integration lane. Aborting before any landing effect.`);
    }
    await this.requireRetainedApprovalFeedback(slug, context, missionServices);
    if (strategy.mode === 'github-pr') {
      return (await this.dependencies.landThroughGithubPr({ slug, context, missionServices, strategy })) ? 0 : 1;
    }
    const landingBase = { baseWorktree: context.baseWorktree, baseBranch: context.baseBranch };
    for (let attempt = 0; attempt < 3; attempt++) {
      const landed = await withBaseMutation(this.dependencies.ports.process, landingBase.baseWorktree, landingBase.baseBranch, async () => {
        if (this.landingNeedsRebase(slug, context)) { return false; }
        await strategy.run('publish', () => this.dependencies.publishMission({
          slug, context, missionServices, missionServicesFn,
          ...landingBase, seams, state, configuration: options.configuration,
        }));
        return true;
      });
      if (landed) { return 0; }
      // Release base exclusion before preparing and verifying the changed tree.
      // A concurrent landing never forces an operator to restart the command.
      fmt.log.info('The base advanced before landing; reconciling and validating the updated candidate.');
      await this.rebaseForIntegration(slug, context, false, missionServicesFn);
      await readRecordedTests();
      await this.dependencies.recoverMissionForIntegration(context, { missionServices });
    }
    throw abortWith(this.dependencies.landing, 'The base kept advancing during three landing attempts; retry when concurrent integration settles.');
  }

  private async requireRetainedApprovalFeedback(slug: string, context: IntegrationContext, services: IntegrationMissionServices): Promise<void> {
    const allowed = await retainedApprovalFeedbackAllowsLanding(slug, services, () => {
      const checkout = this.dependencies.ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: context.baseWorktree });
      return this.dependencies.ports.gates.approvalEvidence?.(checkout);
    });
    if (!allowed) {
      throw abortWith(this.dependencies.landing, 'Current human review feedback blocks retained approval. Run px review before integration.');
    }
  }

  async integrate(args: string[], options: IntegrateOptions = {}) {
    return runIntegrateEntry(args, options, this.dependencies.ports, { runIntegration: this.runIntegration.bind(this), restoreTemporaryStash: this.restoreTemporaryStash.bind(this) });
  }

  surface() {
    return {
    integrate: this.integrate.bind(this),
    buildIntegrationContext: this.dependencies.buildIntegrationContext,
    evaluateTaskStatusForIntegration: (context: IntegrationContext) => evaluateTaskStatusForIntegration(context, this.dependencies.ports.stateMap),
    promoteTaskForIntegrationIfNeeded: this.dependencies.promoteTaskForIntegrationIfNeeded,
    recoverMissionForIntegration: this.dependencies.recoverMissionForIntegration,
    recoveryEstablishesApproval,
    resolveAuthoritativeApprovalAt,
    printIntegrationPreflight: this.dependencies.printIntegrationPreflight,
    buildIntegrationReadiness: (context: IntegrationContext, outcome: { verification: string }) =>
      buildIntegrationReadiness(context, outcome, this.dependencies.missionPaths.getPrimaryBranch),
    printIntegrationReadiness,
    runIntegrationRebase: this.dependencies.runIntegrationRebase,
    predictIntegrationRebase: this.dependencies.predictIntegrationRebase,
    runReviewStepTests: (slug: string, options: IntegrateOptions = {}) => runReviewStepTestsEntry(slug, options, this.dependencies.ports, createTestsActionExecutor(this.dependencies.ports, this.dependencies)),
    runPolicyTestsAction: (slug: string, options: PolicyTestsActionOptions) => runPolicyTestsAction(this.dependencies.ports, this.dependencies, slug, options),
    parseIntegrateArgs,
    resolveBounceImplementer,
    resolveIntegrationTaskPath,
    VARIANT_B_AUTOMATION_SUMMARY,
  };
  }
}
