/**
 * Mission terminal and retained-history capability (TASK-2749).
 *
 * The application owns one capability that resolves a canonical Mission ID to
 * the resources it owns in one repository: its live terminal, if any, and its
 * retained workflow history. Launch, attach, capture, history, retirement,
 * cleanup, the web host and board actions all go through it, so none of them
 * derives a native handle of its own. Native handles — sockets, session names,
 * directory encodings — stay inside the adapters that implement the ports
 * below; callers pass Mission IDs and receive typed results.
 */
import type { AgentRunIdentity } from '../../domain/agent-run.js';

import type { RunHistoryErrorKind, RunHistoryFileSystem, RunHistoryRef, RunRecord, RunStreamName } from '../run-history-types.js';
import type { RunShowResult, RunSummary } from '../run-history.js';

/** Repository and Mission scope, using the existing domain identities. */
export type MissionTerminalScope = Pick<AgentRunIdentity, 'repositoryId' | 'missionId'>;

/** What the terminal host observed for one Mission terminal. */
export type MissionTerminalProbe =
  /** No terminal server exists for the Mission: definitively nothing hosted. */
  | { readonly kind: 'absent' }
  /** The Mission session exists and an operation is launching (no command yet). */
  | { readonly kind: 'starting'; readonly operation: string; readonly runId?: string | null }
  /** An operation runs in the Mission session. */
  | { readonly kind: 'live'; readonly operation: string; readonly runId?: string | null; readonly execution?: boolean | null }
  /** Only the retained console remains; no operation runs. */
  | { readonly kind: 'idle' }
  /** Sessions exist that cannot be attributed to this Mission. */
  | { readonly kind: 'ambiguous'; readonly sessions: readonly string[]; readonly detail: string }
  /** The probe could not decide; absence is not implied. */
  | { readonly kind: 'unavailable'; readonly reason: 'host-missing' | 'failed' | 'timeout'; readonly detail: string };

/** Raw session facts a host reports; the application resolves ownership. */
export interface MissionTerminalSessions {
  /** The session carrying this Mission's native name, when present. */
  readonly owned: string | null;
  /** Other sessions on the Mission's own terminal server. */
  readonly others: readonly string[];
  /** Operation windows of the owned session and whether their command started. */
  readonly operations: ReadonlyArray<{ readonly name: string; readonly started: boolean; readonly runId?: string | null; readonly execution?: boolean | null }>;
}

export type MissionTerminalSessionsResult =
  | { readonly ok: true; readonly sessions: MissionTerminalSessions | null }
  | { readonly ok: false; readonly reason: 'host-missing' | 'failed' | 'timeout'; readonly detail: string };

/** Terminal host port: implemented by the tmux adapter. */
export interface MissionTerminalHostPort {
  /** Inspect the Mission's own terminal server; `sessions: null` means no server exists. */
  sessions(_identity: MissionTerminalScope): MissionTerminalSessionsResult;
  /** Visible text of one owned operation or console pane; never sends keys. */
  capture(_identity: MissionTerminalScope, _session: string, _window: string | null): { readonly ok: true; readonly output: string } | { readonly ok: false; readonly reason: 'failed' | 'timeout'; readonly detail: string };
  /** Attach the operator terminal to the owned session; returns the exit status. */
  attach(_identity: MissionTerminalScope, _session: string, _readOnly: boolean): number;
  /** Close an idle owned session; refuses one with an owned operation. */
  close(_identity: MissionTerminalScope, _session: string): void;
  /** Retire the Mission terminal during worktree cleanup, after operations drain; `null` stops an empty server. */
  retire(_identity: MissionTerminalScope, _session: string | null): void;
}

/** One place that may hold a Mission's retained runs. */
export interface MissionHistoryLocation {
  readonly runsDir: string;
  /** True for a pre-TASK-2749 name or a worktree-local store. */
  readonly legacy: boolean;
}

/** History store port: implemented by the filesystem run-history adapter. */
export interface MissionHistoryStorePort {
  readonly fs: RunHistoryFileSystem;
  locations(_identity: MissionTerminalScope): readonly MissionHistoryLocation[];
  /** Supervisor liveness, so an abandoned `running` record reads as interrupted. */
  isAlive(_pid: number): boolean;
  executionAlive?(_execution: { readonly pid: number; readonly processIdentity: string | null }): boolean | null;
  /** Validate current or legacy record ownership using adapter storage attribution. */
  attribute(_identity: MissionTerminalScope, _record: { readonly missionId?: unknown; readonly repositoryId?: unknown; readonly repositoryKey?: unknown }, _location: MissionHistoryLocation): { readonly kind: 'attributed'; readonly legacy: boolean } | { readonly kind: 'unattributed'; readonly reason: string };
}

