import { gateFailureReasonFromProcess } from '../../../domain/failure-classification.js';
// Integration-gate failure routing for `px integrate` (TASK-2492, TASK-2620).
//
// A red integration gate is classified into bounded operator-facing routes;
// the recoverable route hands the failure to the rebound kernel with a fresh
// per-invocation repair budget:
//
//  1. `fixed` / `exhausted` — a mission regression inside the budget. The
//     kernel returns the mission to `active`, launches the implementer with the
//     gate evidence and the approved revision, and re-runs the identical gate
//     set. Only a passing re-run is reported `fixed`.
//  2. `stranded` — the failure could not be classified or no implementer could
//     be named.
//  3. `revision-changed` — the repair worked but changed what the reviewer
//     approved. Parallix dismisses the standing approval as its own `parallix`
//     login, and the caller re-reviews the repaired revision; an approval stops
//     the mission in the integration lane for the human. A staleness already
//     reported before integration (TASK-2555) is named rather than rediscovered.
//
// The dependency direction matches `integrate-gates.ts`: `integrate.ts` imports
// from here, never the other way round.
import * as fmt from '../../../application/presentation/cli-format.js';
import type { IntegrationApproval } from '../../../application/ports/integration-records.js';
import { missionId } from '../../../domain/mission.js';
import { rebound, type GateFailureReason, type ReboundContext, type ReboundOutcome } from '../../../application/rebound-kernel.js';
import { runPhaseGates, type GateRunOutcome, type PhaseGateRunResult, type RepositoryGate } from '../../config/repository-gates.js';
import { captureFinalIntegrationTree } from './integrate-gates.js';
import { completeIntegrationGateRunReceipt } from '../../../application/integrate/integration-gate-receipt.js';

import { invalidateApprovedPrReview, type ApprovalInvalidation } from '../../review/integration-approval-invalidation.js';
export { invalidateApprovedPrReview, type ApprovalInvalidation } from '../../review/integration-approval-invalidation.js';

/**
 * How many implementer repairs one `px integrate` invocation may spend before
 * it returns the mission to the human. The budget is deliberately small and
 * fresh every invocation: an integration gate that survives two implementer
 * repairs is evidence the diagnosis, not the code, is wrong (TASK-2620 AC5).
 *
 * This is a per-invocation bound enforced by the rebound kernel's own attempt
 * counter (`maxAttempts`), not a lifetime counter. A lifetime counter would
 * make later human resumes repair-free, which is exactly the defect AC5
 * removes: every human-initiated `px integrate` starts with this full budget.
 */
export const INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION = 2;

/**
 * `operational_history.event_type` for one spent integration-gate rebound.
 *
 * Retained as an audit label only: the enforcement budget is per-invocation
 * (TASK-2620 AC5), so nothing records or reads a lifetime count here. The log
 * is append-only and keyed on the mission id, which fixes the reset boundary
 * exactly for the audit trail: the count of these rows names how many repairs
 * a mission has ever spent, never what a fresh `px integrate` may still spend.
 */
export const INTEGRATION_GATE_REBOUND_EVENT = 'integration.gate-rebound';

export type IntegrationGateRoute =
  | { route: 'fixed' | 'retained' | 'blocked'; rebounds: number }
  | { route: 'revision-changed'; rebounds: number; approvedRevision: string; repairedRevision: string; invalidation: ApprovalInvalidation }
  | { route: 'human-only'; rebounds: number; diagnostic: string }
  | { route: 'exhausted'; rebounds: number; diagnostic: string }
  | { route: 'limit-reached'; rebounds: number }
  | { route: 'stranded'; detail: string };

// ── Failure evidence ─────────────────────────────────────────────────────────

/**
 * Whether the failed gate command is the mission's ordinary verification
 * command. When it is not, the failing test may never run under ordinary
 * mission verification, so a green verification gate is no evidence the bounce
 * is fixed — which is exactly how TASK-2483 stalled.
 */
export function integrationOnlyCoverageNote(gateCommand: string, verificationCommand: string | null): string | null {
  const gate = String(gateCommand || '').trim();
  const verify = String(verificationCommand || '').trim();
  if (!gate || !verify || gate === verify) { return null; }
  return `integration-only — this gate command is not the mission's ordinary verification command (${verify}), so the failing test is not necessarily covered by it. Reproduce with the gate command above; a green ${verify} does not close this failure.`;
}

