import { runIntegrateEntry } from './integrate-entry.js';
import type { MissionLoadResult } from './domain-ports.js';
import type { IntegrationMissionServices, IntegrationMissionServicesFactory } from './ports/integration-records.js';
import type { IntegrationContext } from './integrate/context.js';
import { withBaseMutation } from './integrate/base-mutation.js';
import { prepareBacklogPayload } from './integrate/backlog-payload.js';
import type { ParallixConfiguration } from "./ports/configuration.js";
/**
 * Integrate workflow use case — the `px integrate` sequence (TASK-2512).
 *
 * This module owns the order of the run: argument parsing, the authoritative
 * Mission load, lifecycle recovery, preflight, the integration-time rebase,
 * the required gates, the readiness view, and dispatch to the integration
 * mode's landing. Each step lives in its own module under `./integrate/`.
 *
 * Every concrete mechanism is reached through `IntegrateWorkflowPorts`
 * (`./ports/integrate-workflow.js`), which the CLI adapter binds; no adapter
 * module is imported here (ADR 0037, ADR 0051).
 */
import * as fmt from './presentation/cli-format.js';
import { createIntegrationStrategy } from './services/integration-dispatch.js';
import { missionId } from '../domain/mission.js';
import { integrationRepairNeedsReview } from './integration-repair-review.js';
import { evaluateTaskStatusForIntegration, recoveryEstablishesApproval, resolveAuthoritativeApprovalAt } from './integrate/approval.js';
import { createIntegrationContextBuilder } from './integrate/context.js';
import { createIntegrationGateStep, type IntegrateSeams } from './integrate/gates.js';
import { createGithubPrLanding } from './integrate/github-pr.js';
import { createMissionLanding } from './integrate/landing.js';
import { createIntegrationPreflight } from './integrate/preflight.js';
import { buildIntegrationReadiness, printIntegrationReadiness } from './integrate/readiness.js';
import { createIntegrationRebase } from './integrate/rebase.js';
import { createMissionRecovery } from './integrate/recovery.js';
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

/** The injection seams `px integrate` callers and the characterization suites bind. */
export interface IntegrateOptions extends Partial<IntegrateSeams> {
  configuration?: ParallixConfiguration;
  missionServicesFn?: IntegrationMissionServicesFactory;
  /** Board composition receives the terminal status without terminating the UI process. */
  exitFn?: (_code: number) => void;
  /** The outer `px integrate` publication nested repair and review report into (TASK-2620). */
  nestedWork?: unknown;
}

