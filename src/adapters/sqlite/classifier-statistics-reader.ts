import type { ClassifierStatisticsInput, PrDecisionFact } from '../../application/review-classification/statistics.js';
import type { ClassifierStatisticsReadPort, ReviewClassificationTelemetryPort } from '../../application/ports/review-classification-telemetry.js';
import { assertClassifierReviewSource, type ClassifierReviewSource } from '../../domain/classifier-review.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { UsageRepository } from '../../application/ports/mission-measurements.js';

/** Local Review and measurements only; no provider queries or inferred workflow state. */
export class SqliteClassifierStatisticsReader implements ClassifierStatisticsReadPort {
  constructor(private readonly _db: SqliteDatabaseAdapter, private readonly _telemetry: ReviewClassificationTelemetryPort,
    private readonly _repository: string, private readonly _usage?: UsageRepository) {}
  async read(): Promise<ClassifierStatisticsInput> {
    const repository = this._repository;
    const rows = await this._db.query<{ mission_id: string; round_number: number; decided_at: string | null;
      decision_kind: string; classifier_source: string | null; change_kind: string }>(
      `SELECT r.mission_id, r.round_number, r.decided_at, r.decision_kind, r.classifier_source, r.change_kind
       FROM mission_review_rounds r JOIN missions m ON m.id = r.mission_id
       WHERE m.repository_id = ? AND r.decision_kind IS NOT NULL`, [repository]);
    const decisions: PrDecisionFact[] = [];
    let partial = false;
    for (const row of rows) {
      if (row.change_kind !== 'pull-request') { continue; }
      if (!row.decided_at) { partial = true; continue; }
      let source: ClassifierReviewSource | null = null;
      if (row.classifier_source) {
        try {
          source = JSON.parse(row.classifier_source) as ClassifierReviewSource;
          assertClassifierReviewSource(source);
        } catch { partial = true; continue; }
      }
      decisions.push({ id: source?.decisionId ?? `${repository}:${row.mission_id}:${row.round_number}`,
        decidedAt: row.decided_at, source: source ? 'classifier' : 'reviewer',
        outcome: row.decision_kind === 'approved' ? 'clear' : 'implementer' });
    }
    const cohorts = await this._db.query<{ mission: string; closedAt: string | null; reviewRounds: number; fixRounds: number }>(
      `SELECT m.id AS mission, m.closed_at AS closedAt,
       COUNT(CASE WHEN r.change_kind = 'pull-request' THEN 1 END) AS reviewRounds,
       COUNT(CASE WHEN r.change_kind = 'pull-request' AND r.decision_kind = 'changes-requested' THEN 1 END) AS fixRounds
       FROM missions m LEFT JOIN mission_review_rounds r ON r.mission_id = m.id
       WHERE m.repository_id = ? GROUP BY m.id`, [repository]);
    const usage = await this._usage?.findWhere(row => row.repo === repository) ?? [];
    const agentModels = usage.filter(row => row.mission && row.stage && row.stage !== 'default').map(row => ({
      mission: row.mission!, role: row.stage === 'review' ? 'reviewer' as const : 'implementer' as const,
      family: row.stage === 'review' ? row.reviewer_agent ?? 'unavailable' : row.implementer_agent ?? row.implementer ?? 'unavailable',
      provider: row.provider ?? null, model: row.model ?? null,
    }));
    return { decisions, missions: cohorts, agentModels, attempts: await this._telemetry.calls(repository),
      applied: decisions.filter(d => d.source === 'classifier').map(d => ({ decisionId: d.id, decidedAt: d.decidedAt, route: d.outcome })),
      observations: await this._telemetry.observations(repository), coverage: partial ? 'partial' : 'complete' };
  }
}