type IntegrationGateFailureReasonOptions = {
  gateError?: string | null;
  verificationCommand?: string | null;
  approvedRevision?: string | null;
  failedGates?: readonly GateRunOutcome[];
  testedRevision?: string | null;
  blockedGates?: readonly { readonly key: string; readonly blockedBy: readonly string[] }[];
  cancelledGates?: readonly string[];
};

/** Structured gate-failure reason for the rebound kernel. */
export function integrationGateFailureReason(
  failedGate: GateRunOutcome,
  opts: IntegrationGateFailureReasonOptions = {},
): GateFailureReason {
  const coverageNote = integrationOnlyCoverageNote(failedGate.command, opts.verificationCommand ?? null);
  const reason: GateFailureReason = {
    kind: 'gate-failure',
    signal: failedGate.signal ?? null,
    failureReason: failedGate.failureReason ?? gateFailureReasonFromProcess({ status: failedGate.exitCode, signal: failedGate.signal, stdout: failedGate.stdout, stderr: failedGate.stderr }),
    area: `integration gate ${failedGate.key}`,
    command: failedGate.command,
    exitCode: failedGate.exitCode,
    stdout: failedGate.stdout,
    stderr: failedGate.stderr,
    ...integrationGateFailureContext(failedGate, opts, coverageNote),
  };
  // TASK-2620 AC4: agent-smoke runs against a shared local vLLM under
  // concurrency and flakes. Retry it once on an unchanged tree; a persistent
  // failure is an environment failure and returns to the human without
  // spending the repair budget. The gate itself stays mandatory.
  if (failedGate.key === 'agent-smoke' || failedGate.key === 'custom-agent-smoke') {
    reason.transient = true;
    reason.environment = true;
  }
  return reason;
}

function integrationGateFailureContext(failedGate: GateRunOutcome, opts: IntegrationGateFailureReasonOptions,
  coverageNote: string | null): Partial<GateFailureReason> {
  const context: Partial<GateFailureReason> = {};
  if (opts.gateError) { context.error = opts.gateError; }
  if (opts.approvedRevision !== undefined) { context.approvedRevision = opts.approvedRevision; }
  if (opts.testedRevision !== undefined) { context.testedRevision = opts.testedRevision; }
  if (opts.failedGates && opts.failedGates.length > 1) {
    context.relatedFailures = opts.failedGates.filter(gate => gate.key !== failedGate.key).map(gate => ({
      gate: gate.key, command: gate.command, exitCode: gate.exitCode,
      signal: gate.signal ?? null, stdout: gate.stdout, stderr: gate.stderr,
    }));
  }
  if (opts.blockedGates?.length) {
    context.blockedGates = opts.blockedGates.map(gate => ({ gate: gate.key, blockedBy: gate.blockedBy }));
  }
  if (opts.cancelledGates?.length) { context.cancelledGates = [...opts.cancelledGates]; }
  if (coverageNote) { context.coverageNote = coverageNote; }
  return context;
}

function integrationGateRerunFailure(result: PhaseGateRunResult, verificationCommand: string | null | undefined, approvedRevision: string | null) {
  return {
    ok: false as const,
    diagnostic: result.error ?? 'integration gates failed again',
    ...(result.failedGate ? { reason: integrationGateFailureReason(result.failedGate, { gateError: result.error, verificationCommand, approvedRevision }) } : {}),
  };
}

// ── Stale-approval dismissal (TASK-2528, TASK-2620) ─────────────────────────

/**
 * The dismissal reason. It states what happened and names both revisions so
 * the claim is checkable; it is not a review finding.
 */
export function staleApprovalSummary(slug: string, approvedRevision: string, repairedRevision: string, gateKey: string): string {
  return [
    `Integration gate \`${gateKey}\` failed for ${slug} after this approval.`,
    `The approval was given to \`${approvedRevision}\`; the integration repair produces \`${repairedRevision}\`.`,
    'Parallix dismissed this approval so the repaired revision is reviewed before it lands.',
  ].join('\n');
}

