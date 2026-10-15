import type { ClassifierStatisticsInput, PrDecisionFact } from '../../application/review-classification/statistics.js';
import type { ClassifierStatisticsReadPort, ReviewClassificationTelemetryPort } from '../../application/ports/review-classification-telemetry.js';
import { assertClassifierReviewSource, type ClassifierReviewSource } from '../../domain/classifier-review.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

/** Local Review and measurements only; no provider queries or inferred workflow state. */
export class SqliteClassifierStatisticsReader implements ClassifierStatisticsReadPort {
  constructor(private readonly _db: SqliteDatabaseAdapter, private readonly _telemetry: ReviewClassificationTelemetryPort,
    private readonly _repository: string) {}
  async read(): Promise<ClassifierStatisticsInput> {
    const repository = this._repository;
    const rows = await this._db.query<{ mission_id: string; round_number: number; decided_at: string | null;
      decision_kind: string; classifier_source: string | null; mechanical_source: string | null; change_kind: string }>(
      `SELECT r.mission_id, r.round_number, r.decided_at, r.decision_kind, r.classifier_source, r.mechanical_source, r.change_kind
       FROM mission_review_rounds r JOIN missions m ON m.id = r.mission_id
       WHERE m.repository_id = ? AND r.decision_kind IN ('approved', 'changes-requested')`, [repository]);
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
        } catch { source = null; partial = true; }
      }
      decisions.push({ id: `${repository}:${row.mission_id}:${row.round_number}`,
        repository, mission: row.mission_id, round: row.round_number,
        decidedAt: row.decided_at, source: row.mechanical_source ? 'mechanical' : source ? 'classifier' : 'reviewer',
        outcome: row.decision_kind === 'approved' ? 'clear' : 'implementer' });
    }
    return { decisions, attempts: await this._telemetry.calls(repository), coverage: partial ? 'partial' : 'complete' };
  }
}
