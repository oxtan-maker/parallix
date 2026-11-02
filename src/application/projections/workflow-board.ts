import { projectExecutionMetrics } from './provider-execution.js';
import { isOpenWorkflow, type WorkflowOperation } from '../../domain/workflow-operation.js';
import type { MissionCard } from './mission-board.js';
import { buildBoardProjection, type BoardProjection } from './board.js';

/** Ownership fences actions. Activity and observed liveness describe actual work. */
export function projectWorkflowBoard(board: BoardProjection, operations: readonly WorkflowOperation[]): BoardProjection {
  const owners = new Map(operations.filter(operation => operation.repositoryId === board.repositoryId).map(operation => [operation.missionId, operation]));
  const cards = board.stages.flatMap(stage => stage.cards.map(card => projectWorkflowCard(card, owners.get(card.id) ?? null)));
  const projected = { ...board, ...buildBoardProjection(board.repositoryId, cards, board.availableActions, board.operationLog, board.metrics, board.sourceFacts),
    stages: board.stages.map(stage => ({ ...stage, cards: cards.filter(card => card.lane === stage.lane) })) };
  return board.stages.some(stage => stage.cards.some(card => card.execution)) ? projectExecutionMetrics(projected) : projected;
}

export function projectWorkflowCard(card: MissionCard, owner: WorkflowOperation | null): MissionCard {
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
