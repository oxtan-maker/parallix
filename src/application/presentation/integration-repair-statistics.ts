import { FALLBACK_CATEGORIES, PRESERVES_BUCKETS, integrationRepairStatistics } from '../review-classification/repair-statistics.js';
import type { ClassifierStatisticsInput } from '../review-classification/statistics.js';
import { reportingRange, table, type Window } from './stats-table.js';

/** Integration-repair re-reviews decided by the recorded gate fact and the weakening question, per reporting period. */
export function renderIntegrationRepairStatistics(input: ClassifierStatisticsInput | null, windows: readonly [Window, Window]): string {
  const periods = [['This week', windows[0]], ['Last week', windows[1]]] as const;
  const stats = periods.map(([, window]) => input ? integrationRepairStatistics(input, window) : null);
  const partial = (s: (typeof stats)[number]) => s?.coverage === 'partial' ? ' (partial)' : '';
  const unavailable = (s: (typeof stats)[number]) => !s || s.coverage === 'unavailable';
  const num = (s: (typeof stats)[number], value: number) => unavailable(s) ? 'unavailable' : `${value}${partial(s)}`;
  const share = (s: (typeof stats)[number], value: number, of: number) => unavailable(s) ? 'unavailable' : of === 0 ? 'n/a' : `${Math.round(100 * value / of)}%${partial(s)}`;
  const rows = periods.map(([label, window], index) => {
    const s = stats[index];
    return [`${label} (${reportingRange(window)})`, num(s, s?.rounds ?? 0), num(s, s?.withFact ?? 0), num(s, s?.calls ?? 0), num(s, s?.clears ?? 0), share(s, s?.clears ?? 0, s?.rounds ?? 0)];
  });
  const wrong = periods.map(([label], index) => {
    const s = stats[index];
    if (unavailable(s)) { return [label, 'unavailable', 'unavailable', 'unavailable', 'unavailable']; }
    return [label, `${s!.clearsRecorded}`, `${s!.observedClears}`, `${s!.unobservedClears}`, s!.observedClears === 0 ? `n/a (0/${s!.clearsRecorded} observed)` : `${s!.wrongClears}/${s!.observedClears} observed`];
  });
  const buckets = PRESERVES_BUCKETS.map(bucket => [bucket, ...stats.flatMap(s => [num(s, s?.clearScores[bucket] ?? 0), num(s, s?.fallbackScores[bucket] ?? 0)])]);
  return [
    'Integration-repair re-reviews (recorded green gate + weakening question)',
    ...table(['Period', 'Repair rounds', 'With admissible gate fact', 'Weakening calls', 'Clears', 'Clear share'], rows, new Set([1, 2, 3, 4, 5])),
    '',
    'Measured-limit weakening question (V5)',
    ...table(['Question', 'This week', 'Last week'], [
      ['V5 calls', ...stats.map(s => num(s, s?.v5Calls ?? 0))],
      ['V5 clears', ...stats.map(s => num(s, s?.v5Clears ?? 0))],
    ], new Set([1, 2])),
    '',
    'V5 preserves probability',
    ...table(['Preserves', 'This week', 'Last week'], PRESERVES_BUCKETS.map(bucket => [bucket, ...stats.map(s => num(s, s?.v5Scores[bucket] ?? 0))]), new Set([1, 2])),
    '',
    'Integration-repair fallback reasons (rounds decided by the general reviewer)',
    ...table(['Reason', 'This week', 'Last week'], FALLBACK_CATEGORIES.map(reason => [reason, ...stats.map(s => num(s, s?.reasons[reason] ?? 0))]), new Set([1, 2])),
    '',
    'Observed wrong clears (revoked by a human, or changes requested later on the same mission)',
    ...table(['Period', 'Clears', 'Observed', 'Unobserved', 'Observed wrong'], wrong, new Set([1, 2, 3])),
    '',
    'Preserves probability of integration-repair rounds',
    ...table(['Preserves', 'Clears this week', 'Fallbacks this week', 'Clears last week', 'Fallbacks last week'], buckets, new Set([1, 2, 3, 4])),
  ].join('\n');
}
