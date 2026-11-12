import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { configureRebaseObservation } from '../application/ports/rebase-workflow.js';
import { authorizedOperationGeneration, authorizedOperationId } from '../application/ports/mission-write-authorization.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { randomUUID } from 'node:crypto';

/** Bind rebase observations to the installed operational-history adapter. */
export function bindRebaseObservation(configuration: ParallixConfiguration): void {
  configureRebaseObservation({
    observeRebase: async observation => {
      const { initOperatorState } = await import('../adapters/sqlite/adapter-factory.js');
      const { SqliteOperationalHistoryRepository } = await import('../adapters/sqlite/operational-history-repository.js');
      const { db } = await initOperatorState({ configuration });
      const operationId = authorizedOperationId() ?? configuration.runtime.workflowOperation ?? null;
      const generation = authorizedOperationGeneration() ?? configuration.runtime.workflowGeneration ?? null;
      const value = { ...observation, repositoryId: resolveCanonicalRepositoryId(observation.root), operationId, generation,
        sourceId: observation.id };
      await new SqliteOperationalHistoryRepository(db).append({ eventType: 'flow.rebase',
        eventData: JSON.stringify(value), createdAt: observation.occurredAt });
    },
    newRebaseObservationId: randomUUID,
    rebaseObservationStage: 'direct-rebase',
  });
}
