/**
 * Agent-run history retrieval (TASK-2643): bounded list, search and show over
 * one Mission's retained runs.
 *
 * Retrieval is scoped to one Mission's run directory, which the caller derives
 * from the Mission worktree it was launched in; a reference names a run and a
 * byte range but never a path, so it cannot reach another Mission's or
 * repository's history. Results are bounded and cite stable references with
 * byte offsets, so an agent pulls only the slice it needs into its context.
 * Every answer states its source and coverage, and reports omissions instead
 * of implying the history is whole.
 */
import { retainedRunFamily } from './mission-terminal-compat.js';
import { isRunHistoryId, runCaptureKind } from './run-history-types.js';
import {
  MAX_RUN_PAGE_BYTES,
  MAX_RUN_SEARCH_HITS,
  MAX_RUN_SEARCH_SCAN_BYTES,
  MAX_RUN_SHOW_BYTES,
  RUN_RECORD_FILE,
  RUN_SEARCH_CONTEXT_BYTES,
  formatRunHistoryRef,
  runSegmentOffset,
} from './run-history-types.js';
import type {
  RunHistoryErrorKind,
  RunHistoryFileSystem,
  RunHistoryRef,
  RunRecord,
  RunState,
  RunStreamName,
} from './run-history-types.js';

export interface RunHistoryScope {
  /** The Mission's run directory (`.workflow/run-history/<mission>` in its worktree). */
  readonly runsDir: string;
  readonly fs: RunHistoryFileSystem;
  /** Supervisor liveness, used to report an abandoned `running` record as interrupted. */
  readonly isAlive: (_pid: number) => boolean;
  readonly executionAlive?: (_execution: { readonly pid: number; readonly processIdentity: string | null }) => boolean | null;
}

export interface RunSummary {
  readonly record: RunRecord;
  /** The record's state, with a dead supervisor's `running` reported as `interrupted`. */
  readonly state: RunState;
  readonly execution: 'live' | 'stopped' | 'unknown';
  /** Plain coverage statements: sources, retained bytes and omissions. */
  readonly coverage: readonly string[];
}

/** `run` is present exactly when `ok`; `error` and `detail` exactly when not. */
export interface RunLookup {
  readonly ok: boolean;
  readonly run?: RunSummary;
  readonly error?: RunHistoryErrorKind;
  readonly detail?: string;
}

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

function effectiveState(record: RunRecord, isAlive: (_pid: number) => boolean): RunState {
  return record.state === 'running' && !isAlive(record.supervisorPid) ? 'interrupted' : record.state;
}

function coverageOf(record: RunRecord, state: RunState): string[] {
  const lines: string[] = [];
  for (const stream of ['stdout', 'stderr'] as const) {
    const s = record.streams[stream];
    const dropped = s.omitted.map(range => `${range.from}-${range.to}`).join(', ');
    lines.push(`${stream}: ${s.retainedBytes} of ${s.bytes} bytes retained${dropped ? `; omitted byte ranges ${dropped}` : ''}`);
  }
  if (record.terminalHost === 'tmux') { lines.push('stderr is merged into stdout by the terminal (tmux host)'); }
  if (record.redacted) { lines.push('configured credential redaction ran; offsets index the redacted stream'); }
  for (const source of record.sources) { lines.push(`${source.kind}${source.path ? ` (${source.path})` : ''}: ${source.covers}${source.complete ? '' : ' [incomplete]'}`); }
  if (state === 'interrupted') { lines.push('the run was interrupted: its supervisor exited before the run finished, so the tail may be missing'); }
  if (state === 'running') { lines.push('capture is still open; this alone does not prove that an agent is executing'); }
  lines.push(...record.omissions);
  return lines;
}

function readRecord(scope: RunHistoryScope, runId: string): RunLookup {
  if (!isRunHistoryId(runId)) { return { ok: false, error: 'access-denied', detail: `not a run id of this Mission: ${runId}` }; }
  const raw = scope.fs.readText(join(scope.runsDir, runId, RUN_RECORD_FILE));
  if (raw === null) { return { ok: false, error: 'missing', detail: `no retained run ${runId} in this Mission (it may have been retired)` }; }
  let record: RunRecord;
  try { record = JSON.parse(raw) as RunRecord; } catch { return { ok: false, error: 'malformed', detail: `run record ${runId} is not valid JSON` }; }
  if (record.runId !== runId) { return { ok: false, error: 'malformed', detail: `run record ${runId} names another run` }; }
  try { record = { ...record, family: retainedRunFamily(record), captureKind: runCaptureKind(record) }; }
  catch { return { ok: false, error: 'malformed', detail: `run record ${runId} has an invalid agent family` }; }
  const state = effectiveState(record, scope.isAlive);
  const observed = record.execution ? scope.executionAlive?.(record.execution) : null;
  const execution = state === 'exited' ? 'stopped' : observed === true ? 'live' : observed === false ? 'stopped' : 'unknown';
  return { ok: true, run: { record, state, execution, coverage: coverageOf(record, state) } };
}

