import type { MissionId } from '../../domain/mission.js';
import type { ReviewProjectionFact } from '../../application/projections/board-readers.js';
import { hydrateReviewProjection, type MissionReviewEventRecord, type MissionReviewFindingRecord, type MissionReviewResolutionRecord, type MissionReviewRoundRecord } from './mission-serialization.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

type ReviewDatabase = Pick<SqliteDatabaseAdapter, 'query'>;
const MAX_MISSIONS_PER_BATCH = 999;

function byMission<T extends { readonly mission_id: string }>(rows: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const values = grouped.get(row.mission_id) ?? [];
    values.push(row);
    grouped.set(row.mission_id, values);
  }
  return grouped;
}

export class SqliteReviewProjectionReader {
  private readonly db: ReviewDatabase;

  constructor(database: ReviewDatabase) {
    this.db = database;
  }

  async loadReviews(ids: readonly MissionId[]): Promise<ReadonlyMap<MissionId, ReviewProjectionFact>> {
    if (ids.length === 0) { return new Map(); }
    if (ids.length > MAX_MISSIONS_PER_BATCH) {
      const chunks: ReadonlyMap<MissionId, ReviewProjectionFact>[] = [];
      for (let offset = 0; offset < ids.length; offset += MAX_MISSIONS_PER_BATCH) {
        chunks.push(await this.loadReviews(ids.slice(offset, offset + MAX_MISSIONS_PER_BATCH)));
      }
      return new Map(chunks.flatMap((chunk) => [...chunk]));
    }
    const placeholders = ids.map(() => '?').join(', ');
    const [reviewRounds, findings, resolutions, reviewEvents] = await Promise.all([
      this.db.query<MissionReviewRoundRecord>(
        `SELECT mission_id, position, round_number, change_kind, provider,
                provider_change_id, provider_url, source_branch, target_branch,
                revision, reviewer, implementer, started_at, decision_kind,
                decided_at, decision_comment, approval_source_kind,
                approval_source_provider, responded_at, resulting_revision,
                phase, disposition, reviewer_retry_count, implementer_retry_count,
                implementer_response_content, item_dispositions, blocked_reason
         FROM mission_review_rounds WHERE mission_id IN (${placeholders})
         ORDER BY mission_id, position`, ids),
      this.db.query<MissionReviewFindingRecord>(
        `SELECT mission_id, round_position, position, finding_id, summary, location
         FROM mission_review_findings WHERE mission_id IN (${placeholders})
         ORDER BY mission_id, round_position, position`, ids),
      this.db.query<MissionReviewResolutionRecord>(
        `SELECT mission_id, round_position, position, finding_id, kind, explanation
         FROM mission_review_resolutions WHERE mission_id IN (${placeholders})
         ORDER BY mission_id, round_position, position`, ids),
      this.db.query<MissionReviewEventRecord>(
        `SELECT mission_id, position, event_type, round_number, phase, actor,
                content, disposition, verdict, item_dispositions, blocked_reason,
                followup_reference, created_at
         FROM mission_review_events WHERE mission_id IN (${placeholders})
         ORDER BY mission_id, position`, ids),
    ]);

    const roundsByMission = byMission(reviewRounds);
    const findingsByMission = byMission(findings);
    const resolutionsByMission = byMission(resolutions);
    const eventsByMission = byMission(reviewEvents);
    return new Map(ids.map((id) => {
      const review = hydrateReviewProjection({
        reviewRounds: roundsByMission.get(id) ?? [],
        findings: findingsByMission.get(id) ?? [],
        resolutions: resolutionsByMission.get(id) ?? [],
        reviewEvents: eventsByMission.get(id) ?? [],
      });
      const current = review?.rounds.at(-1);
      const approval = current?.phase === 'approved'
        ? { subject: current.subject, approvedAt: current.decision?.kind === 'approved' ? current.decision.decidedAt : null }
        : null;
      return [id, { review, approval }];
    }));
  }
}
