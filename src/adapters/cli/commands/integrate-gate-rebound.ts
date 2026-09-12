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
//     the regression is not the mission's. A separately identifiable backlog
//     task records the mainline problem; the implementer is not bounced.
//  3. `fixed` / `exhausted` — a mission regression inside budget. The kernel
//     transitions the task back to `active`, launches the implementer with the
//     gate evidence, and re-runs the identical gate set. Only a passing re-run
//     is reported `fixed`.
//  4. `stranded`      — the failure could not be classified or no implementer
//     could be named, which is the pre-TASK-2492 abort behaviour.
//
// The dependency direction matches `integrate-gates.ts`: `integrate.ts` imports
// from here, never the other way round.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import { elideBounceOutput } from '../../../application/output-elision.js';
import { rebound, type GateFailureReason, type ReboundContext } from '../../../application/rebound-kernel.js';
import { runPhaseGates, type GateRunOutcome, type RepositoryGate } from '../../config/repository-gates.js';
import { captureFinalIntegrationTree } from './integrate-gates.js';
import { git } from '../../git/git.js';
import { getTaskStorage } from '../../backlog/task-file-io.js';
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
  | { route: 'exhausted'; rebounds: number; diagnostic: string }
  | { route: 'mainline'; taskId: string; taskFile: string | null; created: boolean; detail: string }
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

// ── Mainline problem ticket ──────────────────────────────────────────────────

/**
 * Deterministic identity for one mainline gate problem, derived from the gate
 * key and the base commit it reproduced on. Re-running `px integrate` for
 * another mission against the same broken base resolves to the same task
 * instead of minting a duplicate, and the hashed suffix cannot collide with the
 * numeric `TASK-NNNN` range a stale fork might also be handing out.
 */
export function mainlineGateTaskId(gateKey: string, baseCommit: string): string {
  const hash = crypto.createHash('sha1').update(`${gateKey}\n${baseCommit}`).digest('hex').slice(0, 8).toUpperCase();
  return `TASK-MAINGATE-${hash}`;
}

/**
 * Record a gate failure that reproduces on the base branch as its own backlog
 * task. Per team-lead policy a main problem is not an implementer bounce, so
 * this replaces the bounce rather than preceding it.
 */
