// Integration-gate failure routing for `px integrate` (TASK-2492).
//
// `runPhaseGates('integration', ...)` used to dead-end: a red gate logged and
// threw `IntegrationAbort`, leaving an approved mission parked in
// `ready-for-integration` until a human noticed. This module classifies that
// failure into exactly one of four operator-facing routes and, for the one
// recoverable route, hands the failure to the same rebound kernel the
// squash-commit hook bounce already uses:
//
//  1. `limit-reached` — the mission has already spent its persisted
//     integration-gate rebound budget. No transition, no implementer launch.
//  2. `mainline`      — the same gate command fails on the base branch too, so
//     the regression is not the mission's. The gate evidence is reported and
//     the integration attempt stops; the implementer is not bounced and no
//     artefact is written to the base checkout (TASK-2507).
//  3. `fixed` / `exhausted` — a mission regression inside budget. The kernel
//     transitions the task back to `active`, launches the implementer with the
//     gate evidence, and re-runs the identical gate set. Only a passing re-run
//     is reported `fixed`.
//  4. `stranded`      — the failure could not be classified or no implementer
//     could be named, which is the pre-TASK-2492 abort behaviour.
//  5. `revision-changed` — the repair worked, but it changed the mission diff
//     the reviewer approved. The standing approval is retracted on the pull
//     request and the integration attempt stops, so the reviewer decides on
//     the revision that actually lands (TASK-2528).
//
// The dependency direction matches `integrate-gates.ts`: `integrate.ts` imports
// from here, never the other way round.
import * as fmt from '../../../application/presentation/cli-format.js';
import { rebound, type GateFailureReason, type ReboundContext } from '../../../application/rebound-kernel.js';
import { runPhaseGates, type GateRunOutcome, type RepositoryGate } from '../../config/repository-gates.js';
import { captureFinalIntegrationTree } from './integrate-gates.js';
import { git } from '../../git/git.js';
import { DEFAULT_FORGEJO_USER, postReview, readToken } from '../../forgejo/forgejo.js';
import { missionId } from '../../../domain/mission.js';

/**
 * How many integration-gate rebounds one mission may spend before a further
 * red gate escalates to a human. The budget is deliberately small: an
 * integration gate that survives two implementer repairs is evidence the
 * diagnosis, not the code, is wrong.
 */
export const INTEGRATION_GATE_REBOUND_LIMIT = 2;

/**
 * `operational_history.event_type` for one spent integration-gate rebound.
 *
 * The log is append-only and keyed on the mission id, which fixes the reset
 * boundary exactly: the budget never resets inside a mission — not on a new
 * commit, a new review round, or a new `px integrate` process — and never
 * carries into a different mission. Unlike a mutable retry column, two
 * concurrent processes cannot consume one counter; appending twice only ever
 * stops sooner, never denies a rebound that was never spent.
 */
export const INTEGRATION_GATE_REBOUND_EVENT = 'integration.gate-rebound';

/** Exactly one implementer relaunch per `px integrate` invocation. */
const REBOUND_ATTEMPTS_PER_INVOCATION = 1;

export type IntegrationGateRoute =
  | { route: 'fixed'; rebounds: number }
  | { route: 'revision-changed'; rebounds: number; approvedRevision: string; repairedRevision: string; invalidation: ApprovalInvalidation }
  | { route: 'exhausted'; rebounds: number; diagnostic: string }
  | { route: 'mainline'; detail: string; baseCommit: string | null }
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
  opts: { gateError?: string | null; verificationCommand?: string | null } = {},
): GateFailureReason {
  const coverageNote = integrationOnlyCoverageNote(failedGate.command, opts.verificationCommand ?? null);
  return {
    kind: 'gate-failure',
    area: `integration gate ${failedGate.key}`,
    command: failedGate.command,
    exitCode: failedGate.exitCode,
    stdout: failedGate.stdout,
    stderr: failedGate.stderr,
    ...(opts.gateError ? { error: opts.gateError } : {}),
    ...(coverageNote ? { coverageNote } : {}),
  };
}

// ── Persisted rebound budget ─────────────────────────────────────────────────

/**
 * Open the operator database, hand the operational-history repository to `fn`,
 * and close it again. Returns `null` when the database cannot be opened or
 * migrated, which callers must treat as "the budget cannot be enforced".
 */