/** One retained operation (run) of the Mission, newest first in listings. */
export interface MissionOperationSummary extends Pick<RunRecord, 'runId' | 'role' | 'family' | 'attempt' | 'state' | 'terminalHost' | 'startedAt' | 'endedAt' | 'exitCode' | 'signal' | 'redacted'> {
  readonly captureKind: 'agent' | 'coordinator';
  readonly operationId: string | null;
  readonly execution: RunSummary['execution'];
  readonly legacy: boolean;
  readonly streams: { readonly stdout: number; readonly stderr: number };
  /** Coverage, gaps and omissions, stated plainly. */
  readonly coverage: readonly string[];
}

/**
 * The Mission view's state:
 * - `starting`: an operation is launching and has not produced a hosted command yet
 * - `live`: an operation runs in the Mission terminal
 * - `ended`: no operation runs; retained history is available
 * - `capture-only`: the newest operation ran without a terminal (pipe execution); only its capture exists
 * - `missing`: no terminal and no retained history
 * - `probe-failed` / `probe-timeout`: the terminal could not be inspected; history is still returned
 * - `ambiguous`: terminal sessions exist that cannot be attributed to this Mission
 */
export type MissionViewState = 'starting' | 'live' | 'ended' | 'capture-only' | 'missing' | 'probe-failed' | 'probe-timeout' | 'ambiguous';

export interface MissionHistoryOverview {
  readonly missionId: string;
  readonly state: MissionViewState;
  readonly probe: MissionTerminalProbe;
  /** Retained operations, newest first; bounded by the retention budget. */
  readonly operations: readonly MissionOperationSummary[];
  /** Retained artifacts that could not be attributed; reported, never shown as this Mission's. */
  readonly unattributed: readonly string[];
  /** Plain retention and limitation notes. */
  readonly notices: readonly string[];
}

export interface MissionHistoryPageRequest {
  readonly runId: string;
  readonly stream: RunStreamName;
  /** Return bytes ending at this offset (earlier history). */
  readonly before?: number;
  /** Return bytes starting at this offset (newer output). */
  readonly after?: number;
  readonly limit?: number;
}

/** A bounded, line-aligned slice of one operation stream. */
export interface MissionHistoryPage {
  readonly runId: string;
  readonly stream: RunStreamName;
  /** Byte range `[from, to)` of the stored stream this page covers. */
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** Retained bytes exist before `from`. */
  readonly hasEarlier: boolean;
  /** `to` is the end of everything captured so far. */
  readonly atEnd: boolean;
  /** The operation is still capturing; more output may follow `to`. */
  readonly running: boolean;
  /** Dropped byte ranges adjacent to or inside the requested window. */
  readonly gaps: ReadonlyArray<{ readonly from: number; readonly to: number }>;
}

export type MissionHistoryError = { readonly ok: false; readonly error: 'invalid' | 'ambiguous' | RunHistoryErrorKind; readonly detail: string };

export interface MissionHistorySearchHit {
  /** Citable `run:<id>:<stream>@<offset>+<length>` reference. */
  readonly ref: string;
  readonly runId: string;
  readonly stream: RunStreamName;
  readonly offset: number;
  readonly preview: string;
}

export interface MissionHistorySearchResult {
  readonly hits: readonly MissionHistorySearchHit[];
  readonly totalHits: number;
  readonly searchedRuns: readonly string[];
  /** True when the scan stopped at its byte budget before covering every run. */
  readonly scanLimited: boolean;
  readonly coverage: readonly string[];
  readonly errors: readonly string[];
}

export interface MissionHistorySearchQuery {
  readonly pattern: string;
  /** Operator CLI only; the web host never passes a regular expression. */
  readonly regex?: boolean;
  readonly runId?: string;
  readonly stream?: RunStreamName;
  readonly maxHits?: number;
}

export type MissionLiveView =
  | { readonly kind: 'live'; readonly operation: string | null; readonly output: string }
  | { readonly kind: 'not-live'; readonly probe: MissionTerminalProbe };

/** The published capability. Every method takes a Mission ID as given by an input boundary. */
export interface MissionTerminalCapability {
  /** Canonical identity for this repository, or a typed `invalid` error. */
  identify(_mission: string): { readonly ok: true; readonly identity: MissionTerminalScope } | MissionHistoryError;
  probe(_mission: string): MissionTerminalProbe | MissionHistoryError;
  overview(_mission: string): MissionHistoryOverview | MissionHistoryError;
  page(_mission: string, _request: MissionHistoryPageRequest): ({ readonly ok: true } & MissionHistoryPage) | MissionHistoryError;
  /** Attributed retained runs, newest first, with what could not be attributed. */
  history(_mission: string): { readonly ok: true; readonly runs: readonly RunSummary[]; readonly unattributed: readonly string[] } | MissionHistoryError;
  search(_mission: string, _query: MissionHistorySearchQuery): ({ readonly ok: true } & MissionHistorySearchResult) | MissionHistoryError;
  /** The bytes one citable reference names, bounded. */
  show(_mission: string, _ref: RunHistoryRef, _context: number): RunShowResult | MissionHistoryError;
  live(_mission: string): MissionLiveView | MissionHistoryError;
  attach(_mission: string, _options: { readonly readOnly: boolean }): number;
  close(_mission: string): void;
  retire(_mission: string): void;
}
