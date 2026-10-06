/**
 * The board composition: it groups the received stages into the reference's
 * three regions and renders nothing itself. Grouping is presentation only —
 * it never reorders, filters or reinterprets what the server sent, and every
 * fact on screen comes from the validated snapshot.
 *
 * Layout, spacing, palette and typography follow the design authority
 * (`Parallix Board GPU.dc.html` in the reference acceptance artifact).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DragEvent } from 'react';
import type { WebBoardSnapshot, WebCommandAction, WebMissionCard } from '../../src/interfaces/web/transport.js';
import { AttentionRail } from './attention-rail.js';
import { DoneRail } from './done-rail.js';
import { FlightColumn } from './flight-column.js';
import { FlowPanel } from './flow-panel.js';
import { IntakeColumn } from './intake-column.js';
import { OperationLog } from './operation-log.js';
import { TopBar } from './top-bar.js';
import { sendCommand } from './board-data.js';
import { unavailableReason, type PendingCommands } from './pending-command.js';

// Presentation-only grouping: which reference region a received stage sits in.
// These are layout buckets, not lifecycle rules.
const INTAKE_LANES: readonly string[] = ['refined', 'backlog'];
const SHIPPED_LANE = 'done';

/** A drop is valid only for one enabled, server-projected target intent. */
export function dragActionForTarget(actions: readonly WebCommandAction[], lane: WebMissionCard['lane']): WebCommandAction | null {
  const matches = actions.filter((action) => action.state === 'enabled' && action.targetLane === lane);
  return matches.length === 1 ? matches[0] : null;
}

export function restoreActionFocus(control: HTMLButtonElement, root: HTMLDivElement | null) {
  queueMicrotask(() => {
    if (control.isConnected) { control.focus(); return; }
    // `focus()` returns undefined, so the fallback must branch on the element,
    // never on the call's result.
    const card = root?.querySelector<HTMLElement>('[data-board-card][aria-selected="true"]') ?? null;
    (card ?? root)?.focus();
  });
}

function setDragPreview(event: DragEvent<HTMLElement>, card: WebMissionCard) {
  const preview = document.createElement('div');
  preview.textContent = card.id;
  Object.assign(preview.style, {
    position: 'fixed', top: '-1000px', left: '-1000px', padding: '5px 9px', borderRadius: '4px',
    border: '1px solid #43e891', background: '#102419', color: '#68f6a7', font: '12px monospace',
  });
  document.body.append(preview);
  event.dataTransfer.setData('text/plain', card.id);
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setDragImage(preview, 12, 12);
  requestAnimationFrame(() => preview.remove());
}

function isRequestKind(kind: WebCommandAction['kind']): kind is 'active:execute' | 'draft:create' | 'handoff:record' | 'integrate:merge' | 'review:submit' | 'mission:cancel' {
  return kind === 'active:execute' || kind === 'draft:create' || kind === 'handoff:record'
    || kind === 'integrate:merge' || kind === 'review:submit' || kind === 'mission:cancel';
}

