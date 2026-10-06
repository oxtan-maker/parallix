/**
 * Agent-run history contract (TASK-2643).
 *
 * One record per agent run: the run's identity, what was captured and from
 * which source, and what is missing. The store reuses the TASK-2642 recovery
 * evidence contract instead of opening a second Mission store: the same
 * worktree-local `.workflow/` tree, the same Mission directory naming, the same
 * byte cap, retention window and record budget, the same opt-in credential
 * redaction, and the same honest error kinds.
 */
import {
  MAX_RECOVERY_EVIDENCE_BYTES,
  MAX_RECOVERY_EVIDENCE_INCIDENTS,
  RECOVERY_EVIDENCE_RETENTION_MS,
} from './recovery-evidence-types.js';
import type { RecoveryEvidenceErrorKind } from './recovery-evidence-types.js';

export const RUN_HISTORY_VERSION = 1;

/** Retained bytes per stream; output past it is dropped from the middle and reported. */
export const MAX_RUN_STREAM_BYTES = MAX_RECOVERY_EVIDENCE_BYTES;
/** Segment size; overflow drops whole middle segments so kept offsets stay stable. */
export const RUN_SEGMENT_BYTES = 1024 * 1024;
/** Runs kept per Mission before the oldest is retired. */
export const MAX_RUNS_PER_MISSION = MAX_RECOVERY_EVIDENCE_INCIDENTS;
/** Runs older than this are retired on the next capture. */
export const RUN_HISTORY_RETENTION_MS = RECOVERY_EVIDENCE_RETENTION_MS;

/** Largest slice one `show` returns; larger requests are clamped and say so. */
export const MAX_RUN_SHOW_BYTES = 16 * 1024;
/** Most hits one `search` returns; more are counted, not returned. */
export const MAX_RUN_SEARCH_HITS = 20;
/** Context bytes returned on each side of a search hit. */
export const RUN_SEARCH_CONTEXT_BYTES = 160;

export type RunStreamName = 'stdout' | 'stderr';
export type RunState = 'running' | 'exited' | 'interrupted';
export type RunTerminalHost = 'pipe' | 'tmux';

/**
 * Where a piece of history came from. Terminal bytes are what the process
 * wrote; they are not a rendered screen and they do not contain model
 * reasoning or tool calls the provider never printed.
 */
export type RunSourceKind = 'terminal-bytes' | 'provider-stream' | 'provider-transcript';

export interface RunSource {
  readonly kind: RunSourceKind;
  /** Store-relative path of the retained content, when retained. */
  readonly path: string | null;
  /** What this source covers, in one sentence an agent can rely on. */
  readonly covers: string;
  readonly complete: boolean;
}

/** One stream's retained bytes; offsets are byte offsets into the stored stream. */
export interface RunStreamCoverage {
  /** Bytes the stream produced (after redaction, when redaction ran). */
  readonly bytes: number;
  readonly retainedBytes: number;
  /** Byte ranges `[from, to)` dropped to stay under the cap. */
  readonly omitted: ReadonlyArray<{ readonly from: number; readonly to: number }>;
}

export interface RunRecord {
  readonly version: typeof RUN_HISTORY_VERSION;
  readonly runId: string;
  readonly missionId: string;
  readonly repositoryKey: string;
  readonly role: string;
  readonly family: string;
  readonly attempt: number;
  readonly terminalHost: RunTerminalHost;
  /** Why a configured tmux launch ran through `pipe`, when it did. */
  readonly hostFallbackReason: string | null;
  /** tmux socket and session names for attach, when hosted by tmux. */
  readonly tmux: { readonly socketPath: string; readonly sessions: readonly string[] } | null;
  /** The supervising process; a `running` record whose supervisor is gone is interrupted. */
  readonly supervisorPid: number;
  readonly state: RunState;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly providerSessionId: string | null;
  readonly redacted: boolean;
  readonly streams: { readonly stdout: RunStreamCoverage; readonly stderr: RunStreamCoverage };
  readonly sources: readonly RunSource[];
  /** Plain statements of what this history does not contain. */
  readonly omissions: readonly string[];
}

/** A stable, citable reference to bytes inside one run's stream. */
export interface RunHistoryRef {
  readonly runId: string;
  readonly stream: RunStreamName;
  readonly offset: number;
  readonly length: number;
}

/** Error kinds are the TASK-2642 kinds, so both stores report failures alike. */
export type RunHistoryErrorKind = RecoveryEvidenceErrorKind;

/** The file-system surface the application-side reader needs (ADR 0051). */
export interface RunHistoryFileSystem {
  readText(_path: string): string | null;
  readBytes(_path: string, _offset: number, _length: number): Uint8Array | null;
  size(_path: string): number | null;
  listDirs(_path: string): string[];
  listFiles(_path: string): string[];
}

/** Store-relative layout shared by the writer adapter and the reader. */
export const RUN_HISTORY_DIR = 'run-history';
export const RUN_RECORD_FILE = 'run.json';

/** Segment file name for the segment starting at `offset`. */
export function runSegmentName(offset: number): string {
  return `${String(offset).padStart(12, '0')}.log`;
}

/** Start offset of a segment file, or `null` when the name is not a segment. */
export function runSegmentOffset(name: string): number | null {
  const match = /^(\d{12})\.log$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** Render a reference as the stable token agents cite: `run:<id>:<stream>@<offset>+<length>`. */
export function formatRunHistoryRef(ref: RunHistoryRef): string {
  return `run:${ref.runId}:${ref.stream}@${ref.offset}+${ref.length}`;
}

/** Parse a reference token; `null` when malformed. */
export function parseRunHistoryRef(token: string): RunHistoryRef | null {
  const match = /^run:([a-z0-9_-]+):(stdout|stderr)@(\d+)\+(\d+)$/.exec(token.trim());
  if (!match) { return null; }
  return { runId: match[1], stream: match[2] as RunStreamName, offset: Number(match[3]), length: Number(match[4]) };
}
