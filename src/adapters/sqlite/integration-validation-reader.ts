import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { RestorationValidation } from '../../domain/integration-approval-restoration.js';
import { INTEGRATION_VALIDATION_EVENT_TYPE, INTEGRATION_VALIDATION_FAILED_EVENT_TYPE, parseIntegrationValidationMarker } from '../../application/integrate/validation-marker.js';

/** Read the latest existing sha-keyed marker; malformed/unavailable evidence fails closed. */
export class SqliteIntegrationValidationReader {
  constructor(private readonly _db: SqliteDatabaseAdapter) {}
  async read(missionId: string): Promise<RestorationValidation | null> {
    const rows = await this._db.query<{ id: number; event_type: string; event_data: string; created_at: string }>(
      "SELECT id, event_type, event_data, created_at FROM operational_history WHERE event_type IN (?, ?) AND json_extract(event_data, '$.missionId') = ? ORDER BY id DESC LIMIT 1",
      [INTEGRATION_VALIDATION_EVENT_TYPE, INTEGRATION_VALIDATION_FAILED_EVENT_TYPE, missionId]);
    const row = rows[0];
    const marker = parseIntegrationValidationMarker(row ? { eventType: INTEGRATION_VALIDATION_EVENT_TYPE, eventData: row.event_data } : null);
    if (!row || !marker) { return null; }
    const data = JSON.parse(row.event_data) as { baseline?: unknown; failed?: unknown };
    return { ...marker, baseline: typeof data.baseline === 'string' ? data.baseline : null,
      failed: row.event_type === INTEGRATION_VALIDATION_FAILED_EVENT_TYPE || data.failed === true, createdAt: row.created_at, reference: `operational_history:${row.id}` };
  }
}
