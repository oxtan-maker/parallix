/**
 * Mission history reads for the mission view (TASK-2749). Every call is one
 * bounded, same-origin GET against the application's mission terminal
 * capability; the browser passes only the card's Mission ID, an operation id,
 * a stream name and byte offsets. A failed read is a distinct result, so the
 * view keeps what it already shows instead of treating failure as absence.
 */

import { isPlainObject } from '../../src/interfaces/web/transport-validation-primitives.js';
import { validateHistoryOverview, validateHistoryPage, validateHistorySearch, validateHistoryLive } from '../../src/interfaces/web/history-transport.js';
import type { HistoryOverview, HistoryPage, HistorySearch, LiveView } from '../../src/interfaces/web/history-transport-types.js';
export type { MissionViewState, HistoryOperation, HistoryOverview, HistoryPage, HistoryHit, HistorySearch, LiveView } from '../../src/interfaces/web/history-transport-types.js';

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const base = (missionId: string) => `/api/terminal/${encodeURIComponent(missionId)}`;

async function read<T>(url: string, accept: (_body: Record<string, unknown>) => T | null, signal?: AbortSignal): Promise<Read<T>> {
  try {
    const deadline = AbortSignal.timeout(15000);
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]) });
    const body: unknown = await response.json();
    if (!isPlainObject(body)) { return { ok: false, detail: `Mission history is unavailable (HTTP ${response.status}).` }; }
    if (body.ok === false) { return { ok: false, detail: typeof body.detail === 'string' ? body.detail : `Mission history is unavailable (HTTP ${response.status}).` }; }
    const value = accept(body);
    return value === null ? { ok: false, detail: 'Mission history returned an unexpected shape.' } : { ok: true, value };
  } catch {
    return { ok: false, detail: 'Mission history is unavailable.' };
  }
}

export function loadOverview(missionId: string, signal?: AbortSignal): Promise<Read<HistoryOverview>> {
  return read(base(missionId), validateHistoryOverview, signal);
}

export function loadPage(missionId: string, request: { runId: string; stream: 'stdout' | 'stderr'; before?: number; after?: number }, signal?: AbortSignal): Promise<Read<HistoryPage>> {
  const query = new URLSearchParams({ run: request.runId, stream: request.stream });
  if (request.before !== undefined) { query.set('before', String(request.before)); }
  if (request.after !== undefined) { query.set('after', String(request.after)); }
  return read(`${base(missionId)}/history?${query.toString()}`, validateHistoryPage, signal);
}

export function searchHistory(missionId: string, pattern: string, signal?: AbortSignal): Promise<Read<HistorySearch>> {
  return read(`${base(missionId)}/search?${new URLSearchParams({ q: pattern }).toString()}`, validateHistorySearch, signal);
}

export function loadLive(missionId: string, signal?: AbortSignal): Promise<Read<LiveView>> {
  return read(`${base(missionId)}/live`, validateHistoryLive, signal);
}

/** One plain sentence per view state; never claims a live terminal that is not there. */
export function describeState(overview: HistoryOverview): string {
  switch (overview.state) {
    case 'live-operation': return `Live operation: ${'operation' in overview.probe ? overview.probe.operation : 'unknown'} is running. Following its correlated output.`;
    case 'starting': return 'Starting: an operation is launching. Wait for its correlated output or select retained history.';
    case 'current-capture': return 'Current pipe capture: following retained output while the operation runs without a terminal.';
    case 'idle-console': return 'Retained idle console: no operation is running. Select an operation to inspect durable history.';
    case 'ended': return 'Ended work: no operation is running. Showing retained history.';
    case 'missing': return 'Missing history: no terminal or retained operation is available for this mission.';
    case 'probe-timeout': return `The terminal did not answer in time (${'detail' in overview.probe ? overview.probe.detail : 'timeout'}). Retained history is still shown.`;
    case 'probe-failed': return `The terminal could not be inspected (${'detail' in overview.probe ? overview.probe.detail : 'failed'}). Retained history is still shown.`;
    case 'ambiguous': return `Terminal sessions could not be attributed to this mission (${'detail' in overview.probe ? overview.probe.detail : 'ambiguous'}). Retained history is still shown.`;
  }
}
