import { createReviewStatisticsEvidenceReader, workflowReturnsFromRecoveredEvidence } from '../review/review-statistics-evidence.js';
import { collectLocalStatsRecovery } from '../review/stats-recovery-collector.js';
import { liveOperatorDatabasePath, resolveIsolatedOperatorCopy } from '../sqlite/isolated-operator-copy.js';
import { resolveMeasurementStore } from '../sqlite/measurement-store.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { reconstructReviewMeasurements } from '../../application/stats-backfill-service.js';
import { repositoryId } from '../../domain/repository.js';
import * as stats from '../cli/commands/stats.js';
import type { DurableEvidence } from '../../application/contracts.js';
import type { StatsBackfillPort, StatsProjection, StatsRecoveryTarget } from '../../application/ports.js';
import { mergeRecoveryCollections, reconcileRecoveryEvidence, recoveryAudit,
  recoveryConflictIdentity, type StatsRecoveryCollection } from '../../application/stats-recovery-evidence.js';

interface RecoverySources {
  readonly laneMoves?: Pick<import('../../application/ports/operation-history.js').BoardLaneEventRepository, 'findByRepositoryId'>;
  readonly operationalHistory?: Pick<import('../../application/ports/operation-history.js').OperationalHistoryRepository,
    'findAll' | 'findByType' | 'append'>;
  readonly provider?: (_repositoryId: string) => Promise<StatsRecoveryCollection>;
}

/** Operator-state repositories one recovery run reads and writes through. */
interface RecoveryState {
  readonly measurements: import('../../application/measurement-ports.js').MeasurementStorePort;
  readonly missions: { readonly loadByRepository: NonNullable<import('../../application/domain-ports.js').MissionStore['loadByRepository']> };
  readonly operationalHistory?: RecoverySources['operationalHistory'];
  readonly laneMoves?: RecoverySources['laneMoves'];
}

/** Historical evidence recovery behind the existing backfill application port. */
export class StatsRecoveryAdapter implements StatsBackfillPort {
  private readonly evidenceReader: ReturnType<typeof createReviewStatisticsEvidenceReader>;
  constructor(
    private readonly rootDir: string,
    private readonly measurementStore: { configuration?: ParallixConfiguration; dbPath?: string;
      store?: import('../../application/measurement-ports.js').MeasurementStorePort } = {},
    private readonly missionStore: Pick<import('../../application/domain-ports.js').MissionStore, 'loadByRepository'> | null = null,
    private readonly workflowReturns?: (_missionId: string) => Promise<readonly import('../../application/services/review-statistics.js').WorkflowReturn[] | undefined>,
    private readonly recovery: RecoverySources = {},
  ) { this.evidenceReader = createReviewStatisticsEvidenceReader(rootDir); }

  async readProjection(target?: StatsRecoveryTarget): Promise<StatsProjection> {
    if (!this.missionStore?.loadByRepository) { throw new Error('Stats recovery requires repository Mission history'); }
    const state = this.state(target, { loadByRepository: this.missionStore.loadByRepository.bind(this.missionStore) });
    const repo = repositoryId(stats.resolveStatsRepoName(this.rootDir));
    const missions = await state.missions.loadByRepository(repo);
    const collection = await this.collect(repo, missions, state);
    const existing = state.measurements.listMeasurements().filter(record => record.repo === repo)
      .map(record => ({ ...stats.measurementToStatsRow(record), actorKey: record.actorKey }));
    const evidence = new Map<string, import('../../application/services/review-statistics.js').ReviewStatisticsEvidence>();
    for (const mission of missions) {
      if (mission.status !== 'done') { continue; }
      const retained = await this.workflowReturns?.(mission.id);
      const recovered = workflowReturnsFromRecoveredEvidence(collection.evidence
        .filter(item => item.links.missionId === mission.id));
      evidence.set(mission.id, await this.evidenceReader(mission.review,
        retained === undefined && recovered.length === 0 ? undefined : [...retained ?? [], ...recovered]));
    }
    const projection = reconstructReviewMeasurements(missions, existing, evidence);
    return { ...projection, recovery: collection,
      recoveryAudit: recoveryAudit(collection, await this.existingRecoveryIdentities(state.operationalHistory)) };
  }

