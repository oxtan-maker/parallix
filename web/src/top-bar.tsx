/**
 * The top bar: repository identity, the server's own WIP and attention
 * counts, and the agent-family strip as the reference's rounded pills. Every
 * number here is the server's; the bar computes no rate and no average.
 */
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { C, DISPLAY } from './palette.js';
import { familyAccent, sessionsText } from './format.js';

export function TopBar({ snapshot }: { snapshot: WebBoardSnapshot }) {
  // The wire carries per-lane WIP; the total is their sum, not a rule about
  // which lanes count as in flight.
  const wip = snapshot.wipCounts.reduce((total, entry) => total + entry.count, 0);
  const unattributed = 'unattributedRunningSessions' in snapshot
    ? snapshot.unattributedRunningSessions === null
      ? 'unattributed sessions unknown'
      : `unattributed ${snapshot.unattributedRunningSessions} running`
    : null;
  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: 18, padding: '10px 18px',
        borderBottom: `1px solid ${C.rule}`, flexShrink: 0, overflowX: 'auto',
      }}
    >
      <h1
        style={{
          fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: 3,
          color: C.green, textTransform: 'uppercase', whiteSpace: 'nowrap',
          flexShrink: 0, margin: 0,
        }}
      >
        Parallix
      </h1>
      <div style={{ color: C.dim, whiteSpace: 'nowrap', flexShrink: 0 }}>
        @ <span style={{ color: C.text }}>{snapshot.repositoryId}</span>
      </div>
      <div style={{ color: C.dim, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {snapshot.wipCounts.length > 0 && <>wip <span style={{ color: C.text }}>{wip}</span> · </>}
        attention <span style={{ color: C.amber }}>{snapshot.attentionQueue.length}</span>
        {unattributed !== null && <> · {unattributed}</>}
      </div>
      <div style={{ flex: 1, minWidth: 12 }} />
      <section
        aria-label="Agent availability"
        style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 1, minWidth: 0, overflowX: 'auto' }}
      >
        {snapshot.agentAvailability.map((metric) => (
          <div
            key={metric.family}
            title={metric.reason ?? undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 9px',
              border: `1px solid ${C.cardEdge}`, borderRadius: 20, background: C.pill,
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden="true" style={{ color: metric.available ? C.green : C.red, fontSize: 9 }}>●</span>
            <span style={{ color: familyAccent(metric.family), fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>
              {metric.family}
            </span>
            <span style={{ color: C.dim, fontSize: 11 }}>{sessionsText(metric)}</span>
          </div>
        ))}
      </section>
    </header>
  );
}
