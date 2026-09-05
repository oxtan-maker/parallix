/**
 * The in-flight stages, rendered as the reference's three-band card: a
 * gradient head carrying the fans, id, work state and implementer; a body
 * carrying checkpoint, gate, actor and next action; and a footer of the
 * server's actions.
 */
import type { CSSProperties, DragEvent } from 'react';
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { ActionButton } from './action-button.js';
import { Fan } from './fan.js';
import { LaneHeader, laneEmpty } from './lane-header.js';
import { C } from './palette.js';
import { actorLine, coordinatorText, familyAccent, GATE_COLOR, GATE_TEXT, isSpinning, workText } from './format.js';

function edgeColor(card: WebMissionCard): string {
  if (card.blockingReason !== null) { return C.red; }
  if (card.gate === 'failed') { return C.red; }
  if (card.flags.length > 0) { return C.amber; }
  return C.headEdge;
}

function ReviewPips({ card }: { card: WebMissionCard }) {
  if (card.reviewRound === null) { return null; }
  const currentRound = card.reviewRound;
  const rounds = new Map(card.reviewHistory.map((round) => [round.number, round]));
  return (
    <span aria-label={`review round ${currentRound}`} style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: 5 }, (_unused, index) => {
        const round = rounds.get(index + 1);
        const completed = index + 1 < currentRound;
        return (
        <span
          key={index}
          title={round === undefined ? undefined : `round ${round.number}: ${round.disposition ?? round.phase}`}
          style={{ width: 16, height: 8, borderRadius: 2, background: completed ? C.green : round?.number === currentRound ? C.amber : C.headEdge }}
        />
        );
      })}
    </span>
  );
}

function CheckpointPips({ checkpoint }: { checkpoint: string }) {
  const current = Number(/^CP-(\d+)/i.exec(checkpoint)?.[1] ?? 0);
  return (
    <span aria-label={`checkpoint ${checkpoint}`} style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: current }, (_unused, index) => (
        <span key={index} style={{ width: 16, height: 8, borderRadius: 2, background: C.green }} />
      ))}
    </span>
  );
}

function primaryAction(actions: readonly WebMissionCard['actions'][number][]) {
  return actions.find((action) => action.state === 'enabled') ?? null;
}

function FlightCard({ card, onAction, onSelect, onDragStart, selected, pendingAction }: { card: WebMissionCard; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; selected: boolean; pendingAction: { missionId: string; kind: WebMissionCard['actions'][number]['kind'] } | null }) {
  const spinning = isSpinning(card);
  const liveAgent = card.activity.work.kind === 'working' ? card.activity.work.agent : null;
  const agent = liveAgent ?? card.agent;
  const accent = card.gate === 'failed' ? C.red : familyAccent(agent);
  const actor = actorLine(card);
  const primary = primaryAction(card.actions);
  // The footer carries the actions the server marked runnable for this card.
  // Which ones those are is the server's lifecycle decision, not a lane rule
  // evaluated here — the client only reads `state`.
  // Phase and disposition often carry the same word in different casing; the
  // reference prints one review status, so repeats collapse to one chip.
  const review = [...new Map(
    [
      card.reviewRound === null ? null : `round ${card.reviewRound}/5`,
      card.reviewPhase,
      card.reviewDisposition,
    ]
      .filter((part): part is string => part !== null)
      .map((part) => [part.toLowerCase(), part] as const),
  ).values()];
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
        border: `1px solid ${selected ? C.cyan : C.cardEdge}`, borderTop: `2px solid ${edgeColor(card)}`,
        borderRadius: 6, background: C.card, marginBottom: 22,
        boxShadow: '0 6px 18px rgba(0,0,0,.55)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'stretch', gap: 8, padding: '9px 10px 8px',
          background: C.cardHead, borderBottom: `1px solid ${C.panel}`,
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, lineHeight: 0 }}>
          <Fan size={23} color={accent} spinning={spinning} speed="0.9s" />
          <Fan size={23} color={accent} spinning={spinning} speed="1.7s" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
            <span style={{ color: C.cyan, fontWeight: 500, flexShrink: 0 }}>{card.id}</span>
            <span
              style={{
                border: `1px solid ${C.headEdge}`, borderRadius: 2, color: C.dim,
                fontSize: 10, padding: '0 4px', flexShrink: 0,
              }}
            >
              {workText(card)}
            </span>
            <div style={{ flex: 1, minWidth: 4 }} />
            <span aria-hidden="true" className={spinning ? 'live-indicator' : undefined} style={{ color: spinning ? C.green : C.faint, fontSize: 8, flexShrink: 0 }}>●</span>
            <span
              title={agent === null ? undefined : `${liveAgent === null ? 'implementer' : 'active worker'} family: ${agent}`}
              style={{
                color: agent === null ? C.faint : familyAccent(agent),
                fontSize: 10, letterSpacing: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {agent ?? 'no implementer'}
            </span>
          </div>
          <p style={{ margin: '5px 0 0', lineHeight: 1.35, color: C.text, fontSize: 13 }}>{card.title}</p>
        </div>
      </div>

      <div style={{ padding: '8px 10px' }}>
        {(card.pullRequest !== null || review.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 11 }}>
            {card.pullRequest !== null && (card.pullRequest.url === null
              ? <span style={{ color: C.cyan }}>PR #{card.pullRequest.id}</span>
              : <a href={card.pullRequest.url} rel="noreferrer" style={{ color: C.cyan }}>PR #{card.pullRequest.id}</a>)}
            {review.length > 0 && <span style={{ color: C.dim }}>{review.join(' · ')}</span>}
            <div style={{ flex: 1, minWidth: 4 }} />
            <ReviewPips card={card} />
          </div>
        )}
        {card.checkpoint !== null && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8, fontSize: 11 }}>
            <CheckpointPips checkpoint={card.checkpoint} />
            <span style={{ color: C.dim }} title={card.checkpointDescription ?? undefined}>{card.checkpoint}</span>
            <span style={{ color: GATE_COLOR[card.gate], fontWeight: card.gate === 'failed' ? 700 : 400 }}>
              {GATE_TEXT[card.gate]}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span aria-hidden="true" style={{ color: actor.color, fontSize: 8, flexShrink: 0 }}>●</span>
          <span style={{ color: actor.color, fontSize: 11 }}>{actor.text}</span>
        </div>
        <p style={{ color: C.faint, fontSize: 10, margin: '5px 0 0' }}>{coordinatorText(card)}</p>
        {card.nextActionText !== null && (
          <p style={{ color: C.dim, fontSize: 11, lineHeight: 1.4, margin: '5px 0 0' }}>
            <span style={{ color: C.faint }}>next:</span> {card.nextActionText}
          </p>
        )}
        {card.flags.length > 0 && (
          <p style={{ color: C.amber, fontSize: 10, margin: '6px 0 0', letterSpacing: 0.5 }}>▲ {card.flags.join(' · ')}</p>
        )}
        {card.blockingReason !== null && (
          <p style={{ color: C.red, fontSize: 10, margin: '6px 0 0', letterSpacing: 0.5 }}>{card.blockingReason}</p>
        )}
      </div>

      {primary !== null && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7,
            padding: '7px 10px', borderTop: `1px solid ${C.rule}`, background: C.cardFoot,
            flexWrap: 'wrap',
          }}
        >
          <ActionButton action={primary} label={primary.label} pending={pendingAction?.missionId === card.id && pendingAction.kind === primary.kind} working={spinning} onInvoke={(next, control) => onAction(card, next, control)} />
        </div>
      )}
      <Grille />
    </article>
  );
}

