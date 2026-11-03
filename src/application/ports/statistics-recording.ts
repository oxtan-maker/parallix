import type { Review } from '../../domain/review.js';
import type { StatsRow } from '../services/statistics-row.js';
import type { StatsMissionFlow } from './cli-workflows.js';

export interface StatisticsWriteResult {
  readonly changed: boolean;
  readonly row: StatsRow;
  readonly data: { readonly headers: readonly string[]; readonly rows: readonly StatsRow[] };
}

/** Concrete mechanisms; classification, merge policy and ordering stay in application. */
export interface StatisticsRecordingPort {
  readClassification(_slug: string): { readonly classification: string | null; readonly error?: string };
  readStoredClassification(_slug: string): Promise<string>;
  readReview(_slug: string): Promise<Review | null>;
  readReviewEvidence(_review: Review | null): Promise<import('../services/review-statistics.js').ReviewStatisticsEvidence>;
  readMeasurements(): readonly StatsRow[];
  upsert(_row: StatsRow): StatisticsWriteResult;
  readonly repositoryName: string;
  readMissionFlow(): Promise<readonly StatsMissionFlow[] | null>;
}
