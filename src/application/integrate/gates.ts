import type { ParallixConfiguration } from '../ports/configuration.js';
import { integrationGateDisposition, integrationRepairRoute, integrationRepairMustReactivate, repairedRevisionReviewEligible, repairCanResumeIntegration } from '../../domain/integration-gate-policy.js';
/**
 * The required local integration gates: run the repository's configured
 * pre-integration gates against the finalized mission tree and route a red
 * gate through the integration-gate rebound (TASK-2492).
 */
import * as fmt from '../presentation/cli-format.js';
import { missionId } from '../../domain/mission.js';
import { integrationRepairNeedsReview } from '../integration-repair-review.js';
import { reportedApprovalStaleness } from '../approval-coverage.js';
import { abortWith, resolveBounceImplementer, type BounceSeams } from './support.js';
import {
  INTEGRATION_VALIDATION_EVENT_TYPE,
  buildIntegrationValidationMarker,
  partitionGatesForSkip,
  parseIntegrationValidationMarker,
  validationSkipApplies,
  type ValidatedCommitDiff,
} from './validation-marker.js';
import type { IntegrateGatesPort, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';
import type { MissionStore } from '../domain-ports.js';
import type { OperationalHistoryService } from '../services/operational-history-service.js';

/**
 * Minimal shape of a configured gate the skip resolver needs. Kept local to
 * avoid an application→adapter import (ADR 0037); the value returned by
 * `gates.loadPhaseGates` structurally matches it.
 */
interface SkippableGate {
  readonly key: string;
}

export interface IntegrateSeams extends BounceSeams {
  routeIntegrationGateFailureFn: IntegrateGatesPort['routeIntegrationGateFailure'];
  /**
   * Send a repaired revision back through review — the same review
   * `px review <slug> --start` runs — and report whether it came back approved.
   * Absent, a changed revision stops integration for the operator to re-review.
   *
   * TASK-2620: the single live re-review route. On approval the mission stays
   * in the integration lane for the human to read the fresh PR and integrate;
   * it never auto-restarts integration or merges.
   */
  reReviewFn?: (_slug: string, _worktree: string) => Promise<boolean>;
}

/**
 * Thrown by the integration gate step to stop the run in the integration lane
 * once a repaired revision is re-approved: the mission is ready for the human
 * to read the fresh PR and integrate, so no landing/merge happens in this
 * invocation (TASK-2620 AC2). The workflow catches it and returns a clean
 * stop with a human next action.
 */
export class IntegrationStopsForHuman extends Error {
  constructor(readonly message: string) {
    super(message);
    this.name = 'IntegrationStopsForHuman';
  }
}

/** The commit the mission's current approval was given to, when one is recorded. */
function approvedRevisionOf(missionLoad: any): string | null {
  const round = missionLoad?.kind === 'found' ? missionLoad.mission.review?.rounds.at(-1) : null;
  // A legacy round may record no reviewed subject; then HEAD stands in for A.
  const revision = round?.decision?.kind === 'approved' ? round.subject?.revision : null;
  return revision ? String(revision) : null;
}

/**
 * The flattened review-state snapshot the integration context read at build time.
 *
 * TASK-2642: the rebound repair advances the live review aggregate to a new
 * current round, but this snapshot is read once at context-build and keeps its
 * original round. Persisting a round lower than the aggregate's current round
 * trips the stale-flattened-write guard (TASK-2385) and drops the repair's
 * identity write. Align the snapshot to the live current round so the fallback
 * lands on the round the repair is actually on. When no live aggregate is
 * available the snapshot is returned unchanged.
 */
async function currentRepairState(missionStore: MissionStore | null | undefined, slug: string, snapshot: Record<string, unknown> | null | undefined): Promise<Record<string, unknown>> {
  // The rebound changes the aggregate after the integration context was built.
  // Load it at the persistence boundary rather than reusing that stale read.
  let missionLoad;
  try {
    missionLoad = missionStore ? await missionStore.load(missionId(slug)) : null;
  } catch {
    return snapshot ?? {};
  }
  const currentNumber = missionLoad?.kind === 'found' ? missionLoad.mission.review?.rounds.at(-1)?.number : undefined;
  if (currentNumber !== undefined) {
    return { ...snapshot, round: currentNumber };
  }
  return snapshot ?? {};
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
  context: any;
  missionLoad: any;
  missionServices: any;
  dryRun: boolean;
  noIntegrationGates: boolean;
  realAgent: string | null;
  realAgentModel: string | null;
  seams: IntegrateSeams;
}

export function createIntegrationGateStep({ gates, landing, verification }: IntegrateWorkflowPorts) {
  /**
   * Decide which of the configured preIntegration gates to run, applying the
   * TASK-2625 skip: when a durable, sha-keyed marker records that this mission
   * already ran some hooks green on a tree that still covers the finalized
   * commit, only the not-yet validated hooks run. The decision is pure over the
   * marker, the finalized commit, and the paths that differ between them — no
   * repo, branch, or mission-slug special-casing — and every fallback (marker
   * missing or unreadable, whitelist empty, git diff failed, substantive diff)
   * runs the full configured set.
   *
   * @param finalizedCommit the finalized integration tree commit the gates will
   *   run against (post-rebase HEAD). A commit other than the validated one is
   *   covered only when the two trees differ solely in bookkeeping paths
   *   (TASK-2646); a rebase that changes code, tests, or configuration never
   *   skips a suite that did not run against the new tree (TASK-2625 F2).
   */
  async function resolveSkippableGates({
    configured,
    slug,
    checkout,
    finalizedCommit,
    operationalHistory,
    log,
  }: {
    configured: SkippableGate[];
    slug: string;
    checkout: string;
    finalizedCommit: string | null | undefined;
    operationalHistory: OperationalHistoryService | null | undefined;
    log: (_message: string) => void;
  }): Promise<{ gates: SkippableGate[]; skippedAll: boolean }> {
    const full = { gates: configured, skippedAll: false };
    if (!finalizedCommit || !operationalHistory) { return full; }
    let markerEntry: { eventType?: string; eventData?: string } | null = null;
    try {
      markerEntry = await operationalHistory.loadLatestByTypeForMission(INTEGRATION_VALIDATION_EVENT_TYPE, missionId(slug));
    } catch {
      // An unreadable history must never authorize a skip: fall back to the full
      // suite rather than silently running nothing.
      return full;
    }
    const marker = parseIntegrationValidationMarker(markerEntry);
    if (!marker) { return full; }
    const diff = marker.sha === finalizedCommit ? null : diffFromValidated(checkout, marker.sha, finalizedCommit);
    if (!validationSkipApplies(marker, finalizedCommit, diff)) { return full; }
    const { skip, run } = partitionGatesForSkip(configured.map(gate => gate.key), marker);
    const coverage = diff ? ` (finalized ${finalizedCommit.slice(0, 12)} differs only in backlog bookkeeping)` : '';
    log(`Integration gates for ${slug}: ${skip.length} hook(s) already validated at ${marker.sha.slice(0, 12)}${coverage}; skipping ${skip.join(', ')}.`);
    const toRun = run.map(key => configured.find(gate => gate.key === key) as SkippableGate);
    return { gates: toRun, skippedAll: toRun.length === 0 };
  }

  /** The validated-to-finalized path diff; any git failure reads as `ok: false` (fail open). */
  function diffFromValidated(checkout: string, validatedSha: string, finalizedCommit: string): ValidatedCommitDiff {
    try {
      return gates.listChangedPathsBetween(checkout, validatedSha, finalizedCommit);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  /**
   * Returns the Verification evidence the readiness view reports: exactly what
   * ran, never "passed" without a gate result behind it.
   */
  async function runRequiredLocalGates({ slug, context, missionLoad, missionServices, dryRun, noIntegrationGates, realAgent, realAgentModel, seams, configuration }: GateStepRequest): Promise<string> {
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
    fmt.log.debug(`Integration gate target: slug=${slug} root=${finalTree.rootDir} commit=${finalTree.commit} tree=${finalTree.tree} requirePreIntegration=${requirePreIntegration}`, configuration?.runtime.debug);

    // TASK-2625/TASK-2646: skip the high-level hooks this mission already ran
    // green on a tree that differs from the finalized one at most in backlog
    // bookkeeping. Every other case runs the full configured set.
    const gatesToRun = await resolveSkippableGates({
      configured,
      slug,
      checkout,
      // Key the skip on the finalized (post-rebase) tree the gates run against,
      // not the pre-rebase HEAD: a rebase that changes the tree must not let the
      // mission skip a suite that never ran against the new tree (TASK-2625 F2).
      finalizedCommit: finalTree.commit ?? null,
      operationalHistory: (missionServices as { operationalHistory?: OperationalHistoryService | null } | null | undefined)?.operationalHistory ?? null,
      log: fmt.log.plain,
    });
    const result = await gates.runPhaseGates('integration', {
      slug,
      checkoutPath: checkout,
      gates: gatesToRun.gates,
      log: fmt.log.plain,
      error: fmt.log.fail,
      // Plan-only dry run executes nothing; self-development agent selection
      // reaches the gate environment via buildGateEnv (F4 / TASK-2269).
      dryRun,
      realAgent,
      realAgentModel,
    });

    const disposition = integrationGateDisposition({ dryRun, skippedAll: gatesToRun.skippedAll, skipped: result.skipped, required: requirePreIntegration, ok: result.ok, cancelled: result.cancelled });
    if (disposition === 'plan') {
      fmt.log.info(`Integration gate plan resolved for ${slug}: ${gatesToRun.gates.length} gate(s) configured; nothing executed.`);
      return 'no gate ran';
    }

    // TASK-2625: every configured hook was already validated green, so nothing
    // ran. This is a deliberate skip, not the "none configured" case, so it
    // must not trip the mandatory-gate fail-closed path below.
    if (disposition === 'validated') {
      return 'all validated integration hooks skipped';
    }
    if (disposition === 'mandatory-missing' || disposition === 'unconfigured') {
      if (disposition === 'mandatory-missing') {
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
    if (disposition === 'passed') {
      fmt.log.pass('All integration gates passed.');
      return `${gatesToRun.gates.length} integration gate(s) passed`;
    }
    if (disposition === 'cancelled') {
      throw abortWith(landing, `Integration gates cancelled for ${slug}. Aborting before merge.`);
    }

    fmt.log.fail(`\nIntegration gates failed for ${slug} (root=${finalTree.rootDir}) — ${result.error}`);
    // TASK-2492: an approved mission whose integration gate goes red is no
    // longer a dead end. The failure is classified and routed; only the
    // recoverable mission-regression route continues, and it continues
    // only because the identical gate set re-ran green.
    const implementer = resolveBounceImplementer(context.taskAssignee ?? null, checkout, seams);
    const reactivateMission = async (bounceSlug: string) => {
      const current = await missionServices.store.load(missionId(bounceSlug));
      if (current.kind !== 'found') { throw new Error(`Mission ${bounceSlug} is unavailable for integration-gate rebound.`); }
      if (current.mission.status === 'active' && integrationRepairNeedsReview(current.mission)) { return true; }
      const occurredAt = new Date().toISOString();
      const transition = await missionServices.lifecycle.transition({
        operationId: `integration-gate-rebound:${bounceSlug}`,
        missionId: missionId(bounceSlug),
        expectedVersion: current.version,
        capabilities: new Set(['mission:transition']),
        command: { type: 'rebound-to-active', agent: implementer, cause: integrationGateFailureCause(result.failedGate), occurredAt },
        actor: implementer,
        occurredAt,
        idempotencyKey: `integration-gate-rebound:${bounceSlug}:${current.version}`,
      });
      if (transition.status !== 'completed') { throw new Error(transition.error?.message ?? `Mission ${bounceSlug} could not rebound to active.`); }
      return seams.transitionTaskFn(bounceSlug, 'active');
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
      verificationCommand: verification.formatVerificationCommand(context.area, checkout),
      failedGate: result.failedGate,
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
      transitionTaskFn: (bounceSlug: string) => seams.transitionTaskFn(bounceSlug, 'active'),
      reactivateMissionFn: reactivateMission,
      applyAgentFallbackFn: async ({ launchResult, original }: { launchResult: unknown; original: string }) => seams.applyAgentFallbackFn({
        launchResult,
        original,
        role: 'implementer',
        slug,
        worktree: checkout,
        state: await currentRepairState(missionServices.store, slug, context.reviewState),
        taskResolution: context.task,
        missionStore: missionServices.store,
      }),
      // TASK-2625: when the rebound verify reruns green against the fixed tree,
      // persist the sha-keyed whitelist of validated hooks so a later integrate
      // can skip them. Keyed on the fix commit the rerun ran against. Inert
      // when the operational-history store is unavailable (older callers).
      recordIntegrationValidationFn: context.missionHeadSha
        ? (input: { missionId: string; sha: string; hooks: readonly string[] }) => {
            const history = (missionServices as { operationalHistory?: OperationalHistoryService | null | undefined } | null | undefined)?.operationalHistory;
            if (!history) { return; }
            return history.recordIntegrationValidation(
              buildIntegrationValidationMarker(input.missionId, input.sha, input.hooks),
            );
          }
        : undefined,
    });
    // A route that cannot continue landing must leave the authoritative lane
    // in active repair state. The live rebound reaches this through
    // `transitionToImplementer`; retain the same fail-closed outcome for
    // exhausted transient retries and injected routing boundaries that did
    // not launch a repair.
    const repairRoute = integrationRepairRoute(route.route, Boolean(seams.reReviewFn));
    if (repairRoute !== 'resume' && missionServices?.store) {
      const failedMission = await missionServices.store.load(missionId(slug));
      if (failedMission.kind === 'found' && integrationRepairMustReactivate(route.route, failedMission.mission.status)) {
        await reactivateMission(slug);
      }
    }
    if (repairRoute === 're-review' && seams.reReviewFn) {
      // The repair changed what the reviewer approved, so the standing approval
      // was retracted on the PR. Re-review the repaired revision through the
      // single live `px review --continue` route. On approval the mission sits
      // in the integration lane for the human to read the fresh PR and
      // integrate; no path auto-restarts integration or merges (TASK-2620 AC2).
      const current = route.invalidation?.ok ? null : await missionServices?.store?.load(missionId(slug));
      if (repairedRevisionReviewEligible(Boolean(route.invalidation?.ok), current?.kind === 'found' && integrationRepairNeedsReview(current.mission))) {
        const approved = await reReviewRepairedRevision(slug, checkout, route.repairedRevision ?? 'unknown', seams.reReviewFn);
        if (approved) {
          throw new IntegrationStopsForHuman(`${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s); the repaired revision was re-reviewed and approved. Read the fresh PR and run px integrate ${slug} to land.`);
        }
        throw abortWith(landing, `The repaired revision of ${slug} was not approved in re-review. Run px review ${slug} --continue to resume review; an approval returns the mission to the integration lane for you to integrate.`, 'Aborting before merge.');
      }
      throw abortWith(landing, `The approval for ${slug}'s superseded revision could not be retracted. Aborting before merge.`);
    }
    if (repairRoute === 'stop') {
      throw abortWith(landing, `Aborting before merge. Resume the repair review with px review ${slug} --continue; an approval returns the mission to the integration lane for you to integrate.`);
    }
    // A route may report `fixed` only if the repair left the approved diff
    // unchanged and its approval was never retracted. Restore the mission to
    // the integration lane through the authoritative lifecycle guard so a
    // legacy or injected route cannot claim a green gate while the mission is
    // still in its active repair lane.
    const repaired = await missionServices.store.load(missionId(slug));
    if (repaired.kind !== 'found') { throw abortWith(landing, `Mission ${slug} is unavailable after integration repair.`); }
    if (!repairCanResumeIntegration(repaired.mission.status)) {
      throw abortWith(landing, `Mission ${slug} cannot resume integration from ${repaired.mission.status}.`);
    }
    await seams.transitionTaskFn(slug, 'ready-for-integration');
    return `${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s)`;
  }

  /**
   * The repair changed what the reviewer approved, and its approval is
   * retracted. Review the repaired revision now instead of stranding the
   * mission for an operator: nothing is approved on the reviewer's behalf,
   * and the superseded approval stays in the review history.
   */
  async function reReviewRepairedRevision(slug: string, checkout: string, repairedRevision: string, reReviewFn: NonNullable<IntegrateSeams['reReviewFn']>): Promise<boolean> {
    fmt.log.info(`Sending ${slug} back through review for the repaired revision ${repairedRevision}.`);
    let approved = false;
    try {
      approved = await reReviewFn(slug, checkout);
    } catch (error) {
      throw abortWith(landing, `Re-review of ${slug} could not run: ${(error as Error).message}`, `Run px review ${slug} --continue to resume review; an approval returns the mission to the integration lane for you to integrate.`, 'Aborting before merge.');
    }
    if (!approved) {
      throw abortWith(landing, `The repaired revision of ${slug} was not approved in re-review. Run px review ${slug} --continue to resume review; an approval returns the mission to the integration lane for you to integrate.`, 'Aborting before merge.');
    }
    fmt.log.pass(`The repaired revision of ${slug} was re-reviewed and approved. ${slug} now sits in the integration lane for the human to read the fresh PR and integrate (TASK-2620).`);
    return true;
  }

  return { runRequiredLocalGates, resolveSkippableGates };
}
