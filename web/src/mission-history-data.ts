/**
 * Mission history reads for the mission view (TASK-2749). Every call is one
 * bounded, same-origin GET against the application's mission terminal
 * capability; the browser passes only the card's Mission ID, an operation id,
 * a stream name and byte offsets. A failed read is a distinct result, so the
 * view keeps what it already shows instead of treating failure as absence.
 */

export type MissionViewState = 'starting' | 'live' | 'ended' | 'capture-only' | 'missing' | 'probe-failed' | 'probe-timeout' | 'ambiguous';

export interface HistoryOperation {
  readonly runId: string;
  readonly captureKind?: 'agent' | 'coordinator';
  readonly operationId?: string | null;
  readonly execution?: 'live' | 'stopped' | 'unknown';
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
  readonly state: MissionViewState;
  readonly probe: { readonly kind: string; readonly operation?: string; readonly detail?: string };
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

export interface HistoryHit { readonly runId: string; readonly stream: 'stdout' | 'stderr'; readonly offset: number; readonly preview: string }
export interface HistorySearch { readonly hits: readonly HistoryHit[]; readonly totalHits: number; readonly scanLimited: boolean }
export type LiveView = { readonly kind: 'live'; readonly operation: string | null; readonly output: string } | { readonly kind: 'not-live'; readonly probe: { readonly kind: string; readonly detail?: string } };

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const STATES: readonly string[] = ['starting', 'live', 'ended', 'capture-only', 'missing', 'probe-failed', 'probe-timeout', 'ambiguous'];

const base = (missionId: string) => `/api/terminal/${encodeURIComponent(missionId)}`;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function read<T>(url: string, accept: (_body: Record<string, unknown>) => T | null, signal?: AbortSignal): Promise<Read<T>> {
  try {
    const deadline = AbortSignal.timeout(15000);
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]) });
    const body: unknown = await response.json();
    if (!isObject(body)) { return { ok: false, detail: `Mission history is unavailable (HTTP ${response.status}).` }; }
    if (body.ok === false) { return { ok: false, detail: typeof body.detail === 'string' ? body.detail : `Mission history is unavailable (HTTP ${response.status}).` }; }
    const value = accept(body);
    return value === null ? { ok: false, detail: 'Mission history returned an unexpected shape.' } : { ok: true, value };
  } catch {
    return { ok: false, detail: 'Mission history is unavailable.' };
  }
}

export function loadOverview(missionId: string, signal?: AbortSignal): Promise<Read<HistoryOverview>> {
  return read(base(missionId), body => (typeof body.state === 'string' && STATES.includes(body.state) && Array.isArray(body.operations) && isObject(body.probe)
    ? body as unknown as HistoryOverview : null), signal);
}

export function loadPage(missionId: string, request: { runId: string; stream: 'stdout' | 'stderr'; before?: number; after?: number }, signal?: AbortSignal): Promise<Read<HistoryPage>> {
  const query = new URLSearchParams({ run: request.runId, stream: request.stream });
  if (request.before !== undefined) { query.set('before', String(request.before)); }
  if (request.after !== undefined) { query.set('after', String(request.after)); }
  return read(`${base(missionId)}/history?${query.toString()}`, body => (typeof body.text === 'string' && typeof body.from === 'number' && typeof body.to === 'number'
    ? body as unknown as HistoryPage : null), signal);
}

export function searchHistory(missionId: string, pattern: string, signal?: AbortSignal): Promise<Read<HistorySearch>> {
  return read(`${base(missionId)}/search?${new URLSearchParams({ q: pattern }).toString()}`, body => (Array.isArray(body.hits) && typeof body.totalHits === 'number'
    ? body as unknown as HistorySearch : null), signal);
}

export function loadLive(missionId: string, signal?: AbortSignal): Promise<Read<LiveView>> {
  return read(`${base(missionId)}/live`, body => (body.kind === 'live' || body.kind === 'not-live' ? body as unknown as LiveView : null), signal);
}

/** One plain sentence per view state; never claims a live terminal that is not there. */
export function describeState(overview: HistoryOverview): string {
  switch (overview.state) {
    case 'live': return `Live: operation ${overview.probe.operation ?? ''} is running; its output is appended as it arrives.`;
    case 'starting': return 'Starting: an operation is launching and has not produced terminal output yet.';
    case 'ended': return 'No operation is running. Showing retained history.';
    case 'capture-only': return 'The newest operation ran without a terminal (pipe execution). Showing its captured output.';
    case 'missing': return 'No terminal and no retained history for this mission.';
    case 'probe-timeout': return `The terminal did not answer in time (${overview.probe.detail ?? 'timeout'}). Retained history is still shown.`;
    case 'probe-failed': return `The terminal could not be inspected (${overview.probe.detail ?? 'failed'}). Retained history is still shown.`;
    case 'ambiguous': return `Terminal sessions could not be attributed to this mission (${overview.probe.detail ?? 'ambiguous'}). Retained history is still shown.`;
  }
}