async function withHistoryRepo<T>(fn: (_repo: any, _db: any) => Promise<T>): Promise<T | null> {
  try {
    const { SqliteDatabaseAdapter } = await import('../../sqlite/database-adapter.js');
    const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../../sqlite/migration-runner.js');
    const { SqliteOperationalHistoryRepository } = await import('../../sqlite/operational-history-repository.js');
    const { resolveDatabasePath } = await import('../../sqlite/database-path-resolver.js');
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: resolveDatabasePath() });
    try {
      await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
      return await fn(new SqliteOperationalHistoryRepository(db), db);
    } finally {
      await db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Integration-gate rebounds already spent by this mission.
 *
 * `null` means the operator database could not be read. The caller fails
 * closed on `null`: an unbounded bounce loop is the failure mode this mission
 * exists to prevent, so an unenforceable budget must stop rather than retry.
 */
export async function readIntegrationGateRebounds(slug: string): Promise<number | null> {
  return await withHistoryRepo(async (repo) => {
    if (typeof repo.findByTypeForMission !== 'function') { return null; }
    const rows = await repo.findByTypeForMission(INTEGRATION_GATE_REBOUND_EVENT, missionId(slug));
    return rows.length;
  });
}

/** Append one spent integration-gate rebound. Best effort; reports success. */
export async function recordIntegrationGateRebound(
  slug: string,
  facts: { repositoryId: string; gate: string; implementer: string; occurredAt?: string },
): Promise<boolean> {
  const appended = await withHistoryRepo(async (repo) => {
    await repo.append({
      eventType: INTEGRATION_GATE_REBOUND_EVENT,
      eventData: JSON.stringify({
        missionId: missionId(slug),
        repositoryId: facts.repositoryId,
        message: `${missionId(slug)} integration gate ${facts.gate} bounced to the implementer`,
        agent: facts.implementer,
        gate: facts.gate,
      }),
      createdAt: facts.occurredAt ?? new Date().toISOString(),
    });
    return true;
  });
  return appended === true;
}

// ── Base-branch reproduction ─────────────────────────────────────────────────

export interface BaseReproductionProbe {
  /** False when no safe, deterministic probe was possible. */
  checked: boolean;
  /** True only when the same gate command also failed on the base branch. */
  reproduced: boolean;
  detail: string;
  baseCommit: string | null;
}

/**
 * Re-run the one failed gate command against the base branch checkout.
 *
 * The probe is read-only: it runs the repository's own configured gate command
 * in the existing base worktree through the same `runPhaseGates` runner, and
 * refuses to run at all unless that worktree is already on the base branch with
 * a clean tree. It never checks out, resets, fetches, or pushes anything, so no
 * shared branch is mutated to obtain the answer.
 */
export async function probeBaseBranchReproduction(opts: {
  slug: string;
  baseWorktree?: string | null;
  baseBranch?: string | null;
  failedGate: GateRunOutcome;
  realAgent?: string | null;
  realAgentModel?: string | null;
  runPhaseGatesFn?: typeof runPhaseGates;
  gitFn?: typeof git;
  captureFinalTreeFn?: typeof captureFinalIntegrationTree;
  /** Receives `fmt.status(...)` lines. */
  log?: (_msg: string) => void;
  /** Receives the gate runner's raw text. */
  gateRunLog?: (_msg: string) => void;
  gateRunError?: (_msg: string) => void;
}): Promise<BaseReproductionProbe> {
  const {
    slug,
    baseWorktree,
    baseBranch,
    failedGate,
    runPhaseGatesFn = runPhaseGates,
    gitFn = git,
    captureFinalTreeFn = captureFinalIntegrationTree,
    log = fmt.log.plain,
  } = opts;

  const unchecked = (detail: string): BaseReproductionProbe => ({ checked: false, reproduced: false, detail, baseCommit: null });

  if (!baseWorktree || !baseBranch) {
    return unchecked('no base worktree/branch resolved for a base-branch reproduction probe');
  }
  const head = gitFn(['-C', baseWorktree, 'branch', '--show-current']);
  const headBranch = String(head.stdout || '').trim();
  if (head.status !== 0 || headBranch !== baseBranch) {
    return unchecked(`base worktree ${baseWorktree} is on "${headBranch || 'unknown'}", not ${baseBranch}; skipping the reproduction probe rather than checking it out`);
  }
  const tree = captureFinalTreeFn(baseWorktree);
  if (!tree.ok) {
    return unchecked(`base worktree ${baseWorktree} is not in a probeable state: ${tree.error}`);
  }

  log(fmt.status('INFO', `Checking whether integration gate ${failedGate.key} also fails on ${baseBranch} (${tree.commit?.slice(0, 12)}) before bouncing the implementer.`));
  const gate: RepositoryGate = { key: failedGate.key, command: failedGate.command, order: 0 };
  const probe = await runPhaseGatesFn('integration', {
    slug,
    checkoutPath: baseWorktree,
    gates: [gate],
    log: opts.gateRunLog ?? fmt.log.plain,
    error: opts.gateRunError ?? fmt.log.fail,
    realAgent: opts.realAgent,
    realAgentModel: opts.realAgentModel,
  });
  return {
    checked: true,
    reproduced: !probe.ok,
    detail: probe.ok
      ? `integration gate ${failedGate.key} passes on ${baseBranch}; the failure is a mission regression`
      : `integration gate ${failedGate.key} also fails on ${baseBranch}: ${probe.error ?? 'non-zero exit'}`,
    baseCommit: tree.commit ?? null,
  };
}

// ── Stale-approval retraction (TASK-2528) ────────────────────────────────────

/** The Forgejo logins whose standing approval a changed revision invalidates. */
export function standingApprovalHolders(approval: any, reviewerUser: string | null | undefined): string[] {
  const holders: string[] = [];
  if (approval?.ok !== true) { return holders; }
  if (approval.defaultUserApproved === true) { holders.push(DEFAULT_FORGEJO_USER); }
  if (approval.reviewerApproved === true && reviewerUser && !holders.includes(reviewerUser)) { holders.push(reviewerUser); }
  return holders;
}

export interface ApprovalInvalidation {
  /** False when at least one standing approval could not be retracted. */
  ok: boolean;
  /** Logins whose approval was retracted with a REQUEST_CHANGES review. */
  retracted: string[];
  errors: string[];
}

/**
 * Retract the standing approval on the mission pull request by posting a
 * `request-changes` review as each login that holds one.
 *
 * Retraction is per-reviewer because approval is: `getLatestReviewDecision`
 * keeps a login's approval standing until that same login posts a later formal
 * decision. Posting as a third party would leave the original approval intact
 * and the stale-approval recovery would still fire.
 *
 * A login whose token is unavailable is reported as an error rather than
 * silently skipped — an unretractable approval must fail closed, because the
 * whole point is that the changed revision cannot land under it.
 */
export async function invalidateApprovedPrReview(opts: {
  slug: string;
  branch: string;
  approval: any;
  reviewerUser?: string | null;
  summary: string;
  readTokenFn?: typeof readToken;
  postReviewFn?: typeof postReview;
}): Promise<ApprovalInvalidation> {
  const { readTokenFn = readToken, postReviewFn = postReview } = opts;
  const holders = standingApprovalHolders(opts.approval, opts.reviewerUser);
  const retracted: string[] = [];
  const errors: string[] = [];
  for (const holder of holders) {
    const token = readTokenFn(holder);
    if (!token) {
      errors.push(`no Forgejo token for ${holder}; the standing approval on ${opts.branch} could not be retracted`);
      continue;
    }
    const posted = postReviewFn(opts.branch, token, 'request-changes', opts.summary, { forgejoUser: holder });
    if (posted?.ok) { retracted.push(holder); }
    else { errors.push(`request-changes as ${holder} on ${opts.branch} failed: ${posted?.error || posted?.raw || 'unknown error'}`); }
  }
  return { ok: errors.length === 0, retracted, errors };
}

/**
 * The review body posted when a gate repair changed the approved diff. It is a
 * reviewer findings document so the reviewer reads what changed under them,
 * and it names both revisions so the claim is checkable.
 */
export function staleApprovalSummary(slug: string, approvedRevision: string, repairedRevision: string, gateKey: string): string {
  return [
    `## F1 (blocking): the approved revision is not the revision that would land`,
    '',
    `Integration gate \`${gateKey}\` failed for ${slug} and the implementer repaired the mission in place.`,
    `The repair changed the mission tree from \`${approvedRevision}\` (the revision this approval was given to) to \`${repairedRevision}\`.`,
    '',
    'This approval is retracted so the repaired revision is reviewed before it lands.',
  ].join('\n');
}

// ── Route ────────────────────────────────────────────────────────────────────

export interface IntegrationGateRouteOptions {
  slug: string;
  /** Mission checkout the failed gates ran from. */
  missionWorktree: string;
  baseWorktree?: string | null;
  baseBranch?: string | null;
  /** The mission's ordinary verification command, for the coverage note. */
  verificationCommand?: string | null;
  failedGate: GateRunOutcome | null;
  gateError?: string | null;
  /** The full configured gate set, re-run verbatim to verify a repair. */
  gates: RepositoryGate[];
  implementer: string;
  repositoryId: string;
  /** Mission pull-request branch, for retracting a stale approval (TASK-2528). */
  branch?: string | null;
  /** Provider approval as read at context-build time (TASK-2528). */
  approval?: any;
  /** Forgejo login of the configured reviewer whose approval may stand. */
  reviewerUser?: string | null;
  realAgent?: string | null;
  realAgentModel?: string | null;
  startAgentFn: ReboundContext['startAgent'];
  transitionTaskFn: (_slug: string) => Promise<unknown> | unknown;
  applyAgentFallbackFn?: ReboundContext['applyAgentFallback'];
  // Injected so tests exercise the routing without a database, an agent, or a
  // second gate execution.
  readReboundsFn?: typeof readIntegrationGateRebounds;
  recordReboundFn?: typeof recordIntegrationGateRebound;
  probeBaseBranchReproductionFn?: typeof probeBaseBranchReproduction;
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
    readReboundsFn = readIntegrationGateRebounds,
    recordReboundFn = recordIntegrationGateRebound,
    probeBaseBranchReproductionFn = probeBaseBranchReproduction,
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

  // 1. Budget first: an exhausted mission must not pay for a probe or a launch.
  const spent = await readReboundsFn(slug);
  if (spent === null) {
    error(fmt.status('FAIL', `Cannot read the integration-gate rebound budget for ${slug} from the operator database; refusing to bounce an unbounded number of times. Human action required.`));
    return { route: 'stranded', detail: 'rebound budget unreadable' };
  }
  if (spent >= INTEGRATION_GATE_REBOUND_LIMIT) {
    error(fmt.status('FAIL', `Integration gate ${failedGate.key} failed again for ${slug} after ${spent}/${INTEGRATION_GATE_REBOUND_LIMIT} integration-gate rebounds. Not transitioning to active and not launching an implementer — human action required.`));
    error(fmt.status('FAIL', `Reproduce with: ${failedGate.command} (from ${missionWorktree}).`));
    return { route: 'limit-reached', rebounds: spent };
  }

  // 2. A failure that also reproduces on the base branch is not this mission's.
  const probe = await probeBaseBranchReproductionFn({
    slug,
    baseWorktree: opts.baseWorktree,
    baseBranch: opts.baseBranch,
    failedGate,
    realAgent: opts.realAgent,
    realAgentModel: opts.realAgentModel,
    log,
    gateRunLog,
    gateRunError,
  });
  if (probe.checked && probe.reproduced) {
    // The evidence is reported and nothing is written: a failed integration
    // must not mutate the shared base checkout or mint a backlog identifier
    // outside the numeric `Backlog.md` authority (TASK-2507). Filing the
    // mainline problem is a human decision through the ordinary backlog
    // workflow.
    error(fmt.status('FAIL', `${probe.detail}. ${slug} was not bounced to its implementer; no backlog task was created. Human action required on the mainline problem.`));
    error(fmt.status('FAIL', `Reproduce with: ${failedGate.command} (from ${opts.baseWorktree}, ${opts.baseBranch} @ ${probe.baseCommit ?? 'unknown'}); exit code ${failedGate.exitCode ?? 'unknown'}.`));
    if (opts.gateError) { error(fmt.status('FAIL', opts.gateError)); }
    return { route: 'mainline', detail: probe.detail, baseCommit: probe.baseCommit };
  }
  log(fmt.status('INFO', probe.checked ? probe.detail : `Base-branch reproduction not determined (${probe.detail}); treating the failure as a mission regression.`));

  if (!opts.implementer) {
    error(fmt.status('FAIL', `No implementer could be named for ${slug}; not bouncing the integration gate failure. Human action required.`));
    return { route: 'stranded', detail: 'no implementer resolvable' };
  }

  // 3. Spend the budget before launching: a process that dies mid-repair must
  //    still have paid for the attempt, or the bound is not a bound.
  await recordReboundFn(slug, { repositoryId: opts.repositoryId, gate: failedGate.key, implementer: opts.implementer });

  // 4. The revision the reviewer's approval was given to, observed before the
  //    implementer touches the worktree. Comparing it with the revision the
  //    repair leaves behind is the only truthful way to tell a repaired diff
  //    from an unchanged retry (TASK-2528); an unreadable tree is treated as
  //    changed, because "unchanged" is the claim that must be proven.
  const approvedTree = captureFinalTreeFn(missionWorktree);
  const approvedRevision = approvedTree.ok ? (approvedTree.tree ?? approvedTree.commit ?? null) : null;

  const outcome = await reboundFn(
    integrationGateFailureReason(failedGate, { gateError: opts.gateError, verificationCommand: opts.verificationCommand }),
    {
      slug,
      worktree: missionWorktree,
      implementer: opts.implementer,
      maxAttempts: REBOUND_ATTEMPTS_PER_INVOCATION,
      startAgent: opts.startAgentFn,
      transitionToImplementer: opts.transitionTaskFn,
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
            ? { reason: integrationGateFailureReason(rerun.failedGate, { gateError: rerun.error, verificationCommand: opts.verificationCommand }) }
            : {}),
        };
      },
      log,
      error,
    },
  );

  const rebounds = spent + 1;
  if (outcome.outcome === 'fixed') {
    log(fmt.status('PASS', `Integration gate ${failedGate.key} repaired by ${outcome.implementer} and re-ran green (${rebounds}/${INTEGRATION_GATE_REBOUND_LIMIT} integration-gate rebounds spent).`));

    // A green re-run is not enough to merge. If the repair changed the mission
    // diff, the approval on the pull request was given to a revision that no
    // longer exists, and merging here would land code in its final form without
    // ever being reviewed (TASK-1281's trust gap, reached through TASK-2492's
    // recovery path). Retract the approval and stop; the mission is already
    // back with its implementer, so it re-enters review the ordinary way.
    const repairedTree = captureFinalTreeFn(missionWorktree);
    const repairedRevision = repairedTree.ok ? (repairedTree.tree ?? repairedTree.commit ?? null) : null;
    const unchanged = approvedRevision !== null && repairedRevision !== null && approvedRevision === repairedRevision;
    if (unchanged) {
      log(fmt.status('INFO', `The repair left the mission tree at ${approvedRevision}, the revision the review approved; the existing approval still covers what would land.`));
      return { route: 'fixed', rebounds };
    }

    const approvedLabel = approvedRevision ?? 'unknown';
    const repairedLabel = repairedRevision ?? 'unknown';
    const invalidation = await invalidateApprovalFn({
      slug,
      branch: opts.branch || `mission/${slug}`,
      approval: opts.approval,
      reviewerUser: opts.reviewerUser ?? null,
      summary: staleApprovalSummary(slug, approvedLabel, repairedLabel, failedGate.key),
    });
    error(fmt.status('FAIL', `The integration-gate repair changed ${slug} from the approved revision ${approvedLabel} to ${repairedLabel}. The approval covers a revision that is no longer what would land, so the merge is not allowed on it.`));
    for (const holder of invalidation.retracted) {
      error(fmt.status('INFO', `Retracted ${holder}'s approval on ${opts.branch || `mission/${slug}`} with a request-changes review.`));
    }
    for (const problem of invalidation.errors) {
      error(fmt.status('FAIL', `Stale approval left standing: ${problem}. Clear it by hand before the next px integrate.`));
    }
    error(fmt.status('FAIL', `${slug} must go back through review: run px review ${slug} --start and have the repaired revision ${repairedLabel} re-reviewed before integrating again.`));
    return { route: 'revision-changed', rebounds, approvedRevision: approvedLabel, repairedRevision: repairedLabel, invalidation };
  }
  error(fmt.status('FAIL', `Integration gate ${failedGate.key} still fails for ${slug} after the bounce (${rebounds}/${INTEGRATION_GATE_REBOUND_LIMIT} integration-gate rebounds spent).`));
  return { route: 'exhausted', rebounds, diagnostic: outcome.diagnostic };
}
