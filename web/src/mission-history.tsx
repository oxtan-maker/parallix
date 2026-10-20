import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { describeState, loadLive, loadOverview, loadPage, searchHistory, type HistoryOperation, type HistoryOverview, type HistorySearch } from './mission-history-data.js';
import { MODAL, RADIUS, SPACE, TYPE } from './palette.js';

/**
 * The mission view (TASK-2749): retained workflow history first, with the
 * newest output appended as it arrives. Earlier history loads page by page,
 * search runs over everything retained, and an optional live pane is shown
 * beside the history, never instead of it. Every poll reads only the bytes
 * after what is already shown; a failed read keeps the displayed history.
 */

const POLL_MS = 1000;

interface Chunk { readonly from: number; readonly to: number; readonly text: string; readonly gapBefore: number }
interface Selection { readonly runId: string; readonly stream: 'stdout' | 'stderr' }
interface Edges { readonly hasEarlier: boolean; readonly atEnd: boolean; readonly running: boolean }

const NO_EDGES: Edges = { hasEarlier: false, atEnd: true, running: false };

function operationLabel(operation: HistoryOperation): string {
  const outcome = operation.state === 'running' ? (operation.family === null ? 'capturing' : `capturing · agent ${operation.execution === 'live' ? 'live' : operation.execution === 'stopped' ? 'stopped' : 'unconfirmed'}`)
    : operation.state === 'interrupted' ? 'interrupted'
    : `exit ${operation.exitCode ?? operation.signal ?? '?'}`;
  return `${operation.role} · ${operation.family === null ? 'workflow' : `${operation.family} #${operation.attempt}`} · ${operation.startedAt.slice(0, 19).replace('T', ' ')} · ${outcome}${operation.terminalHost === 'pipe' ? ' · pipe' : ''}`;
}

/** The selected operation's shown history: one tail or anchored page, earlier pages, and polled newer output. */
function useTranscript(missionId: string, selection: Selection | null, setReadError: (_detail: string | null) => void) {
  const [chunks, setChunks] = useState<readonly Chunk[]>([]);
  const [edges, setEdges] = useState<Edges>(NO_EDGES);
  const generation = useRef(0);

  const pending = useRef<{ selection: Selection; before?: number; generation: number; busy: boolean } | null>(null);
  const retryInitial = useCallback(async (signal?: AbortSignal) => {
    const request = pending.current;
    if (!request || request.busy) { return; }
    request.busy = true;
    const result = await loadPage(missionId, { ...request.selection, ...(request.before !== undefined ? { before: request.before } : {}) }, signal);
    request.busy = false;
    if (generation.current !== request.generation) { return; }
    if (result.ok === false) { setReadError(result.detail); return; }
    pending.current = null;
    setReadError(null);
    setChunks([{ from: result.value.from, to: result.value.to, text: result.value.text, gapBefore: 0 }]);
    setEdges({ hasEarlier: result.value.hasEarlier, atEnd: result.value.atEnd, running: result.value.running });
  }, [missionId, setReadError]);

  // A new selection starts from its tail (or an explicit anchor) with a fresh generation.
  const startAt = useCallback((next: Selection | null, before?: number) => {
    generation.current += 1;
    const mine = generation.current;
    setChunks([]);
    setEdges(NO_EDGES);
    pending.current = next === null ? null : { selection: next, before, generation: mine, busy: false };
    void retryInitial();
  }, [retryInitial]);

  const loadEarlier = (beforeLoad: () => void) => {
    const first = chunks[0];
    if (!selection || !first) { return; }
    const mine = generation.current;
    void loadPage(missionId, { ...selection, before: first.from }).then(result => {
      if (generation.current !== mine) { return; }
      if (result.ok === false) { setReadError(result.detail); return; }
      beforeLoad();
      const earlier = result.value;
      setChunks(previous => [
        { from: earlier.from, to: earlier.to, text: earlier.text, gapBefore: 0 },
        ...previous.map((chunk, index) => (index === 0 && earlier.to < chunk.from ? { ...chunk, gapBefore: chunk.from - earlier.to } : chunk)),
      ]);
      setEdges(previous => ({ ...previous, hasEarlier: earlier.hasEarlier }));
    });
  };

  /** Append only the bytes after what is shown; never re-reads shown history. */
  const appendNewer = async (signal: AbortSignal, operation: HistoryOperation | undefined) => {
    if (pending.current) { await retryInitial(signal); return; }
    const last = chunks[chunks.length - 1];
    if (!selection || !last || !(edges.running || !edges.atEnd || operation?.state === 'running')) { return; }
    const mine = generation.current;
    const page = await loadPage(missionId, { ...selection, after: last.to }, signal);
    if (generation.current !== mine) { return; }
    if (page.ok === false) { setReadError(page.detail); return; }
    if (page.value.to > last.to) {
      setChunks(previous => [...previous, { from: page.value.from, to: page.value.to, text: page.value.text, gapBefore: page.value.from > last.to ? page.value.from - last.to : 0 }]);
    }
    setEdges(previous => ({ ...previous, atEnd: page.value.atEnd, running: page.value.running }));
  };

  return { chunks, edges, startAt, loadEarlier, appendNewer };
}

