/**
 * The browser board (ADR 0054 / ADR 0055). It renders only a successfully
 * validated snapshot, kept current by `useBoardSync`; the loading,
 * request-failure, malformed and incompatible-version states are distinct
 * screens so a rejected payload is never presented as a board, and a board
 * that may be behind the host carries an explicit freshness notice.
 */
import { Board } from './board.js';
import { useBoardSync, type BoardFreshness } from './board-sync.js';
import { C, MONO } from './palette.js';

const page: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: C.page,
  color: C.text,
  fontFamily: MONO,
  fontSize: 12,
  // The page is viewport-height; a board taller than the viewport scrolls
  // vertically inside it instead of being clipped (TASK-2574). Horizontal
  // lane scrolling stays on the inner lane row.
  overflowY: 'auto',
};

const notice: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 8,
  padding: 24,
  textAlign: 'center',
};

function Notice({ title, tone, children }: {
  title: string;
  tone: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={notice} role="status" aria-live="polite">
      <h1 style={{ color: tone, fontWeight: 700, fontSize: 13, letterSpacing: 1, margin: 0 }}>{title}</h1>
      {children}
    </div>
  );
}

/** What, if anything, makes the shown board less than current. Null when live and revalidated. */
export function freshnessNotice(freshness: BoardFreshness): { readonly title: string; readonly detail: string } | null {
  const held = 'showing the last validated snapshot; it may be out of date';
  if (freshness.connection === 'closed') { return { title: '▲ LIVE UPDATES STOPPED', detail: `${held}. Reload the page to reconnect.` }; }
  if (freshness.connection === 'reconnecting') { return { title: '▲ CONNECTION LOST · RECONNECTING', detail: held }; }
  if (freshness.refreshError !== null) { return { title: '▲ SNAPSHOT REFRESH FAILED', detail: `${held} · ${freshness.refreshError}` }; }
  if (!freshness.revalidated) { return { title: 'RECONNECTED · REVALIDATING', detail: held }; }
  return null;
}

function FreshnessBanner({ freshness }: { freshness: BoardFreshness }) {
  const notice = freshnessNotice(freshness);
  if (notice === null) { return null; }
  return (
    <div role="status" aria-live="polite" data-board-freshness="stale" style={{ flexShrink: 0, padding: '6px 18px', borderBottom: `1px solid ${C.rule}`, color: C.amber }}>
      <strong style={{ fontWeight: 700, letterSpacing: 1 }}>{notice.title}</strong>
      <span style={{ color: C.dim }}>  {notice.detail}</span>
    </div>
  );
}

export function Shell() {
  const { state, freshness, refresh } = useBoardSync();

  return (
    <main style={page} aria-busy={state.kind === 'loading'}>
      {state.kind === 'loading' && (
        <Notice title="LOADING BOARD" tone={C.green}>
          <p style={{ color: C.dim, margin: 0 }}>reading the current snapshot from this repository&apos;s local host</p>
        </Notice>
      )}
      {state.kind === 'request-failed' && (
        <Notice title="▲ SNAPSHOT REQUEST FAILED" tone={C.red}>
          <p style={{ color: C.muted, margin: 0 }}>the board host did not return a snapshot. No board data is shown.</p>
          <p style={{ color: C.dim, margin: 0 }}>{state.detail}</p>
        </Notice>
      )}
      {state.kind === 'malformed' && (
        <Notice title="▲ SNAPSHOT REJECTED" tone={C.red}>
          <p style={{ color: C.muted, margin: 0 }}>the response did not satisfy the board transport contract. No board data is shown.</p>
          <ul style={{ color: C.dim, margin: 0, textAlign: 'left', maxWidth: 640 }}>
            {state.problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </Notice>
      )}
      {state.kind === 'incompatible' && (
        <Notice title="▲ INCOMPATIBLE TRANSPORT VERSION" tone={C.amber}>
          <p style={{ color: C.muted, margin: 0 }}>
            this client cannot read the host&apos;s board transport. No board data is shown.
          </p>
          <p style={{ color: C.dim, margin: 0 }}>
            received {JSON.stringify(state.received)} · this client supports {state.supported.join(', ')}
          </p>
        </Notice>
      )}
      {state.kind === 'ready' && <FreshnessBanner freshness={freshness} />}
      {state.kind === 'ready' && <Board snapshot={state.snapshot} onRefresh={refresh} />}
    </main>
  );
}
