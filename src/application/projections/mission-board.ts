import type { AgentFamily } from '../../domain/agents.js';
import { isClosedMission, type Mission, type MissionId, type MissionLabel, type MissionStatus } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { RunningAgentSession } from './agent-status.js';
import {
  currentReviewRound,
  sameReviewedRevision,
  type PullRequestReference,
  type Review,
  type ReviewDisposition,
  type ReviewedRevision,
  type ReviewPhase,
} from '../../domain/review.js';

/**
 * A board lane is a mission status. The board shows the lifecycle the domain
 * records — it does not invent a vocabulary of its own.
 */
export type BoardLane = MissionStatus;
export type BoardCommand = 'active' | 'handoff' | 'review' | 'integrate';

/** Ephemeral operation progress for a live board. It is never mission lifecycle state. */
export interface LiveMissionWork {
  readonly operationId: string;
  readonly phase: string;
  readonly summary: string;
  readonly agent: AgentFamily | null;
  readonly updatedAt: string;
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
}

export interface CommandAvailability {
  readonly command: BoardCommand;
  readonly enabled: boolean;
  readonly reason: string | null;
}

export interface MissionCard {
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
}

function outcomeComment(content: string): string | null {
  const summary = content.match(/(?:^|\n)## Summary\s*\n+([^\n]+)/);
  if (summary?.[1]) { return summary[1].trim(); }
  const lines = content.split('\n').map((line) => line.trim());
  const outcome = lines.findIndex((line) => /^Outcome:\s*/i.test(line));
  return outcome >= 0 ? lines.slice(outcome + 1).find((line) => line && !line.startsWith('#')) ?? null : null;
}

function findingSummaries(content: string): readonly string[] {
  return content.split('\n').flatMap((line) => {
    const heading = line.match(/^#{1,3}\s+Finding(?:\s+\d+)?[^—]*—\s*(.+)$/i);
    const numbered = line.match(/^\d+\.\s+\*\*(?:\[[^\]]+\]\s*)?(.+?)\*\*/);
    return heading?.[1] ?? numbered?.[1] ?? [];
  });
}

function outcomeDisposition(verdict: string | null): ReviewDisposition | null {
  return verdict?.toLowerCase() === 'request-changes' ? 'REQUEST_CHANGES' : null;
}

export function projectReviewHistory(review: Review | null): readonly ReviewRoundSummary[] {
  if (!review) { return []; }
  return review.rounds.map((round) => {
    const events = review.reviewEvents.filter((event) => event.roundNumber === round.number);
    const outcome = [...events].reverse().find((event) => event.eventType === 'reviewer_outcome');
    const findings = [...events].reverse().find((event) => event.eventType === 'reviewer_findings');
    const summary = [...events].reverse().find((event) => event.eventType === 'implementer_round_summary');
    const resolutions = round.response?.resolutions;
    const hasResolutions = resolutions && resolutions.length > 0;

    // itemDispositions is populated from the implementer's round summary
    // artifact. response.resolutions is the formal domain model path.
    // Use itemDispositions as fallback when resolutions are not set.
    const items = hasResolutions ? [] : (round.itemDispositions ?? summary?.itemDispositions ?? []);

    return {
      number: round.number,
      reviewer: round.reviewer,
      implementer: round.implementer,
      phase: round.phase,
      disposition: round.disposition === 'CHANGES_MADE'
        ? outcomeDisposition(outcome?.verdict ?? null) ?? round.disposition
        : round.disposition,
      comment: round.decision?.comment ?? outcomeComment(outcome?.content ?? ''),
      findingSummaries: round.decision?.kind === 'changes-requested'
        ? round.decision.findings.map((finding) => finding.summary)
        : findings ? findingSummaries(findings.content) : [],
      pushbacks: hasResolutions
        ? resolutions.filter((r) => r.kind === 'disputed')
            .map((r) => `${r.findingId}: ${r.rationale}`)
        : items.filter((d) => d.kind === 'pushed_back')
            .map((d) => `pushed_back: ${d.findingId}`),
      fixes: hasResolutions
        ? resolutions.filter((r) => r.kind === 'fixed')
            .map((r) => `${r.findingId}: ${r.evidence}`)
        : items.filter((d) => d.kind === 'fixed')
            .map((d) => `fixed: ${d.findingId}`),
    };
  });
}

export function boardLane(mission: Mission): BoardLane {
  return mission.status;
}

function availability(command: BoardCommand, enabled: boolean, reason: string): CommandAvailability {
  return { command, enabled, reason: enabled ? null : reason };
}

export function availableBoardCommands(
  mission: Mission,
  facts: Pick<MissionOperationalFacts, 'reviewApproval'>,
): CommandAvailability[] {
  const open = !isClosedMission(mission);
  const hasCheckpointEvidence = mission.checkpoints.some((checkpoint) => checkpoint.goalCheck.length > 0);
  const canIntegrate = mission.status === 'integration'
    || (
      mission.status === 'review'
      && mission.review !== null
      && facts.reviewApproval !== null
      && sameReviewedRevision(
        currentReviewRound(mission.review).subject,
        facts.reviewApproval.subject,
      )
    );
  return [
    availability('active', open && ['backlog', 'refined', 'active'].includes(mission.status), 'Mission cannot be activated from its current state'),
    availability('handoff', open && mission.status === 'active' && hasCheckpointEvidence, 'Handoff requires an active mission with checkpoint evidence'),
    availability('review', open && mission.status === 'review', 'Review is available only while the mission is in review'),
    availability('integrate', open && canIntegrate, 'Integration requires the integration queue or an approved review'),
  ];
}

export function projectMissionCard(mission: Mission, facts: MissionOperationalFacts): MissionCard {
  const checkpoint = mission.checkpoints[mission.checkpoints.length - 1] ?? null;
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
    checkpoint: checkpoint?.rawFilename ?? checkpoint?.name ?? null,
    checkpointDescription: checkpoint?.firstLine ?? null,
    nextActionText: checkpoint?.nextActionText ?? null,
    gate: facts.latestGate,
    pullRequest: reviewedChange?.kind === 'pull-request' ? reviewedChange : null,
    reviewApproved: facts.reviewApproval !== null
      && reviewedSubject !== null
      && sameReviewedRevision(reviewedSubject, facts.reviewApproval.subject),
    reviewRound: currentRound?.number ?? null,
    reviewPhase: currentRound?.phase ?? null,
    reviewDisposition: currentRound?.disposition ?? null,
    reviewHistory: projectReviewHistory(mission.review),
    currentWork: facts.currentWork,
    liveSession: facts.liveSession ?? null,
    blockingReason: facts.blockingReason,
    flags: facts.flags,
    commands: availableBoardCommands(mission, facts),
  };
}

/**
 * Whether an agent is running this mission's work right now.
 *
 * A lane says whose turn it is in the lifecycle; a live session says the turn
 * is already being taken. `px review <slug>` running for a review-lane mission
 * is the agent doing the review, so the board must not also ask a human for
 * the same decision. Blocking reasons and failed gates outrank this: they are
 * true whether or not an agent is at the keyboard.
 */
export function agentIsWorking(card: MissionCard): boolean {
  return (card.liveSession ?? null) !== null;
}

export function attentionRank(card: MissionCard): number {
  if (card.blockingReason) { return 0; }
  if (card.gate === 'failed') { return 1; }
  if (agentIsWorking(card)) { return 4; }
  if (card.lane === 'review') { return 2; }
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
