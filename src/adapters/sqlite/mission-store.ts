import { SqliteMissionValueWriter } from './mission-value-writer.js';
import { readMissionAggregates } from './mission-load-reader.js';
import { authorizeSqliteMissionWrite } from './workflow-write-guard.js';
import { SqliteCheckpointHistory } from './checkpoint-history.js';
import type {
  MissionLoadResult,
  MissionStore,
  MigrateLegacyAdhocIdsResult,
  MissionVersion,
} from '../../application/domain-ports.js';
import { DuplicateLaneEventError, type LaneTransitionEvent } from '../../domain/board-event.js';
import { missionTitle, type Mission, type MissionId } from '../../domain/mission.js';
import { missionBrief } from '../../domain/mission-brief.js';
import { declaredGates } from '../../domain/mission-gates.js';
import { completedCriteria, successCriteria, replaceSuccessCriteria, criterionContract, identifyGoalCheckRows } from '../../domain/mission-success-criteria.js';
import { missionDependencies } from '../../domain/mission-dependencies.js';
import type { KnownRepository, RepositoryId } from '../../domain/repository.js';
import { defectProvenance, DefectProvenanceViolation } from '../../domain/defect-provenance.js';

import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { migrateLegacyAdhocIds as migrateLegacyAdhocIdsInStore } from './legacy-adhoc-migration.js';
import { SqliteBoardLaneEventRepository } from './board-lane-event-repository.js';
import { SqliteDefectProvenanceBackfill } from './defect-provenance-backfill.js';
import { SqliteMissionCanceller } from './mission-canceller.js';
import type { DefectProvenanceBackfillRequest } from '../../application/ports/defect-provenance-backfill.js';
import { writeMissionRoot } from './mission-root-writer.js';
export { MissionStaleWriteError } from './mission-root-writer.js';

export interface KnownRepositoryObservation {
  readonly repository: KnownRepository;
  readonly path: string;
  readonly lastAccessed: string;
}

/** Aggregates rehydrated per query batch; keeps the bound-parameter count well under SQLite's limit. */
const LOAD_CHUNK = 400;

/**
 * Relational SQLite adapter for the checked Mission aggregate.
 *
 * The aggregate root and its value collections are committed on one
 * connection. Version compare-and-swap catches stale writers even when two
 * writers keep the same lifecycle status.
 *
 * Aggregate reads and writes are serialized on this store. A write rewrites the
 * value collections as DELETE-then-INSERT, and composition shares a single
 * `DatabaseSync` handle process-wide, so a transaction gives a concurrent read
 * on that same handle no isolation whatsoever: a `load` that interleaves with a
 * `save` observes the aggregate mid-rewrite and reports a mission whose Review
 * has vanished. The review loop does exactly that — recording a stage launch
 * while consuming reviewer artifacts — and the reviewer's verdict was dropped
 * with "no Review in the operator database" while the Review was on disk the
 * whole time. Concurrency between *processes* keeps SQLite's own isolation;
 * this queue closes the in-process window that shared handle opens.
 */
export class SqliteMissionStore implements MissionStore {
  private readonly eventRepo: SqliteBoardLaneEventRepository;
  private readonly valueWriter: SqliteMissionValueWriter;
  /** Tail of the serialized aggregate-operation chain. */
  private aggregateQueue: Promise<unknown> = Promise.resolve();
  /** Hydrated aggregates by repository and the `version` they were read at. */
  private readonly missionsByRepository = new Map<string, Map<string, { readonly version: number; readonly mission: Mission }>>();

  constructor(private readonly db: SqliteDatabaseAdapter) {
    this.eventRepo = new SqliteBoardLaneEventRepository(db);
    this.valueWriter = new SqliteMissionValueWriter(db);
  }

