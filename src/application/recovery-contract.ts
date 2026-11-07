/** Board evidence, fresh recovery requests and public supervision contracts. */
export { FRESH_SESSION_MARKER_PORT } from './fresh-session-marker-port.js';
import type { AttentionAction, AttentionItem, AttentionReason } from './projections/board.js';
import type { BoardLane } from './projections/mission-board.js';
import { agentIsWorking } from './projections/mission-board.js';
import { DEFAULT_REBOUND_ATTEMPTS } from './rebound-kernel.js';

/**
 * Fresh recovery agents one *failure* may receive (ADR 0059).
 *
 * Per failure, not per mission: that is how every other retry budget in this
 * repository is counted. A failure that keeps coming back escalates after this
 * many attempts, while a mission that later hits a genuinely different failure
 * gets its own attempts instead of inheriting an exhausted count.
 */
export const RECOVERY_BUDGET = DEFAULT_REBOUND_ATTEMPTS;

/** How long the loop waits before reading a queue it could not act on. */
export const DEFAULT_POLL_MS = 60_000;
/** A board is infrastructure, not an empty queue: two failed reads hand off. */
export const BOARD_READ_ATTEMPTS = DEFAULT_REBOUND_ATTEMPTS;
/** Retry a transient board-command failure once before recovery takes over. */
export const ACTION_ATTEMPTS = 2;

/**
 * Landing remains a human decision (TASK-2479). Non-dispatchable blockers
 * still receive bounded investigation through the existing recovery path.
 */
export const HUMAN_ONLY_ACTIONS: ReadonlySet<AttentionAction['kind']> = new Set<AttentionAction['kind']>(['integrate:merge']);

/** The leader starts only after an operator has activated a refined mission. */
export const LEAD_LANES: ReadonlySet<BoardLane> = new Set<BoardLane>(['active', 'review', 'integration']);

export function isLeadLane(lane: BoardLane): boolean {
  return LEAD_LANES.has(lane);
}

/** One attention item, plus the facts the supervisor needs to act on it safely. */
export interface AttentionObservation {
  readonly missionId: string;
  readonly lane: BoardLane;
  /** Why the board is asking for attention. This is the failure evidence. */
  readonly reason: AttentionReason;
  /** The typed command the board advertises for this item, as an operator sees it. */
  readonly action: AttentionAction | null;
  /** Ownership may temporarily fence actions even when no agent is working. */
  readonly owned?: boolean;
  /** True while current work is credible (`live` or `unverified`). */
  readonly working: boolean;
  /** What the current work says, for the operator-facing record. */
  readonly workingDetail: string | null;
  /**
   * The authoritative facts that change when the mission moves: lane, gate,
   * review state, branch head. It is what tells one occurrence of an attention
   * item from the next.
   */
  readonly progress: string;
}

/** What a fresh recovery agent is told. Not a root cause — evidence. */
export interface RecoveryRequest {
  readonly missionId: string;
  readonly lane: BoardLane;
  /** Why the board asked for attention, verbatim. */
  readonly diagnostic: string;
  /** The board action that was pressed and did not clear the item. */
  readonly attemptedOperation: string;
  /** Investigate without lifecycle dispatch or pretending a command already ran. */
  readonly directInvestigation?: boolean;
  /** The instruction handed to the fresh agent. */
  readonly instruction: string;
  readonly admission?: import('./ports/operator-judgment.js').OperatorContinuationAdmission;
  readonly judgment?: string;
}