/** Poll the overview, then the selected operation's newer output, one request at a time. */
function usePolling(missionId: string, tick: (_signal: AbortSignal) => Promise<void>) {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    let busy = false;
    const controller = new AbortController();
    const poll = async () => {
      if (busy) { return; }
      busy = true;
      try { await latest.current(controller.signal); } finally { busy = false; }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, POLL_MS);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [missionId]);
}

function LivePane({ missionId }: { missionId: string }) {
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void loadLive(missionId).then(result => {
      if (!alive || result.ok === false) { return; }
      setLive(result.value.kind === 'live' ? result.value.output : `No live pane (${result.value.probe.kind}${result.value.probe.detail ? `: ${result.value.probe.detail}` : ''}).`);
    });
    refresh();
    const interval = window.setInterval(refresh, POLL_MS);
    return () => { alive = false; window.clearInterval(interval); };
  }, [missionId]);
  return <pre aria-label="Live pane" style={{ maxHeight: 200, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap', borderTop: `1px solid ${MODAL.accentEdge}`, paddingTop: SPACE.md }}>{live ?? 'Loading live pane…'}</pre>;
}

function SearchPanel({ missionId, onError, onJump }: { missionId: string; onError: (_detail: string) => void; onJump: (_runId: string, _stream: 'stdout' | 'stderr', _offset: number) => void }) {
  const [results, setResults] = useState<HistorySearch | null>(null);
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem('q');
    const query = field && 'value' in field ? String(field.value).trim() : '';
    if (query === '') { setResults(null); return; }
    void searchHistory(missionId, query).then(result => { if (result.ok === true) { setResults(result.value); } else { onError(result.detail); } });
  };
  return (
    <>
      <form onSubmit={search} style={{ display: 'flex', gap: SPACE.md }}>
        <input name="q" aria-label="Search retained history" placeholder="search retained history" maxLength={200} style={{ flex: 1 }} />
        <button type="submit">search</button>
      </form>
      {results !== null && (
        <ul aria-label="Search results" style={{ margin: 0, maxHeight: 140, overflow: 'auto', paddingLeft: 18 }}>
          <li>{results.totalHits} match(es){results.hits.length < results.totalHits ? `, showing ${results.hits.length}` : ''}{results.scanLimited ? '; search stopped at its scan budget' : ''}</li>
          {results.hits.map(hit => (
            <li key={`${hit.runId}:${hit.stream}:${hit.offset}`}>
              <button type="button" onClick={() => onJump(hit.runId, hit.stream, hit.offset)}>{hit.runId} {hit.stream}@{hit.offset}</button>{' '}
              <code>{hit.preview.replace(/\s+/g, ' ').slice(0, 160)}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Toolbar({ operations, selection, pinned, follow, showLive, canCopy, onSelect, onCopy, onLive, onFollow }: {
  operations: readonly HistoryOperation[]; selection: Selection | null; pinned: boolean; follow: boolean; showLive: boolean; canCopy: boolean;
  onSelect: (_next: Selection | null) => void; onCopy: () => void; onLive: (_on: boolean) => void; onFollow: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center' }}>
      <label>Operation{' '}
        <select aria-label="Operation" value={selection?.runId ?? ''} onChange={event => onSelect(event.target.value === '' ? null : { runId: event.target.value, stream: selection?.stream ?? 'stdout' })}>
          {operations.length === 0 && <option value="">none retained</option>}
          {operations.map(operation => <option key={operation.runId} value={operation.runId}>{operationLabel(operation)}</option>)}
        </select>
      </label>
      <label>Stream{' '}
        <select aria-label="Stream" value={selection?.stream ?? 'stdout'} onChange={event => selection && onSelect({ runId: selection.runId, stream: event.target.value === 'stderr' ? 'stderr' : 'stdout' })}>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
        </select>
      </label>
      {pinned && <button type="button" onClick={() => onSelect(null)}>newest operation</button>}
      <button type="button" onClick={onCopy} disabled={!canCopy}>copy</button>
      <label><input type="checkbox" checked={showLive} onChange={event => onLive(event.target.checked)} /> live pane</label>
      {!follow && <button type="button" onClick={onFollow}>follow output</button>}
    </div>
  );
}

/** Keep the newest output in view only while the operator has not scrolled back. */
function useFollow(chunks: readonly Chunk[]) {
  const [follow, setFollow] = useState(true);
  const transcript = useRef<HTMLPreElement>(null);
  const keepScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = transcript.current;
    if (!element) { return; }
    if (keepScroll.current !== null) {
      element.scrollTop = element.scrollHeight - keepScroll.current;
      keepScroll.current = null;
    } else if (follow) {
      element.scrollTop = element.scrollHeight;
    }
  }, [chunks, follow]);
  const onScroll = () => {
    const element = transcript.current;
    if (!element) { return; }
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
    if (atBottom !== follow) { setFollow(atBottom); }
  };
  /** Prepending earlier history keeps the operator's place. */
  const holdPosition = () => { keepScroll.current = transcript.current ? transcript.current.scrollHeight - transcript.current.scrollTop : null; };
  return { follow, setFollow, transcript, onScroll, holdPosition };
}

function selectionFor(pinned: Selection | null, overview: HistoryOverview | null): Selection | null {
  const newest = overview?.operations[0];
  return pinned ?? (newest ? { runId: newest.runId, stream: 'stdout' } : null);
}

function coverageFor(overview: HistoryOverview | null, selection: Selection | null): string[] {
  if (overview === null) { return []; }
  return [...(overview.operations.find(entry => entry.runId === selection?.runId)?.coverage ?? []), ...overview.notices];
}

function copyChunks(chunks: readonly Chunk[], report: (_message: string) => void): void {
  const text = chunks.map(chunk => chunk.text).join('');
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) { report('Copy is unavailable here; select the text instead.'); return; }
  void clipboard.writeText(text).then(() => report(`Copied ${text.length} characters.`), () => report('Copy failed; select the text instead.'));
}

export function MissionHistory({ missionId, onClose }: { missionId: string; onClose: () => void }) {
  const [overview, setOverview] = useState<HistoryOverview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Selection | null>(null);
  const pausedAutomatically = useRef(false);
  const [showLive, setShowLive] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const selection = selectionFor(pinned, overview);
  const selectionKey = selection ? `${selection.runId}:${selection.stream}` : '';
  const { chunks, edges, startAt, loadEarlier, appendNewer } = useTranscript(missionId, selection, setReadError);
  const { follow, setFollow, transcript, onScroll, holdPosition } = useFollow(chunks);

  // A search hit anchors the next selection at its offset instead of the tail.
  const anchor = useRef<number | null>(null);
  useEffect(() => {
    const before = anchor.current ?? undefined;
    anchor.current = null;
    startAt(selection, before);
    setFollow(before === undefined);
  }, [selectionKey, startAt]);

  usePolling(missionId, async signal => {
    const next = await loadOverview(missionId, signal);
    if (next.ok === true) { setOverview(next.value); setReadError(null); } else { setReadError(next.detail); }
    await appendNewer(signal, next.ok === true ? next.value.operations.find(entry => entry.runId === selection?.runId) : undefined);
  });

  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { onClose(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const jumpTo = (runId: string, stream: 'stdout' | 'stderr', offset: number) => {
    // End the page a little after the hit so it is visible with its context.
    setFollow(false);
    if (selection && selection.runId === runId && selection.stream === stream) { startAt(selection, offset + 2048); return; }
    anchor.current = offset + 2048;
    setPinned({ runId, stream });
  };

  const coverage = coverageFor(overview, selection);
  return (
    <div role="presentation" onClick={event => { if (event.target === event.currentTarget) { onClose(); } }} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: MODAL.scrim }}>
      <section role="dialog" aria-modal="true" aria-label={`Mission progress for ${missionId}`} className="modal-panel" style={{ width: 720, maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: SPACE.md, padding: SPACE.xxl, background: MODAL.surface, border: `1px solid ${MODAL.edge}`, borderRadius: RADIUS.panel, color: MODAL.text, fontFamily: 'inherit', fontSize: TYPE.body, boxShadow: MODAL.shadow }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: SPACE.md }}>
          <h2 style={{ margin: 0, fontSize: TYPE.title }}>{missionId} — mission history</h2>
          <button type="button" onClick={onClose}>close</button>
        </header>
        <p role="status" style={{ margin: 0 }}>{overview ? describeState(overview) : 'Loading mission history…'}</p>
        {readError !== null && <p role="status" style={{ margin: 0, color: MODAL.warning }}>Refresh interrupted ({readError}); showing what was already loaded. Retrying…</p>}
        <Toolbar operations={overview?.operations ?? []} selection={selection} pinned={pinned !== null} follow={follow} showLive={showLive} canCopy={chunks.length > 0}
          onSelect={next => { pausedAutomatically.current = false; setPinned(next); }} onCopy={() => copyChunks(chunks, setCopied)} onLive={setShowLive} onFollow={() => { if (pausedAutomatically.current) { setPinned(null); pausedAutomatically.current = false; } setFollow(true); }} />
        <SearchPanel missionId={missionId} onError={setReadError} onJump={jumpTo} />
        {copied !== null && <p role="status" style={{ margin: 0 }}>{copied}</p>}
        {edges.hasEarlier && <button type="button" onClick={() => loadEarlier(holdPosition)} style={{ alignSelf: 'flex-start' }}>load earlier history</button>}
        <pre ref={transcript} aria-label="Retained history" aria-live={follow ? 'polite' : 'off'} onScroll={() => {
          onScroll();
          const element = transcript.current;
          if (!pinned && selection && element && element.scrollTop + element.clientHeight < element.scrollHeight - 8) {
            pausedAutomatically.current = true;
            setPinned(selection);
          }
        }} style={{ flex: 1, minHeight: 120, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {chunks.map(chunk => (
            <span key={chunk.from}>{chunk.gapBefore > 0 ? `\n[… ${chunk.gapBefore} bytes not retained (retention limit or interrupted capture) …]\n` : ''}{chunk.text}</span>
          ))}
        </pre>
        {coverage.length > 0 && (
          <details><summary>Coverage and limits</summary>
            <ul style={{ margin: 0 }}>{coverage.map(line => <li key={line}>{line}</li>)}</ul>
          </details>
        )}
        {showLive && <LivePane missionId={missionId} />}
      </section>
    </div>
  );
}