async function routeFixedIntegrationGateRebound({
  opts, failedGate, outcome, rebounds, approvedRevision, preRepairRevision, captureFinalTreeFn, invalidateApprovalFn, log, error,
}: {
  opts: IntegrationGateRouteOptions;
  failedGate: GateRunOutcome;
  outcome: ReboundOutcome;
  rebounds: number;
  approvedRevision: string | null;
  /** HEAD before the repair; an unchanged HEAD means the repair changed nothing. */
  preRepairRevision: string | null;
  captureFinalTreeFn: typeof captureFinalIntegrationTree;
  invalidateApprovalFn: typeof invalidateApprovedPrReview;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
}): Promise<IntegrationGateRoute> {
  log(fmt.status('PASS', `Integration gate ${failedGate.key} repaired by ${outcome.implementer} and re-ran green (${rebounds}/${INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION} integration-gate repairs allowed per integrate).`));
  const repairedTree = captureFinalTreeFn(opts.missionWorktree);
  const repairedRevision = committedRevision(repairedTree);
  const retention = await opts.assessRepairFn?.();
  if (retention === 'retained') { return { route: 'retained', rebounds }; }
  if (retention === 'blocked') { return { route: 'blocked', rebounds }; }
  if (retention !== 'changed' && preRepairRevision !== null && repairedRevision !== null && preRepairRevision === repairedRevision) {
    log(fmt.status('INFO', `The repair left the mission at ${preRepairRevision}, unchanged since the review approved it; the existing approval still covers what would land.`));
    return { route: 'fixed', rebounds };
  }

  const approvedLabel = approvedRevision ?? 'unknown';
  const repairedLabel = repairedRevision ?? 'unknown';
  const branch = opts.branch ?? `mission/${opts.slug}`;
  const invalidation = await invalidateApprovalFn({
    slug: opts.slug,
    branch,
    approval: opts.approval,
    approvedRevision: approvedRevision ?? undefined,
    summary: staleApprovalSummary(opts.slug, approvedLabel, repairedLabel, failedGate.key),
  });
  error(fmt.status('INFO', `The integration-gate repair of ${opts.slug} requires a fresh review: prior approved revision ${approvedLabel}, repaired revision ${repairedLabel}. The withdrawn approval cannot authorize the merge.`));
  if (opts.reportedStaleness) {
    error(fmt.status('INFO', `This approval was already reported as no longer covering the branch before integration (px status ${opts.slug}): ${opts.reportedStaleness}`));
  }
  for (const holder of invalidation.dismissed) {
    error(fmt.status('INFO', `Parallix dismissed ${holder}'s approval on ${branch}.`));
  }
  for (const problem of invalidation.errors) {
    error(fmt.status('WARN', `Provider approval was not updated: ${problem}. The old local decision remains invalid; the fresh review excludes it.`));
  }
  reportFreshReviewRoute(opts, invalidation, repairedLabel, log, error);
  return { route: 'revision-changed', rebounds, approvedRevision: approvedLabel, repairedRevision: repairedLabel, invalidation };
}

function committedRevision(tree: ReturnType<typeof captureFinalIntegrationTree>): string | null {
  return tree.ok ? (tree.commit ?? null) : null;
}

