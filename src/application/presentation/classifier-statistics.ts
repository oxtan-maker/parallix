import { reviewRounds, type ClassifierStatisticsInput, type RoundKind } from '../review-classification/statistics.js';

type Window = { start: Date; end: Date; label: string };

function utcRange(window: Window): string {
  return `${window.start.toISOString().slice(0, 10)} to ${window.end.toISOString().slice(0, 10)} UTC`;
}

/** Pads every column to its widest cell so the table reads the same in a terminal and as Markdown. */
function table(headers: readonly string[], rows: readonly (readonly string[])[], numeric: ReadonlySet<number>): string[] {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map(row => row[column].length)));
  const cell = (text: string, column: number) => numeric.has(column) ? text.padStart(widths[column]) : text.padEnd(widths[column]);
  const line = (cells: readonly string[]) => `| ${cells.map((text, column) => cell(text, column)).join(' | ')} |`;
  const rule = widths.map((width, column) => numeric.has(column) ? `${'-'.repeat(width - 1)}:` : '-'.repeat(width));
  return [line(headers), `| ${rule.join(' | ')} |`, ...rows.map(line)];
}

const KINDS: readonly RoundKind[] = ['all', 'first review', 're-review'];

/** Counts are review rounds, shown overall and split by round kind; absent or partial history is labelled, never rendered as zero. */
export function renderClassifierStatistics(input: ClassifierStatisticsInput | null, windows: readonly [Window, Window]): string {
  const periods = [['This week', windows[0]], ['Last week', windows[1]]] as const;
  const cells = periods.flatMap(([label, window]) => KINDS.map(kind => ({ label, window, kind,
    stats: input ? reviewRounds(input, window, kind) : null })));
  const stats = cells.filter(cell => cell.kind === 'all').map(cell => cell.stats);
  const text = (value: number, of: number, coverage: string | undefined) => {
    if (!coverage || coverage === 'unavailable') { return 'unavailable'; }
    const label = coverage === 'partial' ? ', partial' : '';
    return of === 0 ? `${value} (n/a${label})` : `${value} (${Math.round(100 * value / of)}%${label})`;
  };
  const rows = cells.map(({ label, window, kind, stats: s }) => {
    const name = `${label} (${utcRange(window)})`;
    if (!s) { return [name, kind, ...Array<string>(9).fill('unavailable')]; }
    const known = (value: number) => text(value, s.rounds, s.coverage);
    const share = (value: number) => s.coverage === 'unavailable' || s.rounds === 0 ? 'n/a'
      : `${Math.round(100 * value / s.rounds)}%${s.coverage === 'partial' ? ' (partial)' : ''}`;
    const observed = s.appliedDecisions === 0 ? 'n/a (no classifier decisions)'
      : s.observedDecisions === 0 ? `n/a (0/${s.appliedDecisions} observed)`
        : `${s.wrong}/${s.observedDecisions} observed; ${s.appliedDecisions - s.observedDecisions}/${s.appliedDecisions} unobserved`;
    return [name, kind, s.coverage === 'unavailable' ? 'unavailable' : `${s.rounds}${s.coverage === 'partial' ? ' (partial)' : ''}`,
      known(s.notAttempted), known(s.fellBack), known(s.called), known(s.cleared), known(s.returned),
      share(s.jevDecisions), share(s.called), observed];
  });
  const reasons = [...new Set(stats.flatMap(s => Object.keys(s?.reasons ?? {})))].sort((a, b) => a.localeCompare(b));
  const count = (s: (typeof stats)[number], value: number) => !s || s.coverage === 'unavailable' ? 'unavailable'
    : `${value}${s.coverage === 'partial' ? ' (partial)' : ''}`;
  const reasonRows = reasons.map(reason => [reason, ...stats.map(s => count(s, s?.reasons[reason] ?? 0))]);
  return [
    'PR Classification analysis',
    ...table(['Period', 'Round kind', 'Review rounds', 'Classifier not attempted', 'Attempted, fell back', 'Classifier called', 'Classifier cleared', 'Classifier returned',
      'Classifier share of decisions', 'Classifier called share', 'Observed wrong'], rows, new Set([2, 3, 4, 5, 6, 7, 8, 9])),
    '',
    'Fallback reasons (review rounds decided by the general reviewer)',
    ...(reasonRows.length ? table(['Reason', 'This week', 'Last week'], reasonRows, new Set([1, 2]))
      : table(['Reason', 'This week', 'Last week'], [['none', ...stats.map(s => count(s, 0))]], new Set([1, 2]))),
  ].join('\n');
}
