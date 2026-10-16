import { authorizeMissionWrite } from '../../application/ports/mission-write-authorization.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

/** Called inside the guarded write's transaction. A concurrent stop either
 * precedes this read or invalidates its SQLite snapshot before it can write. */
export function authorizeSqliteMissionWrite(db: SqliteDatabaseAdapter, mission: string): Promise<void> {
  return authorizeMissionWrite(mission, async id => {
    const rows = await db.query<{ record_json: string }>('SELECT record_json FROM workflow_operations WHERE id = ?', [id]);
    return rows[0] ? JSON.parse(rows[0].record_json) as WorkflowOperation : null;
  });
}