  /**
   * Run an aggregate operation after every operation already queued.
   *
   * A rejected operation must not poison the chain: the next caller waits for
   * this one to settle, not to succeed.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.aggregateQueue.then(operation, operation);
    this.aggregateQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Resolve once every queued aggregate operation has settled. */
  async drain(): Promise<void> {
    await this.aggregateQueue;
  }

  async load(id: MissionId): Promise<MissionLoadResult> {
    return this.enqueue(() => this.loadAggregate(id));
  }

  async loadByRepository(repositoryId: RepositoryId): Promise<readonly Mission[]> {
    return this.enqueue(async () => {
      // The board asks for every mission of the repository on every refresh. A
      // mission's `version` moves on every aggregate write (any process), so
      // one cheap id/version read decides which aggregates need rehydrating.
      const current = await this.db.query<{ id: MissionId; version: number }>(
        'SELECT id, version FROM missions WHERE repository_id = ? ORDER BY id',
        [repositoryId],
      );
      const cache = this.repositoryCache(repositoryId);
      const stale = current.filter(({ id, version }) => cache.get(id)?.version !== version);
      const ids = new Set<string>(current.map(({ id }) => id));
      for (const id of [...cache.keys()]) { if (!ids.has(id)) { cache.delete(id); } }
      for (let start = 0;start < stale.length;start += LOAD_CHUNK) {
        const chunk = stale.slice(start, start + LOAD_CHUNK).map(({ id }) => id);
        const marks = chunk.map(() => '?').join(', ');
        const loaded = await readMissionAggregates(this.db, { missions: `id IN (${marks})`, children: `mission_id IN (${marks})`, params: chunk });
        for (const result of loaded) {
          if (result.kind === 'found') { cache.set(result.mission.id, { version: result.version, mission: result.mission }); }
        }
      }
      return current.flatMap(({ id }) => {
        const entry = cache.get(id);
        return entry === undefined ? [] : [entry.mission];
      });
    });
  }

  private repositoryCache(repositoryId: RepositoryId): Map<string, { readonly version: number; readonly mission: Mission }> {
    let cache = this.missionsByRepository.get(repositoryId);
    if (cache === undefined) { cache = new Map(); this.missionsByRepository.set(repositoryId, cache); }
    return cache;
  }

  async reviewCheckpointState(id: MissionId, round: number) {
    return this.enqueue(() => new SqliteCheckpointHistory(this.db).round(id, round));
  }

  async checkpointHistory(id: MissionId) {
    return this.enqueue(() => new SqliteCheckpointHistory(this.db).read(id));
  }

  async save(
    mission: Mission,
    expectedVersion: MissionVersion | null,
  ): Promise<MissionVersion> {
    return this.enqueue(() => this.saveAggregate(mission, expectedVersion));
  }

