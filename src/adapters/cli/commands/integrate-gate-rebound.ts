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
import { rebound, type GateFailureReason, type ReboundContext } from '../../../application/rebound-kernel.js';
import { runPhaseGates, type GateRunOutcome, type RepositoryGate } from '../../config/repository-gates.js';
import { captureFinalIntegrationTree } from './integrate-gates.js';

import { dismissStandingApprovals, readToken } from '../../forgejo/forgejo.js';
import { PARALLIX_FORGEJO_USER } from '../../review/setup-review-repository.js';

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
  | { route: 'fixed'; rebounds: number }
  | { route: 'revision-changed'; rebounds: number; approvedRevision: string; repairedRevision: string; invalidation: ApprovalInvalidation }
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

/** Structured gate-failure reason for the rebound kernel. */
export function integrationGateFailureReason(
  failedGate: GateRunOutcome,
  opts: { gateError?: string | null; verificationCommand?: string | null; approvedRevision?: string | null } = {},
): GateFailureReason {
  const coverageNote = integrationOnlyCoverageNote(failedGate.command, opts.verificationCommand ?? null);
  const reason: GateFailureReason = {
    kind: 'gate-failure',
    area: `integration gate ${failedGate.key}`,
    command: failedGate.command,
    exitCode: failedGate.exitCode,
    stdout: failedGate.stdout,
    stderr: failedGate.stderr,
    ...(opts.gateError ? { error: opts.gateError } : {}),
    ...(opts.approvedRevision !== undefined ? { approvedRevision: opts.approvedRevision } : {}),
    ...(coverageNote ? { coverageNote } : {}),
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

// ── Stale-approval dismissal (TASK-2528, TASK-2620) ─────────────────────────

export interface ApprovalInvalidation {
  /** False when at least one standing approval could not be dismissed. */
  ok: boolean;
  /** Logins whose approval Parallix dismissed. */
  dismissed: string[];
  errors: string[];
}

/**
 * Dismiss the standing approvals on the mission pull request as the dedicated
 * `parallix` Forgejo login, through the review dismissal API.
 *
 * Parallix never posts a review as another login and never writes a finding
 * nobody raised: the approval is dismissed with the integration failure as
 * the stated reason. A missing `parallix` token is an error, not a silent skip
 * — an undismissed approval must fail closed so the changed revision cannot
 * land under it.
 */
export async function invalidateApprovedPrReview(opts: {
  slug: string;
  branch: string;
  approval: any;
  summary: string;
  readTokenFn?: typeof readToken;
  dismissFn?: typeof dismissStandingApprovals;
}): Promise<ApprovalInvalidation> {
  const { readTokenFn = readToken, dismissFn = dismissStandingApprovals } = opts;
  if (opts.approval?.ok !== true) { return { ok: true, dismissed: [], errors: [] }; }
  const token = readTokenFn(PARALLIX_FORGEJO_USER);
  if (!token) {
    return { ok: false, dismissed: [], errors: [`no Forgejo token for ${PARALLIX_FORGEJO_USER}; run px setup-review to create the ${PARALLIX_FORGEJO_USER} user so it can dismiss the standing approval on ${opts.branch}`] };
  }
  const result = dismissFn(opts.branch, token, opts.summary, { forgejoUser: PARALLIX_FORGEJO_USER });
  return { ok: result.ok, dismissed: result.dismissed, errors: result.errors };
}

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
  opts, failedGate, outcome, rebounds, approvedRevision, preRepairRevision, captureFinalTreeFn, invalidateApprovalFn, initialInvalidation, log, error,
}: {
  opts: IntegrationGateRouteOptions;
  failedGate: GateRunOutcome;
  outcome: any;
  rebounds: number;
  approvedRevision: string | null;
  /** HEAD before the repair; an unchanged HEAD means the repair changed nothing. */
  preRepairRevision: string | null;
  captureFinalTreeFn: typeof captureFinalIntegrationTree;
  invalidateApprovalFn: typeof invalidateApprovedPrReview;
  initialInvalidation: ApprovalInvalidation | null;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
}): Promise<IntegrationGateRoute> {
  log(fmt.status('PASS', `Integration gate ${failedGate.key} repaired by ${outcome.implementer} and re-ran green (${rebounds}/${INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION} integration-gate repairs allowed per integrate).`));
  const repairedTree = captureFinalTreeFn(opts.missionWorktree);
  const repairedRevision = repairedTree.ok ? (repairedTree.commit ?? null) : null;
  if (!initialInvalidation && preRepairRevision !== null && repairedRevision !== null && preRepairRevision === repairedRevision) {
    log(fmt.status('INFO', `The repair left the mission at ${preRepairRevision}, unchanged since the review approved it; the existing approval still covers what would land.`));
    return { route: 'fixed', rebounds };
  }

  const approvedLabel = approvedRevision ?? 'unknown';
  const repairedLabel = repairedRevision ?? 'unknown';
  const branch = opts.branch ?? `mission/${opts.slug}`;
  const invalidation = initialInvalidation ?? await invalidateApprovalFn({
    slug: opts.slug,
    branch,
    approval: opts.approval,
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
  if (!(opts.reReviewFollows && invalidation.ok)) {
    error(fmt.status('INFO', `${opts.slug} must go back through review: run px review ${opts.slug} --continue to review the repaired revision ${repairedLabel}; an approval returns it to the integration lane.`));
  }
  // TASK-2550: the consumer (the integration gate step) now resumes the
  // review of the repaired revision automatically; the route no longer tells
  // the operator to re-run px review by hand. It reports the fact, and the
  // gate step reports the action it takes (or the fallback when no reviewer
  // can be named).
  if (opts.reReviewFollows && invalidation.ok) {
    log(fmt.status('INFO', `The repair is recoverable: the workflow resumes review of the repaired revision ${repairedLabel} automatically (automatic revbounce).`));
  }
  return { route: 'revision-changed', rebounds, approvedRevision: approvedLabel, repairedRevision: repairedLabel, invalidation };
}

// ── Route ────────────────────────────────────────────────────────────────────

export interface IntegrationGateRouteOptions {
  slug: string;
  /** Mission checkout the failed gates ran from. */
  missionWorktree: string;
  /** The mission's ordinary verification command, for the coverage note. */
  verificationCommand?: string | null;
  failedGate: GateRunOutcome | null;
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
  approval?: any;
  /** Staleness already reported for this approval before integration (TASK-2555), named in the refusal. */
  reportedStaleness?: string | null;
  /** The caller re-reviews a changed revision itself, so no manual instruction is printed. */
  reReviewFollows?: boolean;
  realAgent?: string | null;
  realAgentModel?: string | null;
  startAgentFn: ReboundContext['startAgent'];
  transitionTaskFn: (_slug: string) => Promise<unknown> | unknown;
  /** Authoritative lifecycle transition followed by an optional Backlog mirror. */
  reactivateMissionFn?: (_slug: string) => Promise<unknown> | unknown;
  applyAgentFallbackFn?: ReboundContext['applyAgentFallback'];
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
    slug,
    missionWorktree,
    failedGate,
    gates,
    runPhaseGatesFn = runPhaseGates,
    captureFinalTreeFn = captureFinalIntegrationTree,
    reboundFn = rebound,
    invalidateApprovalFn = invalidateApprovedPrReview,
    log = fmt.log.plain,
    error = fmt.log.plainError,
    gateRunLog = fmt.log.plain,
    gateRunError = fmt.log.fail,
  } = opts;

  if (!failedGate) {
    error(fmt.status('FAIL', `Integration gates failed for ${slug} without naming a failed gate; nothing to bounce. Human action required.`));
    return { route: 'stranded', detail: 'no failed gate recorded' };
  }

  // A fresh bounded repair budget starts here, per `px integrate` (TASK-2620
  // AC5). The kernel's own attempt counter enforces it, so no lifetime counter
  // is read or spent: a later human resume starts with the full budget again.
  if (!opts.implementer) {
    error(fmt.status('FAIL', `No implementer could be named for ${slug}; not bouncing the integration gate failure. Human action required.`));
    return { route: 'stranded', detail: 'no implementer resolvable' };
  }

  // The revision the reviewer's approval was given to, observed before the
  //    implementer touches the worktree. Comparing it with the revision the
  //    repair leaves behind is the only truthful way to tell a repaired diff
  //    from an unchanged retry (TASK-2528); an unreadable tree is treated as
  //    changed, because "unchanged" is the claim that must be proven.
  const approvedTree = captureFinalTreeFn(missionWorktree);
  const preRepairRevision = approvedTree.ok ? (approvedTree.commit ?? null) : null;
  // The revision the reviewer approved (A); HEAD may already carry bookkeeping after it.
  const approvedRevision = opts.approvedRevision ?? preRepairRevision;
  let initialInvalidation: ApprovalInvalidation | null = null;

  const outcome = await reboundFn(
    integrationGateFailureReason(failedGate, { gateError: opts.gateError, verificationCommand: opts.verificationCommand, approvedRevision }),
    {
      slug,
      worktree: missionWorktree,
      implementer: opts.implementer,
      maxAttempts: INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION,
      startAgent: opts.startAgentFn,
      transitionToImplementer: opts.reactivateMissionFn ? async (bounceSlug: string) => {
        // The durable lane move withdraws the local approval atomically. Its
        // provider projection is corrected before the repair agent starts,
        // including when the process later stops before completing repair.
        const transitioned = await opts.reactivateMissionFn!(bounceSlug);
        initialInvalidation = await invalidateApprovalFn({
          slug, branch: opts.branch ?? `mission/${slug}`, approval: opts.approval,
          summary: staleApprovalSummary(slug, approvedRevision ?? 'unknown', 'pending repair', failedGate.key),
        });
        for (const problem of initialInvalidation.errors) { error(fmt.status('WARN', problem)); }
        return transitioned;
      } : opts.transitionTaskFn,
      ...(opts.applyAgentFallbackFn ? { applyAgentFallback: opts.applyAgentFallbackFn } : {}),
      verify: async () => {
        // The repair has to be committed: the integration gates are only ever
        // allowed to verify a finalized tree, and an uncommitted fix would
        // otherwise be reported as a repair the squash merge then drops.
        const tree = captureFinalTreeFn(missionWorktree);
        if (!tree.ok) {
          return { ok: false, diagnostic: `The repair is not committed, so the integration gates cannot re-run: ${tree.error}` };
        }
        const rerun = await runPhaseGatesFn('integration', {
          slug,
          checkoutPath: missionWorktree,
          gates,
          log: gateRunLog,
          error: gateRunError,
          realAgent: opts.realAgent,
          realAgentModel: opts.realAgentModel,
        });
        if (rerun.ok) { return { ok: true, diagnostic: '' }; }
        return {
          ok: false,
          diagnostic: rerun.error ?? 'integration gates failed again',
          ...(rerun.failedGate
            ? { reason: integrationGateFailureReason(rerun.failedGate, { gateError: rerun.error, verificationCommand: opts.verificationCommand, approvedRevision }) }
            : {}),
        };
      },
      log,
      error,
    },
  );

  const rebounds = outcome.attempts;
  if (outcome.outcome === 'fixed') {
    return routeFixedIntegrationGateRebound({ opts, failedGate, outcome, rebounds, approvedRevision, preRepairRevision, captureFinalTreeFn, invalidateApprovalFn, initialInvalidation, log, error });
  }
  error(fmt.status('FAIL', `Integration gate ${failedGate.key} still fails for ${slug} after ${rebounds} repair(s) within this integrate's bounded budget. Address the failed gate, then run px integrate ${slug} again for a fresh repair budget, or px review ${slug} --continue once the gate is fixed.`));
  return { route: 'exhausted', rebounds, diagnostic: outcome.diagnostic };
}
