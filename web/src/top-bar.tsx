/**
 * The top bar: repository identity, the server's own WIP and attention
 * counts, and the agent-family strip as the reference's rounded pills. Every
 * number here is the server's; the bar computes no rate and no average.
 */
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { C, DISPLAY, RADIUS, SPACE, TRACK, TYPE } from './palette.js';
import { familyAccent, sessionsText } from './format.js';

export function TopBar({ snapshot, flowOpen, onFlowToggle, onCreate }: {
  snapshot: WebBoardSnapshot;
  flowOpen: boolean;
  onFlowToggle: () => void;
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
      <button
        type="button"
        aria-expanded={flowOpen}
        aria-controls="flow-metrics"
        onClick={onFlowToggle}
        style={{
          background: flowOpen ? C.controlOn : 'none', border: `1px solid ${flowOpen ? C.chartLane : C.cardEdge}`,
          borderRadius: RADIUS.pill, color: flowOpen ? C.text : C.dim, fontFamily: 'inherit', fontSize: TYPE.micro,
          letterSpacing: TRACK.normal, padding: `${SPACE.sm}px ${SPACE.lg}px`, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
        }}
      >
        ▤ FLOW
      </button>
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
