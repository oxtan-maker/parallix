import { TextEncoder } from 'node:util';
import type { ClassifierObservation, ClassifierCallMeasurement, ReviewClassificationTelemetryPort } from '../../application/ports/review-classification-telemetry.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

/** Measurement samples belong to a decision; fingerprints deduplicate writes, not entities. */
export class SqliteReviewClassificationStore implements ReviewClassificationTelemetryPort {
  constructor(private readonly _db: SqliteDatabaseAdapter) {}
  private payload(value: unknown, maximum = 16384): string {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > maximum) { throw new Error('Classifier telemetry exceeds bounded allowance'); }
    return text;
  }
  async recordCall(sample: ClassifierCallMeasurement): Promise<void> {
    if (!sample.decisionId || !sample.fingerprint || !sample.repository || !sample.mission
      || !Number.isFinite(Date.parse(sample.observedAt)) || (sample.score !== null && sample.score > 1)) {
      throw new Error('Invalid classifier measurement identity');
    }
    for (const value of [sample.preparationMs, sample.classificationMs, sample.score]) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) { throw new Error('Invalid classifier measurement'); }
    }
    this.payload(sample);
    await this._db.beginImmediateTransaction();
    try {
      const [row] = await this._db.query<{ samples: string; repository_id: string }>(
        'SELECT samples, repository_id FROM review_classifier_measurements WHERE decision_id = ?', [sample.decisionId]);
      if (row && row.repository_id !== sample.repository) { throw new Error('Classifier measurement repository mismatch'); }
      const samples = row ? JSON.parse(row.samples) as ClassifierCallMeasurement[] : [];
      const index = samples.findIndex(s => s.fingerprint === sample.fingerprint);
      let changed = false;
      if (index >= 0) {
        const { route: beforeRoute, reason: beforeReason, ...before } = samples[index];
        const { route: afterRoute, reason: afterReason, ...after } = sample;
        if (JSON.stringify(before) !== JSON.stringify(after)) { throw new Error('Classifier call fingerprint reused for different evidence or cost'); }
        if (beforeRoute !== afterRoute || beforeReason !== afterReason) {
          if (beforeRoute === 'reviewer' || afterRoute !== 'reviewer') { throw new Error('Classifier call routing correction must retain fallback'); }
          samples[index] = sample; changed = true;
        }
      } else {
        if (samples.length >= 64) { throw new Error('Classifier decision measurement sample limit reached'); }
        samples.push(sample); changed = true;
      }
      if (changed) {
        await this._db.execute(`INSERT INTO review_classifier_measurements (decision_id, repository_id, samples) VALUES (?, ?, ?)
          ON CONFLICT(decision_id) DO UPDATE SET samples = excluded.samples`, [sample.decisionId, sample.repository, this.payload(samples, 131072)]);
      }
      await this._db.commitTransaction();
    } catch (error) { await this._db.rollbackTransaction(); throw error; }
  }
  async recordObservation(observation: ClassifierObservation): Promise<void> {
    for (const value of [observation.cycleMs, observation.ordinaryReviewMs, observation.newFindings]) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) { throw new Error('Invalid classifier observation'); }
    }
    await this._db.execute(`INSERT INTO review_classifier_observations (decision_id, payload) VALUES (?, ?)
      ON CONFLICT(decision_id) DO UPDATE SET payload = excluded.payload`, [observation.decisionId, this.payload(observation)]);
  }
  async calls(repository: string): Promise<readonly ClassifierCallMeasurement[]> {
    return (await this._db.query<{ samples: string }>('SELECT samples FROM review_classifier_measurements WHERE repository_id = ? ORDER BY decision_id', [repository]))
      .flatMap(row => JSON.parse(row.samples) as ClassifierCallMeasurement[]);
  }
  async observations(repository: string): Promise<readonly ClassifierObservation[]> {
    return (await this._db.query<{ payload: string }>(`SELECT o.payload FROM review_classifier_observations o
      JOIN review_classifier_measurements m ON m.decision_id = o.decision_id WHERE m.repository_id = ?`, [repository]))
      .map(row => JSON.parse(row.payload) as ClassifierObservation);
  }
}
