/**
 * The read-only browser board (ADR 0054 / ADR 0055). It performs one snapshot
 * read per page load and renders only a successfully validated response; the
 * loading, request-failure, malformed and incompatible-version states are
 * distinct screens so a rejected payload is never presented as a board.
 */
import { useEffect, useState } from 'react';
import { loadSnapshot, type SnapshotState } from './board-data.js';
import { Board } from './board.js';
import { C, MONO } from './palette.js';

const page: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: C.page,
  color: C.text,
  fontFamily: MONO,
  fontSize: 12,
  overflow: 'hidden',
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

export function Shell() {
  const [state, setState] = useState<SnapshotState>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void loadSnapshot().then((settled) => { if (live) { setState(settled); } });
    return () => { live = false; };
  }, []);

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
      {state.kind === 'ready' && <Board snapshot={state.snapshot} />}
    </main>
  );
}
