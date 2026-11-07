/**
 * The top bar: repository identity, the server's own WIP and attention
 * counts, and the agent-family strip as the reference's rounded pills. Every
 * number here is the server's; the bar computes no rate and no average.
 */
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { C, DISPLAY, FLOW, FLOW_TYPE, RADIUS, SPACE, TRACK, TYPE } from './palette.js';
import { familyAccent, sessionsText } from './format.js';

export type BoardView = 'board' | 'flow';

/**
 * Board and Flow navigation. The Flow page draws the reference's large pills;
 * the board keeps its compact control height so its header geometry is the
 * one it already had.
 */
export function ViewNav({ view, onNavigate, compact = false }: { view: BoardView; onNavigate: (view: BoardView) => void; compact?: boolean }) {
  return (
    <nav aria-label="Views" style={{ display: 'flex', gap: compact ? SPACE.sm : 7, flexShrink: 0 }}>
      {(['board', 'flow'] as const).map((target) => {
        const current = view === target;
        return (
          <button
            key={target}
            type="button"
            data-view-nav={target}
            aria-current={current ? 'page' : undefined}
            onClick={() => { if (!current) { onNavigate(target); } }}
            style={compact ? {
              background: current ? C.controlOn : 'none', border: `1px solid ${current ? C.chartLane : C.cardEdge}`,
              borderRadius: RADIUS.pill, color: current ? C.text : C.dim, fontFamily: 'inherit', fontSize: TYPE.micro,
              letterSpacing: TRACK.normal, padding: `${SPACE.sm}px ${SPACE.lg}px`, cursor: 'pointer', whiteSpace: 'nowrap',
            } : {
              background: current ? FLOW.pill : 'transparent', border: `1px solid ${current ? FLOW.pill : FLOW.controlEdge}`,
              borderRadius: 20, color: current ? FLOW.pillText : FLOW.control, fontFamily: 'inherit', fontSize: FLOW_TYPE.body,
              fontWeight: current ? 700 : 400, height: 40, padding: '0 15px', cursor: current ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {target === 'board' ? 'Board' : 'Flow'}
          </button>
        );
      })}
    </nav>
  );
}

export function TopBar({ snapshot, onNavigate, onCreate }: {
  snapshot: WebBoardSnapshot;
  onNavigate: (view: BoardView) => void;
  onCreate: (opener: HTMLButtonElement) => void;
}) {
  const wip = snapshot.inFlightWip;
  const throughput = snapshot.metrics.weeklyCompletedMissions;
  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: SPACE.xxl, padding: `${SPACE.lg}px ${SPACE.xxl}px`,
        borderBottom: `1px solid ${C.rule}`, flexShrink: 0, overflowX: 'auto',
      }}
    >
      <h1
        style={{
          fontFamily: DISPLAY, fontWeight: 700, fontSize: TYPE.display, letterSpacing: TRACK.mark,
          color: C.text, textTransform: 'uppercase', whiteSpace: 'nowrap',
          flexShrink: 0, margin: 0,
        }}
      >
        Parallix
      </h1>
      <div style={{ color: C.dim, whiteSpace: 'nowrap', flexShrink: 0, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}>
        @ <span style={{ color: C.text }}>{snapshot.repositoryId}</span>
      </div>
      <div style={{ color: C.dim, whiteSpace: 'nowrap', flexShrink: 0, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}>
        {snapshot.wipCounts.length > 0 && <>wip <span style={{ color: C.text }}>{wip}</span> · </>}
        {throughput === null || throughput === undefined ? 'missions/wk unknown · ' : `${throughput} missions/wk · `}
        attention <span style={{ color: C.amber }}>{snapshot.attentionQueue.length}</span>
      </div>
      <div style={{ flex: 1, minWidth: SPACE.lg }} />
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(event) => onCreate(event.currentTarget)}
        style={{
          background: C.greenFill, border: `1px solid ${C.greenEdge}`, borderRadius: RADIUS.pill, color: C.green,
          fontFamily: 'inherit', fontSize: TYPE.micro, letterSpacing: TRACK.normal, padding: `${SPACE.sm}px ${SPACE.lg}px`, cursor: 'pointer',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}
      >
        + Create new mission
      </button>
      <ViewNav view="board" onNavigate={onNavigate} compact />
      <section
        aria-label="Agent availability"
        style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl, flexShrink: 1, minWidth: 0, overflowX: 'auto' }}
      >
        {snapshot.agentAvailability.map((metric) => (
          <div
            key={metric.family}
            title={metric.reason ?? undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.md}px`,
              border: `1px solid ${C.cardEdge}`, borderRadius: RADIUS.pill, background: C.pill,
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden="true" style={{ color: metric.available ? C.cyan : C.red, fontSize: 9 }}>●</span>
            <span style={{ color: familyAccent(metric.family), fontWeight: 700, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}>
              {metric.family}
            </span>
            <span style={{ color: C.dim, fontSize: TYPE.meta }}>{sessionsText(metric)}</span>
          </div>
        ))}
      </section>
    </header>
  );
}
