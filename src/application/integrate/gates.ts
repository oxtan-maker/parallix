/**
 * The required local integration gates: run the repository's configured
 * pre-integration gates against the finalized mission tree and route a red
 * gate through the integration-gate rebound (TASK-2492).
 */
import * as fmt from '../presentation/cli-format.js';
import { abortWith, resolveBounceImplementer, type BounceSeams } from './support.js';
import type { IntegrateGatesPort, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export interface IntegrateSeams extends BounceSeams {
  routeIntegrationGateFailureFn: IntegrateGatesPort['routeIntegrationGateFailure'];
  /**
   * Send a repaired revision back through review — the same review
   * `px review <slug> --start` runs — and report whether it came back approved.
   * Absent, a changed revision stops integration for the operator to re-review.
   */
  reReviewFn?: (_slug: string, _worktree: string) => Promise<boolean>;
}

/**
 * The repaired revision was re-reviewed and approved during this integration.
 * Everything integrate read before the repair (approval, pull request, lane)
 * is stale, so the run starts over from a fresh context instead of landing on it.
 */
export class IntegrationRestartRequired extends Error {
  constructor(readonly slug: string) {
    super(`${slug} was re-reviewed and approved after an integration-gate repair; integration restarts on the approved revision`);
    this.name = 'IntegrationRestartRequired';
  }
}

export interface GateStepRequest {
  slug: string;
  context: any;
  missionLoad: any;
  dryRun: boolean;
  noIntegrationGates: boolean;
  realAgent: string | null;
  realAgentModel: string | null;
  seams: IntegrateSeams;
}

export function createIntegrationGateStep({ gates, landing, verification }: IntegrateWorkflowPorts) {
  /**
   * Returns the Verification evidence the readiness view reports: exactly what
   * ran, never "passed" without a gate result behind it.
   */
  async function runRequiredLocalGates({ slug, context, missionLoad, dryRun, noIntegrationGates, realAgent, realAgentModel, seams }: GateStepRequest): Promise<string> {
    if (noIntegrationGates) {
      fmt.log.info('Integration gates skipped via --no-integration-gates flag');
      return 'skipped via --no-integration-gates';
    }
    // The integration checkout is the mission's own worktree. Verify the
    // exact resulting tree is finalized before any gate runs, then run the
    // repository's configured pre-integration gates from that checkout.
    // An unconfigured repository runs no gate; a gate that exits non-zero
    // aborts before the merge. The live integration gate carries no
    // Node/npm/tsx/verify-local.sh/Parallix-layout assumption (TASK-2457).
    const checkout = gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: context.baseWorktree });
    const finalTree = gates.captureFinalIntegrationTree(checkout);
    if (!finalTree.ok) {
      throw abortWith(landing, `Integration gates cannot start for ${slug}: ${finalTree.error}`);
    }
    const configured = gates.loadPhaseGates(checkout, 'preIntegration');
    // The mandatory-gate invariant is repository-configured, not hardcoded
    // product policy (task-2457 F11): a repository that opts in via
    // adapters.gates.requirePreIntegration: true fails closed on an empty gate
    // list; an unconfigured repository completes the integration path with
    // no lifecycle gate. --no-integration-gates is rejected outside the test
    // bypass, so the message below never points at it (task-2457 F12).
    const requirePreIntegration = gates.loadRequirePreIntegration(checkout);
    fmt.log.debug(`Integration gate target: slug=${slug} root=${finalTree.rootDir} commit=${finalTree.commit} tree=${finalTree.tree} requirePreIntegration=${requirePreIntegration}`);
    const result = await gates.runPhaseGates('integration', {
      slug,
      checkoutPath: checkout,
      gates: configured,
      log: fmt.log.plain,
      error: fmt.log.fail,
      // Plan-only dry run executes nothing; self-development agent selection
      // reaches the gate environment via buildGateEnv (F4 / TASK-2269).
      dryRun,
      realAgent,
      realAgentModel,
    });

    if (dryRun) {
      fmt.log.info(`Integration gate plan resolved for ${slug}: ${configured.length} gate(s) configured; nothing executed.`);
      return 'no gate ran';
    }
    if (result.skipped) {
      if (requirePreIntegration) {
        // An unconfigured or self-edited branch that removes
        // adapters.gates.preIntegration must fail closed here rather than
        // merge with "All integration gates passed." (TASK-2300 / F1).
        throw abortWith(
          landing,
          `\nIntegration gates are mandatory for ${slug}: no preIntegration gates configured in workflow.config.json, but adapters.gates.requirePreIntegration is set. Configure adapters.gates.preIntegration to run gates.`,
          'Aborting before merge.',
        );
      }
      fmt.log.info(`Integration gates for ${slug}: none configured and adapters.gates.requirePreIntegration is not set — proceeding without a lifecycle gate.`);
      return 'no pre-integration gate configured';
    }
    if (result.ok) {
      fmt.log.pass('All integration gates passed.');
      return `${configured.length} integration gate(s) passed`;
    }
    if (result.cancelled) {
      throw abortWith(landing, `Integration gates cancelled for ${slug}. Aborting before merge.`);
    }

    fmt.log.fail(`\nIntegration gates failed for ${slug} (root=${finalTree.rootDir}) — ${result.error}`);
    // TASK-2492: an approved mission whose integration gate goes red is no
    // longer a dead end. The failure is classified and routed; only the
    // recoverable mission-regression route continues, and it continues
    // only because the identical gate set re-ran green.
    const route = await seams.routeIntegrationGateFailureFn({
      slug,
      missionWorktree: checkout,
      verificationCommand: verification.formatVerificationCommand(context.area, checkout),
      failedGate: result.failedGate,
      gateError: result.error,
      gates: configured,
      implementer: resolveBounceImplementer(context.taskAssignee ?? null, checkout, seams),
      repositoryId: missionLoad.kind === 'found' ? String(missionLoad.mission.repositoryId) : 'unknown',
      // TASK-2528: a repair that changes the approved diff must retract the
      // standing approval instead of merging under it. The retraction is
      // per-reviewer, so the route needs the pull-request branch, the approval
      // as read at context-build time, and the configured reviewer's login.
      branch: context.branch,
      approval: context.approval,
      reviewerUser: context.configuredReviewer ?? null,
      realAgent,
      realAgentModel,
      startAgentFn: seams.startAgentFn,
      transitionTaskFn: (bounceSlug: string) => seams.transitionTaskFn(bounceSlug, 'active'),
      applyAgentFallbackFn: seams.applyAgentFallbackFn,
      reReviewFollows: Boolean(seams.reReviewFn),
    });
    if (route.route === 'revision-changed' && route.invalidation?.ok && seams.reReviewFn) {
      await reReviewRepairedRevision(slug, checkout, route.repairedRevision ?? 'unknown', seams.reReviewFn);
    }
    if (route.route !== 'fixed') {
      throw abortWith(landing, 'Aborting before merge.');
    }
    return `${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s)`;
  }

  /**
   * The repair changed what the reviewer approved, and its approval is
   * retracted. Review the repaired revision now instead of stranding the
   * mission for an operator: nothing is approved on the reviewer's behalf,
   * and the superseded approval stays in the review history.
   */
  async function reReviewRepairedRevision(slug: string, checkout: string, repairedRevision: string, reReviewFn: NonNullable<IntegrateSeams['reReviewFn']>): Promise<void> {
    fmt.log.info(`Sending ${slug} back through review for the repaired revision ${repairedRevision}.`);
    let approved = false;
    try {
      approved = await reReviewFn(slug, checkout);
    } catch (error) {
      throw abortWith(landing, `Re-review of ${slug} could not run: ${(error as Error).message}`, `Run px review ${slug} --start, then px integrate ${slug}.`, 'Aborting before merge.');
    }
    if (!approved) {
      throw abortWith(landing, `The repaired revision of ${slug} was not approved in re-review. Follow the review outcome above, then run px integrate ${slug} again.`, 'Aborting before merge.');
    }
    fmt.log.pass(`The repaired revision of ${slug} was re-reviewed and approved.`);
    throw new IntegrationRestartRequired(slug);
  }

  return { runRequiredLocalGates };
}
