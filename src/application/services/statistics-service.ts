/**
 * Canonical statistics semantics shared by presentation adapters.
 *
 * This is deliberately dependency-light: the CLI's persisted telemetry rows
 * and board's usage rows have compatible identity and date fields.
 */
export interface StatisticsRow {
  readonly repo?: string;
  readonly mission?: string;
  readonly date?: string;
  readonly classification?: string;
}

export interface ReportingWindow {
  readonly start: Date;
  readonly end: Date;
}

export interface MissionWindowSummary<Row extends StatisticsRow> {
  readonly rows: readonly Row[];
  readonly missions: readonly Row[];
}

/** Repository plus case-normalized mission is the sole statistics identity. */
export function statisticsMissionKey(row: Pick<StatisticsRow, 'repo' | 'mission'>): string {
  return `${String(row.repo ?? '').trim()}::${String(row.mission ?? '').trim().toLowerCase()}`;
}

/** Reporting windows compare date-only telemetry as UTC calendar instants. */
export function statisticsRowInWindow(row: Pick<StatisticsRow, 'date'>, window: ReportingWindow): boolean {
  if (!row.date) { return false; }
  const at = new Date(`${row.date}T00:00:00Z`);
  return at >= window.start && at <= window.end;
}

/** Completed records in a window, deduplicated by canonical statistics identity. */
export function summarizeCompletedMissionWindow<Row extends StatisticsRow>(
  rows: readonly Row[],
  window: ReportingWindow,
  completedMissionKeys: ReadonlySet<string> = new Set(),
): MissionWindowSummary<Row> {
  const completedRows = rows.filter((row) =>
    statisticsRowInWindow(row, window) && completedMissionKeys.has(statisticsMissionKey(row)),
  );
  const seen = new Set<string>();
  const missions = completedRows.filter((row) => {
    const key = statisticsMissionKey(row);
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
  return { rows: completedRows, missions };
}

/** Convert an offset-bearing timestamp to its containing UTC hour. */
export function utcHourBucket(timestamp: string): string | null {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) { return null; }
  instant.setUTCMinutes(0, 0, 0);
  return instant.toISOString();
}

/** Sort and deduplicate evaluation instants after normalizing event time to UTC. */
export function statisticsEvaluationInstants(timestamps: readonly string[]): readonly string[] {
  return [...new Set(timestamps.flatMap((timestamp) => {
    const bucket = utcHourBucket(timestamp);
    return bucket === null ? [] : [bucket];
  }))].sort((left, right) => left.localeCompare(right));
}
