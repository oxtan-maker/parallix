/**
 * The intake stages: compact rows with a fan, the mission id and the observed
 * worker in the same header label the flight cards use, the published activity
 * in the same actor line, and the server's actions. No work badge and no drag
 * affordance — this board is read-only.
 */
import type { CSSProperties, DragEvent } from 'react';
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { ActionButton, cardCommands } from './action-button.js';
import { Fan } from './fan.js';
import { CheckpointPips } from './checkpoint-pips.js';
import { LaneHeader, laneCard, laneEmpty } from './lane-header.js';
import { C, SPACE, TRACK, TYPE } from './palette.js';
import type { PendingCommands } from './pending-command.js';
import { ActorLine, AgentLabel } from './card-activity.js';
import { executingFamily, familyAccent, isSpinning } from './format.js';

function cancelAction(actions: readonly WebMissionCard['actions'][number][]) {
  return actions.find((action) => action.state === 'enabled' && action.kind === 'mission:cancel')
    ?? actions.find((action) => action.kind === 'mission:cancel') ?? null;
}

function IntakeCard({ card, onAction, onSelect, onDragStart, selected, pendingCommands }: { card: WebMissionCard; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; selected: boolean; pendingCommands: PendingCommands }) {
  const actions = cardCommands(card.actions);
  const cancel = cancelAction(card.actions);
  const work = card.activity.work;
  // Same worker derivation as the flight card: the observed provider, and the
  // assigned implementer only while no work is published.
  const liveAgent = executingFamily(card);
  const worker = liveAgent ?? (work.kind === 'working' ? null : card.agent);
  return (
    <article
      data-board-card={card.id}
      tabIndex={0}
      aria-label={`${card.id}: ${card.title}`}
      aria-selected={selected}
      draggable={card.actions.some((action) => action.state === 'enabled' && action.targetLane !== null)}
      onFocus={(event) => { if (event.target === event.currentTarget) { onSelect(card.id); } }}
      onDragStart={(event) => onDragStart(card, event)}
      style={{
        ...laneCard(selected), background: C.idleCard,
        padding: `${SPACE.md}px ${SPACE.lg}px`, marginBottom: SPACE.md,
      }}
    >
      {/* The header states worker identity the way every other column does:
          the id, the free space, then the shared label. No work badge sits
          beside it — the fan and the actor line already say what the work is
          and how current it is. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, minWidth: 0 }}>
        <Fan size={15} color={worker === null ? C.stroke : familyAccent(worker)} spinning={isSpinning(card)} speed="3.6s" />
        <span style={{ color: C.cyan, fontWeight: 500, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}>{card.id}</span>
        <div style={{ flex: 1, minWidth: SPACE.sm }} />
        <AgentLabel agent={worker} liveAgent={liveAgent} />
      </div>
      <p style={{ margin: `${SPACE.sm}px 0 0`, lineHeight: 1.4, color: C.muted, fontSize: TYPE.meta }}>{card.title}</p>
      {/* The compact intake row states current work in the shared actor line.
          An idle row publishes no work and keeps its baseline layout. */}
      {work.kind !== 'idle' && <ActorLine card={card} style={{ marginTop: SPACE.sm, lineHeight: 1.35 }} />}
      <CheckpointPips card={card} />
      {(actions.length > 0 || cancel !== null) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: SPACE.sm, marginTop: SPACE.md, flexWrap: 'wrap' }}>
          {cancel !== null && (
            <ActionButton action={cancel} label={cancel.label} style={{ color: C.red, border: `1px solid ${C.red}` }} pending={pendingCommands.get(card.id)} onInvoke={(next, control) => onAction(card, next, control)} />
          )}
          {actions.map((primary) => (
            <ActionButton key={primary.kind} action={primary} label={primary.label} pending={pendingCommands.get(card.id)} working={primary.kind === 'mission:edit' ? false : isSpinning(card)} onInvoke={(next, control) => onAction(card, next, control)} />
          ))}
        </div>
      )}
    </article>
  );
}

export function IntakeColumn({ stage, style, onAction, onSelect, onDragStart, onDrop, selectedId, pendingCommands, draggable }: { stage: WebStage; style: CSSProperties; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; onDrop: (lane: WebStage['lane']) => void; selectedId: string | null; pendingCommands: PendingCommands; draggable: boolean }) {
  return (
    <section aria-label={`${stage.lane} stage`} style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <LaneHeader lane={stage.lane} count={stage.count} />
      <div onDragOver={(event: DragEvent<HTMLDivElement>) => { if (draggable) { event.preventDefault(); } }} onDrop={() => onDrop(stage.lane)} style={{ flex: 1, overflowY: 'auto', paddingTop: SPACE.md, minHeight: 0 }}>
        {stage.cards.length === 0 && <p style={laneEmpty}>no missions in this stage</p>}
        {stage.cards.map((card) => <IntakeCard key={card.id} card={card} onAction={onAction} onSelect={onSelect} onDragStart={onDragStart} selected={selectedId === card.id} pendingCommands={pendingCommands} />)}
      </div>
    </section>
  );
}
