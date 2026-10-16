import { projectReviewHistory } from './review-history.js';
export { projectReviewHistory } from './review-history.js';
import type { AgentFamily } from '../../domain/agents.js';
import { isPlannedCheckpoint, latestEvidencedCheckpoint, type GoalCheckRow } from '../../domain/checkpoint.js';
import { isClosedMission, type Mission, type MissionId, type MissionLabel, type MissionStatus } from '../../domain/mission.js';
import type { CheckpointData } from '../../domain/checkpoint.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { RunningAgentSession } from './agent-status.js';
import type { ApprovalCoverage } from '../../domain/approval-coverage.js';
import {
  currentReviewRound,
  reviewApprovalOwed,
  sameReviewedRevision,
  type PullRequestReference,
  type ReviewDisposition,
  type ReviewedRevision,
  type ReviewPhase,
} from '../../domain/review.js';

/**
 * A board lane is a mission status. The board shows the lifecycle the domain
 * records — it does not invent a vocabulary of its own.
 */
export type BoardLane = MissionStatus;
export type BoardCommand = 'active' | 'handoff' | 'review' | 'integrate' | 'draft' | 'cancel';

/**
 * How much the board can trust a current-work fact.
 *
 * Declared beside the fact it qualifies so the read model has no import cycle
 * with the reconciler that derives it.
 *
 * - `live` — the publishing process was observed running.
 * - `unverified` — liveness could not be observed, and the fact is still
 *   inside its freshness window. Still counts as working: a failed
 *   observation is not evidence that nobody is running.
 * - `stale` — an unverifiable fact aged past its window. Stops counting as
 *   working, which bounds what an abnormally terminated process leaves behind.
 */
export type CurrentWorkFreshness = 'live' | 'unverified' | 'stale';

/**
 * Ephemeral operation progress for a live board. It is never mission lifecycle
 * state.
 *
 * This is the mission-scoped answer to "what is being worked on right now?".
 * It carries everything a UI client needs to say so without going back to a
 * backing store: which operation and phase, one operator-facing line, the
 * family doing the work when one applies, and how much the board can trust the
 * fact. Freshness is derived by `reconcileCurrentWork`
 * (`src/application/projections/current-work.ts`), never by a UI component.
 */
export interface LiveMissionWork {
  readonly operationId: string;
  readonly phase: string;
  readonly summary: string;
  readonly agent: AgentFamily | null;
  readonly updatedAt: string;
  /**
   * `live` when the publishing process was observed running, `unverified` when
   * liveness could not be checked, `stale` when an unverifiable fact aged past
   * its window. Only `stale` stops the mission from counting as working.
   */
  readonly freshness: CurrentWorkFreshness;
}

export interface MissionOperationalFacts {
  readonly latestGate: 'passed' | 'failed' | 'running' | 'unknown';
  /**
   * The live agent session working this mission right now, or `null` when none
   * was observed. Absent means liveness was not observed at all, which is not
   * the same as "nobody is working" and must not suppress attention.
   */
  readonly liveSession?: RunningAgentSession | null;
  readonly reviewApproval: {
    readonly subject: ReviewedRevision;
    readonly approvedAt: string | null;
  } | null;
  readonly currentWork: LiveMissionWork | null;
  readonly blockingReason: string | null;
  readonly flags: readonly string[];
  /** Whether the effective approval still covers the branch (TASK-2555); absent when not observed. */
  readonly approvalCoverage?: ApprovalCoverage | null;
}

export interface CommandAvailability {
  readonly command: BoardCommand;
  readonly enabled: boolean;
  readonly reason: string | null;
  /** The server-projected lane intent for drag/drop, null when this action has no deterministic target. */
  readonly targetLane?: BoardLane | null;
  /**
   * The verb an operator recognises for this action in the mission's current
   * state. One command can mean two things — `px active` first launches a
   * refined mission and later resumes a stalled one — so the lifecycle words
   * are chosen here, never re-derived from a lane by a renderer.
   */
  readonly label?: string;
}

