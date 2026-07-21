import { collectHistoricalStatsBackfill } from '../commands/stats-backfill.js';
import * as stats from '../commands/stats.js';
import type { DurableEvidence } from '../application/contracts.js';
import type { StatsBackfillPort, StatsProjection, StatsRow } from '../application/ports.js';

export class LegacyStatsBackfillAdapter implements StatsBackfillPort {
  constructor(private readonly _rootDir: string) {}

  async readProjection(options: { readonly filePath?: string | null } = {}): Promise<StatsProjection> {
    const report = collectHistoricalStatsBackfill(this._rootDir, options.filePath ?? null);
    const rows: StatsRow[] = report.rows.map(row => ({ ...row }));
    return {
      rows,
      unresolved: report.unresolved,
      skipped: report.skipped,
      sources: [{ source: 'stats', status: 'fresh', value: 'legacy stats report' }],
    };
  }

  async applyRows(rows: readonly StatsRow[], options: { readonly filePath?: string | null } = {}): Promise<readonly DurableEvidence[]> {
    const filePath = options.filePath || stats.resolveStatsPath({ ensureDir: true });
    const evidence: DurableEvidence[] = [];
    for (const row of rows) {
      const result = stats.upsertStatsRow(row as Record<string, string>, { filePath, rootDir: this._rootDir });
      if (result.changed) {
        evidence.push({ id: row.mission, source: 'stats', detail: `legacy stats row applied for ${row.mission}` });
      }
    }
    return evidence;
  }
}
