/**
 * The shipped history. `<details>` is the disclosure: collapse and expand are
 * browser-owned, so the client needs no handler and no state for them.
 */
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { laneEmpty, laneHeaderBox, laneHeading } from './lane-header.js';
import { C, RADIUS, SPACE, TRACK, TYPE } from './palette.js';
import { CheckpointPips } from './checkpoint-pips.js';

function ShippedCard({ card }: { card: WebMissionCard }) {
  return (
    <article
      style={{
        border: `1px solid ${C.rule}`, borderRadius: RADIUS.card, background: C.cardFoot,
        padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.md, opacity: 0.75,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
        {card.closed && <span style={{ color: C.done, fontSize: TYPE.micro }}>✓</span>}
        <span style={{ color: C.dim, fontWeight: 500, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}>{card.id}</span>
      </div>
      <p style={{ margin: `${SPACE.sm}px 0 0`, color: C.faint, fontSize: TYPE.meta }}>{card.title}</p>
      <CheckpointPips card={card} />
    </article>
  );
}

export function DoneRail({ stage }: { stage: WebStage }) {
  return (
    <details className="shipped" aria-label={`${stage.lane} stage`}>
      <summary>
        <span className="rail-open" style={{ ...laneHeaderBox, width: '100%' }}>
          <h2 style={laneHeading}>{stage.lane.toUpperCase()}</h2>
          <span style={{ color: C.faint, fontSize: TYPE.meta }}>{stage.count}</span>
          <span style={{ flex: 1 }} />
          <span aria-hidden="true" style={{ color: C.dim, fontSize: TYPE.meta }}>▸</span>
        </span>
        <span className="rail-closed">
          <span aria-hidden="true" style={{ color: C.dim, fontSize: TYPE.meta }}>◂</span>
          <span style={{ writingMode: 'vertical-rl', color: C.dim, fontSize: TYPE.meta, letterSpacing: TRACK.display }}>
            {stage.lane.toUpperCase()} · {stage.count}
          </span>
        </span>
      </summary>
      <div className="shipped-cards">
        {stage.cards.length === 0 && <p style={laneEmpty}>no missions in this stage</p>}
        {stage.cards.map((card) => <ShippedCard key={card.id} card={card} />)}
        {(stage.historyCards?.length ?? 0) > 0 && (
          <details aria-label="Other completed history">
            <summary>Other completed history · {stage.historyCards!.length}</summary>
            <p style={laneEmpty}>Outside this week or delivery date unavailable</p>
            {stage.historyCards!.map(card => <ShippedCard key={card.id} card={card} />)}
          </details>
        )}
      </div>
    </details>
  );
}