export interface MissionCard {
  readonly workflowOperation?: import('../../domain/workflow-operation.js').WorkflowOperation;
  readonly id: MissionId;
  readonly repositoryId: RepositoryId;
  readonly title: string;
  readonly labels: readonly MissionLabel[];
  readonly lane: BoardLane;
  readonly status: MissionStatus;
  /** Original raw status from backlog file (e.g. "ready", "approved"). Preserves legacy output contract. */
  readonly rawStatus: string;
  readonly closed: boolean;
  readonly agent: AgentFamily | null;
  /** Checkpoint filename with .md extension (e.g. "CP-2.md"). Preserves legacy output contract. */
  readonly checkpoint: string | null;
  /** First line of checkpoint file (e.g. "CP-2: Status Command Re-implemented"). */
  readonly checkpointDescription: string | null;
  /** Complete ordered checkpoint plan and recorded evidence. */
  readonly checkpointEvidence: readonly CheckpointEvidence[];
  readonly nextActionText: string | null;
  readonly gate: MissionOperationalFacts['latestGate'];
  readonly pullRequest: PullRequestReference | null;
  readonly reviewApproved: boolean;
  /**
   * Review-loop workflow state for the current round, null when the mission has
   * no review. Every surface (CLI, TUI, web board) reads the loop's phase from
   * here rather than from a mission-directory file.
   */
  readonly reviewRound: number | null;
  readonly reviewPhase: ReviewPhase | null;
  readonly reviewDisposition: ReviewDisposition | null;
  /** An approved local self-review still needs a formal provider approval. */
  readonly approvalOwed?: boolean;
  /**
   * Whether the effective approval still covers what the branch would land,
   * null when there is no effective approval or it was not observed.
   */
  readonly approvalCoverage?: ApprovalCoverage | null;
  /**
   * Every round so far, oldest first.
   *
   * A reviewer is not guaranteed to be the agent family that reviewed the
   * previous round — a usage block reroutes the launch to another family. The
   * incoming reviewer needs the prior verdicts, comments, and the implementer's
   * pushbacks to avoid re-raising settled findings, so the history travels with
   * the card rather than living in the previous reviewer's context.
   */
  readonly reviewHistory: readonly ReviewRoundSummary[];
  readonly currentWork: LiveMissionWork | null;
  /**
   * The live agent session running this mission's current command, or `null`
   * when none is known — either nothing is running, or liveness could not be
   * observed at all. Only a non-null session proves an agent is working, so
   * only a non-null session may keep the mission out of the human lane.
   */
  readonly liveSession?: RunningAgentSession | null;
  readonly blockingReason: string | null;
  readonly flags: readonly string[];
  readonly commands: readonly CommandAvailability[];
}

/** One past round, flattened for display and for handing to the next reviewer. */
export interface ReviewRoundSummary {
  readonly startRevision?: string;
  readonly decidedRevision?: string | null;
  readonly integrationRepairAssessment?: import('../../domain/integration-approval-restoration.js').IntegrationRepairAssessment;
  readonly number: number;
  readonly reviewer: AgentFamily;
  readonly implementer: AgentFamily;
  readonly phase: ReviewPhase;
  readonly disposition: ReviewDisposition | null;
  readonly comment: string | null;
  readonly findingSummaries: readonly string[];
  /** Findings the implementer disputed rather than fixed, with their rationale. */
  readonly pushbacks: readonly string[];
  /** Findings the implementer fixed, with the evidence they cited. */
  readonly fixes: readonly string[];
  /** Operator withdrawal of this round's approval, if any. */
  readonly revocation?: { readonly by: string; readonly reason: string; readonly at: string };
  /** A branch move after this round's approval: the revision that superseded it. */
  readonly supersession?: { readonly revision: string; readonly by: string; readonly at: string };
}

/**
 * One checkpoint as the board wire sees it: a name, its first-line description,
 * and the Goal Check evidence rows recorded against it. A planned checkpoint
 * (no evidence yet) still appears with its description and an empty row list.
 */
export interface CheckpointEvidence {
  readonly name: string;
  readonly description: string;
  readonly goalCheck: readonly GoalCheckRow[];
  /** Absent only on older projection fixtures. */
  readonly state?: 'completed' | 'current' | 'future';
}

/**
 * Mirror `mission.checkpoints` onto the card. The board projects every checkpoint,
 * not just the latest evidenced one, so a client can walk the mission's checkpoint
 * history and its evidence in one snapshot. Planned checkpoints carry their
 * description with an empty Goal Check list; recorded checkpoints carry their rows.
 */
function checkpointEvidence(checkpoints: readonly CheckpointData[], status: MissionStatus): CheckpointEvidence[] {
  const current = status === 'active' ? checkpoints.find(isPlannedCheckpoint) : undefined;
  return checkpoints.map((checkpoint) => ({
    name: checkpoint.name,
    description: checkpoint.firstLine ?? '',
    goalCheck: checkpoint.goalCheck,
    state: !isPlannedCheckpoint(checkpoint) ? 'completed' : checkpoint === current ? 'current' : 'future',
  }));
}

export function boardLane(mission: Mission): BoardLane {
  return mission.status;
}

