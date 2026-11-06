import { projectExecutionMetrics } from './provider-execution.js';
import { isOpenWorkflow, type WorkflowOperation } from '../../domain/workflow-operation.js';
import { projectMissionClosure, type MissionCard } from './mission-board.js';
import { buildBoardProjection, type BoardProjection } from './board.js';
import { reviewRoundLiveness, type ReviewLivenessReader } from './review-liveness.js';
import { decideReviewRecovery, reviewRecoveryApplies } from '../review-recovery.js';

/** Ownership fences actions. Activity and observed liveness describe actual work. */
export function projectWorkflowBoard(board: BoardProjection, operations: readonly WorkflowOperation[]): BoardProjection {
  const owners = new Map(operations.filter(operation => operation.repositoryId === board.repositoryId).map(operation => [operation.missionId, operation]));
  const cards = board.stages.flatMap(stage => stage.cards.map(card => projectWorkflowCard(card, owners.get(card.id) ?? null)));
  const projected = { ...board, ...buildBoardProjection(board.repositoryId, cards, board.availableActions, board.operationLog, board.metrics, board.sourceFacts),
    stages: board.stages.map(stage => ({ ...stage, cards: cards.filter(card => card.lane === stage.lane) })) };
  return board.stages.some(stage => stage.cards.some(card => card.execution)) ? projectExecutionMetrics(projected) : projected;
}

export function projectWorkflowCard(card: MissionCard, owner: WorkflowOperation | null): MissionCard {
  if (card.closed) { return projectMissionClosure(card); }
  if (!owner || owner.repositoryId !== card.repositoryId || owner.missionId !== card.id) { return card; }
  if (!isOpenWorkflow(owner)) { return settledCard(card, owner); }

  return { ...card, execution: executionEvidence(card, owner), workflowOperation: owner,
    currentWork: owner.phase === 'stopping' ? null : card.currentWork,
    blockingReason: card.blocker?.diagnostic ?? ownershipBlocker(owner) ?? card.blockingReason,
    commands: card.commands.map(command => ({ ...command, enabled: false, reason: 'An admitted workflow owns this mission' })),
  };
}

function settledCard(card: MissionCard, owner: WorkflowOperation): MissionCard {
  const activityId = card.activityOperationId ?? card.currentWork?.operationId;
  if (activityId && activityId !== owner.id) { return card; }
  return { ...card, currentWork: null, blockingReason: card.blocker?.diagnostic ?? card.blockingReason ?? (['blocked', 'interrupted'].includes(owner.phase) ? owner.reason : null) };
}

function ownershipBlocker(owner: WorkflowOperation): string | null {
  return owner.phase === 'stopping' ? owner.reason ?? 'Waiting for confirmed execution termination' : null;
}

function executionEvidence(card: MissionCard, owner: WorkflowOperation): MissionCard['execution'] {
  if (!card.execution || !owner.providerStarted || card.execution.recordedOperationIds?.includes(owner.id)) { return card.execution; }
  return { ...card.execution, limitations: [...card.execution.limitations, 'Provider started but its run metadata is unavailable'] };
}

/**
 * Attach the one recovery decision to cards whose Review may need it. Probes
 * run only for a human-stopped Review or an unsettled round; without a reader
 * the board states nothing rather than guessing absence.
 */
export async function projectReviewRecoveryCard(card: MissionCard, read?: ReviewLivenessReader): Promise<MissionCard> {
  if (!read || card.closed || !reviewRecoveryApplies(card.reviewPhase, card.reviewHumanStop)) { return card; }
  // A non-stopped round with published work is visibly active, not orphaned.
  // Avoid process-table and retained-history probes on every board refresh.
  if (!card.reviewHumanStop && (card.currentWork !== null || card.workflowOperation !== undefined)) { return card; }
  const observation = await read(card.id);
  return { ...card, reviewLiveness: reviewRoundLiveness(card.reviewPhase, observation.liveness),
    reviewRecovery: decideReviewRecovery(card.id, { phase: card.reviewPhase, humanStop: card.reviewHumanStop, ...observation }) };
}

export async function projectReviewRecoveryBoard(board: BoardProjection, read?: ReviewLivenessReader): Promise<BoardProjection> {
  if (!read) { return board; }
  const cards = await Promise.all(board.stages.flatMap(stage => stage.cards).map(card => projectReviewRecoveryCard(card, read)));
  return { ...board, ...buildBoardProjection(board.repositoryId, cards, board.availableActions, board.operationLog, board.metrics, board.sourceFacts),
    stages: board.stages.map(stage => ({ ...stage, cards: cards.filter(card => card.lane === stage.lane) })) };
}
