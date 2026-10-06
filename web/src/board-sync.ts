/**
 * Keeps the browser board converged on the host's projection (ADR 0054,
 * TASK-2655). Every snapshot read — the initial load, an SSE `invalidate` or
 * `progress` frame, every native connection open (first connect and each
 * reconnect), and the Board's awaited `onRefresh` — goes through one
 * refresh coordinator, so reads are serial and a newer accepted snapshot is
 * never replaced by an older response or an obsolete error.
 *
 * Freshness is reported, not assumed: a lost connection marks the last
 * validated snapshot as reconnecting, and a reopened connection counts as
 * revalidated only once a read that started after the open has committed.
 * A failed refresh keeps the last validated board on screen marked stale;
 * malformed or incompatible payloads still replace it with their own
 * rejection screens. There is no polling — the browser's own EventSource
 * retry is the only reconnect loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateWebProgressEvent } from '../../src/interfaces/web/transport.js';
import { loadSnapshot, type SettledSnapshotState, type SnapshotState } from './board-data.js';
import { EMPTY_LIVE_PROGRESS, observeStreamId, recordProgress, withLiveProgress, type LiveProgress } from './operation-log.js';
import { createRefreshCoordinator, type RefreshCoordinator } from './refresh-coordinator.js';

export const EVENTS_PATH = '/api/events';
/** Stream frames arriving within this window become one snapshot read. */
export const REFRESH_COALESCE_MS = 150;

export interface BoardFreshness {
  /** `closed` means the browser gave up reconnecting (for example a rejected session). */
  readonly connection: 'connecting' | 'open' | 'reconnecting' | 'closed';
  /** False from a reconnect until a read started after it commits. */
  readonly revalidated: boolean;
  /** Set when the latest refresh failed and the shown board is the last validated one. */
  readonly refreshError: string | null;
}

const INITIAL_FRESHNESS: BoardFreshness = { connection: 'connecting', revalidated: true, refreshError: null };

interface StreamEvent { readonly data?: unknown; readonly lastEventId?: string }

export function useBoardSync() {
  const [state, setState] = useState<SnapshotState>({ kind: 'loading' });
  const [live, setLive] = useState<LiveProgress>(EMPTY_LIVE_PROGRESS);
  const [freshness, setFreshness] = useState<BoardFreshness>(INITIAL_FRESHNESS);
  const coordinator = useRef<RefreshCoordinator | null>(null);

  useEffect(() => {
    let shown: SnapshotState['kind'] = 'loading';
    let openEpoch = 0;
    const apply = (result: SettledSnapshotState, superseded: boolean) => {
      // A failed read with a newer one already queued is obsolete: decline it.
      if (result.kind !== 'ready' && superseded) { return false; }
      if (result.kind === 'request-failed' && shown === 'ready') {
        setFreshness(current => ({ ...current, refreshError: result.detail }));
        return true;
      }
      shown = result.kind;
      setState(result);
      if (result.kind === 'ready') { setFreshness(current => current.refreshError === null ? current : { ...current, refreshError: null }); }
      return true;
    };
    const sync = createRefreshCoordinator({ load: loadSnapshot, apply, coalesceMs: REFRESH_COALESCE_MS });
    coordinator.current = sync;
    void sync.request();

    const source = new EventSource(EVENTS_PATH);
    const observe = (event: StreamEvent) => { setLive(current => observeStreamId(current, event.lastEventId)); };
    const onOpen = () => {
      openEpoch += 1;
      const epoch = openEpoch;
      setFreshness(current => ({ ...current, connection: 'open', revalidated: current.connection === 'connecting' && current.revalidated }));
      // A read after every open closes the gap between the last snapshot and
      // the subscription, and is what makes a reconnect a revalidation.
      void sync.request().then(() => {
        if (epoch === openEpoch) { setFreshness(current => current.connection === 'open' ? { ...current, revalidated: true } : current); }
      });
    };
    const onError = (event: StreamEvent) => {
      // A server `error` frame carries data; the native connection error does not.
      if (typeof event.data === 'string') { observe(event); return; }
      openEpoch += 1;
      const connection = source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting';
      setFreshness(current => ({ ...current, connection, revalidated: false }));
    };
    const onInvalidate = (event: StreamEvent) => { observe(event); sync.schedule(); };
    const onProgress = (event: StreamEvent) => {
      observe(event);
      let payload: unknown;
      try { payload = JSON.parse(String(event.data)); } catch { return; }
      const result = validateWebProgressEvent(payload);
      if (!result.ok) { return; }
      setLive(current => recordProgress(current, result.value));
      sync.schedule();
    };
    const listeners: readonly [string, (event: StreamEvent) => void][] = [
      ['open', onOpen], ['error', onError], ['invalidate', onInvalidate], ['progress', onProgress],
    ];
    for (const [name, listener] of listeners) { source.addEventListener(name, listener as EventListener); }
    return () => {
      coordinator.current = null;
      sync.dispose();
      for (const [name, listener] of listeners) { source.removeEventListener(name, listener as EventListener); }
      source.close();
    };
  }, []);

  const refresh = useCallback(() => coordinator.current?.request() ?? Promise.resolve(), []);
  const presented = useMemo<SnapshotState>(
    () => state.kind === 'ready' ? { kind: 'ready', snapshot: withLiveProgress(state.snapshot, live) } : state,
    [state, live],
  );
  return { state: presented, freshness, refresh };
}
