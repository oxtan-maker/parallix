import type { AgentFamily } from '../../domain/agents.js';
import { isClosedMission, type Mission, type MissionId, type MissionLabel, type MissionStatus } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import {
  currentReviewRound,
  sameReviewedRevision,
  type PullRequestReference,
  type ReviewedRevision,
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
  readonly currentWork: LiveMissionWork | null;
  readonly blockingReason: string | null;
  readonly flags: readonly string[];
  readonly commands: readonly CommandAvailability[];
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
    currentWork: facts.currentWork,
    blockingReason: facts.blockingReason,
    flags: facts.flags,
    commands: availableBoardCommands(mission, facts),
  };
}

export function attentionRank(card: MissionCard): number {
  if (card.blockingReason) { return 0; }
  if (card.gate === 'failed') { return 1; }
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