  async applyProjection(projection: StatsProjection, target?: StatsRecoveryTarget): Promise<readonly DurableEvidence[]> {
    const history = this.state(target).operationalHistory;
    if (!history) { throw new Error('Stats recovery evidence store is unavailable'); }
    const existing = await this.existingRecoveryIdentities(history);
    const existingConflicts = await this.existingRecoveryConflictIdentities(history);
    const durable: DurableEvidence[] = [];
    for (const evidence of projection.recovery?.evidence ?? []) {
      if (existing.has(evidence.identity)) { continue; }
      await history.append({ eventType: 'stats.recovery.evidence', createdAt: evidence.observedAt,
        eventData: JSON.stringify({ missionId: evidence.links.missionId, repositoryId: evidence.links.repositoryId, evidence }) });
      existing.add(evidence.identity);
      durable.push({ id: evidence.identity, source: 'stats', detail: `${evidence.source}: ${evidence.provenance}` });
    }
    for (const conflict of projection.recovery?.conflicts ?? []) {
      const identity = recoveryConflictIdentity(conflict);
      if (existingConflicts.has(identity)) { continue; }
      await history.append({ eventType: 'stats.recovery.conflict', createdAt: conflict.conflicting.observedAt,
        eventData: JSON.stringify({ repositoryId: conflict.retained.links.repositoryId, conflictIdentity: identity, conflict }) });
      existingConflicts.add(identity);
      durable.push({ id: identity, source: 'stats', detail: `recovery conflict: ${conflict.identity}` });
    }
    if (durable.length > 0) {
      await history.append({ eventType: 'stats.recovery.audit', createdAt: new Date().toISOString(),
        eventData: JSON.stringify({ repositoryId: projection.recovery?.evidence[0]?.links.repositoryId ?? null,
          audit: projection.recoveryAudit, reportComparison: projection.changes ?? [], appliedEvidence: durable.length }) });
    }
    return durable;
  }

  /** Reads and writes go to the isolated copy whenever the run names one. */
  private state(target?: StatsRecoveryTarget,
    missions?: RecoveryState['missions']): RecoveryState {
    if (!target) {
      if (!missions) { throw new Error('Stats recovery requires repository Mission history'); }
      return { measurements: this.measurementStore.store ?? resolveMeasurementStore(this.measurementStore),
        missions,
        operationalHistory: this.recovery.operationalHistory, laneMoves: this.recovery.laneMoves };
    }
    const copy = resolveIsolatedOperatorCopy({ databasePath: target.databasePath, configuration: this.measurementStore.configuration,
      snapshotFrom: this.measurementStore.dbPath ?? liveOperatorDatabasePath(this.measurementStore.configuration),
      materialize: target.materialize });
    return { measurements: copy.measurements, missions: copy.missions,
      operationalHistory: copy.operationalHistory, laneMoves: copy.boardLaneEvents };
  }

  private async existingRecoveryIdentities(history?: RecoverySources['operationalHistory']): Promise<Set<string>> {
    const existing = new Set<string>();
    if (!history) { return existing; }
    for (const entry of await history.findByType('stats.recovery.evidence')) {
      try {
        const parsed = JSON.parse(entry.eventData) as { evidence?: { identity?: string } };
        if (parsed.evidence?.identity) { existing.add(parsed.evidence.identity); }
      } catch { /* A malformed old row cannot suppress valid evidence. */ }
    }
    return existing;
  }


  private async existingRecoveryConflictIdentities(history: NonNullable<RecoverySources['operationalHistory']>): Promise<Set<string>> {
    const existing = new Set<string>();
    for (const entry of await history.findByType('stats.recovery.conflict')) {
      try {
        const parsed = JSON.parse(entry.eventData) as { conflictIdentity?: string };
        if (parsed.conflictIdentity) { existing.add(parsed.conflictIdentity); }
      } catch { /* A malformed old row cannot suppress a valid conflict. */ }
    }
    return existing;
  }

  private async collect(repo: string, missions: readonly import('../../domain/mission.js').Mission[],
    state: RecoveryState): Promise<StatsRecoveryCollection> {
    const local = state.laneMoves && state.operationalHistory
      ? collectLocalStatsRecovery({ missions, laneMoves: await state.laneMoves.findByRepositoryId(repo),
        operationalHistory: await state.operationalHistory.findAll() }, repo)
      : reconcileRecoveryEvidence([]);
    const provider = this.recovery.provider ? await this.recovery.provider(repo) : reconcileRecoveryEvidence([]);
    return mergeRecoveryCollections([local, provider]);
  }
}
