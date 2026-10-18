import { projectExecutionMetrics } from './provider-execution.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { MissionCard } from './mission-board.js';
import type { BoardProjection } from './board.js';
import type { AgentFamily } from '../../domain/agents.js';

/** Persisted ownership supplements current-work observations, never lifecycle. */
export function projectWorkflowBoard(board: BoardProjection, operations: readonly WorkflowOperation[]): BoardProjection {
  const owners = new Map(operations.filter(operation => operation.repositoryId === board.repositoryId).map(operation => [operation.missionId, operation]));
  const projected = { ...board, attentionQueue: board.attentionQueue.filter(item => !owners.has(item.missionId)), stages: board.stages.map(stage => ({ ...stage, cards: stage.cards.map(card => {
    const owner = owners.get(card.id);
    if (!owner) { return card; }
    return projectWorkflowCard(card, owner);
  }) })) };
  return board.stages.some(stage => stage.cards.some(card => card.execution)) ? projectExecutionMetrics(projected) : projected;
}

export function projectWorkflowCard(card: MissionCard, owner: WorkflowOperation | null): MissionCard {
  if (!owner || owner.repositoryId !== card.repositoryId || owner.missionId !== card.id) { return card; }
  const execution = card.execution && owner.providerStarted && !card.execution.recordedOperationIds?.includes(owner.id)
    ? { ...card.execution, complete: false, limitations: [...card.execution.limitations, 'Provider started but its run metadata is unavailable'] } : card.execution;
  return { ...card, execution, workflowOperation: owner,
    currentWork: { operationId: owner.id, phase: owner.phase,
      summary: owner.phase === 'accepted' || owner.phase === 'preparing' ? 'preparing workflow' : owner.reason ?? owner.phase,
      agent: owner.agent as AgentFamily | null, updatedAt: owner.updatedAt, freshness: 'unverified' as const },
    commands: card.commands.map(command => ({ ...command, enabled: false, reason: 'An admitted workflow owns this mission' })),
  };
}
