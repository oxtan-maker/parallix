/**
 * The intake stages: compact rows with a still fan, the mission id, its work
 * state and the server's actions. No drag affordance — this board is read-only.
 */
import type { CSSProperties, DragEvent } from 'react';
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { ActionButton } from './action-button.js';
import { Fan } from './fan.js';
import { LaneHeader, laneEmpty } from './lane-header.js';
import { C } from './palette.js';
import { familyAccent, isSpinning, workText } from './format.js';

function primaryAction(actions: readonly WebMissionCard['actions'][number][]) {
  return actions.find((action) => action.state === 'enabled') ?? actions[0] ?? null;
}

function IntakeCard({ card, onAction, onSelect, onDragStart, selected, pendingAction }: { card: WebMissionCard; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; selected: boolean; pendingAction: { missionId: string; kind: WebMissionCard['actions'][number]['kind'] } | null }) {
  const primary = primaryAction(card.actions);
  return (
    <article
      data-board-card={card.id}
      tabIndex={0}
      aria-label={`${card.id}: ${card.title}`}
      aria-selected={selected}
      draggable={card.actions.some((action) => action.state === 'enabled' && action.targetLane !== null)}
      onFocus={() => onSelect(card.id)}
      onDragStart={(event) => onDragStart(card, event)}
      style={{
        border: `1px solid ${selected ? C.cyan : C.cardEdge}`, borderRadius: 5, background: C.idleCard,
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
      {primary !== null && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
          <ActionButton action={primary} pending={pendingAction?.missionId === card.id && pendingAction.kind === primary.kind} onInvoke={(next, control) => onAction(card, next, control)} />
        </div>
      )}
    </article>
  );
}

export function IntakeColumn({ stage, style, onAction, onSelect, onDragStart, onDrop, selectedId, pendingAction, draggable }: { stage: WebStage; style: CSSProperties; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; onDrop: (lane: WebStage['lane']) => void; selectedId: string | null; pendingAction: { missionId: string; kind: WebMissionCard['actions'][number]['kind'] } | null; draggable: boolean }) {
  return (
    <section aria-label={`${stage.lane} stage`} style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <LaneHeader lane={stage.lane} count={stage.count} />
      <div onDragOver={(event: DragEvent<HTMLDivElement>) => { if (draggable) { event.preventDefault(); } }} onDrop={() => onDrop(stage.lane)} style={{ flex: 1, overflowY: 'auto', paddingTop: 9, minHeight: 0 }}>
        {stage.cards.length === 0 && <p style={laneEmpty}>no missions in this stage</p>}
        {stage.cards.map((card) => <IntakeCard key={card.id} card={card} onAction={onAction} onSelect={onSelect} onDragStart={onDragStart} selected={selectedId === card.id} pendingAction={pendingAction} />)}
      </div>
    </section>
  );
}
