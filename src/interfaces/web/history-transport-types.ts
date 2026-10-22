/** Pure JSON history vocabulary. Optional fields may be omitted; null is explicit. */
export type HistoryProbe =
  | { readonly kind: 'absent' | 'idle' }
  | { readonly kind: 'starting'; readonly operation: string; readonly runId?: string | null }
  | { readonly kind: 'live'; readonly operation: string; readonly runId?: string | null; readonly execution?: boolean | null }
  | { readonly kind: 'ambiguous'; readonly sessions: readonly string[]; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly reason: 'host-missing' | 'failed' | 'timeout'; readonly detail: string };

export type MissionViewState = 'starting' | 'live' | 'ended' | 'capture-only' | 'missing' | 'probe-failed' | 'probe-timeout' | 'ambiguous';

export interface HistoryOperation {
  readonly legacy: boolean;
  readonly redacted: boolean;
  readonly runId: string;
  readonly captureKind: 'agent' | 'coordinator';
  readonly operationId: string | null;
  readonly execution: 'live' | 'stopped' | 'unknown';
  readonly role: string;
  readonly family: string | null;
  readonly attempt: number | null;
  readonly state: 'running' | 'exited' | 'interrupted';
  readonly terminalHost: 'pipe' | 'tmux';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly streams: { readonly stdout: number; readonly stderr: number };
  readonly coverage: readonly string[];
}

export interface HistoryOverview {
  readonly missionId: string;
  readonly state: MissionViewState;
  readonly probe: HistoryProbe;
  readonly operations: readonly HistoryOperation[];
  readonly notices: readonly string[];
  readonly unattributed: readonly string[];
}

export interface HistoryPage {
  readonly runId: string;
  readonly stream: 'stdout' | 'stderr';
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly hasEarlier: boolean;
  readonly atEnd: boolean;
  readonly running: boolean;
  readonly gaps: ReadonlyArray<{ readonly from: number; readonly to: number }>;
}

export interface HistoryHit { readonly ref: string; readonly runId: string; readonly stream: 'stdout' | 'stderr'; readonly offset: number; readonly preview: string }
export interface HistorySearch { readonly searchedRuns: readonly string[]; readonly coverage: readonly string[]; readonly errors: readonly string[]; readonly hits: readonly HistoryHit[]; readonly totalHits: number; readonly scanLimited: boolean }
export type LiveView = { readonly kind: 'live'; readonly operation: string | null; readonly output: string } | { readonly kind: 'not-live'; readonly probe: HistoryProbe };

