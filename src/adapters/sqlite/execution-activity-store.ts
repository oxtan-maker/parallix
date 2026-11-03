import type { ExecutionActivityStore } from '../../application/ports/execution-activity.js';
import { executionActivityToEntry, parseExecutionActivityEntry, EXECUTION_ACTIVITY_EVENT_TYPE } from '../../application/recording/execution-activity-recorder.js';
import { advanceExecutionActivity, type ExecutionActivity, type ExecutionActivitySnapshot } from '../../domain/execution-activity.js';
import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteOperationalHistoryRepository } from './operational-history-repository.js';
import { authorizeSqliteMissionWrite } from './workflow-write-guard.js';

/** One current snapshot per mission; history is written atomically for audit only. */
export class SqliteExecutionActivityStore implements ExecutionActivityStore {
  private static readonly turns = new WeakMap<SqliteDatabaseAdapter, Promise<unknown>>();
  constructor(private readonly db: SqliteDatabaseAdapter, private readonly repository: RepositoryId) {}

  loadCurrentWork(): Promise<readonly ExecutionActivitySnapshot[]> { return this.read('', []); }
  loadMissionCurrentWork(mission: MissionId): Promise<readonly ExecutionActivitySnapshot[]> {
    return this.read(' AND mission_id = ?', [mission]);
  }

  publish(event: ExecutionActivity, sourceId: string): Promise<void> {
    const previous = SqliteExecutionActivityStore.turns.get(this.db) ?? Promise.resolve();
    const next = previous.then(() => this.write(event, sourceId));
    SqliteExecutionActivityStore.turns.set(this.db, next.catch(() => {}));
    return next;
  }

  private async write(event: ExecutionActivity, sourceId: string): Promise<void> {
    await this.db.beginWriteTransaction();
    try {
      await authorizeSqliteMissionWrite(this.db, event.missionId);
      const owners = await this.db.query<{ id: string }>("SELECT id FROM workflow_operations WHERE repository_id = ? AND mission_id = ? AND phase IN ('accepted','executing','stopping')", [this.repository, event.missionId]);
      const previous = (await this.loadMissionCurrentWork(event.missionId))[0] ?? null;
      const next = advanceExecutionActivity(previous, event, sourceId, owners[0]?.id ?? null);
      if (next) {
        await this.db.execute('INSERT INTO execution_activity (repository_id, mission_id, snapshot_json) VALUES (?, ?, ?) ON CONFLICT(repository_id, mission_id) DO UPDATE SET snapshot_json = excluded.snapshot_json',
          [this.repository, event.missionId, JSON.stringify(next)]);
      }
      await new SqliteOperationalHistoryRepository(this.db).append(executionActivityToEntry(event, sourceId, this.repository));
      await this.db.commitTransaction();
    } catch (error) { await this.db.rollbackTransaction(); throw error; }
  }

  private async read(where: string, parameters: readonly string[]): Promise<readonly ExecutionActivitySnapshot[]> {
    const rows = await this.db.query<{ mission_id: string; snapshot_json: string }>(`SELECT mission_id, snapshot_json FROM execution_activity WHERE repository_id = ?${where}`, [this.repository, ...parameters]);
    return rows.map(row => readSnapshot(row.snapshot_json, row.mission_id));
  }
}

function readSnapshot(json: string, mission: string): ExecutionActivitySnapshot {
  const value = JSON.parse(json) as ExecutionActivitySnapshot;
  const eventValid = (event: ExecutionActivity | null): boolean => event === null || Boolean(event && event.missionId === mission
    && parseExecutionActivityEntry({ eventType: EXECUTION_ACTIVITY_EVENT_TYPE, eventData: JSON.stringify(event), createdAt: event.occurredAt }));
  if (!value || value.missionId !== mission || typeof value.operationId !== 'string' || !value.operationId.trim()
    || !Array.isArray(value.frames) || !validIds(value.closedSources) || !validIds(value.supersededOperations)
    || !value.frames.every(frame => frame && typeof frame.sourceId === 'string' && frame.sourceId.trim()
      && frame.event && frame.event.operationId === value.operationId && eventValid(frame.event))
    || !eventValid(value.retainedBlocker) || !eventValid(value.terminal)) {
    throw new Error(`Invalid stored execution activity for ${mission}`);
  }
  return value;
}

function validIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id: unknown) => typeof id === 'string' && Boolean(id.trim()));
}
