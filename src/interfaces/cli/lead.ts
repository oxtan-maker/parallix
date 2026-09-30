import * as fmt from '../../application/presentation/cli-format.js';
import {
  attentionDetail,
  DEFAULT_POLL_MS,
  isLeadLane,
  RECOVERY_BUDGET,
  superviseFleet,
  type MissionSupervision,
  type SupervisorPort,
  type SupervisionOutcome,
} from '../../application/recovery-supervisor.js';
import type { AttentionAction } from '../../application/projections/board.js';
import type { MissionLoadResult } from '../../application/domain-ports.js';
import { reviewStatus } from '../../domain/review.js';

/** The verdict tag shown beside each supervision result, keyed by outcome. */
const SUPERVISION_LABELS: Record<SupervisionOutcome, string> = {
  escalated: 'FAIL',
  cleared: 'PASS',
  human: 'INFO',
  open: 'INFO',
};

/** One supervision result, one line: outcome, mission, summary. */
export function formatSupervision(result: MissionSupervision): string {
  const label = SUPERVISION_LABELS[result.outcome];
  return fmt.status(label, `${result.outcome.padEnd(9)} ${fmt.slug(result.missionId)}  ${result.summary}`);
}

/**
 * The px invocation behind each board action the supervisor may press.
 *
 * A bare `px review <slug>` only prints status, so the review item runs the
 * autonomous review loop instead. `integrate:merge` has no entry: landing is
 * the human's decision.
 */
export function leadInvocation(kind: AttentionAction['kind'], mission: string): { command: string; args: string[] } | null {
  switch (kind) {
    case 'active:execute': return { command: 'active', args: [mission] };
    case 'review:submit': return { command: 'review', args: [mission, '--continue'] };
    default: return null;
  }
}

/**
 * Whether `px lead` may finish a review-lane mission's lost review →
 * integration move itself. Only a round a reviewer already approved qualifies;
 * lead never records a reviewer decision, so an undecided round is forwarded
 * to `px review --continue` instead (TASK-2620).
 */
export function leadFinishesParkedApproval(loaded: MissionLoadResult): boolean {
  if (loaded.kind !== 'found') { return false; }
  const { mission } = loaded;
  return mission.status === 'review' && Boolean(mission.review) && reviewStatus(mission.review!) === 'approved';
}

/** The evidence behind an escalation, indented under its mission. */
function formatSteps(result: MissionSupervision): string[] {
  return result.steps.map((step) => `    - ${step}`);
}

/** Parse the `px lead` flags and mission slugs out of argv. */
function parseLeadArgs(args: string[]): {
  missions: string[];
  dryRun: boolean;
  once: boolean;
  budget: number;
  pollMs: number;
} {
  const missions: string[] = [];
  let dryRun = false;
  let once = false;
  let budget = RECOVERY_BUDGET;
  let pollMs = DEFAULT_POLL_MS;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--dry-run') { dryRun = true; index += 1; }
    else if (arg === '--once') { once = true; index += 1; }
    else if (arg === '--budget') {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 0) { throw new Error('--budget takes a non-negative whole number'); }
      budget = value;
      index += 2;
    } else if (arg === '--poll') {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) { throw new Error('--poll takes a number of seconds'); }
      pollMs = value * 1000;
      index += 2;
    } else if (arg.startsWith('--')) { throw new Error(`Unknown lead option: ${arg}`); }
    else { missions.push(arg); index += 1; }
  }
  return { missions, dryRun, once, budget, pollMs };
}

/** `--dry-run`: print the queue and act on none of it. */
async function runDryRun(
  port: SupervisorPort,
  missions: string[],
  logFn: (_message: string) => void,
): Promise<void> {
  const queue = (await port.attention())
    .filter((item) => isLeadLane(item.lane) && (missions.length === 0 || missions.includes(item.missionId)));
  if (queue.length === 0) {
    logFn(fmt.status('INFO', 'The board asks for attention on nothing: no missions to supervise.'));
    return;
  }
  for (const item of queue) {
    logFn(fmt.status('INFO', `${fmt.slug(item.missionId)} — lane ${item.lane}; `
      + `${attentionDetail(item.reason)}; board offers ${item.action.display}`));
  }
}

/**
 * `px lead [--once] [--poll <seconds>] [--budget <n>] [--dry-run] [<mission>…]`
 * — work down the board's "needs your attention" queue (ADR 0059).
 *
 * The queue is the work list: whatever the board asks a human to look at, the
 * supervisor looks at, in the board's own order, re-reading it every pass. For
 * each item it presses the action the board advertises — the same command an
 * operator would — and when that does not clear the item, starts a fresh agent
 * in the mission worktree to work out why. Attempts are counted per failure
 * (`--budget`, 2 by default); a failure that survives them is escalated with
 * what was observed.
 *
 * An item that asks for integration is left on the board: the supervisor never
 * integrates anything.
 *
 * Without `--once` the run keeps watching, polling every `--poll` seconds,
 * until the operator stops it; `--once` takes a single pass and exits.
 * `--dry-run` prints the queue and acts on none of it, and naming missions
 * narrows the run to those.
 */
export function createLeadCommand(
  port: SupervisorPort,
  logFn: (_message: string) => void = fmt.log.plain,
) {
  return async (args: string[] = []) => {
    const { missions, dryRun, once, budget, pollMs } = parseLeadArgs(args);

    for (const mission of missions) {
      if (!await port.missionExists(mission)) { throw new Error(`Unknown mission: ${mission}`); }
    }

    if (dryRun) { await runDryRun(port, missions, logFn); return 0; }

    let lastReported = '';
    const results = await superviseFleet(port, {
      budget,
      once,
      keepWatching: !once,
      pollMs,
      ...(missions.length > 0 ? { missions } : {}),
      // Report changes, not every poll: a human integration handoff can sit
      // unchanged for hours without spamming the terminal.
      onPass: (pass, board) => {
        const signature = board.map((result) => `${result.missionId}|${result.outcome}|${result.summary}`).join('\n');
        if (signature === lastReported) { return; }
        lastReported = signature;
        logFn(fmt.status('INFO', `pass ${pass}: ${board.length} mission(s) on the attention queue`));
        for (const result of board) { logFn(formatSupervision(result)); }
      },
      onBoardReadFailure: (error) => logFn(fmt.status('FAIL', error.message)),
    });
    if (results.length === 0) {
      logFn(fmt.status('INFO', 'The board asks for attention on nothing: no missions to supervise.'));
      return 0;
    }

    let escalated = 0;
    for (const result of results) {
      // Only an escalation needs its evidence printed: it is the handoff to a
      // human, and a summary without what was observed is not a handoff.
      if (result.outcome !== 'escalated') { continue; }
      escalated += 1;
      logFn(formatSupervision(result));
      for (const line of formatSteps(result)) { logFn(line); }
    }
    return escalated > 0 ? 1 : 0;
  };
}
