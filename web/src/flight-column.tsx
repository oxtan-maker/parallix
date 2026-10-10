/**
 * The in-flight stages, rendered as the reference's three-band card: a
 * gradient head carrying the fans, id and implementer; a body
 * carrying checkpoint, gate, actor and next action; and a footer of the
 * server's actions.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { ActionButton, cardCommands } from './action-button.js';
import { Fan } from './fan.js';
import { LaneHeader, laneEmpty } from './lane-header.js';
import { C } from './palette.js';
import type { PendingCommands } from './pending-command.js';
import { actorLine, coordinatorText, familyAccent, GATE_COLOR, GATE_TEXT, isSpinning } from './format.js';

function edgeColor(card: WebMissionCard): string {
  if (card.blockingReason !== null) { return C.red; }
  if (card.gate === 'failed') { return C.red; }
  if (card.flags.length > 0) { return C.amber; }
  return C.headEdge;
}

function ReviewPips({ card }: { card: WebMissionCard }) {
  if (card.reviewRound === null) { return null; }
  const currentRound = card.reviewRound;
  const work = card.activity.work;
  const active = isSpinning(card) && work.kind === 'working'
    && ((work.phase === 'review' && card.reviewPhase === 'reviewing')
      || (work.phase === 'review-response' && card.reviewPhase === 'fixing'));
  const rounds = new Map(card.reviewHistory.map((round) => [round.number, round]));
  return (
    <span aria-label={`review round ${currentRound}`} style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: 5 }, (_unused, index) => {
        const round = rounds.get(index + 1);
        const completed = index + 1 < currentRound;
        const running = index + 1 === currentRound;
        const background = running
          ? C.green
          : completed
            ? round?.disposition === 'APPROVED' ? C.green : C.amber
            : C.headEdge;
        return (
        <span
          key={index}
          className={running && active ? 'review-pip--running' : undefined}
          title={round === undefined ? undefined : `round ${round.number}: ${round.disposition ?? round.phase}`}
          style={{ width: 16, height: 8, borderRadius: 2, background }}
        />
        );
      })}
    </span>
  );
}

/**
 * The per-checkpoint evidence panel. Opens when a user clicks a checkpoint
 * label on the mission card and closes on the same click, the Escape key, or a
 * click on the backdrop. It renders the selected checkpoint's first-line
 * description and every recorded Goal Check row for it. Missions whose wire
 * card carries no evidence rows render nothing, so an empty mission keeps its
 * original layout with no panel.
 */
