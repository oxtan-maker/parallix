import { retainIntegrationApproval } from './approval-retention.js';
import { completeGateRepairRoute } from './gate-repair-closeout.js';
import type { MissionLoadResult } from '../domain-ports.js';
import type { IntegrationMissionServices } from '../ports/integration-records.js';
import type { IntegrationContext } from './context.js';
import type { ParallixConfiguration } from '../ports/configuration.js';
import { integrationGateDisposition } from '../../domain/integration-gate-policy.js';
/**
 * The required local integration gates: run the repository's configured
 * pre-integration gates against the finalized mission tree and route a red
 * gate through the integration-gate rebound (TASK-2492).
 */
import * as fmt from '../presentation/cli-format.js';
import { agentFamily } from '../../domain/agents.js';
import type { IntegrationReviewSnapshot } from '../ports/integration-records.js';
import { missionId } from '../../domain/mission.js';
import { currentIntegrationRepair } from '../integration-repair-review.js';
import { reportedApprovalStaleness } from '../approval-coverage.js';
import { abortWith, projectBacklogTransition, resolveBounceImplementer, type BounceSeams } from './support.js';
import { buildIntegrationValidationMarker } from './validation-marker.js';
import type { IntegrateGatesPort, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';
import type { MissionStore } from '../domain-ports.js';
import { completeIntegrationGateRunReceipt } from './integration-gate-receipt.js';
import { recordImplementerLaunch } from '../rebase-identity.js';

export interface IntegrateSeams extends BounceSeams {
  routeIntegrationGateFailureFn: IntegrateGatesPort['routeIntegrationGateFailure'];
  /**
   * Send a repaired revision back through review — the same review
   * `px review <slug>` runs — and report whether it came back approved.
   * Absent, a changed revision stops integration for the operator to re-review.
   *
   * TASK-2620: the single live re-review route. On approval the mission stays
   * in the integration lane for the human to read the fresh PR and integrate;
   * it never auto-restarts integration or merges.
   */
  reReviewFn?: (_slug: string, _worktree: string) => Promise<boolean>;
}

/** The commit the mission's current approval was given to, when one is recorded. */
function approvedRevisionOf(missionLoad: MissionLoadResult): string | null {
  const round = missionLoad?.kind === 'found' ? missionLoad.mission.review?.rounds.at(-1) : null;
  // Unknown legacy decided revisions stay unknown; never substitute the round start.
  const revision = round?.decision?.kind === 'approved' ? round.decision.revision : null;
  return revision ? String(revision) : null;
}

/**
 * The flattened review-state snapshot the integration context read at build time.
 *
 * A rebound can change the Mission lane, round, phase and implementer after the
 * integration context was built. Reload the complete adapter-owned projection
 * at the persistence boundary; carrying only the new round leaves stale phase
 * authority in the snapshot. When the live projection is unavailable, preserve
 * the original snapshot and let the downstream writer fail closed as before.
 */
async function currentRepairState(readReviewState: IntegrateWorkflowPorts['review']['readReviewState'],
  missionStore: MissionStore | null | undefined, slug: string, worktree: string,
  snapshot: IntegrationReviewSnapshot | null | undefined): Promise<IntegrationReviewSnapshot> {
  try {
    const current = await Promise.resolve(readReviewState(slug, worktree, missionStore));
    return current ?? snapshot ?? {};
  } catch {
    return snapshot ?? {};
  }
}

/** Output kept with a withdrawn approval; enough to diagnose, bounded for storage. */
const GATE_LOG_TAIL_CHARS = 4000;

/** The typed rebound cause for a red integration gate, with its command and output tail. */
export function integrationGateFailureCause(failedGate: { key: string; command: string; stdout?: string | null; stderr?: string | null } | null | undefined) {
  const output = [failedGate?.stdout, failedGate?.stderr].filter((text): text is string => Boolean(text?.trim())).join('\n').trim();
  return {
    kind: 'integration-gate-failure' as const,
    gate: failedGate?.key ?? null,
    command: failedGate?.command ?? null,
    log: output ? output.slice(-GATE_LOG_TAIL_CHARS) : null,
  };
}

export interface GateStepRequest {
  configuration?: ParallixConfiguration;
  slug: string;
  context: IntegrationContext;
  missionLoad: MissionLoadResult;
  missionServices: IntegrationMissionServices;
  realAgent: string | null;
  realAgentModel: string | null;
  seams: IntegrateSeams;
  /** A policy-selected tests action may reselect the same check after its failed verdict is recorded. */
  retryFailedTestsWithoutRepair?: (_revision: string) => Promise<boolean>;
}

function composeIntegrationGateStepDependencies({ gates, landing, verification, git: gitPort, review }: IntegrateWorkflowPorts) {

  return { gates, landing, verification, gitPort, review };
}

export function createIntegrationGateStep(ports: IntegrateWorkflowPorts) {
  return new IntegrationGateStep(ports).surface();
}

class IntegrationGateStep {
  private readonly dependencies: ReturnType<typeof composeIntegrationGateStepDependencies>;
  constructor(ports: IntegrateWorkflowPorts) { this.dependencies = composeIntegrationGateStepDependencies(ports); }

  /**
   * Returns the Verification evidence the readiness view reports: exactly what
   * ran, never "passed" without a gate result behind it.
   */
  private async executeGatePlan({ slug, context, realAgent, realAgentModel, configuration }: GateStepRequest) {
    // The integration checkout is the mission's own worktree. Verify the
    // exact resulting tree is finalized before any gate runs, then run the
    // repository's configured pre-integration gates from that checkout.
    // An unconfigured repository runs no gate; a gate that exits non-zero
    // aborts before the merge. The live integration gate carries no
    // Node/npm/tsx/verify-local.sh/Parallix-layout assumption (TASK-2457).
    const checkout = this.dependencies.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: context.baseWorktree });
    const finalTree = this.dependencies.gates.captureFinalIntegrationTree(checkout);
    if (!finalTree.ok) {
      throw abortWith(this.dependencies.landing, `Integration gates cannot start for ${slug}: ${finalTree.error}`);
    }
    const configured = this.dependencies.gates.loadPhaseGates(checkout, 'preIntegration');
    // The mandatory-gate invariant is repository-configured, not hardcoded
    // product policy (task-2457 F11): a repository that opts in via
    // adapters.gates.requirePreIntegration: true fails closed on an empty gate
    // list; an unconfigured repository completes the integration path with
    // no lifecycle gate. The message below therefore only describes repository
    // configuration; integrate itself has no gate-execution bypass (task-2457 F12).
    const requirePreIntegration = this.dependencies.gates.loadRequirePreIntegration(checkout);
    fmt.log.debug(`Integration gate target: slug=${slug} root=${finalTree.rootDir} commit=${finalTree.commit} tree=${finalTree.tree} requirePreIntegration=${requirePreIntegration}`, configuration?.runtime.debug);

    const result = await this.dependencies.gates.runPhaseGates('integration', {
      slug,
      checkoutPath: checkout,
      targetBranch: context.baseBranch,
      gates: configured,
      log: fmt.log.plain,
      error: fmt.log.fail,
      dryRun: false,
      realAgent,
      realAgentModel,
    });

    return { checkout, configured, requirePreIntegration, result, finalTree };
  }

  async runRequiredLocalGates({ slug, context, missionLoad, missionServices, realAgent,
    realAgentModel, seams, configuration, retryFailedTestsWithoutRepair }: GateStepRequest): Promise<string> {
    const execution = await this.executeGatePlan({ slug, context, missionLoad, missionServices, realAgent, realAgentModel, seams, configuration });
    const { configured, requirePreIntegration, result } = execution;

    const disposition = integrationGateDisposition({ skipped: result.skipped, required: requirePreIntegration, ok: result.ok, cancelled: result.cancelled });

    if (disposition === 'mandatory-missing' || disposition === 'unconfigured') {
      if (disposition === 'mandatory-missing') {
        // An unconfigured or self-edited branch that removes
        // adapters.gates.preIntegration must fail closed here rather than
        // merge with "All integration gates passed." (TASK-2300 / F1).
        throw abortWith(
          this.dependencies.landing,
          `\nIntegration gates are mandatory for ${slug}: no preIntegration gates configured in workflow.config.json, but adapters.gates.requirePreIntegration is set. Configure adapters.gates.preIntegration to run gates.`,
          'Aborting before merge.',
        );
      }
      fmt.log.info(`Integration gates for ${slug}: none configured and adapters.gates.requirePreIntegration is not set — proceeding without a lifecycle gate.`);
      return 'no pre-integration gate configured';
    }
    if (disposition === 'passed') {
      if (!completeIntegrationGateRunReceipt(configured, result)) {
        await this.recordUnsuccessfulGateRun(slug, missionServices, execution);
        throw abortWith(this.dependencies.landing, `Integration dry-run gates produced incomplete or malformed execution evidence for ${slug}.`);
      }
      if (result.proofReusable !== true) {
        fmt.log.warn(`Integration dry-run gates passed for ${slug}, but reusable verification proof is unavailable for this configuration or input identity.`);
      }
      fmt.log.pass('All integration gates passed.');
      return `${configured.length} integration gate(s) passed`;
    }
    await this.recordUnsuccessfulGateRun(slug, missionServices, execution);
    if (disposition === 'cancelled') {
      throw abortWith(this.dependencies.landing, `Integration gates cancelled for ${slug}. Aborting before merge.`);
    }
    // Only the tests-action entry supplies this boundary. The failed run is
    // durable before the policy sees it; every absent, refused or failed
    // selection continues into the existing rebound owner below.
    if (await this.selectedTestsRetryWithoutRepair(execution.finalTree.commit, retryFailedTestsWithoutRepair)) {
      return 'integration gates failed; policy selected tests again without repair';
    }

    return this.repairGateFailure({ slug, context, missionLoad, missionServices, realAgent, realAgentModel, seams, configuration }, execution);
  }

  private async selectedTestsRetryWithoutRepair(commit: string | null | undefined,
    retryFailedTestsWithoutRepair: GateStepRequest['retryFailedTestsWithoutRepair']): Promise<boolean> {
    if (!commit || !retryFailedTestsWithoutRepair) { return false; }
    try { return await retryFailedTestsWithoutRepair(commit); }
    catch {
      // Policy failure preserves the existing repair route.
      return false;
    }
  }

  private async recordUnsuccessfulGateRun(slug: string, missionServices: IntegrationMissionServices,
    { finalTree, result, configured }: Awaited<ReturnType<IntegrationGateStep['executeGatePlan']>>): Promise<void> {
    const failed = result.failures?.length ? result.failures : result.failedGate ? [result.failedGate] : [];
    const hooks = failed.length ? [...new Set(failed.map(gate => gate.key))] : configured.map(gate => gate.key);
    if (!finalTree.commit || !hooks.length) { return; }
    await missionServices.operationalHistory?.recordIntegrationValidation({ missionId: slug, sha: finalTree.commit,
      hooks, failed: true });
  }

  private async repairGateFailure(request: GateStepRequest, execution: Awaited<ReturnType<IntegrationGateStep['executeGatePlan']>>): Promise<string> {
    const { slug, context, missionLoad, missionServices, realAgent, realAgentModel, seams, configuration } = request;
    const { checkout, configured, result, finalTree } = execution;
    fmt.log.fail(`\nIntegration gates failed for ${slug} (root=${finalTree.rootDir}) — ${result.error}`);
    // TASK-2492: an approved mission whose integration gate goes red is no
    // longer a dead end. The failure is classified and routed; only the
    // recoverable mission-regression route continues, and it continues
    // only because the identical gate set re-ran green.
    const implementer = await resolveBounceImplementer(slug, missionServices.store, context, checkout, seams);
    let repairStarted = false;
    const reactivateMission = async (bounceSlug: string) => {
      repairStarted = true;
      return this.reactivateRepair(bounceSlug, implementer, missionServices, result.failedGate, context, seams);
    };
    // The rebound kernel owns the transition to active, immediately before it
    // launches an implementer. In particular, a transient verifier retries on
    // the unchanged approved tree before any repair transition: a green retry
    // retains the authoritative integration lane and its approval coverage.
    // Failed retries and ordinary gate failures still enter `reactivateMission`
    // through `transitionToImplementer` before a repair can begin.
    const route = await seams.routeIntegrationGateFailureFn({
      slug,
      missionWorktree: checkout,
      executionContext: context.executionContext,
      missionStore: missionServices.store,
      verificationCommand: this.dependencies.verification.formatVerificationCommand(context.area, checkout),
      failedGate: result.failedGate,
      failedGates: result.failures?.length ? result.failures : result.failedGate ? [result.failedGate] : [],
      testedRevision: finalTree.commit ?? null,
      blockedGates: result.blocked ?? [],
      cancelledGates: result.cancelledGates ?? [],
      gateError: result.error,
      gates: configured,
      implementer,
      repositoryId: missionLoad.kind === 'found' ? String(missionLoad.mission.repositoryId) : 'unknown',
      // TASK-2528: a repair that changes the approved diff must not merge under
      // the standing approval. Parallix dismisses it on the pull request as its
      // own login (TASK-2620), so the route needs the branch and the approval
      // as read at context-build time.
      branch: context.branch,
      approval: context.approval,
      approvedRevision: approvedRevisionOf(missionLoad),
      // TASK-2555: a staleness px rebase already recorded is named, so this
      // refusal is not the first place it appears.
      reportedStaleness: missionLoad.kind === 'found' ? reportedApprovalStaleness(missionLoad.mission.review) : null,
      realAgent,
      realAgentModel,
      startAgentFn: seams.startAgentFn,
      transitionTaskFn: (bounceSlug: string) => projectBacklogTransition(context.mirrorOwnership, seams.transitionTaskFn, bounceSlug, 'active'),
      reactivateMissionFn: reactivateMission,
      assessRepairFn: () => repairStarted ? this.assessRepair(slug, checkout, context, missionServices) : Promise.resolve('not-pending'),
      applyAgentFallbackFn: async ({ launchResult, original }) => {
        const actual = launchResult?.agent;
        if (actual && actual !== original) {
          await recordImplementerLaunch(slug, actual, missionServices.store, missionServices.lifecycle);
        }
        return seams.applyAgentFallbackFn({ launchResult, original, role: 'implementer', slug,
          executionContext: context.executionContext,
          state: await currentRepairState(this.dependencies.review.readReviewState, missionServices.store,
            slug, context.executionContext.missionWorktree, context.reviewState),
          taskResolution: context.task, missionStore: missionServices.store });
      },
      // TASK-2625: when rebound verification reruns green against the fixed
      // tree, persist the sha-keyed hooks for repair/retention classification.
      // Landing admission uses the tests action's run receipt instead of this
      // marker and starts no gate. Inert when operational history is unavailable.
      recordIntegrationValidationFailureFn: async (input: { missionId: string; sha: string; hooks: readonly string[] }) => {
        await missionServices?.operationalHistory?.recordIntegrationValidation({ ...input, failed: true });
      },
      recordIntegrationValidationFn: context.missionHeadSha
        ? (input: { missionId: string; sha: string; hooks: readonly string[] }) => {
            const history = missionServices?.operationalHistory;
            if (!history) { return; }
            return history.recordIntegrationValidation(
              { ...buildIntegrationValidationMarker(input.missionId, input.sha, input.hooks),
                baseline: this.candidateBaseline(checkout, context.baseBranch, input.sha) || undefined },
            );
          }
        : undefined,
    });
    return completeGateRepairRoute({ request: { slug, context, missionLoad, missionServices, realAgent, realAgentModel, seams, configuration }, ports: this.dependencies, configured, checkout, route, reactivateMission });
  }

  private async reactivateRepair(bounceSlug: string, implementer: string, missionServices: IntegrationMissionServices,
    failedGate: Parameters<typeof integrationGateFailureCause>[0], context: IntegrationContext, seams: IntegrateSeams) {
    const current = await missionServices.store.load(missionId(bounceSlug));
    if (current.kind !== 'found') { throw new Error(`Mission ${bounceSlug} is unavailable for integration-gate rebound.`); }
    if (current.mission.status === 'active' && currentIntegrationRepair(current.mission)) { return true; }
    const occurredAt = new Date().toISOString();
    const transition = await missionServices.lifecycle.transition({
      operationId: `integration-gate-rebound:${bounceSlug}`,
      missionId: missionId(bounceSlug),
      expectedVersion: current.version,
      capabilities: new Set(['mission:transition']),
      command: { type: 'rebound-to-active', agent: agentFamily(implementer), cause: integrationGateFailureCause(failedGate), occurredAt },
      actor: implementer,
      occurredAt,
      idempotencyKey: `integration-gate-rebound:${bounceSlug}:${current.version}`,
      workflowReturn: 'integration-gates',
    });
    if (transition.status !== 'completed') { throw new Error(transition.error?.message ?? `Mission ${bounceSlug} could not rebound to active.`); }
    return projectBacklogTransition(context.mirrorOwnership, seams.transitionTaskFn, bounceSlug, 'active');
  }

  /** Compare the committed candidate against its actual base, even if the target advanced during repair. */
  private candidateBaseline(checkout: string, branch: string, revision: string): string {
    if (!branch) { return ''; }
    const result = this.dependencies.gitPort.git(['-C', checkout, 'merge-base', '--all', branch, revision]);
    const bases = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    return result.status === 0 && bases.length === 1 ? bases[0] : '';
  }

  private async assessRepair(slug: string, checkout: string, context: IntegrationContext, missionServices: IntegrationMissionServices) {
    const evidence = this.dependencies.gates.approvalEvidence?.(checkout);
    const candidate = this.dependencies.gates.captureFinalIntegrationTree(checkout);
    if (!evidence || !candidate.ok || !candidate.commit) { return 'blocked' as const; }
    const baseline = this.candidateBaseline(checkout, context.baseBranch, candidate.commit);
    const outcome = await retainIntegrationApproval({ slug, services: missionServices, evidence, worktree: checkout,
      candidate: { revision: candidate.commit, baseline }, head: () => {
        const current = this.dependencies.gates.captureFinalIntegrationTree(checkout);
        return current.ok ? current.commit ?? null : null;
      } });
    return outcome === 'not-pending' ? 'blocked' as const : outcome;
  }

  surface() {
    return { runRequiredLocalGates: this.runRequiredLocalGates.bind(this) };
  }
}
