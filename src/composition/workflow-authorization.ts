import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import type { RepositoryId } from '../domain/repository.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { configureMissionWriteAuthorization, hasMissionWriteAuthorization } from '../application/ports/mission-write-authorization.js';
import { requireWorkflowOwner } from '../domain/workflow-operation.js';
import type { WorkflowOperationStore } from '../application/ports/workflow-operation.js';

/** Child CLI writers retain their parent's fence without a live IPC channel. */
export function inheritWorkflowAuthorization(configuration: ParallixConfiguration, store: Pick<WorkflowOperationStore, 'get'> | null): void {
  const id = configuration.runtime.workflowOperation;
  const generation = configuration.runtime.workflowGeneration;
  if (!id || hasMissionWriteAuthorization()) { return; }
  if (!store || !generation) { throw new Error('Inherited workflow authority is unavailable'); }
  configureMissionWriteAuthorization({ operationId: id, assert: async (mission, read) => {
    const operation = await (read ?? store.get.bind(store))(id);
    if (!operation || operation.missionId !== mission) { throw new Error('Inherited workflow does not own this mission'); }
    requireWorkflowOwner(operation, generation);
  } });
}

/** Bind a child graph only when it participates in inherited ownership. */
export function bindInheritedWorkflowAuthorization(configuration: ParallixConfiguration, inherit: boolean | undefined,
  mission: { repositoryId: RepositoryId } | null, db: SqliteDatabaseAdapter | null): void {
  if (inherit === false) { return; }
  inheritWorkflowAuthorization(configuration, mission && db ? new SqliteWorkflowOperationStore(db, mission.repositoryId) : null);
}
