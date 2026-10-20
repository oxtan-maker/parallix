/**
 * The in-flight stages, rendered as the reference's three-band card: a
 * gradient head carrying the fans, id and implementer; a body
 * carrying checkpoint, gate, actor and next action; and a footer of the
 * server's actions.
 */
import type { CSSProperties, DragEvent } from 'react';
import type { WebMissionCard, WebStage } from '../../src/interfaces/web/transport.js';
import { ActionButton, cardCommands } from './action-button.js';
import { Fan } from './fan.js';
import { CheckpointPips } from './checkpoint-pips.js';
import { LaneHeader, laneCard, laneEmpty } from './lane-header.js';
import { C, REVIEW, SPACE, TRACK, TYPE } from './palette.js';
import type { PendingCommands } from './pending-command.js';
import { ActorLine, AgentLabel } from './card-activity.js';
import { coordinatorText, executingFamily, familyAccent, GATE_COLOR, GATE_TEXT, isSpinning } from './format.js';

function edgeColor(card: WebMissionCard): string {
  if (card.blockingReason !== null) { return C.red; }
  if (card.gate === 'failed') { return C.red; }
  if (card.flags.length > 0) { return C.amber; }
  return C.headEdge;
}

/**
 * The review attempt budget, as stated by the board contract. The client draws
 * the budget it was told about; it never extends it, and it never reads a round
 * number as progress toward the goal — a spent budget is not a finished plan.
 */
const ATTEMPT_BUDGET = 5;

type AttemptState = 'approved' | 'changes-requested' | 'recorded' | 'current' | 'unknown-outcome';

/**
 * One attempt, told apart by shape and words before colour: a tick, a cross, a
 * filled dot, a bare outline and a question mark. The caption is what a tooltip
 * and a screen reader read, so the distinction survives a greyscale board.
 */
const ATTEMPT_MARKS: Record<AttemptState, { glyph: string; stroke: string; fill: string; tone: string }> = {
  approved: { glyph: '✓', stroke: REVIEW.approved, fill: REVIEW.approvedFill, tone: REVIEW.approved },
  'changes-requested': { glyph: '✗', stroke: REVIEW.changesRequested, fill: REVIEW.changesRequestedFill, tone: REVIEW.changesRequested },
  recorded: { glyph: '▪', stroke: REVIEW.recorded, fill: 'transparent', tone: REVIEW.recorded },
  current: { glyph: '●', stroke: REVIEW.current, fill: 'transparent', tone: REVIEW.current },
  'unknown-outcome': { glyph: '?', stroke: REVIEW.unknown, fill: 'transparent', tone: REVIEW.unknown },
};

/** The disposition the server records for one attempt, or null when it records none. */
function recordedDisposition(card: WebMissionCard, number: number): string | null {
  const history = card.reviewHistory.find((entry) => entry.number === number)?.disposition ?? null;
  return history ?? (number === card.reviewRound ? card.reviewDisposition : null);
}

/**
 * What one attempt slot may claim. A round number alone claims nothing: a past
 * attempt with no recorded disposition stays unknown rather than borrowing an
 * outcome, and APPROVED and REQUEST_CHANGES name a glyph; any other recorded
 * disposition prints verbatim, because naming a synonym for it is the domain's
 * job and not this one.
 */
function attemptSlot(card: WebMissionCard, currentRound: number, number: number): { state: AttemptState; label: string } {
  const disposition = recordedDisposition(card, number);
  if (disposition === 'APPROVED') { return { state: 'approved', label: 'outcome recorded: approved' }; }
  if (disposition === 'REQUEST_CHANGES') { return { state: 'changes-requested', label: 'outcome recorded: changes requested' }; }
  if (disposition !== null) { return { state: 'recorded', label: `outcome recorded: ${disposition}` }; }
  return number === currentRound
    ? { state: 'current', label: 'current attempt, no outcome recorded' }
    : { state: 'unknown-outcome', label: 'outcome not recorded' };
}