  async saveWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion | null,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    return this.enqueue(() => this.saveAggregateWithTransition(mission, expectedVersion, event));
  }

  async saveWave(
    parent: Mission,
    expectedVersion: MissionVersion,
    children: readonly Mission[],
  ): Promise<{ readonly parentVersion: MissionVersion; readonly childVersions: readonly MissionVersion[] }> {
    return this.enqueue(() => this.saveWaveAggregate(parent, expectedVersion, children));
  }

  async findTransitions(missionId: MissionId) {
    return this.eventRepo.findPersistedByMissionId(missionId);
  }

  async findMissionByIdempotencyKey(repositoryId: RepositoryId, key: string): Promise<MissionId | null> {
    return (await this.eventRepo.findMissionIdByIdempotencyKey(repositoryId, key)) as MissionId | null;
  }

  async cancel(id: MissionId): Promise<void> {
    return this.enqueue(() => this.cancelAggregate(id));
  }

  async migrateLegacyAdhocIds(): Promise<MigrateLegacyAdhocIdsResult> {
    return migrateLegacyAdhocIdsInStore(this.db);
  }

  async previewDefectProvenanceBackfill(request: DefectProvenanceBackfillRequest) {
    return this.enqueue(() => new SqliteDefectProvenanceBackfill(this.db).preview(request));
  }

  async applyDefectProvenanceBackfill(request: DefectProvenanceBackfillRequest) {
    return this.enqueue(() => new SqliteDefectProvenanceBackfill(this.db).apply(request));
  }

  private async loadAggregate(id: MissionId): Promise<MissionLoadResult> {
    const [loaded] = await readMissionAggregates(this.db, { missions: 'id = ?', children: 'mission_id = ?', params: [id] });
    return loaded ?? { kind: 'missing' };
  }

  private async cancelAggregate(id: MissionId): Promise<void> {
    await new SqliteMissionCanceller(this.db).cancel(id);
  }

  private async saveAggregate(
    mission: Mission,
    expectedVersion: MissionVersion | null,
  ): Promise<MissionVersion> {
    await this.db.beginWriteTransaction();
    try {
      const version = await this.persistAggregate(mission, expectedVersion);
      await this.db.commitTransaction();
      return version;
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }
  }

  private async saveAggregateWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion | null,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    if (event.missionId !== mission.id || event.repositoryId !== mission.repositoryId) {
      throw new Error('LaneTransitionEvent does not identify the Mission being saved');
    }
    await this.db.beginWriteTransaction();
    try {
      const version = await this.persistAggregate(mission, expectedVersion);
      const appended = await this.eventRepo.append({
        repositoryId: event.repositoryId,
        missionId: event.missionId,
        fromStatus: event.from,
        toStatus: event.to,
        trigger: event.trigger,
        agent: event.agent,
        occurredAt: event.occurredAt,
        idempotencyKey: event.idempotencyKey,
        ...(event.returnIdentity ? { returnIdentity: event.returnIdentity } : {}),
      });
      if (!appended) {
        throw new DuplicateLaneEventError(event.idempotencyKey);
      }
      await this.db.commitTransaction();
      return version;
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }
  }

  private async saveWaveAggregate(
    parent: Mission,
    expectedVersion: MissionVersion,
    children: readonly Mission[],
  ): Promise<{ readonly parentVersion: MissionVersion; readonly childVersions: readonly MissionVersion[] }> {
    await this.db.beginWriteTransaction();
    try {
      const parentVersion = await this.persistAggregate(parent, expectedVersion);
      const childVersions: MissionVersion[] = [];
      for (const child of children) { childVersions.push(await this.persistAggregate(child, null)); }
      await this.db.commitTransaction();
      return { parentVersion, childVersions };
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }
  }

  async saveKnownRepository(observation: KnownRepositoryObservation): Promise<void> {
    await this.db.execute(
      `INSERT INTO known_repositories (id, path, display_name, last_accessed)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         display_name = excluded.display_name,
         last_accessed = excluded.last_accessed`,
      [
        observation.repository.id,
        observation.path,
        observation.repository.displayName,
        observation.lastAccessed,
      ],
    );
  }

  async loadKnownRepository(id: RepositoryId): Promise<KnownRepositoryObservation | null> {
    const rows = await this.db.query<{
      id: string;
      path: string;
      display_name: string | null;
      last_accessed: string;
    }>(
      'SELECT id, path, display_name, last_accessed FROM known_repositories WHERE id = ?',
      [id],
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      repository: {
        id,
        displayName: row.display_name ?? row.path,
      },
      path: row.path,
      lastAccessed: row.last_accessed,
    };
  }

  // -----------------------------------------------------------------------
  private async persistAggregate(
    mission: Mission,
    expectedVersion: MissionVersion | null,
  ): Promise<MissionVersion> {
    await authorizeSqliteMissionWrite(this.db, mission.id);
    // MissionStore is a public persistence port: callers other than the brief
    // service may save an aggregate, so reject an invalid brief or gate list
    // before any relational row can make a Mission unloadable on restart.
    mission = normalizeStoredMission(mission);
    await this.validateDefectAttribution(mission);
    const nextVersion = await writeMissionRoot(this.db, mission, expectedVersion);
    if (expectedVersion !== null) { await this.clearAggregateValues(mission); }

    mission = alignStoredCriteria(mission);
    await this.db.execute('UPDATE missions SET next_success_criterion_id = ? WHERE id = ?', [mission.nextSuccessCriterionId!, mission.id]);
    const checkpointHistory = new SqliteCheckpointHistory(this.db);
    await checkpointHistory.append(mission);
    await checkpointHistory.captureRounds(mission);
    await this.valueWriter.insert(mission);
    return nextVersion;
  }

  private async validateDefectAttribution(mission: Mission): Promise<void> {
    const attribution = mission.defectProvenance?.attribution;
    if (attribution?.kind !== 'originating-mission') { return; }
    const rows = await this.db.query<{ repository_id: string }>(
      'SELECT repository_id FROM missions WHERE id = ?',
      [attribution.missionId],
    );
    if (rows.length === 0) {
      throw new DefectProvenanceViolation(`Originating Mission ${attribution.missionId} does not exist`);
    }
    if (rows[0]!.repository_id !== mission.repositoryId) {
      throw new DefectProvenanceViolation(
        `Originating Mission ${attribution.missionId} belongs to a different repository`,
      );
    }
  }

  /**
   * Clear the value collections a write is about to rewrite.
   *
   * The `mission_reviews` row is kept whenever the mission still has a Review:
   * every other review table cascades from it, so deleting it discards the
   * rounds, findings, resolutions, stage launches and the whole review-event
   * audit trail on every unrelated save. The row is updated in place by
   * `insertReview` instead, and its children are cleared explicitly here.
   */
  private async clearAggregateValues(mission: Mission): Promise<void> {
    const id = mission.id;
    await this.db.execute('DELETE FROM mission_external_task_refs WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_briefs WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_declared_gates WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_success_criteria WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_dependencies WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_defect_provenance WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_checkpoints WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_labels WHERE mission_id = ?', [id]);
    if (!mission.review) {
      // No Review to keep: the cascade clears every review table.
      await this.db.execute('DELETE FROM mission_reviews WHERE mission_id = ?', [id]);
      return;
    }
    await this.db.execute('DELETE FROM mission_review_events WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_stage_launches WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_resolutions WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_findings WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_rounds WHERE mission_id = ?', [id]);
  }
}

