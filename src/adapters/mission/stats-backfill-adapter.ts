import type { MeasurementRecord } from '../../application/measurement-ports.js';
import { createReviewStatisticsEvidenceReader } from '../review/review-statistics-evidence.js';
import { resolveMeasurementStore } from '../sqlite/measurement-store.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { reconstructReviewMeasurements } from '../../application/stats-backfill-service.js';
import { repositoryId } from '../../domain/repository.js';
import * as stats from '../cli/commands/stats.js';
import type { DurableEvidence } from '../../application/contracts.js';
import type { StatsBackfillPort, StatsProjection, StatsRow } from '../../application/ports.js';

export class LegacyStatsBackfillAdapter implements StatsBackfillPort {
  private readonly evidenceReader: ReturnType<typeof createReviewStatisticsEvidenceReader>;
  constructor(
    private readonly _rootDir: string,
    private readonly _measurementStore: { configuration?: ParallixConfiguration; dbPath?: string; store?: import('../../application/measurement-ports.js').MeasurementStorePort } = {},
    private readonly _missionStore: Pick<import('../../application/domain-ports.js').MissionStore, 'loadByRepository'> | null = null,
  ) { this.evidenceReader = createReviewStatisticsEvidenceReader(_rootDir); }

  async readProjection(): Promise<StatsProjection> {
    if (!this._missionStore?.loadByRepository) { throw new Error('Stats reconstruction requires repository Mission history'); }
    const repo = repositoryId(stats.resolveStatsRepoName(this._rootDir));
    const missions = await this._missionStore.loadByRepository(repo);
    const store = this._measurementStore.store ?? resolveMeasurementStore(this._measurementStore);
    const existing = store.listMeasurements().filter(record => record.repo === repo)
      .map(record => ({ ...stats.measurementToStatsRow(record), actorKey: record.actorKey }));
    const evidence = new Map<string, import('../../application/services/review-statistics.js').ReviewStatisticsEvidence>();
    for (const mission of missions) {
      if (mission.status === 'done') { evidence.set(mission.id, await this.evidenceReader(mission.review)); }
    }
    return reconstructReviewMeasurements(missions, existing, evidence);
  }

  async applyRows(rows: readonly StatsRow[]): Promise<readonly DurableEvidence[]> {
    const evidence: DurableEvidence[] = [];
    const store = this._measurementStore.store ?? resolveMeasurementStore(this._measurementStore);
    const existing = new Map(store.listMeasurements().map(record => [measurementKey(record), record]));
    for (const row of rows) {
      const incoming = stats.statsRowToMeasurement(stats.canonicalizeStatsRow(row));
      if (row.actorKey !== undefined) { incoming.actorKey = row.actorKey; }
      const previous = existing.get(measurementKey(incoming));
      const result = store.upsertMeasurement(repairMeasurement(previous, incoming));
      if (result.changed) {
        evidence.push({ id: row.mission ?? '', source: 'stats', detail: `reconstructed review statistics applied for ${row.mission}` });
      }
    }
    return evidence;
  }
}

function measurementKey(record: MeasurementRecord): string {
  return JSON.stringify([record.repo, record.mission, record.stage, record.actorKey]);
}
function repairMeasurement(previous: MeasurementRecord | undefined, incoming: MeasurementRecord): MeasurementRecord {
  const identity = { repo: incoming.repo, mission: incoming.mission, stage: incoming.stage, actorKey: incoming.actorKey,
    date: incoming.date, classification: incoming.classification, implementer: incoming.implementer };
  return { ...(previous ?? identity), pr_fix_rounds: incoming.pr_fix_rounds };
}
