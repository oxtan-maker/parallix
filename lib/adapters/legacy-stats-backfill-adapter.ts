import { collectHistoricalStatsBackfill } from '../commands/stats-backfill.js';
import * as stats from '../commands/stats.js';
import type { DurableEvidence } from '../application/contracts.js';
import type { StatsBackfillPort, StatsProjection, StatsRow } from '../application/ports.js';

export class LegacyStatsBackfillAdapter implements StatsBackfillPort {
  constructor(private readonly _rootDir: string) {}

  async readProjection(): Promise<StatsProjection> {
    const report = collectHistoricalStatsBackfill(this._rootDir);
    const rows: StatsRow[] = report.rows.map(row => ({ mission: row.mission, implementer: row.implementer }));
    return { rows, sources: [{ source: 'stats', status: 'fresh', value: 'legacy stats report' }] };
  }

  async applyRows(rows: readonly StatsRow[]): Promise<readonly DurableEvidence[]> {
    const filePath = stats.resolveStatsPath({ ensureDir: true });
    for (const row of rows) {
      stats.upsertStatsRow({ mission: row.mission, implementer: row.implementer }, { filePath, rootDir: this._rootDir });
    }
    return rows.map(row => ({ id: row.mission, source: 'stats', detail: `legacy stats row applied for ${row.mission}` }));
  }
}