export interface SupervisorPort {
  /** Bounded judgment is required before fresh recovery. */
  readonly judgeRecovery?: (_missionId: string) => Promise<import('./operator-judgment.js').OperatorJudgmentResult>;
  /** Revalidate a judged continuation at the prepared provider-launch boundary. */
  readonly admitRecovery?: (_admission: import('./ports/operator-judgment.js').OperatorContinuationAdmission) => Promise<void>;
  /**
   * The board's "needs your attention" queue, in the board's own order.
   * Re-read every pass: it is the supervisor's whole work list.
   */
  readonly attention: () => Promise<readonly AttentionObservation[]>;
  /** Whether a named mission exists, for CLI validation before supervision. */
  readonly missionExists: (_missionId: string) => Promise<boolean>;
  /**
   * Re-read one mission's current work, straight from the current-work
   * authority.
   *
   * Deliberately narrower than the queue: this is asked twice per item per
   * pass, and rebuilding the whole board projection to answer "is an agent
   * running on this one mission" made a pass cost one projection per question.
   * The queue read at the top of the pass stays the work list; this is the
   * freshness check that must never be stale.
   */
  readonly liveness: (_missionId: string) => Promise<MissionLiveness>;
  /** Run the command the attention item advertises, through its existing use case. */
  readonly runAction: (_missionId: string, _action: AttentionAction, _observation?: AttentionObservation, _signal?: AbortSignal) => Promise<void>;
  /** Read-only admission facts for opportunistic integration pre-validation. */
  readonly observeIntegrationPrevalidation?: (_missionId: string) => Promise<IntegrationPrevalidationObservation>;
  /** Execute only the public non-landing integrate dry-run action. */
  readonly runIntegrationDryRun?: (_missionId: string, _signal?: AbortSignal) => Promise<void>;
  /**
   * Claim the mission for exclusive supervised work across local lead runs.
   * Returns the release, or null when another run holds it.
   */
  readonly claimRecovery: (_missionId: string) => Promise<(() => Promise<void>) | null>;
  /** Run a fresh agent context in the mission worktree; returns what it reported. */
  readonly launchRecovery: (_request: RecoveryRequest) => Promise<string>;
  /**
   * Start the pause before the queue is read again.
   *
   * It is handed back as a cancellable poll rather than a bare promise because
   * the loop races it against the running steps: the pause that loses the race
   * must be cancelled, and the one that is being waited on must keep the
   * process alive while it runs.
   */
  readonly wait: (_milliseconds: number) => Poll;
}

export interface IntegrationPrevalidationObservation {
  readonly currentSuccessfulRun: boolean;
  /** Whole-machine utilization in [0, 1], or null when it cannot be measured. */
  readonly cpuUtilization: number | null;
}

export function integrationPrevalidationDecision(observation: IntegrationPrevalidationObservation):
  'already-validated' | 'cpu-unavailable' | 'cpu-busy' | 'run' {
  if (observation.currentSuccessfulRun) { return 'already-validated'; }
  if (observation.cpuUtilization === null || !Number.isFinite(observation.cpuUtilization)
    || observation.cpuUtilization < 0 || observation.cpuUtilization > 1) { return 'cpu-unavailable'; }
  return observation.cpuUtilization < 0.30 ? 'run' : 'cpu-busy';
}

/** What the execution activity projection says about one mission right now. */
export interface MissionLiveness {
  /** True while current work is credible (`live` or `unverified`). */
  readonly working: boolean;
  /** What the current work says, for the operator-facing record. */
  readonly detail: string | null;
}

/** A pause in progress. `cancel` is idempotent and safe after `elapsed`. */
export interface Poll {
  readonly elapsed: Promise<void>;
  readonly cancel: () => void;
}

export type SupervisionOutcome =
  /** The item left the board's attention queue. */
  | 'cleared'
  /** The item is the human's: it asks for integration, which is never automatic. */
  | 'human'
  /** Nothing the supervisor may do cleared it; a human has it now. */
  | 'escalated'
  /** Still on the queue and still being worked on by the loop. */
  | 'open';

export interface MissionSupervision {
  readonly missionId: string;
  readonly outcome: SupervisionOutcome;
  /** What the run observed and did, in order. The escalation evidence. */
  readonly steps: readonly string[];
  /** One line for the operator, with the supported next action when there is one. */
  readonly summary: string;
}

/** The board's own words for why a mission needs attention. */
export function attentionDetail(reason: AttentionReason): string {
  return reason.kind === 'none' ? 'the board reports nothing' : `${reason.kind}: ${reason.detail}`;
}

/**
 * A stable identity for one failure occurrence.
 *
 * Digits and whitespace are normalized out so a rerun that only moves a
 * timestamp, a line number or a count is still the same failure.
 */
