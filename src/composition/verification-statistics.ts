import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { VerificationStatisticsReadPort } from '../application/ports/verification-statistics.js';
import { verificationStatistics, type VerificationStatisticsInput } from '../application/projections/verification-statistics.js';
import { initOperatorState } from '../adapters/sqlite/adapter-factory.js';
import { SqliteOperationalHistoryRepository } from '../adapters/sqlite/operational-history-repository.js';
import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import { SqliteBoardLaneEventRepository } from '../adapters/sqlite/board-lane-event-repository.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';

/** All consumers read the same repository-scoped facts and pure calculation. */
export function createVerificationStatisticsReader(root: string, configuration?: ParallixConfiguration): VerificationStatisticsReadPort {
  return verificationStatisticsReader(async () => {
    const { db } = await initOperatorState({ configuration });
    const repositoryId = resolveCanonicalRepositoryId(root);
    const [history, operations, lifecycle] = await Promise.all([
      new SqliteOperationalHistoryRepository(db).findAll(), new SqliteWorkflowOperationStore(db, repositoryId).all(),
      new SqliteBoardLaneEventRepository(db).findByRepositoryId(repositoryId),
    ]);
    return { repositoryId, history, operations, lifecycle };
  });
}

/** Compose with the consumer's authoritative repositories when already available. */
export function verificationStatisticsReader(readInput: () => Promise<VerificationStatisticsInput>): VerificationStatisticsReadPort {
  return { async read(missions) { return verificationStatistics(await readInput(), missions); } };
}