function composeIntegrateWorkflowDependencies(ports: IntegrateWorkflowPorts) {

  const { landing, missionPaths } = ports;

  const { buildIntegrationContext } = createIntegrationContextBuilder(ports);

  const { recoverMissionForIntegration, promoteTaskForIntegrationIfNeeded } = createMissionRecovery(ports);

  const { runIntegrationRebase, predictIntegrationRebase } = createIntegrationRebase(ports);

  const { printIntegrationPreflight } = createIntegrationPreflight(ports);

  const { runRequiredLocalGates } = createIntegrationGateStep(ports);

  const { landThroughGithubPr } = createGithubPrLanding(ports);

  const { publishMission } = createMissionLanding(ports, { promoteTaskForIntegrationIfNeeded });
  return { ports, landing, missionPaths, buildIntegrationContext, recoverMissionForIntegration, promoteTaskForIntegrationIfNeeded, runIntegrationRebase, predictIntegrationRebase, printIntegrationPreflight, runRequiredLocalGates, landThroughGithubPr, publishMission };
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
  /** @param {string} slug @param {any} missionServices @param {string} rootDir */
  async recoverLandedCloseout(slug: string, missionServices: IntegrationMissionServices, rootDir: string): Promise<0> {
    // The hook runs from the base checkout; resolve the landed base branch the
    // same way the integration context does (legacy missions fall back to the
    // primary branch).
    let baseBranch: string;
    try { baseBranch = this.dependencies.missionPaths.resolveMissionBaseBranch(slug, rootDir); } catch { baseBranch = this.dependencies.missionPaths.getPrimaryBranch(); }
    const baseWorktree = this.dependencies.missionPaths.resolveBaseWorktree(slug, { rootDir });
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
      `Fetch or restore revision ${revision}, then run px review ${context.slug} --continue to establish review for the current branch before retrying integrate.`);
  }

  /**
   * Rebase the mission onto its resolved local primary/parent (ADR 0043)
   * BEFORE any gate runs and before the probe merge, so gates and the merge
   * see the actual merge base (task-2506). A dry run only reports the need /
   * conflict and never touches the branch.
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
        return;
      }
      await this.dependencies.runIntegrationRebase(slug, { baseWorktree, baseBranch, git, missionServicesFn });
      const checkout = this.dependencies.ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: String(baseWorktree) });
      const removed = prepareBacklogPayload(this.dependencies.ports, checkout, baseBranch);
      if (removed.size > 0 && git(['-C', checkout, 'commit', '--only', '-m', 'Remove stale completed-task copies before integration', '--', ...removed]).status !== 0) {
        throw abortWith(this.dependencies.landing, 'Could not commit stale backlog cleanup before integration gates.');
      }
      // Repo-owned metadata such as a version bump is committed onto the
      // rebased mission branch here, so it is computed from the current base,
      // verified by the gates below, and squashed into the one mission commit.
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
      fmt.log.info(`Rebase required: ${baseBranch} advanced since the mission branch. px integrate rebases before running gates.`);
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
    if (this.dependencies.ports.checkout.maybeDropStashAfterCollision(restoreResult, stashRootDir)) {
      fmt.log.info('[RESTORE] Stashed working-tree change was preserved on disk by the landed commit; dropped the temporary stash.');
      return 0;
    }
    this.dependencies.ports.checkout.reportStashPopFailure(slug, restoreResult, { rootDir: stashRootDir });
    return 1;
  }

  private async tryResumeIntegration(slug: string, request: IntegrateRequest, missionServices: IntegrationMissionServices, seams: IntegrateSeams, state: IntegrateRunState): Promise<0 | null> {
    const { dryRun } = request;
    // TASK-2517 CP-3: a landed-but-stranded mission short-circuits the whole run —
    // no rebase, no gates, no publish — and closes directly.
    if (request.recoverLanded) {
      await this.recoverLandedCloseout(slug, missionServices, this.dependencies.ports.process.cwd());
      return 0;
    }
    const existing = await missionServices.store.load(missionId(slug));
    if (existing.kind === 'found' && existing.mission.status === 'done' && existing.mission.closedAt) {
      const landed = this.dependencies.ports.checkout.findLandedSquashOnBaseBranch(this.dependencies.ports.process.cwd(), slug);
      if (!landed) {
        throw abortWith(this.dependencies.landing, `Mission ${slug} is closed in SQLite, but its landed commit is absent from the base branch. Inspect the lifecycle record before retrying integration.`);
      }
      const primary = this.dependencies.missionPaths.getPrimaryWorktree();
      const branch = this.dependencies.missionPaths.missionBranchName(slug, primary);
      const branchExists = this.dependencies.ports.git.git(['-C', primary, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
      if (branchExists || this.dependencies.ports.fileSystem.existsSync(this.dependencies.missionPaths.conventionalWorktreePath(slug))) {
        throw abortWith(this.dependencies.landing, `Mission ${slug} is marked closed but its branch or worktree remains. Preserve any work in the mission worktree, then run px integrate ${slug} --recover-landed to finish closeout.`);
      }
      fmt.log.info(`Mission ${slug} already integrated as ${landed.slice(0, 12)}; no integration gates or merge rerun.`);
      return 0;
    }
    if (!dryRun) {
      const repair = await missionServices.store.load(missionId(slug));
      if (repair.kind === 'found' && integrationRepairNeedsReview(repair.mission)) {
        if (!seams.reReviewFn) {
          throw abortWith(this.dependencies.ports.landing, `The repaired mission ${slug} requires review. Run px review ${slug} --continue.`);
        }
        if (!await seams.reReviewFn(slug, this.dependencies.ports.process.cwd())) {
          throw abortWith(this.dependencies.ports.landing, `Review of the repaired mission ${slug} stopped. Run px review ${slug} --continue to resume.`);
        }
        // TASK-2620: on approval the repaired mission sits in the integration
        // lane for the human to read the fresh PR and integrate. No path
        // auto-restarts integration or merges, so stop here.
        state.nextActionMessage = `The repaired mission ${slug} was re-reviewed and approved; it now sits in the integration lane. Read the fresh PR and run px integrate ${slug} to land.`;
        return 0;
      }
    }
    return null;
  }

  private resolveMissionHead(slug: string, context: IntegrationContext): void {
    const integrationCheckout = this.dependencies.ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: context.baseWorktree });
    const headResolution = this.dependencies.ports.git.git(['-C', integrationCheckout, 'rev-parse', 'HEAD']);
    context.missionHeadSha = headResolution.status === 0 ? String(headResolution.stdout || '').trim() : null;
  }

  async runIntegration(slug: string, request: IntegrateRequest, options: IntegrateOptions, seams: IntegrateSeams, state: IntegrateRunState): Promise<0 | 1> {
    const { dryRun } = request;
    const { missionServicesFn } = options;
    if (typeof missionServicesFn !== 'function') { throw new Error('integrate command requires injected mission services'); }
    // Resolve the authoritative store before buildIntegrationContext so the
    // reviewer lookup (TASK-2420 review round 2, F1) receives its `missionStore`
    // argument; the store is rootDir-independent.
    const missionServices = await missionServicesFn(this.dependencies.ports.process.cwd());
    const resumed = await this.tryResumeIntegration(slug, request, missionServices, seams, state);
    if (resumed !== null) { return resumed; }
    const context: IntegrationContext = await this.dependencies.buildIntegrationContext(slug, { missionStore: missionServices.store });
    const missionLoad = await this.loadMissionAuthority(slug, context, missionServices);
    this.requireReadableApprovedRevision(context, missionLoad);

    // Reconcile the authoritative Mission before preflight or merge work.
    // Backlog promotion remains delayed until closeout, because it can be
    // part of the candidate branch, but it is never lifecycle authority.
    if (!dryRun) {
      context.promoteBacklogOnCloseout = context.missionStatus === 'review';
      await this.dependencies.recoverMissionForIntegration(context, { missionServices });
    }

    if (this.dependencies.printIntegrationPreflight(context, { gitFn: this.dependencies.ports.git.git, configuration: options.configuration }).failures.length > 0) {
      throw abortWith(this.dependencies.landing, '\nIntegration preflight failed. Resolve the blockers above before running integrate.');
    }

    // TASK-2625: a resolvable mission HEAD only enables recording the
    // integration-validation marker. The marker itself is keyed on the commit
    // the rebound verify rerun ran green against (its finalized `tree.commit`),
    // and a later integrate looks it up against the post-rebase finalized
    // commit, which may differ from it only in backlog bookkeeping
    // (TASK-2646). Absent, no marker is recorded and the full suite runs.
    this.resolveMissionHead(slug, context);

    await this.rebaseForIntegration(slug, context, dryRun, missionServicesFn);

    // Resolve the repository's integration mode and build the capability
    // boundary. An invalid mode throws the actionable configuration error here
    // (fail closed) before any merge authority is exercised. From now on the
    // real integration operations run through `strategy.run`, so a non-local
    // mode refuses the local primary merge / unimplemented steps instead of
    // silently performing them (SC4 / SC6).
    const strategy = createIntegrationStrategy(this.dependencies.ports.productConfig.resolveIntegrationMode(context.baseWorktree ?? this.dependencies.ports.process.cwd()));
    const gateRequest = { slug, context, missionLoad, missionServices, ...request, seams, configuration: options.configuration };
    let verificationEvidence = await strategy.run('run-required-local-gates', () => this.dependencies.runRequiredLocalGates(gateRequest));
    // Gates certify a particular landing candidate.  If the primary advanced
    // while they ran, rebase again and run the complete configured set against
    // that new candidate; never squash a comparison tree the gates did not see.
    if (!dryRun && this.dependencies.predictIntegrationRebase(slug, {
      baseWorktree: context.baseWorktree,
      baseBranch: context.baseBranch,
      git: this.dependencies.ports.git.git,
    }).needed) {
      fmt.log.info(`${context.baseBranch} advanced while integration gates ran; rebasing and re-running gates on the updated landing candidate.`);
      await this.rebaseForIntegration(slug, context, false, missionServicesFn);
      verificationEvidence = await strategy.run('run-required-local-gates', () =>
        this.dependencies.runRequiredLocalGates(gateRequest));
    }
    printIntegrationReadiness(buildIntegrationReadiness(context, { verification: verificationEvidence }, this.dependencies.missionPaths.getPrimaryBranch));

    if (dryRun) {
      await this.dependencies.promoteTaskForIntegrationIfNeeded(context, { dryRun: true, missionServicesFn });
      fmt.log.pass('Dry run complete. Integration preflight passed.');
      return 0;
    }
    // TASK-2517 SC1: an integration-gate rebound bounced the lane back to
    // `active` to run the implementer. The gates re-ran green, but the lane is
    // still where the bounce left it, and `decideIntegration` only accepts
    // `integration`. Restore it through the same recovery that owns the
    // authoritative timestamps — before any landing effect, never after.
    const restored = await this.dependencies.recoverMissionForIntegration(context, { missionServices });
    if (restored.status !== 'integration' && restored.status !== 'done') {
      throw abortWith(this.dependencies.landing, `Mission ${slug} is ${restored.status} after the integration gates; integration requires the integration lane. Aborting before any landing effect.`);
    }
    if (strategy.mode === 'github-pr') {
      return (await this.dependencies.landThroughGithubPr({ slug, context, missionServices, strategy })) ? 0 : 1;
    }
    const landingBase = { baseWorktree: String(context.baseWorktree), baseBranch: String(context.baseBranch) };
    for (let attempt = 0; attempt < 3; attempt++) {
      const landed = await withBaseMutation(this.dependencies.ports.process, landingBase.baseWorktree, landingBase.baseBranch, async () => {
        if (this.dependencies.predictIntegrationRebase(slug, { baseWorktree: String(context.baseWorktree), baseBranch: String(context.baseBranch), git: this.dependencies.ports.git.git }).needed) { return false; }
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
      await strategy.run('run-required-local-gates', () =>
        this.dependencies.runRequiredLocalGates(gateRequest));
      await this.dependencies.recoverMissionForIntegration(context, { missionServices });
    }
    throw abortWith(this.dependencies.landing, 'The base kept advancing during three landing attempts; retry when concurrent integration settles.');
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
    parseIntegrateArgs,
    resolveBounceImplementer,
    resolveIntegrationTaskPath,
    VARIANT_B_AUTOMATION_SUMMARY,
  };
  }
}
