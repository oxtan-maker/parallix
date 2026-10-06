import { classifierStatistics, type ClassifierStatisticsInput } from '../review-classification/statistics.js';

type Window = { start: Date; end: Date; label: string };

function utcRange(window: Window): string {
  return `${window.start.toISOString().slice(0, 10)} to ${window.end.toISOString().slice(0, 10)} UTC`;
}

/** A compact, comparable weekly view; absent history is never rendered as zero. */
export function renderClassifierStatistics(input: ClassifierStatisticsInput | null, windows: readonly [Window, Window]): string {
  const row = (label: string, window: Window) => {
    if (!input) { return `| ${label} (${utcRange(window)}) | unavailable | unavailable | unavailable | unavailable | unavailable |`; }
    const counts = classifierStatistics(input, window);
    const known = (value: number) => counts.coverage === 'unavailable' ? 'unavailable'
      : `${value}${counts.coverage === 'partial' ? ' (partial)' : ''}`;
    const observed = counts.total - counts.unobserved;
    const correct = observed - counts.falseClears - counts.falseReturns;
    const correctness = counts.coverage === 'unavailable' ? 'unavailable'
      : observed === 0 ? `unavailable (0/${counts.total} observed)`
        : `${correct}/${observed} observed; ${counts.unobserved}/${counts.total} unavailable`;
    return `| ${label} (${utcRange(window)}) | ${known(counts.total)} | ${known(counts.eligibleDecisions)} | ${known(counts.calls)} | ${known(counts.fallbacks)} | ${correctness} |`;
  };
  return [
    'PR',
    '| Period | Applied decisions | Distinct eligible decisions | Jev calls | Reviewer fallbacks | Observed correctness |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    row('This week', windows[0]),
    row('Last week', windows[1]),
  ].join('\n');
}
