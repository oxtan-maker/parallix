/**
 * The shipped history. `<details>` is the disclosure: collapse and expand are
 * browser-owned, so the client needs no handler and no state for them.
 */
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { laneEmpty, laneHeaderBox, laneHeading } from './lane-header.js';
import { C } from './palette.js';

function ShippedCard({ card }: { card: WebMissionCard }) {
  return (
    <article
      style={{
        border: `1px solid ${C.rule}`, borderRadius: 5, background: C.cardFoot,
        padding: '6px 9px', marginBottom: 7, opacity: 0.75,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {card.closed && <span style={{ color: C.green, fontSize: 10 }}>✓</span>}
        <span style={{ color: C.dim, fontWeight: 500 }}>{card.id}</span>
      </div>
      <p style={{ margin: '3px 0 0', color: C.faint, fontSize: 11 }}>{card.title}</p>
    </article>
  );
}

export function DoneRail({ stage }: { stage: WebStage }) {
  return (
    <details className="shipped" aria-label={`${stage.lane} stage`}>
      <summary>
        <span className="rail-open" style={{ ...laneHeaderBox, width: '100%' }}>
          <h2 style={laneHeading}>{stage.lane.toUpperCase()}</h2>
          <span style={{ color: C.faint, fontSize: 11 }}>{stage.count}</span>
          <span style={{ flex: 1 }} />
          <span aria-hidden="true" style={{ color: C.green, fontSize: 11 }}>▸</span>
        </span>
        <span className="rail-closed">
          <span aria-hidden="true" style={{ color: C.green }}>◂</span>
          <span style={{ writingMode: 'vertical-rl', color: C.dim, fontSize: 11, letterSpacing: 2 }}>
            {stage.lane.toUpperCase()} · {stage.count}
          </span>
        </span>
      </summary>
      <div className="shipped-cards">
        {stage.cards.length === 0 && <p style={laneEmpty}>no missions in this stage</p>}
        {stage.cards.map((card) => <ShippedCard key={card.id} card={card} />)}
      </div>
    </details>
  );
}