/** The reference's vent grille under each card: decoration, carrying no fact. */
function Grille() {
  return (
    <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-start', height: 0, paddingLeft: '10%', overflow: 'visible' }}>
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 5, width: '32%', height: 9,
          overflow: 'hidden', background: 'linear-gradient(180deg,#1d3325 0%,#16281c 100%)',
          borderRadius: '0 0 1px 1px', padding: '0 2px 1px', boxShadow: '0 3px 6px rgba(0,0,0,.6)',
        }}
      >
        <div style={{ flex: 11, minWidth: 0, height: 8, background: GRILLE_SLATS }} />
        <div style={{ flex: 40, minWidth: 0, height: 8, background: GRILLE_SLATS }} />
      </div>
    </div>
  );
}

const GRILLE_SLATS = 'repeating-linear-gradient(90deg,#dfbc68 0 1px,rgba(0,0,0,0) 1px 3px)';

/**
 * The head's right-hand note: how many of this lane's cards report live work.
 * The reference tints it amber the moment anything is stopped, so a stalled
 * lane reads as stalled from the header alone.
 */
function runNote(stage: WebStage): { readonly text: string; readonly color: string } {
  if (stage.cards.length === 0) { return { text: '', color: C.faint }; }
  const spinning = stage.cards.filter(isSpinning).length;
  const stopped = stage.cards.length - spinning;
  return {
    text: `${spinning > 0 ? `${spinning} spinning` : 'none spinning'}${stopped > 0 ? ` · ${stopped} stopped` : ''}`,
    color: stopped > 0 ? C.amber : C.faint,
  };
}

export function FlightColumn({ stage, style, onAction, onSelect, onDragStart, onDrop, selectedId, pendingAction, draggable }: { stage: WebStage; style: CSSProperties; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; onDrop: (lane: WebStage['lane']) => void; selectedId: string | null; pendingAction: { missionId: string; kind: WebMissionCard['actions'][number]['kind'] } | null; draggable: boolean }) {
  const note = runNote(stage);
  return (
    <section aria-label={`${stage.lane} stage`} style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <LaneHeader
        lane={stage.lane}
        count={stage.count}
        countText={`${stage.count} ${stage.count === 1 ? 'card' : 'cards'}`}
        note={note.text === '' ? undefined : (
          <span style={{ color: note.color, fontSize: 10, whiteSpace: 'nowrap' }}>{note.text}</span>
        )}
      />
      <div onDragOver={(event: DragEvent<HTMLDivElement>) => { if (draggable) { event.preventDefault(); } }} onDrop={() => onDrop(stage.lane)} style={{ flex: 1, overflowY: 'auto', paddingTop: 10, minHeight: 0 }}>
        {stage.cards.length === 0 && <p style={laneEmpty}>no missions in this stage</p>}
        {stage.cards.map((card) => <FlightCard key={card.id} card={card} onAction={onAction} onSelect={onSelect} onDragStart={onDragStart} selected={selectedId === card.id} pendingAction={pendingAction} />)}
      </div>
    </section>
  );
}
