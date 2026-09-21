// ---------------------------------------------------------------------------
// Completed-mission bug frequency
import { compareCodeUnits } from '../../domain/comparators.js';
// (ADR 0051 §"Reliability measurement")
//
// The primary outcome metric for the UI-neutral boundary is
// `completed bug missions / all completed missions`, with the companion ratio
// `100 * completed bug missions / completed non-bug missions`. Both use the
// exact `bug` label — never title keywords or an inferred severity — and both
// union labels across every copy of one task ID so a later-added `bug` label
// updates an earlier classification.
//
// This module is the pure classification/aggregation half of that report: it
// receives already-read task records and a frozen cohort order, and returns
// counts, ratios, per-row label evidence, warnings, and fail-closed aborts.
// It performs no filesystem, git, or process access; the reading and cohort
// enumeration belong to the caller (the `scripts/bug-frequency-report.ts`
// runner). The parsing and classification rules are a faithful port of the
// cohort-1 audit script (`missions/task-2291/audit-cohort.mjs`) so a frozen
// input cannot silently drift between cohort measurements.
// ---------------------------------------------------------------------------

/** Which backlog store a task-file copy was read from. */
export type BugFrequencyStore = 'tasks' | 'completed' | 'archive';

/** A task record already read by the caller; the module never opens files. */
export interface BugFrequencyTaskFile {
  /** Repo-relative path used verbatim in warnings, aborts, and row evidence. */
  readonly path: string;
  /** Full file content including frontmatter. */
  readonly rawText: string;
  /** The store directory the copy was read from at report time. */
  readonly store: BugFrequencyStore;
}

/** Per-cohort-member classification detail. */
export interface BugFrequencyRow {
  readonly id: string;
  /** Number of copies of this task ID found across all scanned stores. */
  readonly copies: number;
  /** One `path:idLine` evidence entry per copy, in scan order. */
  readonly copyPaths: readonly string[];
  /** Union of every label on every copy, sorted ascending. */
  readonly labelUnion: readonly string[];
  /** `path:labelsLine` of the first completed-store copy, or null. */
  readonly labelEvidence: string | null;
  /** `path:statusLine` of the first completed-store copy, or null. */
  readonly statusEvidence: string | null;
  /** Status value of the first completed-store copy, or null. */
  readonly status: string | null;
  /** True when the label union carries the exact `bug` label. */
  readonly bug: boolean;
}

export interface BugFrequencyMeasurement {
  /** Cohort members that produced a row; aborted members are absent. */
  readonly total: number;
  readonly bug: number;
  readonly nonBug: number;
  /** `bug / total`, or null when the cohort produced no rows. */
  readonly bugOverTotal: number | null;
  /** `100 * bug / nonBug`, or null when there are no non-bug rows. */
  readonly bugPer100NonBug: number | null;
  /** Cohort order preserved; aborted members appear in neither list. */
  readonly bugIds: readonly string[];
  readonly nonBugIds: readonly string[];
  /** Data-quality findings that do not stop classification. */
  readonly warnings: readonly string[];
  /** Fail-closed findings; the affected record is never classified. */
  readonly aborts: readonly string[];
  readonly rows: readonly BugFrequencyRow[];
}

export interface BugFrequencyInput {
  /** Frozen cohort membership in selection order; rows follow this order. */
  readonly cohortIds: readonly string[];
  /** Every task-file copy read from the backlog stores at report time. */
  readonly files: readonly BugFrequencyTaskFile[];
}

const TASK_ID_PATTERN = /^TASK-[0-9]+(\.[0-9]+)?$/;
const FILENAME_ID_PATTERN = /^task-([0-9]+(?:\.[0-9]+)?) - /;
const LABEL_ITEM_PATTERN = /^\s+-\s+/;

interface ParsedCopy {
  readonly id: string;
  readonly path: string;
  readonly idLine: number;
  readonly labels: readonly string[];
  readonly labelLine: number | null;
  readonly status: string | null;
  readonly statusLine: number;
  readonly store: BugFrequencyStore;
}