export function CheckpointDetail({ card, initial, onClose }: {
  card: WebMissionCard;
  initial: string;
  onClose: () => void;
}) {
  const evidence = card.checkpointEvidence ?? [];
  const hasRows = evidence.some((checkpoint) => checkpoint.goalCheck.length > 0);
  if (!hasRows) { return null; }
  const [selected, setSelected] = useState(initial);
  // `initial` is the card's checkpoint filename ("CP-2.md"); evidence entries
  // are keyed by checkpoint name ("CP-2"), so match on either form.
  const active = evidence.find((checkpoint) => checkpoint.name === selected || selected === `${checkpoint.name}.md`) ?? evidence[0];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const onBackdrop = (event: React.MouseEvent<HTMLDivElement>) => {
    // The backdrop closes only on a direct click. Clicks inside the dialog
    // (checkpoint selector buttons, the close button, evidence text) bubble up
    // to the backdrop and must not dismiss the panel.
    if (event.target !== event.currentTarget) { return; }
    onClose();
  };
  return (
    <div
      role="presentation"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)' }}
      onClick={onBackdrop}
    >
      <section
        role="dialog"
        aria-label={`Checkpoint evidence for ${card.id}`}
        aria-modal="true"
        style={{
          width: 480,
          maxWidth: '92vw', maxHeight: '80vh', overflow: 'auto',
          background: '#101c16', border: '1px solid #2f5a3f', borderRadius: 6,
          color: '#cbd9cf', padding: 16, fontFamily: 'inherit', fontSize: 12,
          boxShadow: '0 12px 36px rgba(0,0,0,.6)',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 14, color: C.cyan }}>{card.id} — checkpoints</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: '1px solid #3a4550', borderRadius: 4, color: '#aab4bf', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, padding: '2px 8px' }}
          >
            close
          </button>
        </header>
        <nav aria-label="Checkpoints" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {evidence.map((checkpoint) => {
            const chosen = checkpoint.name === active?.name;
            return (
              <button
                key={checkpoint.name}
                type="button"
                aria-pressed={chosen}
                onClick={() => setSelected(checkpoint.name)}
                style={{
                  background: chosen ? '#1f4a31' : '#16241c',
                  border: `1px solid ${chosen ? '#43e891' : '#2f4a3a'}`,
                  borderRadius: 4, color: chosen ? '#68f6a7' : '#aab4bf',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
                  padding: '3px 9px',
                }}
              >
                {checkpoint.name}
              </button>
            );
          })}
        </nav>
        <p style={{ margin: '0 0 10px', color: C.dim, fontStyle: 'italic' }}>
          {active?.description ?? 'No description recorded for this checkpoint.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(active?.goalCheck ?? []).map((row, index) => (
            <div key={index} style={{ border: '1px solid #264030', borderRadius: 4, padding: '8px 10px', background: '#0c1712' }}>
              <div style={{ color: '#68f6a7', marginBottom: 4 }}>{row.criterion}</div>
              <div style={{ color: '#cbd9cf' }}>evidence: {row.evidence}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
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

function cancelAction(actions: readonly WebMissionCard['actions'][number][]) {
  return actions.find((action) => action.state === 'enabled' && action.kind === 'mission:cancel')
    ?? actions.find((action) => action.kind === 'mission:cancel') ?? null;
}

function FlightCard({ card, onAction, onSelect, onDragStart, selected, pendingCommands }: { card: WebMissionCard; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; selected: boolean; pendingCommands: PendingCommands }) {
  const [openCheckpoint, setOpenCheckpoint] = useState<string | null>(null);
  const checkpointEvidence = card.checkpointEvidence ?? [];
  const hasCheckpointEvidence = checkpointEvidence.some((entry) => entry.goalCheck.length > 0);
  const openCheckpointDetail = () => setOpenCheckpoint(openCheckpoint === card.checkpoint ? null : (card.checkpoint ?? null));
  const spinning = isSpinning(card);
  // The work publication names the worker; a px process alone does not.
  const working = card.activity.work.kind === 'working';
  const liveAgent = spinning && working ? card.activity.work.agent : null;
  const agent = working ? liveAgent : card.agent;
  const accent = card.gate === 'failed' ? C.red : familyAccent(agent);
  const actor = actorLine(card);
  const actions = cardCommands(card.actions);
  const cancel = cancelAction(card.actions);
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
      onFocus={(event) => { if (event.target === event.currentTarget) { onSelect(card.id); } }}
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
            <div style={{ flex: 1, minWidth: 4 }} />
            {agent !== null && (
            <span
              title={agent === null ? undefined : `${liveAgent === null ? 'implementer' : 'active worker'} family: ${agent}`}
              style={{
                color: agent === null ? C.faint : familyAccent(agent),
                fontSize: 10, letterSpacing: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {agent}
            </span>
            )}
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
          <div
            role="button"
            tabIndex={hasCheckpointEvidence ? 0 : undefined}
            aria-label={hasCheckpointEvidence ? `View checkpoint evidence for ${card.checkpoint}` : undefined}
            onClick={openCheckpointDetail}
            onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCheckpointDetail(); } }}
            // Keep the label clickable above the modal backdrop (zIndex 50) so the
            // same-label click closes the panel; the backdrop still closes on a
            // backdrop click or Escape.
            style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8, fontSize: 11, cursor: hasCheckpointEvidence ? 'pointer' : 'default', position: 'relative', zIndex: 60 }}
          >
            <CheckpointPips checkpoint={card.checkpoint} />
            <span style={{ color: C.dim }} title={card.checkpointDescription ?? undefined}>{card.checkpoint}</span>
            <span style={{ color: GATE_COLOR[card.gate], fontWeight: card.gate === 'failed' ? 700 : 400 }}>
              {GATE_TEXT[card.gate]}
            </span>
          </div>
        )}
        {openCheckpoint !== null && (
          <CheckpointDetail card={card} initial={openCheckpoint} onClose={() => setOpenCheckpoint(null)} />
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

      {(actions.length > 0 || cancel !== null) && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7,
            padding: '7px 10px', borderTop: `1px solid ${C.rule}`, background: C.cardFoot,
            flexWrap: 'wrap',
          }}
        >
          {cancel !== null && (
            <ActionButton action={cancel} label={cancel.label} style={{ color: C.red, border: `1px solid ${C.red}` }} pending={pendingCommands.get(card.id)} onInvoke={(next, control) => onAction(card, next, control)} />
          )}
          {actions.map((primary) => (
            <ActionButton key={primary.kind} action={primary} label={primary.label} pending={pendingCommands.get(card.id)} working={primary.kind === 'mission:edit' ? false : spinning} onInvoke={(next, control) => onAction(card, next, control)} />
          ))}
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

export function FlightColumn({ stage, style, onAction, onSelect, onDragStart, onDrop, selectedId, pendingCommands, draggable }: { stage: WebStage; style: CSSProperties; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; onDrop: (lane: WebStage['lane']) => void; selectedId: string | null; pendingCommands: PendingCommands; draggable: boolean }) {
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
        {stage.cards.map((card) => <FlightCard key={card.id} card={card} onAction={onAction} onSelect={onSelect} onDragStart={onDragStart} selected={selectedId === card.id} pendingCommands={pendingCommands} />)}
      </div>
    </section>
  );
}