function availability(
  command: BoardCommand,
  enabled: boolean,
  reason: string,
  targetLane: BoardLane | null,
  label?: string,
): CommandAvailability {
  return { command, enabled, reason: enabled ? null : reason, targetLane, ...(label === undefined ? {} : { label }) };
}

export function availableBoardCommands(
  mission: Mission,
  facts: Pick<MissionOperationalFacts, 'reviewApproval'> & Partial<Pick<MissionOperationalFacts, 'currentWork' | 'latestGate'>>,
): CommandAvailability[] {
  const open = !isClosedMission(mission);
  const hasCheckpointEvidence = mission.checkpoints.some((checkpoint) => checkpoint.goalCheck.length > 0);
  const hasApprovedReview = mission.review !== null
    && facts.reviewApproval !== null
    && sameReviewedRevision(
      currentReviewRound(mission.review).subject,
      facts.reviewApproval.subject,
    );
  // `px active` is the launch command and the resume command: the workflow
  // re-runs it to act on reviewer findings and to restart a mission whose gate
  // failed. Offering it only from `refined` left a mission in review with no
  // runnable action at all, and explained itself with a lane rule that did not
  // apply to it.
  const { resumesFindings, resumesGate, strandedActive, activeReason, canIntegrate, activeLabel } = activeCommandFacts(mission, facts, hasApprovedReview);
  return [
    availability(
      'active',
      open && (mission.status === 'refined' || resumesFindings || resumesGate || strandedActive),
      activeReason,
      'active',
      activeLabel,
    ),
    availability('handoff', open && mission.status === 'active' && hasCheckpointEvidence, 'Handoff requires an active mission with checkpoint evidence', 'review', 'review ▸'),
    availability('review', open && mission.status === 'review', 'Review is available only while the mission is in review', null, 'review ▸'),
    availability('integrate', open && canIntegrate, 'Integration requires the integration queue or an approved review', 'integration', 'integrate ▸'),
    // Pre-draft state: the mission exists as a card but no draft worktree has
    // been created yet. Once draft work exists the mission has moved on, and
    // re-drafting is refused by the dispatch backstop, not the projection.
    availability('draft', open && mission.status === 'backlog', 'Draft is available only while the mission is in the pre-draft (backlog) state', 'refined', 'draft ▸'),
    // A delivered Mission may still be finishing statistics and cleanup.
    // Cancellation must never delete its lifecycle record mid-closeout.
    availability('cancel', mission.status !== 'done', 'Delivered missions must finish integration closeout', null, 'cancel ✕'),
  ];
}

function activeCommandReason(status: Mission['status']): string {
  if (status === 'review') { return 'Resuming a review mission requires reviewer findings to act on'; }
  if (status === 'active') { return 'Resuming an active mission requires a failed gate or no live work'; }
  return 'Mission must be refined before it can be activated';
}

function activeCommandLabel(resumesFindings: boolean, resumesGate: boolean, strandedActive: boolean): string {
  if (resumesFindings) { return 'findings ↩'; }
  if (resumesGate) { return 'resume ▸'; }
  return strandedActive ? 'restart ▸' : 'power ▸';
}

export function projectMissionCard(mission: Mission, facts: MissionOperationalFacts): MissionCard {
  // A planned checkpoint without evidence is not progress.
  const checkpoint = latestEvidencedCheckpoint(mission.checkpoints);
  const reviewedSubject = mission.review
    ? currentReviewRound(mission.review).subject
    : null;
  const reviewedChange = reviewedSubject?.change ?? null;
  const currentRound = mission.review ? currentReviewRound(mission.review) : null;
  return {
    id: mission.id,
    repositoryId: mission.repositoryId,
    title: mission.title,
    labels: mission.labels,
    lane: boardLane(mission),
    status: mission.status,
    rawStatus: mission.rawStatus ?? mission.status,
    closed: isClosedMission(mission),
    agent: mission.assignee,
    ...cardCheckpoint(mission, checkpoint),
    gate: facts.latestGate,
    ...cardReview(mission, facts, reviewedSubject, reviewedChange, currentRound),
    currentWork: facts.currentWork,
    liveSession: facts.liveSession,
    blockingReason: facts.blockingReason,
    // The board renders flags on the card, so a stale approval is visible there
    // before anyone reaches the integration gate.
    flags: facts.approvalCoverage?.kind === 'stale'
      ? [...facts.flags, `approval no longer covers the branch (round ${facts.approvalCoverage.round})`]
      : facts.flags,
    commands: availableBoardCommands(mission, facts),
  };
}