function normalizeStoredMission(mission: Mission): Mission {
  mission = { ...mission, title: missionTitle(mission.title, mission.id) };
  if (mission.brief) {
    mission = { ...mission, brief: missionBrief(mission.brief) };
  }
  if (mission.declaredGates && mission.declaredGates.length > 0) {
    mission = { ...mission, declaredGates: declaredGates(mission.declaredGates) };
  }
  if (mission.successCriteria && mission.successCriteria.length > 0) {
    mission = { ...mission, successCriteria: successCriteria(mission.successCriteria) };
  }
  if (mission.completedSuccessCriteria && mission.completedSuccessCriteria.length > 0) {
    mission = { ...mission, completedSuccessCriteria: completedCriteria(mission.completedSuccessCriteria, mission.successCriteria?.length ?? 0) };
  }
  if (mission.dependencies && mission.dependencies.length > 0) {
    mission = { ...mission, dependencies: missionDependencies(mission.dependencies, mission.id) };
  }
  if (mission.defectProvenance) {
    mission = { ...mission, defectProvenance: defectProvenance(mission.defectProvenance, mission.id) };
  }
  return mission;
}

function alignStoredCriteria(mission: Mission): Mission {
  mission = replaceSuccessCriteria(mission, mission.successCriteria ?? [], mission.successCriterionIds);
  mission = {
    ...mission, checkpoints: mission.checkpoints.map(checkpoint => ({
      ...checkpoint,
      goalCheck: identifyGoalCheckRows(checkpoint.goalCheck, criterionContract(mission))
    }))
  };
  return mission;
}