/** Every retained run of the Mission, newest first. */
export function listRuns(scope: RunHistoryScope): RunSummary[] {
  return scope.fs.listDirs(scope.runsDir)
    .filter(isRunHistoryId)
    .map(runId => readRecord(scope, runId))
    .flatMap(lookup => (lookup.ok && lookup.run ? [lookup.run] : []))
    .sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
}

export function getRun(scope: RunHistoryScope, runId: string): RunLookup {
  return readRecord(scope, runId);
}

// CSI, OSC and two-byte escape sequences: terminal control, not content.
function codeInRange(code: number, min: number, max: number): boolean { return code >= min && code <= max; }
function terminalSequenceEnd(text: string, start: number): number {
  const next = text.charCodeAt(start + 1);
  let end = start + 2;
  if (next === 91) {
    while (codeInRange(text.charCodeAt(end), 48, 63)) { end += 1; }
    while (codeInRange(text.charCodeAt(end), 32, 47)) { end += 1; }
    if (codeInRange(text.charCodeAt(end), 64, 126)) { return end + 1; }
  }
  if (next === 93) {
    while (end < text.length && text.charCodeAt(end) !== 7 && text.charCodeAt(end) !== 27) { end += 1; }
    if (text.charCodeAt(end) === 7) { return end + 1; }
    if (text.charCodeAt(end) === 27 && text[end + 1] === '\\') { return end + 2; }
  }
  return codeInRange(next, 64, 90) || codeInRange(next, 92, 95) ? start + 2 : start;
}

function* terminalSequences(text: string): Generator<{ start: number; end: number }> {
  let start = 0;
  while (start < text.length) {
    const end = text.charCodeAt(start) === 27 ? terminalSequenceEnd(text, start) : start;
    if (end > start) { yield { start, end }; start = end; }
    else { start += 1; }
  }
}

/** Strip terminal control sequences for display; alternate-screen text is kept. */
export function stripTerminalControl(text: string): string {
  const visible = searchable(text).text.replace(/\r\n/g, '\n');
  return Array.from(visible).filter(character => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || (code >= 32 && code !== 127);
  }).join('');
}

/**
 * Search text and a raw-offset map for one latin1-decoded segment: control
 * sequences are removed from the text, and `map[i]` is the raw byte offset of
 * text position `i`, so hits cite offsets into the stored bytes.
 */
function searchable(raw: string): { text: string; map: number[] } {
  const map: number[] = [];
  let text = '';
  let last = 0;
  const pushRange = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) { text += raw[i]; map.push(i); }
  };
  for (const match of terminalSequences(raw)) {
    pushRange(last, match.start);
    last = match.end;
  }
  pushRange(last, raw.length);
  return { text, map };
}

