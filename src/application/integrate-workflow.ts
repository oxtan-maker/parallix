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
import { evaluateTaskStatusForIntegration, recoveryEstablishesApproval, resolveAuthoritativeApprovalAt } from './integrate/approval.js';
import { createIntegrationContextBuilder } from './integrate/context.js';
import { createBaseWorktreeRepair } from './integrate/base-worktree-repair.js';
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
  missionServicesFn?: Function;
  /** Board composition receives the terminal status without terminating the UI process. */
  exitFn?: (_code: number) => void;
}

export function createIntegrateWorkflow(ports: IntegrateWorkflowPorts) {
  const { landing, missionPaths } = ports;
  const { buildIntegrationContext } = createIntegrationContextBuilder(ports);
  const { recoverMissionForIntegration, promoteTaskForIntegrationIfNeeded } = createMissionRecovery(ports);
  const { runIntegrationRebase, predictIntegrationRebase } = createIntegrationRebase(ports);
  // TASK-2532: heal integration-owned poison left by an interrupted integrate in
  // the resolved base worktree before preflight or the stash/rebase steps.
  const { repairBaseWorktree } = createBaseWorktreeRepair(ports);

  // TASK-2517 CP-3: a mission whose squash already landed on the base branch but
  // whose aggregate is stranded in `active`/`review` has no remote effect left to
  // perform. Recover the lane through the same authoritative recovery that owns
  // the timestamps (never assign Mission.status), close it to `done`, and remove
  // the worktree and local branch. Every effect reuses a tested integration
  // port, so the closeout performs zero new remote side effects.
  /** @param {string} slug @param {any} missionServices @param {string} rootDir */
  async function recoverLandedCloseout(slug: string, missionServices: any, rootDir: string): Promise<0> {
    await recoverLandedIntegration(
      slug,
      missionServices,
      rootDir,
      {
        findSquashCommit: ports.checkout.findLandedSquashOnBaseBranch,
        recoverMissionForIntegration,
        persistLandedIntegrationOrAbort: ports.landing.persistLandedIntegrationOrAbort,
        cleanupMissionWorktree: ports.landing.cleanupMissionWorktree,
        createAbort: landing.createAbort,
      },
    );
    return 0;
  }
  const { printIntegrationPreflight } = createIntegrationPreflight(ports);
  const { runRequiredLocalGates } = createIntegrationGateStep(ports);
  const { landThroughGithubPr } = createGithubPrLanding(ports);
  const { publishMission } = createMissionLanding(ports, { promoteTaskForIntegrationIfNeeded });

  /**
   * Read the authoritative Mission (SQLite) and fold its lifecycle facts into
   * the context. Database unavailability fails the operation (fail-closed).
   */
  async function loadMissionAuthority(slug: string, context: any, missionServices: any) {
    const missionLoad = await missionServices.store.load(missionId(slug));
    if (missionLoad.kind === 'unavailable') {
      throw abortWith(landing, `Mission store unavailable: ${missionLoad.reason}. Integration cannot proceed on legacy files.`);
    }
    if (missionLoad.kind === 'missing') {
      throw abortWith(landing, `Mission ${missionId(slug)} not found in SQLite. Materialize through the intake boundary before integration.`);
    }
    if (missionLoad.kind === 'found') {
      context.missionStatus = missionLoad.mission.status;
      context.missionLabels = missionLoad.mission.labels;
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

  /**
   * Rebase the mission onto its resolved local primary/parent (ADR 0043)
   * BEFORE any gate runs and before the probe merge, so gates and the merge
   * see the actual merge base (task-2506). A dry run only reports the need /
   * conflict and never touches the branch.
   */
  async function rebaseForIntegration(slug: string, context: any, dryRun: boolean, missionServicesFn?: Function) {
    const { baseWorktree, baseBranch } = context;
    const git = ports.git.git;
    if (!dryRun) {
      await runIntegrationRebase(slug, { baseWorktree, baseBranch, git, missionServicesFn });
      // Repo-owned metadata such as a version bump is committed onto the
      // rebased mission branch here, so it is computed from the current base,
      // verified by the gates below, and squashed into the one mission commit.
      // Amending after landing is not an option: Forgejo sync, closeout, and
      // github-publish all bind to the landed commit SHA.
      landing.runPreCommitHookOrAbort(slug, {
        missionWorktree: ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree }),
        baseWorktree,
        baseBranch,
        variant: 'variant-b',
      });
      return;
    }
    const prediction = predictIntegrationRebase(slug, { baseWorktree, baseBranch, git });
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
  function restoreTemporaryStash(slug: string, stash: IntegrateRunState['temporaryStash']): 0 | 1 {
    if (!stash?.created) { return 0; }
    const restoreResult = ports.checkout.restoreMainCheckoutStash(stash);
    if (restoreResult.status === 0) { return 0; }
    // A stash pop can fail on a pure file-collision when a stashed untracked
    // working-tree file (e.g. a first-run config/agents.json) was committed by
    // the landed squash merge and now already exists on disk. In that case the
    // data is preserved and the temporary stash can be dropped; only a genuine
    // conflict (or a missing file) should fail the run.
    const stashRootDir = stash.rootDir as string;
    if (ports.checkout.maybeDropStashAfterCollision(restoreResult, stashRootDir)) {
      fmt.log.info('[RESTORE] Stashed working-tree change was preserved on disk by the landed commit; dropped the temporary stash.');
      return 0;
    }
    ports.checkout.reportStashPopFailure(slug, restoreResult, { rootDir: stashRootDir });
    return 1;
  }

  async function runIntegration(slug: string, request: IntegrateRequest, options: IntegrateOptions, seams: IntegrateSeams, state: IntegrateRunState): Promise<0 | 1> {
    const { dryRun } = request;
    const { missionServicesFn } = options;
    if (typeof missionServicesFn !== 'function') { throw new Error('integrate command requires injected mission services'); }
    // Resolve the authoritative store before buildIntegrationContext so the
    // reviewer lookup (TASK-2420 review round 2, F1) receives its `missionStore`
    // argument; the store is rootDir-independent.
    const missionServices = await missionServicesFn(process.cwd());
    // TASK-2517 CP-3: a landed-but-stranded mission short-circuits the whole run —
    // no rebase, no gates, no publish — and closes directly.
    if (request.recoverLanded) {
      await recoverLandedCloseout(slug, missionServices, process.cwd());
      return 0;
    }
    const context: any = await buildIntegrationContext(slug, { missionStore: missionServices.store });

    // TASK-2532 / F2 (task-2532 round 1): an interrupted prior integrate can
    // leave an integration-owned marker stash or a dead rebase in the base
    // worktree. Sweep it here, before preflight and the stash/rebase steps, so
    // this run does not abort on that stale state. A dry run is non-mutating by
    // contract — the pre-dry-run `rebaseForIntegration` never started a rebase
    // under --dry-run — so the repair runs detect-only (logs what it would
    // repair, mutates nothing) when `dryRun` is set; it is passed through to
    // `repairBaseWorktree`, which owns the mutation boundary. F3 (task-2532
    // round 2): no in-flight guard here — the stash sweep drops every marker
    // stash unconditionally. A lifecycle-status proxy was rejected because the
    // `integration` lane is not a liveness signal and would keep exactly the
    // SC1 poison from being swept. Concurrent integrates on the same base
    // worktree were never supported (`restoreMainCheckoutStash` pops
    // `stash@{0}`), so the sweep is allowed to be unconditional.
    await repairBaseWorktree({
      baseWorktree: context.baseWorktree,
      git: ports.git.git,
      dryRun,
    });

    const missionLoad = await loadMissionAuthority(slug, context, missionServices);

    // Reconcile the authoritative Mission before preflight or merge work.
    // Backlog promotion remains delayed until closeout, because it can be
    // part of the candidate branch, but it is never lifecycle authority.
    if (!dryRun) {
      context.promoteBacklogOnCloseout = context.missionStatus === 'review';
      await recoverMissionForIntegration(context, { missionServices });
    }

    if (printIntegrationPreflight(context, { gitFn: ports.git.git }).failures.length > 0) {
      throw abortWith(landing, '\nIntegration preflight failed. Resolve the blockers above before running integrate.');
    }

    await rebaseForIntegration(slug, context, dryRun, missionServicesFn);

    // Resolve the repository's integration mode and build the capability
    // boundary. An invalid mode throws the actionable configuration error here
    // (fail closed) before any merge authority is exercised. From now on the
    // real integration operations run through `strategy.run`, so a non-local
    // mode refuses the local primary merge / unimplemented steps instead of
    // silently performing them (SC4 / SC6).
    const strategy = createIntegrationStrategy(ports.productConfig.resolveIntegrationMode(context.baseWorktree ?? process.cwd()));
    const verificationEvidence = await strategy.run('run-required-local-gates', () =>
      runRequiredLocalGates({ slug, context, missionLoad, ...request, seams }));
    printIntegrationReadiness(buildIntegrationReadiness(context, { verification: verificationEvidence }, missionPaths.getPrimaryBranch));

    if (dryRun) {
      await promoteTaskForIntegrationIfNeeded(context, { dryRun: true, missionServicesFn });
      fmt.log.pass('Dry run complete. Integration preflight passed.');
      return 0;
    }
    // TASK-2517 SC1: an integration-gate rebound bounced the lane back to
    // `active` to run the implementer. The gates re-ran green, but the lane is
    // still where the bounce left it, and `decideIntegration` only accepts
    // `integration`. Restore it through the same recovery that owns the
    // authoritative timestamps — before any landing effect, never after.
    const restored = await recoverMissionForIntegration(context, { missionServices });
    if (restored.status !== 'integration' && restored.status !== 'done') {
      throw abortWith(landing, `Mission ${slug} is ${restored.status} after the integration gates; integration requires the integration lane. Aborting before any landing effect.`);
    }
    if (strategy.mode === 'github-pr') {
      return (await landThroughGithubPr({ slug, context, missionServices, strategy })) ? 0 : 1;
    }
    await strategy.run('publish', () => publishMission({
      slug, context, missionServices, missionServicesFn,
      baseWorktree: context.baseWorktree, baseBranch: context.baseBranch, seams, state,
    }));
    return 0;
  }

  async function integrate(args: string[], options: IntegrateOptions = {}) {
    const exitFn = options.exitFn ?? ports.process.terminate;
    let request: IntegrateRequest;
    try {
      request = parseIntegrateArgs(args);
    } catch (error) {
      fmt.log.fail((error as Error).message);
      exitFn(1);
      return;
    }
    const slug = missionPaths.inferSlug(request.explicitSlug);

    if (process.env.FORGEJO_USER === 'gemini' || process.env.WORKFLOW_AGENT === 'gemini') {
      fmt.log.fail('Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.');
      exitFn(1);
      return;
    }
    if (!slug) {
      fmt.log.fail('Usage: px integrate [<slug>] [--dry-run] [--no-integration-gates]');
      exitFn(1);
      return;
    }
    if (request.noGate) {
      fmt.log.warn('integrate ignores --no-gate. The landed squash commit relies on the local git hooks for validation.');
    }

    const seams: IntegrateSeams = {
      // SC2: kernel-context injection seams. Both bounces build their rebound
      // context from these so tests keep a mock launch/transition/fallback
      // port instead of a real agent, git, or Forgejo.
      startAgentFn: options.startAgentFn ?? ports.agents.startAgent,
      transitionTaskFn: options.transitionTaskFn ?? ports.backlog.transitionTask,
      applyAgentFallbackFn: options.applyAgentFallbackFn ?? ports.agents.applyAgentFallback,
      selectAgentFn: options.selectAgentFn ?? ports.agents.selectAgent,
      workflowLauncherStatusFn: options.workflowLauncherStatusFn ?? ports.agents.workflowLauncherStatus,
      routeIntegrationGateFailureFn: options.routeIntegrationGateFailureFn ?? ports.gates.routeIntegrationGateFailure,
    };
    const state: IntegrateRunState = { temporaryStash: null, nextActionMessage: null };
    let exitCode = 0;
    try {
      exitCode = await runIntegration(slug, request, options, seams, state);
    } catch (error) {
      // Report and fail. Rethrowing here is swallowed by the terminal exit
      // port call below, which would end the run with a success code and no
      // output at all.
      if (!landing.isAbort(error)) {
        fmt.log.fail(`Integration failed: ${(error as Error)?.message || String(error)}`);
        if ((error as Error)?.stack) {
          fmt.log.fail(String((error as Error).stack));
        }
      }
      exitCode = 1;
    }
    exitCode = Math.max(exitCode, restoreTemporaryStash(slug, state.temporaryStash));
    if (state.nextActionMessage) {
      fmt.log.info(state.nextActionMessage);
    }
    exitFn(exitCode);
    return { exitCode };
  }

  return {
    integrate,
    buildIntegrationContext,
    evaluateTaskStatusForIntegration: (context: any) => evaluateTaskStatusForIntegration(context, ports.stateMap),
    promoteTaskForIntegrationIfNeeded,
    recoverMissionForIntegration,
    recoveryEstablishesApproval,
    resolveAuthoritativeApprovalAt,
    printIntegrationPreflight,
    buildIntegrationReadiness: (context: any, outcome: { verification: string }) =>
      buildIntegrationReadiness(context, outcome, missionPaths.getPrimaryBranch),
    printIntegrationReadiness,
    runIntegrationRebase,
    predictIntegrationRebase,
    parseIntegrateArgs,
    resolveBounceImplementer,
    resolveIntegrationTaskPath,
    VARIANT_B_AUTOMATION_SUMMARY,
  };
}