function stripQuotes(value: string): string {
  return value.replace(/(?:^['"])|(?:['"]$)/g, '');
}

function basenameOf(filePath: string): string {
  const segments = filePath.split('/');
  return segments[segments.length - 1] ?? filePath;
}

interface ParseOutcome {
  readonly copy?: ParsedCopy;
  readonly warning?: string;
  readonly abort?: string;
}

/**
 * Parse one already-read task file into an indexed copy.
 *
 * Returns a warning when the file is skipped for a data-quality reason that
 * does not make any classification claim (missing or unterminated frontmatter,
 * missing id), and an abort when the id or label data is ambiguous enough
 * that classifying it would be a guess.
 */
function parseTaskFile(file: BugFrequencyTaskFile): ParseOutcome {
  const { path, rawText } = file;
  const lines = rawText.split('\n');
  if (lines[0] !== '---') { return {}; }
  const end = lines.indexOf('---', 1);
  if (end < 0) { return { warning: `${path}: unterminated frontmatter` }; }
  const fm = lines.slice(1, end);

  const idLine = fm.findIndex((line) => /^id:\s*/.test(line));
  if (idLine < 0) { return { warning: `${path}:1 missing id field` }; }
  const idRaw = stripQuotes(fm[idLine]!.replace(/^id:\s*/, '').trim());
  if (!TASK_ID_PATTERN.test(idRaw)) {
    return { abort: `${path}:${idLine + 2} ambiguous id "${idRaw}"` };
  }

  const fnMatch = basenameOf(path).match(FILENAME_ID_PATTERN);
  if (fnMatch && `TASK-${fnMatch[1]}` !== idRaw) {
    return { abort: `${path}:${idLine + 2} filename id TASK-${fnMatch[1]} != frontmatter id ${idRaw}` };
  }

  const labelParse = parseLabels(fm, path);
  if (labelParse.abort) { return labelParse; }

  const statusIndex = fm.findIndex((line) => /^status:/.test(line));
  const status = statusIndex >= 0 ? fm[statusIndex]!.replace(/^status:\s*/, '').trim() : null;

  const copy: ParsedCopy = {
    id: idRaw,
    path,
    idLine: idLine + 2,
    labels: labelParse.labels,
    labelLine: labelParse.labelLine,
    status,
    statusLine: statusIndex + 2,
    store: file.store,
  };
  return { copy };
}

function parseLabels(frontmatter: string[], path: string): { labels: string[]; labelLine: number | null; abort?: string } {
  const index = frontmatter.findIndex((line) => /^labels:/.test(line));
  if (index < 0) { return { labels: [], labelLine: null }; }
  const inline = frontmatter[index]!.replace(/^labels:\s*/, '').trim();
  if (inline.startsWith('[')) { return parseInlineLabels(inline, path, index); }
  if (inline) { return { labels: [], labelLine: index + 2, abort: `${path}:${index + 2} unparseable labels scalar "${inline}"` }; }
  return parseBlockLabels(frontmatter, path, index);
}

function parseInlineLabels(inline: string, path: string, index: number) {
  const close = inline.indexOf(']');
  if (close < 0) { return { labels: [], labelLine: index + 2, abort: `${path}:${index + 2} unterminated inline label list "${inline}"` }; }
  return { labels: inline.slice(1, close).split(',').map((part) => stripQuotes(part.trim())).filter(Boolean), labelLine: index + 2 };
}

function parseBlockLabels(frontmatter: string[], path: string, index: number) {
  const labels: string[] = [];
  for (let i = index + 1; i < frontmatter.length; i += 1) {
    const line = frontmatter[i]!;
    if (LABEL_ITEM_PATTERN.test(line)) { labels.push(stripQuotes(line.replace(LABEL_ITEM_PATTERN, '').trim())); }
    else if (/^\S/.test(line)) { break; }
    else if (line.trim() !== '') { return { labels, labelLine: index + 2, abort: `${path}:${i + 2} unparseable label line "${line}"` }; }
  }
  return { labels, labelLine: index + 2 };
}

/**
 * Classify a frozen cohort by the exact `bug` label.
 *
 * Labels are read from the copies the caller supplies — i.e. the working tree
 * at report time, not the transition commit — and unioned across every copy of
 * one task ID in `backlog/tasks`, `backlog/completed`, `backlog/archive`, and
 * `backlog/archive/tasks`. Ambiguous ID or label data aborts that record
 * instead of classifying it (fail closed).
 */
export function measureBugFrequency(input: BugFrequencyInput): BugFrequencyMeasurement {
  const warnings: string[] = [];
  const aborts: string[] = [];
  const byId = indexTaskCopies(input.files, warnings, aborts);
  const rows = input.cohortIds.flatMap((id) => makeBugFrequencyRow(id, byId, aborts));

  const bugRows = rows.filter((row) => row.bug);
  const nonBugRows = rows.filter((row) => !row.bug);
  return {
    total: rows.length,
    bug: bugRows.length,
    nonBug: nonBugRows.length,
    bugOverTotal: rows.length === 0 ? null : bugRows.length / rows.length,
    bugPer100NonBug: nonBugRows.length === 0 ? null : (100 * bugRows.length) / nonBugRows.length,
    bugIds: bugRows.map((row) => row.id),
    nonBugIds: nonBugRows.map((row) => row.id),
    warnings,
    aborts,
    rows,
  };
}

function indexTaskCopies(files: readonly BugFrequencyTaskFile[], warnings: string[], aborts: string[]): Map<string, ParsedCopy[]> {
  const byId = new Map<string, ParsedCopy[]>();
  for (const file of files) {
    const outcome = parseTaskFile(file);
    if (outcome.warning !== undefined) { warnings.push(outcome.warning); }
    if (outcome.abort !== undefined) { aborts.push(outcome.abort); }
    if (outcome.copy !== undefined) { byId.set(outcome.copy.id, [...(byId.get(outcome.copy.id) ?? []), outcome.copy]); }
  }
  return byId;
}

function makeBugFrequencyRow(id: string, byId: Map<string, ParsedCopy[]>, aborts: string[]): BugFrequencyRow[] {
  const copies = byId.get(id) ?? [];
  if (copies.length === 0) { aborts.push(`${id}: no task record found in any store`); return []; }
  const labels = new Set(copies.flatMap((copy) => copy.labels));
  const evidence = copies.find((copy) => copy.store === 'completed') ?? null;
  if (!evidence) { aborts.push(`${id}: no completed-store copy at report time`); }
  return [{ id, copies: copies.length, copyPaths: copies.map((copy) => `${copy.path}:${copy.idLine}`), labelUnion: [...labels].sort(compareCodeUnits), labelEvidence: evidence?.labelLine === null || !evidence ? null : `${evidence.path}:${evidence.labelLine}`, statusEvidence: evidence ? `${evidence.path}:${evidence.statusLine}` : null, status: evidence?.status ?? null, bug: labels.has('bug') }];
}
