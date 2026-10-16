import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { BoardProjection } from './board.js';
import type { AgentFamily } from '../../domain/agents.js';

/** Persisted ownership supplements current-work observations, never lifecycle. */
export function projectWorkflowBoard(board: BoardProjection, operations: readonly WorkflowOperation[]): BoardProjection {
  const owners = new Map(operations.map(operation => [operation.missionId, operation]));
  return { ...board, attentionQueue: board.attentionQueue.filter(item => !owners.has(item.missionId)), stages: board.stages.map(stage => ({ ...stage, cards: stage.cards.map(card => {
    const owner = owners.get(card.id);
    if (!owner) { return card; }
    return { ...card, workflowOperation: owner,
      currentWork: { operationId: owner.id, phase: owner.phase,
        summary: owner.phase === 'accepted' || owner.phase === 'preparing' ? 'preparing workflow' : owner.reason ?? owner.phase,
        agent: owner.agent as AgentFamily | null, updatedAt: owner.updatedAt, freshness: 'unverified' as const },
      commands: card.commands.map(command => ({ ...command, enabled: false, reason: 'An admitted workflow owns this mission' })),
    };
  }) })) };
}