export function createMainlineGateTask(opts: {
  baseWorktree: string;
  baseBranch: string;
  baseCommit: string;
  slug: string;
  failedGate: GateRunOutcome;
  gateError?: string | null;
  gitFn?: typeof git;
  log?: (_msg: string) => void;
}): { taskId: string; taskFile: string | null; created: boolean } {
  const { baseWorktree, baseBranch, baseCommit, slug, failedGate, gitFn = git, log = fmt.log.plain } = opts;
  const taskId = mainlineGateTaskId(failedGate.key, baseCommit);
  const { tasksDir } = getTaskStorage(baseWorktree);
  const taskFile = path.join(tasksDir, `${taskId} - Integration gate ${failedGate.key} fails on ${baseBranch}.md`);

  if (fs.existsSync(taskFile)) {
    log(fmt.status('INFO', `Mainline gate problem already tracked as ${taskId}.`));
    return { taskId, taskFile, created: false };
  }

  // Only the gate's own identity and a bounded, elided excerpt are recorded:
  // a task file is a shared artifact and must never carry raw environment or
  // unbounded command output.
  const excerpt = elideBounceOutput([failedGate.stdout, failedGate.stderr, opts.gateError].filter(Boolean).join('\n').trim() || '(no captured output; the gate streamed to the terminal)');
  const body = [
    '---',
    `id: ${taskId}`,
    `title: Integration gate ${failedGate.key} fails on ${baseBranch}`,
    'status: backlog',
    'assignee: []',
    `created_date: '${new Date().toISOString().slice(0, 16).replace('T', ' ')}'`,
    'labels: [ai_sdlc]',
    'dependencies: []',
    '---',
    '',
    '## Description',
    '',
    '<!-- SECTION:DESCRIPTION:BEGIN -->',
    `Integration gate \`${failedGate.key}\` failed while integrating ${slug}, and the`,
    `same command reproduces on \`${baseBranch}\` at commit ${baseCommit}. The failure is`,
    'therefore a mainline problem, not a regression introduced by that mission, so',
    'no implementer was bounced for it.',
    '',
    `- Gate command: \`${failedGate.command}\``,
    `- Exit code: ${failedGate.exitCode ?? 'unknown'}`,
    `- Reproduced on: \`${baseBranch}\` @ ${baseCommit}`,
    `- First observed integrating: ${slug}`,
    '',
    'Captured excerpt:',
    '',
    '```',
    excerpt,
    '```',
    '<!-- SECTION:DESCRIPTION:END -->',
    '',
  ].join('\n');

  try {
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, body, 'utf8');
  } catch (error) {
    log(fmt.status('WARN', `Could not write the mainline gate task ${taskId}: ${(error as Error).message}`));
    return { taskId, taskFile: null, created: false };
  }
  log(fmt.status('PASS', `Recorded the mainline gate problem as ${taskId} (${fmt.path(path.relative(baseWorktree, taskFile))}).`));

  // Committing it is best effort: the ticket has already been written, and a
  // read-only `backlog/` or a rejecting hook must not turn a mainline report
  // into a second failure.
  try {
    const relative = path.relative(baseWorktree, taskFile);
    gitFn(['-C', baseWorktree, 'add', relative]);
    gitFn(['-C', baseWorktree, 'commit', '-m', `backlog(${taskId}): record mainline integration gate failure`, '--', relative]);
  } catch {
    log(fmt.status('WARN', `Mainline gate task ${taskId} was written but not committed; commit it manually.`));
  }
  return { taskId, taskFile, created: true };
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
  createMainlineGateTaskFn?: typeof createMainlineGateTask;
  runPhaseGatesFn?: typeof runPhaseGates;
  captureFinalTreeFn?: typeof captureFinalIntegrationTree;
  reboundFn?: typeof rebound;
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
    createMainlineGateTaskFn = createMainlineGateTask,
    runPhaseGatesFn = runPhaseGates,
    captureFinalTreeFn = captureFinalIntegrationTree,
    reboundFn = rebound,
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
    const ticket = createMainlineGateTaskFn({
      baseWorktree: opts.baseWorktree as string,
      baseBranch: opts.baseBranch as string,
      baseCommit: probe.baseCommit ?? 'unknown',
      slug,
      failedGate,
      gateError: opts.gateError,
      log,
    });
    error(fmt.status('FAIL', `${probe.detail}. Tracked as ${ticket.taskId}; ${slug} was not bounced to its implementer. Human action required on the mainline problem.`));
    return { route: 'mainline', taskId: ticket.taskId, taskFile: ticket.taskFile, created: ticket.created, detail: probe.detail };
  }
  log(fmt.status('INFO', probe.checked ? probe.detail : `Base-branch reproduction not determined (${probe.detail}); treating the failure as a mission regression.`));

  if (!opts.implementer) {
    error(fmt.status('FAIL', `No implementer could be named for ${slug}; not bouncing the integration gate failure. Human action required.`));
    return { route: 'stranded', detail: 'no implementer resolvable' };
  }

  // 3. Spend the budget before launching: a process that dies mid-repair must
  //    still have paid for the attempt, or the bound is not a bound.
  await recordReboundFn(slug, { repositoryId: opts.repositoryId, gate: failedGate.key, implementer: opts.implementer });

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
    return { route: 'fixed', rebounds };
  }
  error(fmt.status('FAIL', `Integration gate ${failedGate.key} still fails for ${slug} after the bounce (${rebounds}/${INTEGRATION_GATE_REBOUND_LIMIT} integration-gate rebounds spent).`));
  return { route: 'exhausted', rebounds, diagnostic: outcome.diagnostic };
}