export function failureFingerprint(observation: AttentionObservation): string {
  return attentionDetail(observation.reason)
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * The session-marker port a recovery launch must use.
 *
 * The launcher resumes an agent's previous session whenever a marker matches the
 * mission, role and family it is about to start — which is exactly the session
 * that got stuck. Recovery depends on the opposite: a new context anchored in
 * the repository, not the transcript that failed. This port reports no marker
 * and never resumes, and it records nothing, so a recovery launch also cannot
 * overwrite the implementer's own session identity.
 */

/** The recovery instruction: general by design, constrained explicitly. */
export function recoveryInstruction(request: Omit<RecoveryRequest, 'instruction'>): string {
  return [
    `Mission ${request.missionId} is stuck in lane ${request.lane}: the Parallix board keeps asking for`,
    ...(request.directInvestigation
      ? ['attention on a recorded blocker. No lifecycle command was dispatched; investigate the evidence before proposing a continuation.']
      : ['attention on it, and the normal command for that has already been run without clearing it.',
        `The command that was run and did not help: ${request.attemptedOperation}.`]),
    '',
    'What the board reports (this is evidence, not a diagnosis — the real cause may be',
    'something else entirely):',
    request.diagnostic,
    '',
    'Inspect this mission and the repository, determine why progress stopped, and',
    'restore the mission to a state where the normal Parallix workflow can continue.',
    'Follow the repository and mission instructions exactly as any implementer would.',
    `Control assessment: ${request.judgment ?? 'Verify the execution surface before continuing.'}`,
    'Check whether the standard installed controls contain the behavior this mission needs.',
    'If the mission changes its own workflow or control tooling, inspect its documented',
    'development entry point and run the supported control from that worktree when needed.',
    'Verify command help, revision and target first; never guess a shell command or replace',
    'a locked gate. Missing or ambiguous control evidence requires escalation.',
    '',
    'Do the recovery now. Do not stop after diagnosing the problem or merely recommend',
    'a next command. Run the appropriate supported Parallix command to advance the',
    'mission, then re-read its status. Report completion only after the original',
    'attention condition has cleared, credible work is running, or the mission has',
    'reached the human-owned integration step. If that cannot be achieved safely,',
    'report the exact remaining blocker and the command or evidence that proves it.',
    'If an operator decision remains, report the specific decision, supporting evidence, options and recommended next step.',
    '',
    'You may not:',
    '- change the scope of MISSION.md;',
    '- weaken, skip or remove a gate, test or check to obtain a passing result;',
    '- edit the operator database to manufacture lifecycle or review state;',
    '- manufacture a review approval, or review your own repair;',
    '- change the locked contract or reserved operator decisions: you must not acknowledge or clear an operator stop, stand down approval, or invoke a command as the operator;',
    '- merge this mission, or run `px integrate` — landing is the human decision.',
    '',
    'If the defect is outside this mission\'s scope or belongs to the primary branch,',
    'do not absorb the fix into this mission. Report it with the evidence and stop.',
  ].join('\n');
}

/**
 * Turn one board attention item into an observation.
 *
 * The item supplies the reason and the action the operator is shown; the head
 * sha is the Git fact that moves when an agent commits, and without it a repair
 * that changed the branch but not the lane would read as "nothing happened".
 */
export function observationFromAttention(item: AttentionItem, headSha: string | null): AttentionObservation {
  const card = item.card;
  return {
    missionId: String(item.missionId),
    lane: card.lane,
    reason: item.reason,
    action: item.action,
    owned: Boolean(card.workflowOperation),
    working: agentIsWorking(card),
    workingDetail: card.currentWork
      ? `${card.currentWork.phase} — ${card.currentWork.summary} (${card.currentWork.freshness}, ${card.currentWork.updatedAt})`
      : null,
    progress: [
      card.lane,
      card.gate,
      card.reviewRound ?? '-',
      card.reviewPhase ?? '-',
      card.reviewApproved ? 'approved' : '-',
      card.checkpoint ?? '-',
      headSha ?? '-',
      card.workflowOperation?.id ?? '-',
      card.workflowOperation?.generation ?? '-',
      card.workflowOperation?.phase ?? '-',
      item.action?.kind ?? '-',
    ].join('|'),
  };
}