/**
 * Whether an agent is running this mission's work right now.
 *
 * A lane says whose turn it is in the lifecycle; current work says the turn is
 * already being taken. `px review <slug>` running for a review-lane mission is
 * the agent doing the review, so the board must not also ask a human for the
 * same decision. Blocking reasons and failed gates outrank this: they are true
 * whether or not an agent is at the keyboard.
 *
 * The authority is `currentWork`, published by the operation itself. The
 * OS-process scan behind `liveSession` is consulted only when no current-work
 * fact was recorded at all — bounded recovery for a mission worked by an older
 * `px` build or by a command that publishes nothing. A recorded fact always
 * wins, including when it says the work is stale.
 */
export function agentIsWorking(card: MissionCard): boolean {
  if (card.currentWork) { return card.currentWork.freshness !== 'stale'; }
  return (card.liveSession ?? null) !== null;
}

export function attentionRank(card: MissionCard): number {
  if (card.blockingReason) { return 0; }
  if (card.gate === 'failed') { return 1; }
  if (agentIsWorking(card)) { return 4; }
  if (card.lane === 'review') { return 2; }
  // Stranded active mission: no live work at all (a stale fact is reported as
  // stale-work above, rank 4), so it needs a human sooner than an in-review
  // mission waiting on a decision. currentWork === null is the exact signal
  // because a fresh fact already returned at the agentIsWorking check and a
  // stale fact is stale-work, not stranded.
  if (card.lane === 'active' && card.currentWork === null) { return 2; }
  if (card.lane === 'integration') { return 3; }
  return 4;
}

export function attentionQueue(cards: readonly MissionCard[]): MissionCard[] {
  return [...cards].sort((left, right) => {
    const rank = attentionRank(left) - attentionRank(right);
    return rank === 0 ? left.id.localeCompare(right.id) : rank;
  });
}

export function wipCounts(cards: readonly MissionCard[]): Readonly<Record<BoardLane, number>> {
  const result: Record<BoardLane, number> = {
    backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 0,
  };
  for (const card of cards) { result[card.lane] += 1; }
  return result;
}

function activeCommandFacts(mission: Mission, facts: Pick<MissionOperationalFacts, 'reviewApproval'> & Partial<Pick<MissionOperationalFacts, 'currentWork' | 'latestGate'>>, hasApprovedReview: boolean) {
  const reviewPhase = mission.review === null ? null : currentReviewRound(mission.review).phase;
  const resumesFindings = mission.status === 'review' && reviewPhase === 'fixing';
  const resumesGate = mission.status === 'active' && facts.latestGate === 'failed';
  const activeReason = activeCommandReason(mission.status);
  const canIntegrate = mission.status === 'integration'
    || (['active', 'review'].includes(mission.status) && hasApprovedReview);
  // An active mission with no live work at all is stranded: no agent holds the
  // turn and the aggregate never left `active`. Re-running `px active` is the
  // defined lifecycle resume for it (the `activate` transition accepts
  // `active`), so the stranded case joins the findings and gate-failed resumes
  // rather than advertising a one-off recovery command. A stale published fact
  // is reported as stale-work, so this is limited to a mission that is active,
  // holds no work fact, and has no failing gate.
  const strandedActive = mission.status === 'active'
    && (facts.currentWork === null || facts.currentWork === undefined)
    && facts.latestGate !== 'failed';
  const activeLabel = activeCommandLabel(resumesFindings, resumesGate, strandedActive);
  return { resumesFindings, resumesGate, strandedActive, activeReason, canIntegrate, activeLabel };
}

function cardCheckpoint(mission: Mission, checkpoint: ReturnType<typeof latestEvidencedCheckpoint>) {
  return {
    checkpoint: checkpoint?.rawFilename ?? checkpoint?.name ?? null,
    checkpointDescription: checkpoint?.firstLine ?? null,
    checkpointEvidence: checkpointEvidence(mission.checkpoints, mission.status),
    nextActionText: checkpoint?.nextActionText ?? null,
  };
}
function cardReview(mission: Mission, facts: MissionOperationalFacts, reviewedSubject: ReviewedRevision | null, reviewedChange: ReviewedRevision['change'] | null, currentRound: ReturnType<typeof currentReviewRound> | null) {
  return {
    pullRequest: reviewedChange?.kind === 'pull-request' ? reviewedChange : null,
    reviewApproved: facts.reviewApproval !== null
      && reviewedSubject !== null
      && sameReviewedRevision(reviewedSubject, facts.reviewApproval.subject),
    reviewRound: currentRound?.number ?? null,
    reviewPhase: currentRound?.phase ?? null,
    reviewDisposition: currentRound?.disposition ?? null,
    approvalOwed: reviewApprovalOwed(mission.review),
    approvalCoverage: facts.approvalCoverage ?? null,
    reviewHistory: projectReviewHistory(mission.review),
  };
}
