import { collectHistoricalStatsBackfill } from '../cli/commands/stats-backfill.js';
import * as stats from '../cli/commands/stats.js';
import type { DurableEvidence } from '../../application/contracts.js';
import type { StatsBackfillPort, StatsProjection, StatsRow } from '../../application/ports.js';

export class LegacyStatsBackfillAdapter implements StatsBackfillPort {
  /**
   * @param _rootDir Repository root the historical missions are read from.
   * @param _measurementStore Optional measurement-store selection so isolated
   *   tests bind a temporary database instead of `<PARALLIX_HOME>`.
   * @param _missionStore Operator Mission authority for the authoritative
   *   implementer/fix-round derivation (TASK-2378); `null` keeps the
   *   historical git-history-only fallback.
   */
  constructor(
    private readonly _rootDir: string,
    private readonly _measurementStore: { dbPath?: string; store?: unknown } = {},
    private readonly _missionStore: unknown = null,
  ) {}

  async readProjection(_options: { readonly filePath?: string | null } = {}): Promise<StatsProjection> {
    const report = await collectHistoricalStatsBackfill(this._rootDir, this._measurementStore, this._missionStore);
    const rows: StatsRow[] = report.rows.map(row => ({ ...row }));
    return {
      rows,
      unresolved: report.unresolved,
      skipped: report.skipped,
      sources: [{ source: 'stats', status: 'fresh', value: 'legacy stats report' }],
    };
  }

  async applyRows(rows: readonly StatsRow[], _options: { readonly filePath?: string | null } = {}): Promise<readonly DurableEvidence[]> {
    // architecture migration: rows are persisted through the measurement store, never a
    // CSV file. `options.filePath` is accepted for port compatibility and
    // deliberately ignored — no default execution resolves or writes stats.csv.
    const evidence: DurableEvidence[] = [];
    for (const row of rows) {
      const result = stats.upsertMeasurementRow(row as Record<string, string>, { rootDir: this._rootDir, ...this._measurementStore });
      if (result.changed) {
        evidence.push({ id: row.mission, source: 'stats', detail: `legacy stats row applied for ${row.mission}` });
      }
    }
    return evidence;
  }
}
