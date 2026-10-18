import { observeProviderExecution } from './projections/provider-execution.js';
/**
 * Mission terminal and retained-history service (TASK-2749).
 *
 * Implements the published `MissionTerminalCapability` from two ports: the
 * terminal host (live sessions) and the history store (retained runs). It
 * accepts a Mission ID from an input boundary, normalizes accepted aliases
 * once, validates it against the domain, and only ever resolves resources the
 * one canonical identity owns. History does not depend on the live terminal:
 * a failed or timed-out probe is reported beside the retained history, never
 * instead of it, and never as absence.
 */
import { isRunHistoryId, runCaptureKind } from './run-history-types.js';
import { missionId } from '../domain/mission.js';
import { repositoryId } from '../domain/repository.js';
import type { MissionTerminalScope } from './ports/mission-terminal.js';
import { resolveMissionSession } from './mission-terminal-compat.js';
import { getRun, readRunPage, searchRuns, showRun, stripTerminalControl } from './run-history.js';
import type { RunHistoryScope, RunSummary } from './run-history.js';
import { MAX_RUN_SEARCH_HITS, MAX_RUN_SEARCH_SCAN_BYTES, MAX_RUN_STREAM_BYTES, MAX_RUNS_PER_MISSION, RUN_HISTORY_RETENTION_MS } from './run-history-types.js';
import type { RecordedOutputRenderer } from './ports/recorded-output-renderer.js';
import type {
  MissionHistoryError,
  MissionHistoryLocation,
  MissionHistoryOverview,
  MissionHistoryPage,
  MissionHistoryPageRequest,
  MissionHistorySearchHit,
  MissionHistorySearchQuery,
  MissionHistorySearchResult,
  MissionLiveView,
  MissionHistoryStorePort,
  MissionOperationSummary,
  MissionTerminalCapability,
  MissionTerminalHostPort,
  MissionTerminalProbe,
  MissionTerminalSessions,
  MissionViewState,
} from './ports/mission-terminal.js';

export interface MissionTerminalServiceDeps {
  /** The repository this capability serves; computed by an adapter. */
  readonly repositoryId: string;
  readonly host: MissionTerminalHostPort;
  readonly store: MissionHistoryStorePort;
  readonly renderer?: RecordedOutputRenderer;
}

interface IndexedRun { readonly run: RunSummary; readonly scope: RunHistoryScope; readonly legacy: boolean }

const RETENTION_NOTICE = `Retention: at most ${MAX_RUNS_PER_MISSION} operations per Mission, each kept up to ${Math.round(RUN_HISTORY_RETENTION_MS / 86_400_000)} days; `
  + `each stream keeps its first and newest bytes up to ${MAX_RUN_STREAM_BYTES / (1024 * 1024)} MiB and reports the dropped middle.`;

function fail(error: MissionHistoryError['error'], detail: string): MissionHistoryError {
  return { ok: false, error, detail };
}

/** Accepted CLI aliases (for example `TASK-2622.18`) normalize here; the domain validates the canonical value unchanged. */
function identifyMission(repository: string, mission: string): { ok: true; identity: MissionTerminalScope } | MissionHistoryError {
  try { return { ok: true, identity: { repositoryId: repositoryId(repository), missionId: missionId(String(mission ?? '').trim().toLowerCase()) } }; }
  catch { return fail('invalid', `not a Mission ID: ${JSON.stringify(String(mission ?? '').slice(0, 80))}`); }
}

