/**
 * The intake stages: compact rows with a still fan, the mission id, its work
 * state and the server's actions. No drag affordance — this board is read-only.
 */
import type { CSSProperties } from 'react';
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { ActionButton } from './action-button.js';
import { Fan } from './fan.js';
import { LaneHeader, laneEmpty } from './lane-header.js';
import { C } from './palette.js';
import { familyAccent, isSpinning, workText } from './format.js';

function IntakeCard({ card }: { card: WebMissionCard }) {
  const runnable = card.actions.filter((action) => action.state === 'enabled');
  return (
    <article
      style={{
        border: `1px solid ${C.cardEdge}`, borderRadius: 5, background: C.idleCard,
        padding: '7px 9px', marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Fan size={15} color={familyAccent(card.agent)} spinning={isSpinning(card)} speed="3.6s" />
        <span style={{ color: C.cyan, fontWeight: 500 }}>{card.id}</span>
        <div style={{ flex: 1 }} />
        <span style={{ border: `1px solid ${C.cardEdge}`, borderRadius: 2, color: C.dim, fontSize: 10, padding: '0 4px' }}>
          {workText(card)}
        </span>
      </div>
      <p style={{ margin: '5px 0 0', lineHeight: 1.4, color: C.muted, fontSize: 11 }}>{card.title}</p>
      {runnable.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
          {runnable.map((action) => <ActionButton key={action.kind} action={action} />)}
        </div>
      )}
    </article>
  );
}

export function IntakeColumn({ stage, style }: { stage: WebStage; style: CSSProperties }) {
  return (
    <section aria-label={`${stage.lane} stage`} style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <LaneHeader lane={stage.lane} count={stage.count} />
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 9, minHeight: 0 }}>
        {stage.cards.length === 0 && <p style={laneEmpty}>no missions in this stage</p>}
        {stage.cards.map((card) => <IntakeCard key={card.id} card={card} />)}
      </div>
    </section>
  );
}
