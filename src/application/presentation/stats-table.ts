import { localReportingTimeZone, type ReportingWindow } from '../../domain/decision-window.js';

export type Window = ReportingWindow & { label: string };

export function reportingRange(window: Window): string {
  return `${window.start.toISOString().slice(0, 10)} to ${window.end.toISOString().slice(0, 10)} ${window.timeZone ?? localReportingTimeZone()}`;
}

/** Pads every column to its widest cell so the table reads the same in a terminal and as Markdown. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[], numeric: ReadonlySet<number>): string[] {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map(row => row[column].length)));
  const cell = (text: string, column: number) => numeric.has(column) ? text.padStart(widths[column]) : text.padEnd(widths[column]);
  const line = (cells: readonly string[]) => `| ${cells.map((text, column) => cell(text, column)).join(' | ')} |`;
  const rule = widths.map((width, column) => numeric.has(column) ? `${'-'.repeat(width - 1)}:` : '-'.repeat(width));
  return [line(headers), `| ${rule.join(' | ')} |`, ...rows.map(line)];
}
