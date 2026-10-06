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
import { isAgentRunId } from '../domain/agent-run.js';
import {
  MAX_RUN_SEARCH_HITS,
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
}

export interface RunSummary {
  readonly record: RunRecord;
  /** The record's state, with a dead supervisor's `running` reported as `interrupted`. */
  readonly state: RunState;
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
  if (state === 'running') { lines.push('the run is still live; later output is not yet captured'); }
  lines.push(...record.omissions);
  return lines;
}

function readRecord(scope: RunHistoryScope, runId: string): RunLookup {
  if (!isAgentRunId(runId)) { return { ok: false, error: 'access-denied', detail: `not a run id of this Mission: ${runId}` }; }
  const raw = scope.fs.readText(join(scope.runsDir, runId, RUN_RECORD_FILE));
  if (raw === null) { return { ok: false, error: 'missing', detail: `no retained run ${runId} in this Mission (it may have been retired)` }; }
  let record: RunRecord;
  try { record = JSON.parse(raw) as RunRecord; } catch { return { ok: false, error: 'malformed', detail: `run record ${runId} is not valid JSON` }; }
  if (record.runId !== runId) { return { ok: false, error: 'malformed', detail: `run record ${runId} names another run` }; }
  const state = effectiveState(record, scope.isAlive);
  return { ok: true, run: { record, state, coverage: coverageOf(record, state) } };
}

/** Every retained run of the Mission, newest first. */
export function listRuns(scope: RunHistoryScope): RunSummary[] {
  return scope.fs.listDirs(scope.runsDir)
    .filter(isAgentRunId)
    .map(runId => readRecord(scope, runId))
    .flatMap(lookup => (lookup.ok && lookup.run ? [lookup.run] : []))
    .sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
}

export function getRun(scope: RunHistoryScope, runId: string): RunLookup {
  return readRecord(scope, runId);
}

// CSI, OSC and two-byte escape sequences: terminal control, not content.
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** Strip terminal control sequences for display; alternate-screen text is kept. */
export function stripTerminalControl(text: string): string {
  return text.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
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
  for (const match of raw.matchAll(ANSI)) {
    pushRange(last, match.index);
    last = match.index + match[0].length;
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
}

export interface RunSearchQuery {
  readonly pattern: string;
  readonly regex?: boolean;
  readonly runId?: string;
  readonly stream?: RunStreamName;
  readonly maxHits?: number;
}

function matcher(query: RunSearchQuery): RegExp {
  if (query.regex) { return new RegExp(query.pattern, 'gi'); }
  // Literal search over latin1 text: encode the pattern's UTF-8 bytes the same way.
  const literal = Buffer.from(query.pattern, 'utf8').toString('latin1');
  return new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
}

/** Bounded search across the Mission's runs (or one run), newest run first. */
export function searchRuns(scope: RunHistoryScope, query: RunSearchQuery): RunSearchResult {
  if (!query.pattern) { throw new Error('search pattern must not be empty'); }
  const maxHits = Math.min(Math.max(query.maxHits ?? MAX_RUN_SEARCH_HITS, 1), MAX_RUN_SEARCH_HITS);
  const pattern = matcher(query);
  const errors: string[] = [];
  let runs: RunSummary[];
  if (query.runId) {
    const lookup = getRun(scope, query.runId);
    runs = lookup.ok && lookup.run ? [lookup.run] : [];
    if (!lookup.ok) { errors.push(`${lookup.error}: ${lookup.detail}`); }
  } else {
    runs = listRuns(scope);
  }
  const hits: RunSearchHit[] = [];
  let totalHits = 0;
  for (const run of runs) {
    for (const stream of query.stream ? [query.stream] : (['stdout', 'stderr'] as const)) {
      for (const segment of segments(scope, run.record.runId, stream)) {
        const size = scope.fs.size(segment.path) ?? 0;
        const bytes = scope.fs.readBytes(segment.path, 0, size);
        if (!bytes) { errors.push(`access-denied: cannot read ${run.record.runId} ${stream} segment at ${segment.start}`); continue; }
        const { text, map } = searchable(latin1(bytes));
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
          if (match[0].length === 0) { break; }
          totalHits += 1;
          if (hits.length >= maxHits) { continue; }
          const rawStart = map[match.index];
          const rawEnd = map[match.index + match[0].length - 1] + 1;
          const from = Math.max(0, rawStart - RUN_SEARCH_CONTEXT_BYTES);
          const to = Math.min(bytes.length, rawEnd + RUN_SEARCH_CONTEXT_BYTES);
          const ref: RunHistoryRef = { runId: run.record.runId, stream, offset: segment.start + rawStart, length: rawEnd - rawStart };
          hits.push({ ref: formatRunHistoryRef(ref), runId: ref.runId, stream, offset: ref.offset, preview: stripTerminalControl(decode(bytes.subarray(from, to))) });
        }
      }
    }
  }
  return {
    hits,
    totalHits,
    searchedRuns: runs.map(run => run.record.runId),
    coverage: runs.flatMap(run => run.coverage.map(line => `${run.record.runId}: ${line}`)),
    errors,
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
