import { defectProvenance, type DefectProvenance } from '../../domain/defect-provenance.js';
import { missionId, type MissionId } from '../../domain/mission.js';
import type {
  DefectProvenanceBackfillReport,
  DefectProvenanceBackfillRequest,
  DefectProvenanceBackfillRow,
} from '../../application/ports/defect-provenance-backfill.js';
import type { BoardLaneEventEntry } from '../../application/ports/operation-history.js';
import { missionLifecycles } from '../../application/projections/metrics-outcomes.js';
import { repositoryId as toRepositoryId } from '../../domain/repository.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

interface SelectedMission {
  readonly id: string;
  readonly completed_at: string;
  readonly attribution_disposition: string | null;
}

interface PlannedWrite {
  readonly missionId: MissionId;
  readonly provenance: DefectProvenance;
}

interface BackfillPlan {
  readonly rows: readonly DefectProvenanceBackfillRow[];
  readonly writes: readonly PlannedWrite[];
}

/** SQLite implementation behind the existing Mission-store boundary. */
export class SqliteDefectProvenanceBackfill {
  constructor(private readonly db: SqliteDatabaseAdapter) {}

  async preview(request: DefectProvenanceBackfillRequest): Promise<DefectProvenanceBackfillReport> {
    return report('preview', false, await this.plan(request), 0);
  }

  async apply(request: DefectProvenanceBackfillRequest): Promise<DefectProvenanceBackfillReport> {
    await this.db.beginWriteTransaction();
    try {
      const plan = await this.plan(request);
      if (plan.rows.some(row => row.disposition === 'failed')) {
        await this.db.rollbackTransaction();
        return report('apply', false, plan, 0);
      }
      for (const write of plan.writes) {
        await this.write(write);
      }
      await this.db.commitTransaction();
      return report('apply', true, plan, plan.writes.length);
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }
  }

  private async select(repositoryId: string): Promise<readonly SelectedMission[]> {
    const missions = await this.db.query<Omit<SelectedMission, 'completed_at'>>(
      `SELECT m.id, provenance.attribution_disposition
         FROM missions m
         JOIN mission_labels label ON label.mission_id = m.id AND label.label = 'bug'
         LEFT JOIN mission_defect_provenance provenance ON provenance.mission_id = m.id
        WHERE m.repository_id = ? AND m.status = 'done'`,
      [repositoryId],
    );
    const eventRows = await this.db.query<{
      readonly id: number;
      readonly repository_id: string;
      readonly mission_id: string;
      readonly from_status: string | null;
      readonly to_status: string;
      readonly trigger: string;
      readonly agent: string;
      readonly occurred_at: string;
      readonly idempotency_key: string;
    }>(`SELECT id, repository_id, mission_id, from_status, to_status, trigger, agent,
               occurred_at, idempotency_key
          FROM board_lane_events
         WHERE repository_id = ?`, [repositoryId]);
    const events: BoardLaneEventEntry[] = eventRows.map(row => ({
      id: row.id,
      repositoryId: row.repository_id,
      missionId: row.mission_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      trigger: row.trigger,
      agent: row.agent,
      occurredAt: row.occurred_at,
      idempotencyKey: row.idempotency_key,
    }));
    const lifecycles = missionLifecycles(events, toRepositoryId(repositoryId));
    return missions.flatMap(mission => {
      const completedAt = lifecycles.get(missionId(mission.id))?.completedAt;
      return completedAt ? [{ ...mission, completed_at: completedAt }] : [];
    }).sort((left, right) => Date.parse(right.completed_at) - Date.parse(left.completed_at)
      || left.id.localeCompare(right.id)).slice(0, 100);
  }

  private async plan(request: DefectProvenanceBackfillRequest): Promise<BackfillPlan> {
    const selected = await this.select(request.repositoryId);
    const entries = new Map<string, typeof request.entries>();
    for (const entry of request.entries) {
      entries.set(entry.missionId, [...(entries.get(entry.missionId) ?? []), entry]);
    }
    const rows: DefectProvenanceBackfillRow[] = [];
    const writes: PlannedWrite[] = [];
    for (const selectedMission of selected) {
      const id = missionId(selectedMission.id);
      if (selectedMission.attribution_disposition !== null && !request.replaceExisting) {
        rows.push({ missionId: id, completedAt: selectedMission.completed_at, disposition: 'already-populated' });
        continue;
      }
      const matches = entries.get(id) ?? [];
      if (matches.length !== 1) {
        rows.push({ missionId: id, completedAt: selectedMission.completed_at, disposition: 'failed',
          reason: matches.length === 0 ? 'no provenance supplied' : 'duplicate provenance supplied' });
        continue;
      }
      try {
        const provenance = defectProvenance(matches[0]!.provenance, id);
        await this.validateOrigin(provenance, request.repositoryId);
        const disposition = provenance.attribution.kind === 'originating-mission'
          ? 'attributed' as const
          : provenance.attribution.kind === 'unresolved'
            ? 'unresolved' as const
            : 'external-or-pre-mission' as const;
        rows.push({ missionId: id, completedAt: selectedMission.completed_at, disposition });
        writes.push({ missionId: id, provenance });
      } catch (error) {
        rows.push({ missionId: id, completedAt: selectedMission.completed_at, disposition: 'failed',
          reason: error instanceof Error ? error.message : 'invalid provenance' });
      }
    }
    return { rows, writes };
  }

  private async validateOrigin(provenance: DefectProvenance, repositoryId: string): Promise<void> {
    if (provenance.attribution.kind !== 'originating-mission') { return; }
    const rows = await this.db.query<{ repository_id: string }>(
      'SELECT repository_id FROM missions WHERE id = ?', [provenance.attribution.missionId],
    );
    if (rows.length === 0) { throw new Error(`Originating Mission ${provenance.attribution.missionId} does not exist`); }
    if (rows[0]!.repository_id !== repositoryId) {
      throw new Error(`Originating Mission ${provenance.attribution.missionId} belongs to a different repository`);
    }
  }

  private async write({ missionId, provenance }: PlannedWrite): Promise<void> {
    await this.db.execute(
      `INSERT INTO mission_defect_provenance
         (mission_id, root_cause_summary, investigation_evidence, attribution_disposition, originating_mission_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(mission_id) DO UPDATE SET
         root_cause_summary = excluded.root_cause_summary,
         investigation_evidence = excluded.investigation_evidence,
         attribution_disposition = excluded.attribution_disposition,
         originating_mission_id = excluded.originating_mission_id`,
      [missionId, provenance.rootCauseSummary, provenance.investigationEvidence, provenance.attribution.kind,
        provenance.attribution.kind === 'originating-mission' ? provenance.attribution.missionId : null],
    );
    await this.db.execute('UPDATE missions SET version = version + 1 WHERE id = ?', [missionId]);
  }
}

function report(mode: 'preview' | 'apply', committed: boolean, plan: BackfillPlan, applied: number): DefectProvenanceBackfillReport {
  const count = (disposition: DefectProvenanceBackfillRow['disposition']) => plan.rows.filter(row => row.disposition === disposition).length;
  return {
    mode, committed, targeted: plan.rows.length,
    attributed: count('attributed'), externalOrPreMission: count('external-or-pre-mission'),
    unresolved: count('unresolved'), alreadyPopulated: count('already-populated'), failed: count('failed'),
    applied, rows: plan.rows,
  };
}
