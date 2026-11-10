/**
 * The gate status mark: the supplied Parallix gate icon designs, drawn inline.
 * Geometry, stroke, colours and the running-arc animation are the design's own
 * (`.pg-icon` rules in `style.css`); only the arc of a running gate moves, so a
 * card never shifts. Waiting, cancelled, skipped and dry-run designs are not
 * used because no `GateState` produces them, and `unavailable` is the unknown
 * design. The icon carries its accessible name; no visible text accompanies it.
 */
import type { ReactNode } from 'react';
import type { WebMissionCard } from '../../src/interfaces/web/transport.js';

type GateState = WebMissionCard['gate'];
type DesignState = 'passed' | 'failed' | 'running' | 'stale' | 'not-run' | 'unconfigured' | 'unknown';

const FRAME = 'M4 20.5V5.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M4 20.5h6.5';
const LEAVES_PLAN = 'M7.5 7v10M11.5 7v5M15 7v3.5M7.5 10.5H15';

interface Design { readonly label: string; readonly body: ReactNode }

const DESIGNS: Record<DesignState, Design> = {
  passed: { label: 'Passed', body: <>
    <path className="pg-leaves" opacity=".65" d="M4 6.5 8 8.5v9L4 19.5M18 6.5l-3 1.75v2.25" />
    <path d="m13 17.5 3 3 6-7" /></> },
  failed: { label: 'Not passing', body: <>
    <path className="pg-leaves" opacity=".65" d={LEAVES_PLAN} />
    <path d="m14.5 14.5 6.5 6.5m0-6.5-6.5 6.5" /></> },
  running: { label: 'Running', body: <>
    <path className="pg-leaves" opacity=".65" d={LEAVES_PLAN} />
    <circle className="pg-track" opacity=".26" cx="17.5" cy="17.5" r="4" />
    <path className="pg-spin" d="M17.5 13.5a4 4 0 0 1 4 4" /></> },
  stale: { label: 'Stale', body: <>
    <circle cx="17.5" cy="17.5" r="4" />
    <path d="M17.5 15.25v2.5l1.75 1" /></> },
  'not-run': { label: 'Not run', body: <path d="M14 17.5h7" /> },
  unconfigured: { label: 'Not configured', body: <>
    <circle cx="17.5" cy="17.5" r="4" />
    <path d="m14.5 20.5 6-6" /></> },
  unknown: { label: 'Unknown', body: <path d="M14.75 15a2.75 2.75 0 0 1 5.5 0c0 1.75-2.75 1.75-2.75 3.5M17.5 21h.01" /> },
};

const DESIGN_OF: Record<GateState, DesignState> = {
  passed: 'passed', failed: 'failed', running: 'running', stale: 'stale',
  'not-run': 'not-run', unconfigured: 'unconfigured', unavailable: 'unknown',
};

/** The explicit detail an unobservable gate keeps, reachable without visible text. */
const UNAVAILABLE_DETAIL = 'Gate evidence could not be observed';

const SCREEN_READER_ONLY = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

export function GateIcon({ gate, size = 20 }: { gate: GateState; size?: number }) {
  const state = DESIGN_OF[gate];
  const design = DESIGNS[state];
  return (
    <span data-gate-status="" data-gate={gate} title={gate === 'unavailable' ? UNAVAILABLE_DETAIL : undefined}
      style={{ display: 'inline-flex', flex: '0 0 auto', width: size, height: size, position: 'relative' }}>
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" className="pg-icon"
        data-state={state} data-animate={state === 'running' ? 'true' : 'false'} role="img" aria-label={design.label}>
        <path className="pg-frame" d={FRAME} />
        {design.body}
      </svg>
      {gate === 'unavailable' && <span style={SCREEN_READER_ONLY}>{UNAVAILABLE_DETAIL}</span>}
    </span>
  );
}