/** The typed probe plus the owned native session, which never leaves this module. */
function hostedTerminal(host: MissionTerminalHostPort, identity: MissionTerminalScope): { probe: MissionTerminalProbe; session: string | null; observations?: MissionTerminalSessions['operations'] } {
  const result = host.sessions(identity);
  if (result.ok === false) { return { probe: { kind: 'unavailable', reason: result.reason, detail: result.detail }, session: null }; }
  if (result.sessions === null) { return { probe: { kind: 'absent' }, session: null }; }
  const resolved = resolveMissionSession(result.sessions.owned, result.sessions.others);
  if (resolved.kind === 'ambiguous') { return { probe: { kind: 'ambiguous', sessions: resolved.sessions, detail: resolved.detail }, session: null }; }
  if (resolved.kind === 'none') { return { probe: { kind: 'absent' }, session: null }; }
  const started = result.sessions.operations.find(operation => operation.started && operation.execution !== false);
  const launching = result.sessions.operations.find(operation => !operation.started);
  const probe: MissionTerminalProbe = started ? { kind: 'live', operation: started.name, ...(started.runId ? { runId: started.runId, execution: started.execution ?? null } : {}) }
    : launching ? { kind: 'starting', operation: launching.name, ...(launching.runId ? { runId: launching.runId } : {}) } : { kind: 'idle' };
  return { probe, session: resolved.session, observations: result.sessions.operations };
}

/** Every retained run the compatibility resolver attributes to this Mission, newest first. */
function indexHistory(store: MissionHistoryStorePort, identity: MissionTerminalScope): { runs: IndexedRun[]; unattributed: string[] } {
  const runs: IndexedRun[] = [];
  const unattributed: string[] = [];
  const seen = new Set<string>();
  for (const location of store.locations(identity) as readonly MissionHistoryLocation[]) {
    const scope: RunHistoryScope = { runsDir: location.runsDir, fs: store.fs, isAlive: pid => store.isAlive(pid), executionAlive: store.executionAlive };
    for (const runId of store.fs.listDirs(location.runsDir).filter(isRunHistoryId)) {
      if (seen.has(runId)) { continue; }
      const lookup = getRun(scope, runId);
      if (!lookup.ok || !lookup.run) { unattributed.push(`${runId}: ${lookup.detail}`); continue; }
      const attribution = store.attribute(identity, lookup.run.record, location);
      if (attribution.kind === 'unattributed') { unattributed.push(`${runId}: ${attribution.reason}`); continue; }
      seen.add(runId);
      runs.push({ run: lookup.run, scope, legacy: attribution.legacy });
    }
  }
  runs.sort((a, b) => b.run.record.startedAt.localeCompare(a.run.record.startedAt));
  return { runs, unattributed };
}

function summary({ run, legacy }: IndexedRun): MissionOperationSummary {
  const captureKind = runCaptureKind(run.record);
  return {
    runId: run.record.runId, captureKind, operationId: run.record.operationId ?? null, execution: run.execution, role: run.record.role, family: captureKind === 'coordinator' ? null : run.record.family, attempt: captureKind === 'coordinator' ? null : run.record.attempt,
    state: run.state, terminalHost: run.record.terminalHost, startedAt: run.record.startedAt, endedAt: run.record.endedAt,
    exitCode: run.record.exitCode, signal: run.record.signal, redacted: run.record.redacted, legacy,
    streams: { stdout: run.record.streams.stdout.bytes, stderr: run.record.streams.stderr.bytes },
    coverage: run.coverage,
  };
}

function viewState(probe: MissionTerminalProbe, newest: IndexedRun | undefined): MissionViewState {
  if (probe.kind === 'ambiguous') { return 'ambiguous'; }
  if (probe.kind === 'unavailable') { return probe.reason === 'timeout' ? 'probe-timeout' : 'probe-failed'; }
  if (probe.kind === 'live' || probe.kind === 'starting') { return probe.kind; }
  if (!newest) { return 'missing'; }
  if (newest.run.record.terminalHost === 'pipe') { return 'capture-only'; }
  // A hosted operation whose record is open but whose window is not up yet.
  return newest.run.state === 'running' && probe.kind === 'absent' ? 'starting' : 'ended';
}

