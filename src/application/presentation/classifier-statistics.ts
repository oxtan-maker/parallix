import { table, reportingRange, type Window } from './stats-table.js';
import { reviewRounds, type ClassifierStatisticsInput } from '../review-classification/statistics.js';

/** Decisions and telemetry have independent populations and coverage. */
export function renderClassifierStatistics(input: ClassifierStatisticsInput | null, windows: readonly [Window, Window]): string {
  const cells = windows.map(window => input ? reviewRounds(input, window, 're-review') : null);
  const count = (s: (typeof cells)[number], value: number) => !s ? 'unavailable'
    : `${value}${s.coverage === 'partial' ? ' (partial)' : ''}`;
  const rows = cells.map((s, i) => {
    const name = `${i === 0 ? 'This week' : 'Last week'} (${reportingRange(windows[i])})`;
    if (!s) { return [name, 're-review', ...Array<string>(10).fill('unavailable')]; }
    return [name, 're-review', String(s.rounds), String(s.jevDecisions), String(s.mechanical), String(s.reviewer),
      s.rounds ? `${Math.round(100 * s.jevDecisions / s.rounds)}%` : 'n/a',
      count(s, s.notAttempted), count(s, s.fellBack), count(s, s.called), String(s.cleared), String(s.returned)];
  });
  const reasons = [...new Set(cells.flatMap(s => Object.keys(s?.reasons ?? {})))].sort((a, b) => a.localeCompare(b));
  const reasonRows = (reasons.length ? reasons : ['none']).map(reason => [reason, ...cells.map(s => count(s, s?.reasons[reason] ?? 0))]);
  const firstSample = cells[0]?.firstSampleAt ?? 'none recorded';
  return [
    'PR Classification analysis',
    ...table(['Period', 'Round kind', 'Decided rounds', 'Classifier', 'Mechanical restoration', 'General reviewer',
      'Classifier share of decisions', 'Classifier not attempted', 'Attempted, fell back', 'Classifier called', 'Classifier cleared', 'Classifier returned'], rows,
    new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])),
    `Sample coverage starts: ${firstSample}. Partial applies to sample measurements only; samples use sample time.`,
    '',
    ...table(['Clears by omission evidence', 'This week', 'Last week'], [
      ['With omissions', ...cells.map(s => count(s, s?.clearsWithOmissions ?? 0))],
      ['Without omissions', ...cells.map(s => count(s, s?.clearsWithoutOmissions ?? 0))],
      ['Historical unknown', ...cells.map(s => count(s, s?.clearsOmissionsUnknown ?? 0))],
    ], new Set([1, 2])),
    '', 'Fallback reasons (sampled review rounds routed to the general reviewer)',
    ...table(['Reason', 'This week', 'Last week'], reasonRows, new Set([1, 2])),
  ].join('\n');
}