/**
 * The review attempts so far, one circle each. Attempts that may never happen
 * are not drawn: the budget bounds what is valid, it is not a promise. It shares no shape
 * with the checkpoint track below it, and it does not blink — whether work is
 * running is the fan's fact, carried by the server's work publication.
 */
function ReviewAttempts({ card }: { card: WebMissionCard }) {
  const currentRound = card.reviewRound;
  if (currentRound === null) { return null; }
  // The transport admits any finite number. A round the budget cannot hold is
  // reported as unknown: never clamped into a valid slot, never drawn as extra
  // circles, never given a negative remainder.
  if (!Number.isInteger(currentRound) || currentRound < 1 || currentRound > ATTEMPT_BUDGET) {
    return (
      <span
        role="group"
        aria-label="Review attempts"
        data-review-round="unknown"
        title={`the supplied review round ${String(currentRound)} lies outside the attempt budget`}
        style={{ color: C.faint, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}
      >
        review round unknown
      </span>
    );
  }
  return (
    <span
      role="group"
      aria-label="Review attempts"
      style={{ display: 'inline-flex', gap: SPACE.xs, alignItems: 'center', fontSize: TYPE.meta }}
    >
      {Array.from({ length: currentRound }, (_unused, index) => {
        const number = index + 1;
        const { state, label } = attemptSlot(card, currentRound, number);
        const mark = ATTEMPT_MARKS[state];
        const caption = `attempt ${number}: ${label}`;
        return (
          <span
            key={number}
            role="img"
            aria-label={caption}
            title={caption}
            data-review-attempt={number}
            data-review-state={state}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0, lineHeight: 1,
              border: `1px solid ${mark.stroke}`, background: mark.fill, color: mark.tone,
            }}
          >
            {mark.glyph}
          </span>
        );
      })}
    </span>
  );
}

function cancelAction(actions: readonly WebMissionCard['actions'][number][]) {
  return actions.find((action) => action.state === 'enabled' && action.kind === 'mission:cancel')
    ?? actions.find((action) => action.kind === 'mission:cancel') ?? null;
}