function segments(scope: RunHistoryScope, runId: string, stream: RunStreamName): Array<{ path: string; start: number }> {
  const dir = join(scope.runsDir, runId, stream);
  return scope.fs.listFiles(dir)
    .map(name => ({ path: join(dir, name), start: runSegmentOffset(name) }))
    .filter((s): s is { path: string; start: number } => s.start !== null)
    .sort((a, b) => a.start - b.start);
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

/** One character per byte, so string positions are byte offsets. */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

export interface RunSearchHit {
  readonly ref: string;
  readonly runId: string;
  readonly stream: RunStreamName;
  readonly offset: number;
  /** Matched text with surrounding context, terminal control removed. */
  readonly preview: string;
}

export interface RunSearchResult {
  readonly hits: readonly RunSearchHit[];
  /** Matches found, including those past the returned bound. */
  readonly totalHits: number;
  readonly searchedRuns: readonly string[];
  /** Coverage and omission statements for every searched run. */
  readonly coverage: readonly string[];
  readonly errors: readonly string[];
  /** True when the scan stopped at its byte budget before covering every run. */
  readonly scanLimited: boolean;
}

export interface RunSearchQuery {
  readonly pattern: string;
  readonly regex?: boolean;
  readonly runId?: string;
  readonly stream?: RunStreamName;
  readonly maxHits?: number;
  /** Stored bytes the scan may read; newest runs are scanned first. */
  readonly maxScanBytes?: number;
}

function matcher(query: RunSearchQuery): RegExp {
  if (query.regex) { return new RegExp(query.pattern, 'gi'); }
  // Literal search over latin1 text: encode the pattern's UTF-8 bytes the same way.
  const literal = Buffer.from(query.pattern, 'utf8').toString('latin1');
  return new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
}

function searchableRuns(scope: RunHistoryScope, query: RunSearchQuery, errors: string[]): RunSummary[] {
  let runs: RunSummary[];
  if (query.runId) {
    const lookup = getRun(scope, query.runId);
    runs = lookup.ok && lookup.run ? [lookup.run] : [];
    if (!lookup.ok) { errors.push(`${lookup.error}: ${lookup.detail}`); }
  } else {
    runs = listRuns(scope);
  }
  return runs;
}

/** Bounded search across the Mission's runs (or one run), newest run first. */
export function searchRuns(scope: RunHistoryScope, query: RunSearchQuery): RunSearchResult {
  if (!query.pattern) { throw new Error('search pattern must not be empty'); }
  const maxHits = Math.min(Math.max(query.maxHits ?? MAX_RUN_SEARCH_HITS, 1), MAX_RUN_SEARCH_HITS);
  const pattern = matcher(query);
  const errors: string[] = [];
  const runs = searchableRuns(scope, query, errors);
  const hits: RunSearchHit[] = [];
  let totalHits = 0;
  let budget = Math.max(0, query.maxScanBytes ?? MAX_RUN_SEARCH_SCAN_BYTES);
  let scanLimited = false;
  const searched: RunSummary[] = [];
  for (const run of runs) {
    if (scanLimited) { break; }
    searched.push(run);
    for (const stream of searchStreams(query)) {
      if (scanLimited) { break; }
      for (const segment of segments(scope, run.record.runId, stream)) {
        const size = scope.fs.size(segment.path) ?? 0;
        if (size > budget) { scanLimited = true; break; }
        budget -= size;
        const bytes = scope.fs.readBytes(segment.path, 0, size);
        if (!bytes) { errors.push(`access-denied: cannot read ${run.record.runId} ${stream} segment at ${segment.start}`); continue; }
        totalHits += collectSegmentHits(bytes, pattern, run.record.runId, stream, segment.start, hits, maxHits);
      }
    }
  }
  return {
    hits,
    totalHits,
    searchedRuns: searched.map(run => run.record.runId),
    coverage: [
      ...searched.flatMap(run => run.coverage.map(line => `${run.record.runId}: ${line}`)),
      ...(scanLimited ? [`search stopped at its scan budget; ${runs.length - searched.length} older run(s) and the rest of ${searched.at(-1)?.record.runId ?? 'the newest run'} were not searched`] : []),
    ],
    errors,
    scanLimited,
  };
}

/** `ref`, `text`, `clamped` and `coverage` are present exactly when `ok`. */
export interface RunShowResult {
  readonly ok: boolean;
  readonly ref?: string;
  readonly text?: string;
  readonly clamped?: boolean;
  readonly coverage?: readonly string[];
  readonly error?: RunHistoryErrorKind;
  readonly detail?: string;
}

/**
 * Return the bytes a reference names (plus optional context), bounded to
 * `MAX_RUN_SHOW_BYTES`. A range that falls in an omitted span says so.
 */
export function showRun(scope: RunHistoryScope, ref: RunHistoryRef, context = 0): RunShowResult {
  const lookup = getRun(scope, ref.runId);
  if (!lookup.ok || !lookup.run) { return { ok: false, error: lookup.error, detail: lookup.detail }; }
  const run = lookup.run;
  const coverage = run.record.streams[ref.stream];
  const from = Math.max(0, ref.offset - Math.max(0, context));
  const requestedEnd = ref.offset + ref.length + Math.max(0, context);
  const to = Math.min(requestedEnd, from + MAX_RUN_SHOW_BYTES);
  const omitted = coverage.omitted.find(range => from < range.to && to > range.from);
  if (omitted) {
    return { ok: false, error: 'truncated', detail: `bytes ${omitted.from}-${omitted.to} of ${ref.stream} were dropped by the retention cap; retained data ends at ${omitted.from} and resumes at ${omitted.to}` };
  }
  const parts: Uint8Array[] = [];
  let expected = from;
  for (const segment of segments(scope, ref.runId, ref.stream)) {
    const size = scope.fs.size(segment.path) ?? 0;
    const segFrom = Math.max(from, segment.start);
    const segTo = Math.min(to, segment.start + size);
    if (segTo <= segFrom) { continue; }
    // A live run's record may predate a dropped segment; the files are the truth.
    if (segFrom > expected) {
      return { ok: false, error: 'truncated', detail: `bytes ${expected}-${segFrom} of ${ref.stream} are not retained` };
    }
    expected = segTo;
    const bytes = scope.fs.readBytes(segment.path, segFrom - segment.start, segTo - segFrom);
    if (!bytes) { return { ok: false, error: 'access-denied', detail: `cannot read ${ref.runId} ${ref.stream} segment at ${segment.start}` }; }
    parts.push(bytes);
  }
  if (parts.length === 0) { return { ok: false, error: 'missing', detail: `${ref.runId} has no retained ${ref.stream} bytes at ${from}-${to}` }; }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { joined.set(part, cursor); cursor += part.length; }
  return {
    ok: true,
    ref: formatRunHistoryRef({ runId: ref.runId, stream: ref.stream, offset: from, length: total }),
    text: stripTerminalControl(decode(joined)),
    clamped: to < requestedEnd,
    coverage: run.coverage,
  };
}

/** A bounded, line-aligned page of one stream; see `MissionHistoryPage`. */
export interface RunPage {
  readonly from: number;
  readonly to: number;
  readonly bytes: Uint8Array;
  readonly hasEarlier: boolean;
  readonly atEnd: boolean;
  readonly gaps: ReadonlyArray<{ readonly from: number; readonly to: number }>;
}

type Range = { from: number; to: number };
type SizedSegment = { path: string; start: number; end: number };

/** Retained segments with their sizes, and the contiguous ranges they form; holes are dropped bytes. */
function retainedRanges(scope: RunHistoryScope, runId: string, stream: RunStreamName): { sized: SizedSegment[]; ranges: Range[] } {
  const sized = segments(scope, runId, stream)
    .map(segment => ({ ...segment, end: segment.start + (scope.fs.size(segment.path) ?? 0) }))
    .filter(segment => segment.end > segment.start);
  const ranges: Range[] = [];
  for (const segment of sized) {
    const last = ranges[ranges.length - 1];
    if (last && last.to === segment.start) { last.to = segment.end; } else { ranges.push({ from: segment.start, to: segment.end }); }
  }
  return { sized, ranges };
}

/** The byte window a page request selects inside one contiguous retained range, or `null` past the data. */
function pageWindow(ranges: readonly Range[], request: { readonly before?: number; readonly after?: number }, limit: number): Range | null {
  const end = ranges[ranges.length - 1].to;
  if (request.after !== undefined) {
    const start = Math.max(0, request.after);
    const range = ranges.find(r => start < r.to);
    if (!range) { return null; }
    const from = Math.max(start, range.from);
    return { from, to: Math.min(range.to, from + limit) };
  }
  const stop = Math.min(Math.max(0, request.before ?? end), end);
  const range = [...ranges].reverse().find(r => stop > r.from);
  if (!range) { return null; }
  const to = Math.min(stop, range.to);
  return { from: Math.max(range.from, to - limit), to };
}

/** Forward pages end on a line break; earlier pages drop a partial first line. */
function alignPage(bytes: Uint8Array, window: Range, forward: boolean, rangeStart: number): { bytes: Uint8Array; from: number; to: number } {
  if (forward) {
    const cut = bytes.lastIndexOf(0x0a);
    return cut >= 0 && cut < bytes.length - 1 ? { bytes: bytes.subarray(0, cut + 1), from: window.from, to: window.from + cut + 1 } : { bytes, ...window };
  }
  const cut = window.from > rangeStart ? bytes.indexOf(0x0a) : -1;
  return cut >= 0 && cut < bytes.length - 1 ? { bytes: bytes.subarray(cut + 1), from: window.from + cut + 1, to: window.to } : { bytes, ...window };
}

/**
 * Read one page of a run stream (TASK-2749). `after` pages forward from an
 * offset (newer output, ending at a line break when one is present); `before`
 * pages backward to an offset (earlier history, starting after a line break);
 * neither returns the tail. Only the segments the page touches are read, and a
 * dropped range is reported as a gap rather than skipped silently.
 */
export function readRunPage(scope: RunHistoryScope, request: { readonly runId: string; readonly stream: RunStreamName; readonly before?: number; readonly after?: number; readonly limit?: number }): { ok: true; run: RunSummary; page: RunPage } | { ok: false; error: RunHistoryErrorKind; detail: string } {
  const lookup = getRun(scope, request.runId);
  if (!lookup.ok || !lookup.run) { return { ok: false, error: lookup.error!, detail: lookup.detail! }; }
  const run = lookup.run;
  const limit = Math.min(Math.max(Math.trunc(request.limit ?? MAX_RUN_PAGE_BYTES), 1), MAX_RUN_PAGE_BYTES);
  const { sized, ranges } = retainedRanges(scope, request.runId, request.stream);
  const gapsNear = gapFinder(run.record.streams[request.stream].omitted, ranges);
  const first = ranges[0]?.from ?? 0;
  const end = ranges[ranges.length - 1]?.to ?? 0;
  const finish = (page: { bytes: Uint8Array; from: number; to: number }): { ok: true; run: RunSummary; page: RunPage } =>
    ({ ok: true, run, page: { ...page, hasEarlier: ranges.length > 0 && page.from > first, atEnd: page.to >= end, gaps: gapsNear(page.from, page.to) } });
  const window = ranges.length > 0 ? pageWindow(ranges, request, limit) : null;
  if (window === null) {
    const at = request.after !== undefined ? Math.min(Math.max(0, request.after), end) : first;
    return finish({ bytes: new Uint8Array(0), from: at, to: at });
  }
  const bytes = readWindow(scope, sized, window);
  if (bytes === null) { return { ok: false, error: 'access-denied', detail: `cannot read ${request.runId} ${request.stream} retained segments` }; }
  const rangeStart = ranges.find(r => window.from >= r.from && window.from < r.to)?.from ?? window.from;
  return finish(alignPage(bytes, window, request.after !== undefined, rangeStart));
}

/** Recorded omissions and holes between retained ranges that touch `[from, to]`, each once, in order. */
function gapFinder(omitted: readonly Range[], ranges: readonly Range[]): (_from: number, _to: number) => Range[] {
  const holes = ranges.slice(1).map((range, index) => ({ from: ranges[index].to, to: range.from }));
  return (from, to) => [...omitted, ...holes]
    .filter((gap, index, all) => gap.from <= to && gap.to >= from && all.findIndex(other => other.from === gap.from && other.to === gap.to) === index)
    .sort((x, y) => x.from - y.from);
}

/** Read exactly the window's bytes from the segments it touches; `null` when one cannot be read. */
function readWindow(scope: RunHistoryScope, sized: readonly SizedSegment[], window: Range): Uint8Array | null {
  const parts: Uint8Array[] = [];
  for (const segment of sized) {
    const segFrom = Math.max(window.from, segment.start);
    const segTo = Math.min(window.to, segment.end);
    if (segTo <= segFrom) { continue; }
    const bytes = scope.fs.readBytes(segment.path, segFrom - segment.start, segTo - segFrom);
    if (!bytes) { return null; }
    parts.push(bytes);
  }
  return concat(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let cursor = 0;
  for (const part of parts) { joined.set(part, cursor); cursor += part.length; }
  return joined;
}

function collectSegmentHits(bytes: Uint8Array, pattern: RegExp, runId: string, stream: RunHistoryRef['stream'], segmentStart: number, hits: RunSearchHit[], maxHits: number): number {
  let count = 0;
  const { text, map } = searchable(latin1(bytes));
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0].length === 0) { break; }
    count += 1;
    if (hits.length >= maxHits) { continue; }
    const rawStart = map[match.index];
    const rawEnd = map[match.index + match[0].length - 1] + 1;
    const from = Math.max(0, rawStart - RUN_SEARCH_CONTEXT_BYTES);
    const to = Math.min(bytes.length, rawEnd + RUN_SEARCH_CONTEXT_BYTES);
    const ref: RunHistoryRef = { runId, stream, offset: segmentStart + rawStart, length: rawEnd - rawStart };
    hits.push({ ref: formatRunHistoryRef(ref), runId: ref.runId, stream, offset: ref.offset, preview: stripTerminalControl(decode(bytes.subarray(from, to))) });
  }
  return count;
}

function searchStreams(query: RunSearchQuery): readonly RunHistoryRef['stream'][] {
  return query.stream ? [query.stream] : ['stdout', 'stderr'];
}