function overviewOf(deps: MissionTerminalServiceDeps, identity: MissionTerminalScope): MissionHistoryOverview {
  const { probe, observations = [] } = hostedTerminal(deps.host, identity);
  const { runs, unattributed } = indexHistory(deps.store, identity);
  const notices = [RETENTION_NOTICE];
  if (runs.some(entry => entry.legacy)) { notices.push('Some operations were recorded by an earlier release under a legacy name or in the Mission worktree; they are attributed by their own records.'); }
  if (unattributed.length > 0) { notices.push(`${unattributed.length} retained record(s) could not be attributed to this Mission and are not shown.`); }
  if (runs.some(entry => entry.run.record.terminalHost === 'pipe')) { notices.push('Pipe-executed operations record what the harness printed; output a child process wrote straight to the terminal is not captured.'); }
  return { missionId: identity.missionId, state: viewState(probe, runs[0]), probe, operations: runs.slice(0, MAX_RUNS_PER_MISSION).map(entry => {
    const projected = summary(entry);
    const observed = observations.find(operation => operation.runId === entry.run.record.runId);
    if (entry.run.state === 'running' && observed?.started) {
      return { ...projected, execution: observed.execution === true ? 'live' as const : observed.execution === false ? 'stopped' as const : 'unknown' as const };
    }
    return projected;
  }), unattributed, notices };
}

function pageOf(deps: MissionTerminalServiceDeps, identity: MissionTerminalScope, request: MissionHistoryPageRequest): ({ ok: true } & MissionHistoryPage) | MissionHistoryError {
  if (!isRunHistoryId(request.runId)) { return fail('invalid', 'not a run id'); }
  const found = indexHistory(deps.store, identity).runs.find(entry => entry.run.record.runId === request.runId);
  if (!found) { return fail('missing', `no retained operation ${request.runId} for ${identity.missionId}`); }
  const read = readRunPage(found.scope, request);
  if (read.ok === false) { return fail(read.error, read.detail); }
  const raw = Buffer.from(read.page.bytes.buffer, read.page.bytes.byteOffset, read.page.bytes.byteLength).toString('utf8');
  const record = read.run.record;
  // Claude stdout is its stream-json; pages are line-aligned, so the provider renderer frames whole records.
  const text = request.presentation === 'terminal' && record.captureKind === 'coordinator' ? raw : deps.renderer && record.family === 'claude' && request.stream === 'stdout' ? deps.renderer.render(record.family, raw) : stripTerminalControl(raw);
  return { ok: true, runId: request.runId, stream: request.stream, from: read.page.from, to: read.page.to, text,
    hasEarlier: read.page.hasEarlier, atEnd: read.page.atEnd, running: read.run.state === 'running', gaps: read.page.gaps };
}

/** Search the attributed runs newest first under one shared scan budget. */
function searchOf(store: MissionHistoryStorePort, identity: MissionTerminalScope, query: MissionHistorySearchQuery): ({ ok: true } & MissionHistorySearchResult) | MissionHistoryError {
  if (!query.pattern) { return fail('invalid', 'search pattern must not be empty'); }
  const maxHits = Math.min(Math.max(query.maxHits ?? MAX_RUN_SEARCH_HITS, 1), MAX_RUN_SEARCH_HITS);
  const runs = indexHistory(store, identity).runs.filter(entry => !query.runId || entry.run.record.runId === query.runId);
  const result = { ok: true as const, hits: [] as MissionHistorySearchHit[], totalHits: 0, searchedRuns: [] as string[], scanLimited: false, coverage: [] as string[], errors: [] as string[] };
  let budget = MAX_RUN_SEARCH_SCAN_BYTES;
  for (const entry of runs) {
    const found = searchRuns(entry.scope, { pattern: query.pattern, regex: Boolean(query.regex), runId: entry.run.record.runId, maxHits, maxScanBytes: budget, ...(query.stream ? { stream: query.stream } : {}) });
    result.searchedRuns.push(...found.searchedRuns);
    result.totalHits += found.totalHits;
    result.errors.push(...found.errors);
    result.coverage.push(...found.coverage);
    result.hits.push(...found.hits.slice(0, maxHits - result.hits.length).map(hit => ({ ref: hit.ref, runId: hit.runId, stream: hit.stream, offset: hit.offset, preview: hit.preview })));
    budget = Math.max(0, budget - entry.run.record.streams.stdout.retainedBytes - entry.run.record.streams.stderr.retainedBytes);
    if (found.scanLimited || budget === 0) { result.scanLimited = true; break; }
  }
  if (result.scanLimited) { result.coverage.push('search stopped at its scan budget; older operations were not searched'); }
  return result;
}

