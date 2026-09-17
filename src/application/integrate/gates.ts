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

    fmt.log.fail(`\nIntegration gates failed for ${slug} (root=${finalTree.rootDir}) — ${result.error}`);
    // TASK-2492: an approved mission whose integration gate goes red is no
    // longer a dead end. The failure is classified and routed; only the
    // recoverable mission-regression route continues, and it continues
    // only because the identical gate set re-ran green.
    const route = await seams.routeIntegrationGateFailureFn({
      slug,
      missionWorktree: checkout,
      baseWorktree: context.baseWorktree,
      baseBranch: context.baseBranch,
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
    });
    if (route.route !== 'fixed') {
      throw abortWith(landing, 'Aborting before merge.');
    }
    return `${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s)`;
  }

  return { runRequiredLocalGates };
}
