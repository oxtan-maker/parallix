import type { CohortComparison, CohortMetrics } from '../../../application/projections/cohorts.js';

// ---------------------------------------------------------------------------
// Cohort comparison presentation
//
// One rule governs this file: a cohort figure is never rendered without the
// sample size it was computed from. `n` is therefore a fixed column, not an
// option, and a cohort below the comparison's threshold is marked so an
// operator does not read three missions as a comparable result.
// ---------------------------------------------------------------------------

/** The marker appended to a cohort whose `n` is below the threshold. */
export const LOW_SAMPLE_MARKER = 'low-sample';

/** Columns in render order. `n` is second so it is read before any figure. */
export const COHORT_REPORT_COLUMNS = [
  'cohort',
  'n',
  'median cycle (min)',
  'p75 cycle (min)',
  'median active (min)',
  'median review (min)',
  'bounce rate',
  'median fix rounds',
  'tokens/mission',
  'runtime/mission (min)',
  'cost/mission (USD)',
  'NEL/mission',
] as const;

/** An unmeasured figure prints as `n/a`; it is never rendered as a zero. */
function figure(value: number | null, fractionDigits = 0): string {
  return value === null ? 'n/a' : value.toFixed(fractionDigits);
}

function cohortRow(metrics: CohortMetrics): readonly string[] {
  return [
    metrics.lowSample ? `${metrics.key} (${LOW_SAMPLE_MARKER})` : metrics.key,
    String(metrics.n),
    figure(metrics.medianCycleTimeMinutes),
    figure(metrics.p75CycleTimeMinutes),
    figure(metrics.medianActiveDwellMinutes),
    figure(metrics.medianReviewDwellMinutes),
    figure(metrics.reviewBounceRate, 2),
    figure(metrics.medianReviewFixRounds, 1),
    figure(metrics.tokensPerMission),
    figure(metrics.agentRuntimeMinutesPerMission, 1),
    figure(metrics.costUsdPerMission, 2),
    figure(metrics.netEngineeringLinesPerMission),
  ];
}

/** Pad every column to its widest cell so the table reads as a grid. */
function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): readonly string[] {
  const widths = header.map((cell, column) => Math.max(
    cell.length,
    ...rows.map((row) => (row[column] ?? '').length),
  ));
  const line = (row: readonly string[]) => row
    .map((cell, column) => cell.padEnd(widths[column]!))
    .join('  ')
    .trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)];
}

/**
 * Render a cohort comparison as a text table.
 *
 * Every row carries `n`, and cohorts under the threshold are both marked in the
 * cohort column and named in the trailing note, so the flag survives whether
 * the reader scans the table or the summary.
 */
export function renderCohortComparison(comparison: CohortComparison): string {
  const lines = [`Cohort comparison by ${comparison.dimension}`, ''];
  if (comparison.cohorts.length === 0) {
    lines.push('No completed missions in this repository, so there is no cohort to compare.');
    return lines.join('\n');
  }

  lines.push(...formatTable([...COHORT_REPORT_COLUMNS], comparison.cohorts.map(cohortRow)));

  const lowSample = comparison.cohorts.filter((cohort) => cohort.lowSample);
  lines.push('');
  lines.push(
    lowSample.length === 0
      ? `All cohorts have at least ${comparison.lowSampleThreshold} completed missions.`
      : `Low-sample (n < ${comparison.lowSampleThreshold}), not comparable results: ${
        lowSample.map((cohort) => `${cohort.key} (n=${cohort.n})`).join(', ')}.`,
  );
  lines.push('Figures are per completed mission; n/a means nothing measured the quantity.');
  return lines.join('\n');
}