function liveOf(host: MissionTerminalHostPort, identity: MissionTerminalScope): MissionLiveView {
  const { probe, session } = hostedTerminal(host, identity);
  if (session === null || (probe.kind !== 'live' && probe.kind !== 'starting' && probe.kind !== 'idle')) { return { kind: 'not-live', probe }; }
  const operation = probe.kind === 'idle' ? null : probe.operation;
  const captured = host.capture(identity, session, operation);
  if (captured.ok === false) { return { kind: 'not-live', probe: { kind: 'unavailable', reason: captured.reason, detail: captured.detail } }; }
  return { kind: 'live', operation, output: captured.output };
}

/** The owned session an operator action may use; ambiguous or undecidable terminals are refused. */
function ownedSession(host: MissionTerminalHostPort, identity: MissionTerminalScope, action: string, allowAbsent = false): string | null {
  const { probe, session } = hostedTerminal(host, identity);
  if (probe.kind === 'ambiguous') { throw new Error(`Ambiguous mission terminal for ${identity.missionId}: ${probe.detail}.`); }
  if (probe.kind === 'unavailable') { throw new Error(`Cannot ${action} the mission terminal for ${identity.missionId}: ${probe.detail}`); }
  if (probe.kind === 'absent' && !allowAbsent) {
    throw new Error(`Nothing to ${action}: no mission terminal is live for ${identity.missionId}. Retained history: px history ${identity.missionId} list`);
  }
  return session;
}

export function createMissionTerminalService(deps: MissionTerminalServiceDeps): MissionTerminalCapability {
  const identify = (mission: string) => identifyMission(deps.repositoryId, mission);
  const withIdentity = <T>(mission: string, run: (_identity: MissionTerminalScope) => T): T | MissionHistoryError => {
    const identified = identify(mission);
    return identified.ok === true ? run(identified.identity) : identified;
  };
  const identityOrThrow = (mission: string): MissionTerminalScope => {
    const identified = identify(mission);
    if (identified.ok === false) { throw new Error(identified.detail); }
    return identified.identity;
  };
  return {
    identify,
    execution: (mission, currentOperationId) => withIdentity(mission, identity => observeProviderExecution(deps.store, identity, currentOperationId)),
    probe: mission => withIdentity(mission, identity => hostedTerminal(deps.host, identity).probe),
    overview: mission => withIdentity(mission, identity => overviewOf(deps, identity)),
    page: (mission, request) => withIdentity(mission, identity => pageOf(deps, identity, request)),
    history: mission => withIdentity(mission, identity => {
      const { runs, unattributed } = indexHistory(deps.store, identity);
      return { ok: true as const, runs: runs.map(entry => entry.run), unattributed };
    }),
    show: (mission, ref, context) => withIdentity(mission, identity => {
      const found = indexHistory(deps.store, identity).runs.find(entry => entry.run.record.runId === ref.runId);
      return found ? showRun(found.scope, ref, context) : fail('missing', `no retained run ${ref.runId} in this Mission (it may have been retired)`);
    }),
    search: (mission, query) => withIdentity(mission, identity => searchOf(deps.store, identity, query)),
    live: mission => withIdentity(mission, identity => liveOf(deps.host, identity)),
    attach: (mission, options) => {
      const identity = identityOrThrow(mission);
      return deps.host.attach(identity, ownedSession(deps.host, identity, 'attach')!, options.readOnly);
    },
    close: mission => {
      const identity = identityOrThrow(mission);
      deps.host.close(identity, ownedSession(deps.host, identity, 'close')!);
    },
    retire: mission => {
      const identity = identityOrThrow(mission);
      deps.host.retire(identity, ownedSession(deps.host, identity, 'retire', true));
    },
  };
}