function FlightCardHeader({ card, agent, liveAgent, accent, spinning }: { card: WebMissionCard; agent: WebMissionCard['agent']; liveAgent: WebMissionCard['agent']; accent: string; spinning: boolean }) {
  return (
      <div
        style={{
          display: 'flex', alignItems: 'stretch', gap: SPACE.md, padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.md}px`,
          background: C.cardHead, borderBottom: `1px solid ${C.panel}`,
        }}
      >
        <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'center', flexShrink: 0, lineHeight: 0 }}>
          <Fan size={23} color={accent} spinning={spinning} speed="0.9s" />
          <Fan size={23} color={accent} spinning={spinning} speed="1.7s" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.md, minWidth: 0 }}>
            <span style={{ color: C.cyan, fontWeight: 500, flexShrink: 0, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}>{card.id}</span>
            <div style={{ flex: 1, minWidth: SPACE.sm }} />
            <AgentLabel agent={agent} liveAgent={liveAgent} />
          </div>
          <p style={{ margin: `${SPACE.sm}px 0 0`, lineHeight: 1.35, color: C.text, fontSize: TYPE.heading }}>{card.title}</p>
        </div>
      </div>

  );
}

function FlightCardReview({ card }: { card: WebMissionCard }) {
  return (
(card.pullRequest !== null || card.reviewRound !== null) && (
          <div style={{ marginBottom: SPACE.md, fontSize: TYPE.meta }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
              {card.pullRequest !== null && (card.pullRequest.url === null
                ? <span style={{ color: C.cyan }}>PR #{card.pullRequest.id}</span>
                : <a href={card.pullRequest.url} rel="noreferrer" style={{ color: C.cyan }}>PR #{card.pullRequest.id}</a>)}
              <ReviewAttempts card={card} />
            </div>
          </div>
        )
  );
}

function FlightCardCheckpoint({ card }: { card: WebMissionCard }) {
  return (
    <div>
      <CheckpointPips card={card} />
      <div style={{ marginBottom: SPACE.md, fontSize: TYPE.meta, color: GATE_COLOR[card.gate], fontWeight: card.gate === 'failed' ? 700 : 400 }}>
        {GATE_TEXT[card.gate]}
      </div>
    </div>
  );
}

function FlightCard({ card, onAction, onSelect, onDragStart, selected, pendingCommands }: { card: WebMissionCard; onAction: (card: WebMissionCard, action: WebMissionCard['actions'][number], control: HTMLButtonElement) => void; onSelect: (id: string) => void; onDragStart: (card: WebMissionCard, event: DragEvent<HTMLElement>) => void; selected: boolean; pendingCommands: PendingCommands }) {
  const spinning = isSpinning(card);
  // The work publication names the worker; a px process alone does not.
  const working = card.activity.work.kind === 'working';
  const liveAgent = executingFamily(card);
  const agent = liveAgent ?? (working ? null : card.agent);
  const accent = card.gate === 'failed' ? C.red : agent === null ? C.stroke : familyAccent(agent);
  const actions = cardCommands(card.actions);
  const cancel = cancelAction(card.actions);
  // The footer carries the actions the server marked runnable for this card.
  // Which ones those are is the server's lifecycle decision, not a lane rule
  // evaluated here — the client only reads `state`.
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
        ...laneCard(selected), borderTop: `2px solid ${edgeColor(card)}`,
        background: C.card, marginBottom: 22,
        boxShadow: '0 6px 18px rgba(0,0,0,.55)',
      }}
    >
      <FlightCardHeader card={card} agent={agent} liveAgent={liveAgent} accent={accent} spinning={spinning} />

      <div style={{ padding: SPACE.lg }}>
        <FlightCardReview card={card} />
        <FlightCardCheckpoint card={card} />
        <ActorLine card={card} />
        <p style={{ color: C.faint, fontSize: TYPE.micro, margin: `${SPACE.sm}px 0 0` }}>{coordinatorText(card)}</p>
        {card.nextActionText !== null && (
          <p style={{ color: C.dim, fontSize: TYPE.meta, lineHeight: 1.4, margin: `${SPACE.sm}px 0 0` }}>
            <span style={{ color: C.faint }}>recorded guidance ({card.checkpoint}):</span> {card.nextActionText}
          </p>
        )}
        {card.flags.length > 0 && (
          <p style={{ color: C.amber, fontSize: TYPE.micro, margin: `${SPACE.md}px 0 0`, letterSpacing: TRACK.tight }}>▲ {card.flags.join(' · ')}</p>
        )}
        {card.blockingReason !== null && (
          <p style={{ color: C.red, fontSize: TYPE.micro, margin: `${SPACE.md}px 0 0`, letterSpacing: TRACK.tight }}>{card.blockingReason}</p>
        )}
      </div>

      {(actions.length > 0 || cancel !== null) && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: SPACE.md,
            // The action row fits the narrowest lane with only a few px of slack,
            // so the footer keeps its horizontal padding at the md step instead
            // of lg; lg would push three projected actions onto a second row.
            padding: SPACE.md, borderTop: `1px solid ${C.rule}`, background: C.cardFoot,
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
          display: 'flex', alignItems: 'flex-start', gap: SPACE.sm, width: '32%', height: 9,
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
          <span style={{ color: note.color, fontSize: TYPE.micro, whiteSpace: 'nowrap' }}>{note.text}</span>
        )}
      />
      <div onDragOver={(event: DragEvent<HTMLDivElement>) => { if (draggable) { event.preventDefault(); } }} onDrop={() => onDrop(stage.lane)} style={{ flex: 1, overflowY: 'auto', paddingTop: SPACE.lg, minHeight: 0 }}>
        {stage.cards.length === 0 && <p style={laneEmpty}>no missions in this stage</p>}
        {stage.cards.map((card) => <FlightCard key={card.id} card={card} onAction={onAction} onSelect={onSelect} onDragStart={onDragStart} selected={selectedId === card.id} pendingCommands={pendingCommands} />)}
      </div>
    </section>
  );
}
