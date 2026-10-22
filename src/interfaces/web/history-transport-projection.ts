/** Application models remain separate; emit only the browser's JSON vocabulary. */
import type { MissionHistoryOverview, MissionHistoryPage, MissionHistorySearchResult, MissionLiveView, MissionTerminalProbe } from '../../application/ports/mission-terminal.js';
import { validateHistoryOverview, validateHistoryPage, validateHistorySearch, validateHistoryLive } from './history-transport.js';
import type { HistoryOverview, HistoryPage, HistorySearch, LiveView, HistoryProbe } from './history-transport-types.js';

function required<T>(value: T | null): T {
  if (value === null) { throw new Error('Invalid mission history projection'); }
  return value;
}
function probe(value: MissionTerminalProbe): HistoryProbe {
  switch (value.kind) {
    case 'absent': case 'idle': return { kind: value.kind };
    case 'starting': case 'live': return {
      kind: value.kind, operation: value.operation,
      ...(value.runId !== undefined ? { runId: value.runId } : {}),
      ...(value.kind === 'live' && value.execution !== undefined ? { execution: value.execution } : {}),
    };
    case 'ambiguous': return { kind: value.kind, sessions: [...value.sessions], detail: value.detail };
    case 'unavailable': return { kind: value.kind, reason: value.reason, detail: value.detail };
  }
}
export function toHistoryOverview(value: MissionHistoryOverview): HistoryOverview {
  return required(validateHistoryOverview({
    missionId: value.missionId, state: value.state, probe: probe(value.probe),
    notices: [...value.notices], unattributed: [...value.unattributed],
    operations: value.operations.map(operation => ({
      runId: operation.runId, captureKind: operation.captureKind, operationId: operation.operationId,
      execution: operation.execution, role: operation.role, family: operation.family, attempt: operation.attempt,
      state: operation.state, terminalHost: operation.terminalHost, startedAt: operation.startedAt,
      endedAt: operation.endedAt, exitCode: operation.exitCode, signal: operation.signal,
      legacy: operation.legacy, redacted: operation.redacted,
      streams: { stdout: operation.streams.stdout, stderr: operation.streams.stderr }, coverage: [...operation.coverage],
    })),
  }));
}
export function toHistoryPage(value: MissionHistoryPage): HistoryPage & { readonly ok: true } {
  return { ok: true, ...required(validateHistoryPage({
    runId: value.runId, stream: value.stream, from: value.from, to: value.to, text: value.text,
    hasEarlier: value.hasEarlier, atEnd: value.atEnd, running: value.running,
    gaps: value.gaps.map(gap => ({ from: gap.from, to: gap.to })),
  })) };
}
export function toHistorySearch(value: MissionHistorySearchResult): HistorySearch & { readonly ok: true } {
  return { ok: true, ...required(validateHistorySearch({
    hits: value.hits.map(hit => ({ ref: hit.ref, runId: hit.runId, stream: hit.stream, offset: hit.offset, preview: hit.preview })),
    totalHits: value.totalHits, scanLimited: value.scanLimited,
    searchedRuns: [...value.searchedRuns], coverage: [...value.coverage], errors: [...value.errors],
  })) };
}
export function toHistoryLive(value: MissionLiveView): LiveView {
  return required(validateHistoryLive(value.kind === 'live'
    ? { kind: value.kind, operation: value.operation, output: value.output }
    : { kind: value.kind, probe: probe(value.probe) }));
}