function reportFreshReviewRoute(opts: IntegrationGateRouteOptions, invalidation: ApprovalInvalidation, repairedLabel: string, log: (_msg: string) => void, error: (_msg: string) => void): void {
  if (!(opts.reReviewFollows && invalidation.ok)) {
    error(fmt.status('INFO', `${opts.slug} must go back through review: run px review ${opts.slug} to review the repaired revision ${repairedLabel}; an approval returns it to the integration lane.`));
  }
  // TASK-2550: the consumer (the integration gate step) now resumes the
  // review of the repaired revision automatically; the route no longer tells
  // the operator to re-run px review by hand. It reports the fact, and the
  // gate step reports the action it takes (or the fallback when no reviewer
  // can be named).
  if (opts.reReviewFollows && invalidation.ok) {
    log(fmt.status('INFO', `The repair is recoverable: the workflow resumes review of the repaired revision ${repairedLabel} automatically (automatic revbounce).`));
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export interface IntegrationGateRouteOptions {
  slug: string;
  /** Mission checkout the failed gates ran from. */
  missionWorktree: string;
  /** The mission's ordinary verification command, for the coverage note. */
  verificationCommand?: string | null;
  failedGate: GateRunOutcome | null | undefined;
  failedGates?: readonly GateRunOutcome[];
  testedRevision?: string | null;
  blockedGates?: readonly { readonly key: string; readonly command: string; readonly blockedBy: readonly string[] }[];
  cancelledGates?: readonly string[];
  gateError?: string | null;
  /** The full configured gate set, re-run verbatim to verify a repair. */
  gates: RepositoryGate[];
  implementer: string;
  repositoryId: string;
  /** The commit the withdrawn approval was given to, from the review record. */
  approvedRevision?: string | null;
  /** Mission pull-request branch, for dismissing a stale approval (TASK-2528). */
  branch?: string | null;
  /** Provider approval as read at context-build time (TASK-2528). */
  approval?: IntegrationApproval | null;
  /** Staleness already reported for this approval before integration (TASK-2555), named in the refusal. */
  reportedStaleness?: string | null;
  /** The caller re-reviews a changed revision itself, so no manual instruction is printed. */
  reReviewFollows?: boolean;
  realAgent?: string | null;
  realAgentModel?: string | null;
  startAgentFn: ReboundContext['startAgent'];
  transitionTaskFn: (_slug: string) => Promise<unknown> | unknown;
  /** Authoritative lifecycle transition followed by an optional Backlog mirror. */
  assessRepairFn?: () => Promise<'retained' | 'changed' | 'blocked' | 'not-pending'>;
  reactivateMissionFn?: (_slug: string) => Promise<unknown> | unknown;
  applyAgentFallbackFn?: ReboundContext['applyAgentFallback'];
  // TASK-2625: when the verify rerun goes green against the fixed tree, record
  // a durable, sha-keyed whitelist of the validated hooks so a later integrate
  // can skip them. Injected so tests exercise the routing without a database.
  recordIntegrationValidationFailureFn?: (_input: { missionId: string; sha: string; hooks: readonly string[] }) => Promise<void> | void;
  recordIntegrationValidationFn?: (_input: {
    missionId: string;
    sha: string;
    hooks: readonly string[];
  }) => Promise<void> | void;
  // Injected so tests exercise the routing without a database, an agent, or a
  // second gate execution.
  runPhaseGatesFn?: typeof runPhaseGates;
  captureFinalTreeFn?: typeof captureFinalIntegrationTree;
  reboundFn?: typeof rebound;
  invalidateApprovalFn?: typeof invalidateApprovedPrReview;
  /** Receive `fmt.status(...)` lines. */
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  /** Receive the gate runner's raw text. */
  gateRunLog?: (_msg: string) => void;
  gateRunError?: (_msg: string) => void;
}

/**
 * Classify one failed integration-gate run and take the single action its class
 * allows. Returns the route taken; the caller aborts before merge for every
 * route except `fixed`.
 */
export async function routeIntegrationGateFailure(opts: IntegrationGateRouteOptions): Promise<IntegrationGateRoute> {
  const {
    missionWorktree,
    failedGate,
    captureFinalTreeFn = captureFinalIntegrationTree,
    reboundFn = rebound,
    invalidateApprovalFn = invalidateApprovedPrReview,
    log = fmt.log.plain,
    error = fmt.log.plainError,
  } = opts;

  const stranded = integrationGateStrandedRoute(opts, error);
  if (stranded) { return stranded; }
  const routedGate = failedGate as GateRunOutcome;

  // The revision the reviewer's approval was given to, observed before the
  //    implementer touches the worktree. Comparing it with the revision the
  //    repair leaves behind is the only truthful way to tell a repaired diff
  //    from an unchanged retry (TASK-2528); an unreadable tree is treated as
  //    changed, because "unchanged" is the claim that must be proven.
  const approvedTree = captureFinalTreeFn(missionWorktree);
  const preRepairRevision = committedRevision(approvedTree);
  // The revision the reviewer approved (A); HEAD may already carry bookkeeping after it.
  const approvedRevision = opts.approvedRevision ?? preRepairRevision;
  const failedGates = opts.failedGates?.length ? [...opts.failedGates] : [routedGate];
  const failureReasons = failedGates.map(gate => integrationGateFailureReason(gate, {
    gateError: opts.gateError, verificationCommand: opts.verificationCommand, approvedRevision,
    testedRevision: opts.testedRevision ?? preRepairRevision,
  }));

  const outcome = await reboundFn(
    integrationGateFailureReason(routedGate, { gateError: opts.gateError, verificationCommand: opts.verificationCommand,
      approvedRevision, failedGates, testedRevision: opts.testedRevision ?? preRepairRevision,
      blockedGates: opts.blockedGates, cancelledGates: opts.cancelledGates }),
    integrationReboundContext(opts, failedGates, failureReasons, approvedRevision, preRepairRevision,
      captureFinalTreeFn, log, error),
  );
  return settleIntegrationGateRebound({ opts, failedGate: routedGate, outcome, approvedRevision, preRepairRevision,
    captureFinalTreeFn, invalidateApprovalFn, log, error });
}

function integrationGateStrandedRoute(opts: IntegrationGateRouteOptions,
  error: (_message: string) => void): Extract<IntegrationGateRoute, { route: 'stranded' }> | null {
  if (!opts.failedGate) {
    error(fmt.status('FAIL', `Integration gates failed for ${opts.slug} without naming a failed gate; nothing to bounce. Human action required.`));
    return { route: 'stranded', detail: 'no failed gate recorded' };
  }
  // A fresh bounded repair budget starts per `px integrate`; no lifetime counter
  // is read or spent, so a later human resume starts with the full budget again.
  if (!opts.implementer) {
    error(fmt.status('FAIL', `No implementer could be named for ${opts.slug}; not bouncing the integration gate failure. Human action required.`));
    return { route: 'stranded', detail: 'no implementer resolvable' };
  }
  return null;
}

function integrationReboundContext(opts: IntegrationGateRouteOptions, failedGates: readonly GateRunOutcome[],
  failureReasons: readonly GateFailureReason[], approvedRevision: string | null, preRepairRevision: string | null,
  captureFinalTreeFn: typeof captureFinalIntegrationTree, log: (_message: string) => void,
  error: (_message: string) => void): ReboundContext {
  return {
    slug: opts.slug,
    worktree: opts.missionWorktree,
    implementer: opts.implementer,
    returnStage: 'integration-gates',
    head: opts.testedRevision ?? preRepairRevision ?? undefined,
    readHead: () => committedRevision(captureFinalTreeFn(opts.missionWorktree)),
    ...(opts.testedRevision ? { repairIncidentId: `integration:${opts.testedRevision}` } : {}),
    ...(opts.failedGates && failedGates.length > 1 ? {
      repairObligations: failedGates.map((gate, index) => ({ gateKey: gate.key, reason: failureReasons[index] })),
    } : {}),
    maxAttempts: INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION,
    startAgent: opts.startAgentFn,
    transitionToImplementer: opts.reactivateMissionFn ?? opts.transitionTaskFn,
    ...(opts.applyAgentFallbackFn ? { applyAgentFallback: opts.applyAgentFallbackFn } : {}),
    verify: createRepairVerifier(opts, failedGates, approvedRevision, log),
    log,
    error,
  };
}

async function settleIntegrationGateRebound({ opts, failedGate, outcome, approvedRevision, preRepairRevision,
  captureFinalTreeFn, invalidateApprovalFn, log, error }: {
  opts: IntegrationGateRouteOptions; failedGate: GateRunOutcome; outcome: ReboundOutcome;
  approvedRevision: string | null; preRepairRevision: string | null;
  captureFinalTreeFn: typeof captureFinalIntegrationTree; invalidateApprovalFn: typeof invalidateApprovedPrReview;
  log: (_message: string) => void; error: (_message: string) => void;
}): Promise<IntegrationGateRoute> {
  const rebounds = outcome.attempts;
  if (outcome.outcome === 'fixed') {
    return routeFixedIntegrationGateRebound({ opts, failedGate, outcome, rebounds, approvedRevision,
      preRepairRevision, captureFinalTreeFn, invalidateApprovalFn, log, error });
  }
  if (outcome.outcome === 'human-only') {
    error(fmt.status('FAIL', `Integration gate ${failedGate.key} requires human action for ${opts.slug}: ${outcome.diagnostic}. No repair agent was launched.`));
    return { route: 'human-only', rebounds, diagnostic: outcome.diagnostic };
  }
  await withdrawChangedExhaustedRepair(opts, failedGate, approvedRevision, captureFinalTreeFn, invalidateApprovalFn);
  error(fmt.status('FAIL', `Integration gate ${failedGate.key} still fails for ${opts.slug} after ${rebounds} repair(s) within this integrate's bounded budget. Address the failed gate, then run px integrate ${opts.slug} again for a fresh repair budget, or px review ${opts.slug} once the gate is fixed.`));
  return { route: 'exhausted', rebounds, diagnostic: outcome.diagnostic };
}

function greenGateRun(result: PhaseGateRunResult): boolean { return result.ok && !result.cancelled && !result.skipped; }

function createRepairVerifier(opts: IntegrationGateRouteOptions, failedGates: readonly GateRunOutcome[],
  approvedRevision: string | null, log: (_message: string) => void): ReboundContext['verify'] {
  const { missionWorktree, slug, gates, captureFinalTreeFn = captureFinalIntegrationTree, runPhaseGatesFn = runPhaseGates } = opts;
  let requiredCommand = failedGates[0].command;
  return async () => {
    const tree = captureFinalTreeFn(missionWorktree);
    if (!tree.ok) { return { ok: false, diagnostic: `The repair is not committed, so the integration gates cannot re-run: ${tree.error}` }; }
    const rerun = await runPhaseGatesFn('integration', { slug, checkoutPath: missionWorktree, gates,
      log: opts.gateRunLog ?? fmt.log.plain, error: opts.gateRunError ?? fmt.log.fail,
      realAgent: opts.realAgent, realAgentModel: opts.realAgentModel });
    const after = captureFinalTreeFn(missionWorktree);
    if (!after.ok || after.commit !== tree.commit) { return { ok: false, diagnostic: 'Mission tree changed during integration verification' }; }
    if (failedGates.length > 1 && greenGateRun(rerun) && !completeIntegrationGateRunReceipt(gates, rerun)) {
      return { ok: false, command: requiredCommand, diagnostic: 'Aggregate integration rerun did not return complete passing coverage for every configured gate' };
    }
    await recordRepairValidation(opts, tree.commit, rerun, failedGates[0], log);
    if (greenGateRun(rerun)) {
      return { ok: true, command: requiredCommand, diagnostic: '',
        exactExecutions: failedGates.map(gate => ({ command: gate.command, worktree: missionWorktree, exitCode: 0 as const })) };
    }
    if (rerun.failedGate) { requiredCommand = rerun.failedGate.command; }
    return integrationGateRerunFailure(rerun, opts.verificationCommand, approvedRevision);
  };
}

async function recordRepairValidation(opts: IntegrationGateRouteOptions, sha: string | undefined,
  rerun: PhaseGateRunResult, failedGate: GateRunOutcome, log: (_message: string) => void): Promise<void> {
  if (!sha) { return; }
  if (!greenGateRun(rerun)) {
    try { await opts.recordIntegrationValidationFailureFn?.({ missionId: missionId(opts.slug), sha, hooks: [rerun.failedGate?.key ?? failedGate.key] }); }
    catch { /* Missing failure history never proves green. */ }
    return;
  }
  try { await opts.recordIntegrationValidationFn?.({ missionId: missionId(opts.slug), sha, hooks: opts.gates.map(gate => gate.key) }); }
  catch (error) { log(`Could not record integration-validation marker for ${opts.slug}: ${String(error)}. The full suite runs next time.`); }
}

async function withdrawChangedExhaustedRepair(opts: IntegrationGateRouteOptions, failedGate: GateRunOutcome,
  approvedRevision: string | null, captureFinalTreeFn: typeof captureFinalIntegrationTree, invalidateApprovalFn: typeof invalidateApprovedPrReview): Promise<void> {
  if (await opts.assessRepairFn?.() !== 'changed') { return; }
  await invalidateApprovalFn({ slug: opts.slug, branch: opts.branch ?? `mission/${opts.slug}`, approval: opts.approval,
    approvedRevision: approvedRevision ?? undefined,
    summary: staleApprovalSummary(opts.slug, approvedRevision ?? 'unknown', committedRevision(captureFinalTreeFn(opts.missionWorktree)) ?? 'unknown', failedGate.key) });
}
