import type { WorkflowOperationStore, WorkflowOperationRecord as WorkflowOperation } from '../../application/ports/workflow-operation.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

/** A dedicated connection prevents unrelated services joining admission transactions. */
export class SqliteWorkflowOperationStore implements WorkflowOperationStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly _db: SqliteDatabaseAdapter, private readonly _repository: RepositoryId) {}
  readOnly<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work);
    this.tail = run.catch(() => {});
    return run;
  }
  transaction<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      await this.beginWrite();
      try { const result = await work(); await this._db.commitTransaction(); return result; }
      catch (error) { await this._db.rollbackTransaction(); throw error; }
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async get(id: string): Promise<WorkflowOperation | null> {
    return (await this.read('id = ?', [id]))[0] ?? null;
  }
  async byRequest(mission: string, key: string): Promise<WorkflowOperation | null> {
    return (await this.read('mission_id = ? AND request_key = ?', [mission, key]))[0] ?? null;
  }
  async current(mission: string): Promise<WorkflowOperation | null> {
    return (await this.read("mission_id = ? AND phase IN ('accepted','preparing','waiting','running','checking','stopping')", [mission]))[0] ?? null;
  }
  open(): Promise<readonly WorkflowOperation[]> {
    return this.read("phase IN ('accepted','preparing','waiting','running','checking','stopping')", []);
  }
  async insert(operation: WorkflowOperation): Promise<void> {
    await this._db.execute('INSERT INTO workflow_operations (id, repository_id, mission_id, request_key, generation, phase, record_json) VALUES (?,?,?,?,?,?,?)',
      [operation.id, this._repository, operation.missionId, operation.requestKey, operation.generation, operation.phase, JSON.stringify(operation)]);
  }
  async replace(operation: WorkflowOperation, generation: number): Promise<void> {
    const changed = await this._db.execute('UPDATE workflow_operations SET generation = ?, phase = ?, record_json = ? WHERE id = ? AND repository_id = ? AND generation = ?',
      [operation.generation, operation.phase, JSON.stringify(operation), operation.id, this._repository, generation]);
    if (changed !== 1) { throw new Error('Workflow ownership changed'); }
  }
  private async beginWrite(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await this._db.beginImmediateTransaction(); return; }
      catch (error) {
        if (attempt >= 200 || !/SQLITE_BUSY|database is locked/.test(String(error))) { throw error; }
        // Yield instead of blocking the HTTP loop in SQLite's busy handler.
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
  private async read(where: string, parameters: readonly string[]): Promise<WorkflowOperation[]> {
    const rows = await this._db.query<{ record_json: string }>(`SELECT record_json FROM workflow_operations WHERE repository_id = ? AND ${where}`, [this._repository, ...parameters]);
    return rows.map(row => JSON.parse(row.record_json) as WorkflowOperation);
  }
}