export function Board({ snapshot, onRefresh }: { snapshot: WebBoardSnapshot; onRefresh: () => Promise<void> }) {
  const [flowOpen, setFlowOpen] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<PendingCommands>(new Map());
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, string>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragged, setDragged] = useState<WebMissionCard | null>(null);
  /**
   * The pending destructive confirmation. Every other action dispatches on the
   * click that invoked it; cancellation deletes rows, so it takes a second,
   * separately labelled click that only this panel offers.
   */
  const [cancelPrompt, setCancelPrompt] = useState<{ card: WebMissionCard; action: WebCommandAction } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Map<string, { id: number; kind: WebCommandAction['kind'] }>>(new Map());
  const requestSequence = useRef(0);
  const latestInteraction = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const publishPending = () => { if (mounted.current) { setPendingCommands(new Map(pendingRef.current)); } };
  const publishOutcome = (missionId: string, text: string) => {
    if (mounted.current) { setOutcomes((current) => new Map(current).set(missionId, text)); }
  };
  const clearOutcome = (missionId: string) => {
    if (mounted.current) { setOutcomes((current) => { const next = new Map(current); next.delete(missionId); return next; }); }
  };
  useEffect(() => {
    const present = new Set(snapshot.stages.flatMap((stage) => stage.cards).map((card) => card.id));
    setOutcomes((current) => new Map([...current].filter(([missionId]) => present.has(missionId))));
  }, [snapshot]);
  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') { return; }
    const cards = [...(root.current?.querySelectorAll<HTMLElement>('[data-board-card]') ?? [])];
    if (cards.length === 0) { return; }
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-board-card]');
    const index = Math.max(0, current === null ? -1 : cards.indexOf(current));
    const next = cards[(index + (event.key === 'ArrowDown' ? 1 : -1) + cards.length) % cards.length];
    event.preventDefault();
    next.focus();
    setSelectedId(next.dataset.boardCard ?? null);
  };
  const startDrag = (card: WebMissionCard, event: DragEvent<HTMLElement>) => {
    if (pendingRef.current.has(card.id)) { publishOutcome(card.id, 'Drag unavailable while a command is running for this mission.'); return; }
    setDragPreview(event, card);
    setDragged(card);
  };
  const dispatch = async (card: WebMissionCard, action: WebCommandAction, control?: HTMLButtonElement) => {
    const unavailable = unavailableReason(action, pendingRef.current.get(card.id));
    if (unavailable !== null) { publishOutcome(card.id, unavailable); return; }
    if (!isRequestKind(action.kind)) {
      publishOutcome(card.id, 'This projected action is not supported by the browser controller.');
      return;
    }
    const id = ++requestSequence.current;
    latestInteraction.current = id;
    pendingRef.current.set(card.id, { id, kind: action.kind });
    publishPending();
    publishOutcome(card.id, `Starting ${action.display}…`);
    try {
      const result = await sendCommand({
        missionId: card.id,
        kind: action.kind,
        missionStatusAtRequest: card.status,
      });
      if (result.error?.kind === 'conflict') {
        await onRefresh();
        publishOutcome(card.id, `${result.error.message} Select the refreshed action to try again.`);
        return;
      }
      if (result.status !== 'completed') { publishOutcome(card.id, result.error?.message ?? result.status); return; }
      await onRefresh();
      publishOutcome(card.id, action.kind === 'mission:cancel'
        ? `Cancelled ${card.id}: its lifecycle rows are gone and its card has left the board.`
        : `${action.display} started.`);
    } catch (error) {
      publishOutcome(card.id, error instanceof Error ? error.message : String(error));
    } finally {
      if (pendingRef.current.get(card.id)?.id === id) { pendingRef.current.delete(card.id); publishPending(); }
      if (control !== undefined && mounted.current && latestInteraction.current === id) { restoreActionFocus(control, root.current); }
    }
  };
  const open = (card: WebMissionCard, action: WebCommandAction, control: HTMLButtonElement) => {
    const unavailable = unavailableReason(action, pendingRef.current.get(card.id));
    if (unavailable !== null) { publishOutcome(card.id, unavailable); return; }
    setSelectedId(card.id);
    clearOutcome(card.id);
    if (action.kind === 'mission:cancel') { setCancelPrompt({ card, action }); return; }
    void dispatch(card, action, control);
  };
  const dropAction = (lane: WebMissionCard['lane']) => {
    if (dragged === null) { return; }
    if (pendingRef.current.has(dragged.id)) { publishOutcome(dragged.id, 'Drop unavailable while a command is running for this mission.'); return; }
    const matches = dragged.actions.filter((action) => action.state === 'enabled' && action.targetLane === lane);
    setDragged(null);
    const action = dragActionForTarget(dragged.actions, lane);
    if (action === null) {
      publishOutcome(dragged.id, `Drop unavailable: ${matches.length === 0 ? 'no enabled projected action targets this lane' : 'more than one projected action targets this lane'}.`);
      return;
    }
    setSelectedId(dragged.id);
    void dispatch(dragged, action);
  };
  const canDrop = (lane: WebMissionCard['lane']) => dragged !== null && !pendingRef.current.has(dragged.id) && dragActionForTarget(dragged.actions, lane) !== null;
  // The intake bucket stacks in the reference's order; every other lane keeps
  // the order the server sent.
  const intake = snapshot.stages
    .filter((stage) => INTAKE_LANES.includes(stage.lane))
    .sort((a, b) => INTAKE_LANES.indexOf(a.lane) - INTAKE_LANES.indexOf(b.lane));
  const flight = snapshot.stages.filter((stage) => !INTAKE_LANES.includes(stage.lane) && stage.lane !== SHIPPED_LANE);
  const shipped = snapshot.stages.filter((stage) => stage.lane === SHIPPED_LANE);

  return (
    <div ref={root} tabIndex={-1} onKeyDown={moveSelection}>
      <TopBar snapshot={snapshot} flowOpen={flowOpen} onFlowToggle={() => setFlowOpen((open) => !open)} />
      {flowOpen && <FlowPanel metrics={snapshot.metrics} />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <AttentionRail snapshot={snapshot} selectedId={selectedId} pendingCommands={pendingCommands} onSelect={setSelectedId} onAction={(item, control) => {
          const card = snapshot.stages.flatMap((stage) => stage.cards).find((candidate) => candidate.id === item.missionId);
          if (card !== undefined) { open(card, item.action, control); } else { publishOutcome(item.missionId, `Mission ${item.missionId} is no longer in the current projection.`); }
        }} />
        <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, gap: 14, padding: 14, overflowX: 'auto' }}>
          {intake.length > 0 && (
            <div style={{ width: 222, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 16 }}>
              {intake.map((stage, index) => (
                <IntakeColumn
                  key={stage.lane}
                  stage={stage}
                  onAction={open}
                  onSelect={setSelectedId}
                  onDragStart={startDrag}
                  onDrop={dropAction}
                  selectedId={selectedId}
                  pendingCommands={pendingCommands}
                  draggable={canDrop(stage.lane) === true}
                  style={index === 0
                    ? { minHeight: 80, maxHeight: '44%', flexShrink: 0 }
                    : { flex: 1, minHeight: 0 }}
                />
              ))}
            </div>
          )}
          {flight.map((stage) => (
            <div key={stage.lane} aria-dropeffect={canDrop(stage.lane) ? 'move' : undefined} style={{ flex: 1, minWidth: 318, minHeight: 0 }}>
              <FlightColumn stage={stage} onAction={open} onSelect={setSelectedId} onDragStart={startDrag} onDrop={dropAction} selectedId={selectedId} pendingCommands={pendingCommands} draggable={canDrop(stage.lane) === true} style={{ height: '100%' }} />
            </div>
          ))}
          {shipped.map((stage) => <DoneRail key={stage.lane} stage={stage} />)}
        </div>
      </div>
      {cancelPrompt !== null && (
        <section
          aria-label={`Confirm cancelling ${cancelPrompt.card.id}`}
          style={{ margin: '0 14px 10px', padding: '9px 11px', border: '1px solid #7a2f2f', borderRadius: 5, background: '#1d1112', color: '#e0b7b7' }}
        >
          <p style={{ margin: 0, fontSize: 12 }}>
            {`Cancelling ${cancelPrompt.card.id} deletes its lifecycle rows — lanes, checkpoints, review rounds, findings and session markers — and cannot be undone. Usage statistics are kept, and its git branch and worktree stay for you to remove.`}
          </p>
          <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => {
                const pending = cancelPrompt;
                const card = snapshot.stages.flatMap((stage) => stage.cards).find((candidate) => candidate.id === pending.card.id);
                const action = card?.actions.find((candidate) => candidate.kind === pending.action.kind);
                const unavailable = card === undefined ? 'mission is no longer in the current projection' : action === undefined
                  ? 'cancellation is no longer available in the current server projection'
                  : unavailableReason(action, pendingRef.current.get(card.id));
                if (card === undefined || action === undefined || unavailable !== null) { publishOutcome(pending.card.id, `Cancellation was not sent: ${unavailable}`); return; }
                setCancelPrompt(null);
                void dispatch(card, action);
              }}
              style={{ background: '#3a1618', border: '1px solid #a83c3c', borderRadius: 4, color: '#f0a0a0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, letterSpacing: 0.5, padding: '4px 10px' }}
            >
              {`delete ${cancelPrompt.card.id} lifecycle rows`}
            </button>
            <button
              type="button"
              onClick={() => { setCancelPrompt(null); publishOutcome(cancelPrompt.card.id, `Kept ${cancelPrompt.card.id}. Nothing was deleted.`); }}
              style={{ background: 'none', border: '1px solid #3a4550', borderRadius: 4, color: '#aab4bf', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, letterSpacing: 0.5, padding: '4px 10px' }}
            >
              keep mission
            </button>
          </div>
        </section>
      )}
      {[...outcomes.entries()].map(([missionId, outcome]) => <p key={missionId} role="status" aria-live="polite" style={{ margin: '0 14px 10px', color: '#aab4bf' }}>{outcome}</p>)}
      <OperationLog snapshot={snapshot} />
    </div>
  );
}
