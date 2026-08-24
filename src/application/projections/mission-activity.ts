import type { AgentFamily } from '../../domain/agents.js';
import type { LiveMissionWork, MissionCard } from './mission-board.js';

// ---------------------------------------------------------------------------
// Mission activity — the one interface-neutral read model for "is anything
// happening on this mission right now?".
//
// Two facts of different authority are kept apart on purpose:
//
//   * `work` is authoritative. The operation itself published it
//     (`reconcileCurrentWork` in `current-work.ts`), so it can say *what* is
//     being worked and how much the reading can be trusted.
//   * `coordinator` is recovery evidence only. It comes from scanning the
//     process table for a live `px` command. A coordinator can be live while
//     no agent is running — it spends whole phases in git, gates, and file
//     writes — so this evidence can never be upgraded into an agent count.
//
// Every operator surface (the TUI agent strip, `px status`) renders from this
// module's vocabulary, so the two cannot drift into contradicting each other.
// ---------------------------------------------------------------------------

/**
 * How much an authoritative work fact can be trusted.
 *
 * Renames `CurrentWorkFreshness`'s `unverified` to `unknown` because that is
 * the word both operator surfaces show; the underlying grades are identical.
 */
export type ActivityCertainty = 'live' | 'unknown' | 'stale';

/** Authoritative mission work: what the operation itself reported. */
export type MissionWorkActivity =
  | {
    readonly kind: 'working';
    readonly certainty: ActivityCertainty;
    readonly phase: string;
    readonly summary: string;
    readonly agent: AgentFamily | null;
    readonly operationId: string;
  }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'idle' };

/**
 * Recovery-only evidence that a `px` coordinator process exists.
 *
 * `stopped` is an observation (the scan ran and found nothing); `unknown` is
 * the absence of one (the scan could not run). Collapsing the two would turn a
 * failed probe into "nobody is working", which is the conversion this model
 * exists to prevent.
 */
export type CoordinatorEvidence =
  | { readonly state: 'live'; readonly family: AgentFamily | null }
  | { readonly state: 'stopped' }
  | { readonly state: 'unknown' };

export interface MissionActivity {
  readonly work: MissionWorkActivity;
  readonly coordinator: CoordinatorEvidence;
}

/** The card fields this projection reads. Kept structural so tests need no full card. */
export type MissionActivitySource = Pick<MissionCard, 'currentWork' | 'blockingReason' | 'liveSession'>;

/**
 * Project one mission card into the shared activity read model.
 *
 * Overlapping operations are already resolved upstream: `reconcileCurrentWork`
 * picks the standing operation by durable append order, so exactly one work
 * fact reaches this function and a late report from a superseded operation
 * cannot blank a mission that is still being worked. This projection therefore
 * never merges, counts, or sums operations — it restates the one resolved fact.
 */
export function projectMissionActivity(card: MissionActivitySource): MissionActivity {
  return { work: projectWork(card), coordinator: projectCoordinatorEvidence(card.liveSession) };
}

function projectWork(card: MissionActivitySource): MissionWorkActivity {
  const work: LiveMissionWork | null = card.currentWork;
  if (work !== null) {
    return {
      kind: 'working',
      certainty: work.freshness === 'unverified' ? 'unknown' : work.freshness,
      phase: work.phase,
      summary: work.summary,
      agent: work.agent,
      operationId: work.operationId,
    };
  }
  if (card.blockingReason) { return { kind: 'blocked', reason: card.blockingReason }; }
  return { kind: 'idle' };
}

/**
 * `undefined` means liveness was never observed, `null` means it was observed
 * and nothing was running. A session whose family could not be attributed
 * stays `family: null` rather than being guessed onto a family.
 */
function projectCoordinatorEvidence(session: MissionActivitySource['liveSession']): CoordinatorEvidence {
  if (session === undefined) { return { state: 'unknown' }; }
  if (session === null) { return { state: 'stopped' }; }
  return { state: 'live', family: session.family };
}

// ---------------------------------------------------------------------------
// Shared wording. Both operator surfaces call these so `px status` and the TUI
// describe the same state with the same words.
// ---------------------------------------------------------------------------

const CERTAINTY_WORD: Readonly<Record<ActivityCertainty, string>> = Object.freeze({
  live: 'live',
  unknown: 'unconfirmed',
  stale: 'stale',
});

/**
 * One line for the authoritative work fact.
 *
 * The literal word `working` is deliberately omitted here: it is a derived
 * activity note, not a mission lifecycle lane, so stamping it reads as a
 * status the board never ordered. The trust grade and the recorded phase are
 * kept because they are grounded in the published work fact, so an operator
 * still learns the mission is being worked and how much to trust it. The count
 * of such missions stays in `describeMissionActivityTotals`, not here.
 */
export function describeMissionWork(work: MissionWorkActivity): string {
  if (work.kind === 'blocked') { return `blocked: ${work.reason}`; }
  if (work.kind === 'idle') { return 'none recorded'; }
  return `(${CERTAINTY_WORD[work.certainty]}): ${work.phase}`;
}

/**
 * One line for the coordinator evidence. Always says "px command", never
 * "agent" and never a count of agents: a live coordinator is not a running
 * agent, and this wording is the guard against that claim reappearing.
 */
export function describeCoordinatorEvidence(evidence: CoordinatorEvidence): string {
  if (evidence.state === 'unknown') { return 'px command liveness unknown'; }
  if (evidence.state === 'stopped') { return 'no live px command'; }
  const family = evidence.family === null ? '' : ` (${evidence.family})`;
  return `live px command${family} — recovery evidence only`;
}

/**
 * The agent strip's per-family evidence text.
 *
 * The input counts live `px` processes attributed to a family, not agents, so
 * the text names `px cmd`. `null`/`undefined` means the process scan could not
 * run and must never be rendered as zero.
 */
export function describeFamilyCoordinatorEvidence(liveCommands: number | null | undefined): string {
  return typeof liveCommands === 'number' ? `${liveCommands} px cmd live` : 'px cmd unknown';
}

/** Counts of authoritative work states across the board. */
export interface MissionActivityTotals {
  readonly live: number;
  readonly unknown: number;
  readonly stale: number;
  readonly blocked: number;
  readonly idle: number;
}

/** Tally authoritative work states. Coordinator evidence is deliberately not summed. */
export function summarizeMissionActivity(activities: readonly MissionActivity[]): MissionActivityTotals {
  const totals = { live: 0, unknown: 0, stale: 0, blocked: 0, idle: 0 };
  for (const { work } of activities) {
    if (work.kind === 'working') { totals[work.certainty] += 1; continue; }
    totals[work.kind] += 1;
  }
  return totals;
}

/**
 * The strip's authoritative-work summary, or `null` when there is nothing to
 * say. Only non-zero states appear, so an all-idle board reads `work: 3 idle`
 * rather than four zeroes the operator has to parse.
 */
export function describeMissionActivityTotals(totals: MissionActivityTotals): string | null {
  const segments = [
    totals.live > 0 ? `${totals.live} live` : null,
    totals.unknown > 0 ? `${totals.unknown} unconfirmed` : null,
    totals.stale > 0 ? `${totals.stale} stale` : null,
    totals.blocked > 0 ? `${totals.blocked} blocked` : null,
    totals.idle > 0 ? `${totals.idle} idle` : null,
  ].filter((segment): segment is string => segment !== null);
  return segments.length === 0 ? null : `work: ${segments.join(' · ')}`;
}
