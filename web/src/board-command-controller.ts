import type { RefObject } from 'react';
import type { WebCommandAction, WebMissionCard } from '../../src/interfaces/web/transport.js';
import { sendCommand } from './board-data.js';
import { unavailableReason } from './pending-command.js';

interface BoardCommandContext {
  pendingRef: RefObject<Map<string, { id: number; kind: WebCommandAction['kind'] }>>;
  requestSequence: RefObject<number>; latestInteraction: RefObject<number>; mounted: RefObject<boolean>;
  root: RefObject<HTMLDivElement | null>;
  setEditRequest(request: { id: string; control: HTMLButtonElement }): void;
  publishPending(): void; publishOutcome(missionId: string, text: string): void; onRefresh(): Promise<void>;
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

function isRequestKind(kind: WebCommandAction['kind']): kind is 'workflow:stop' | 'active:execute' | 'draft:create' | 'handoff:record' | 'integrate:merge' | 'review:submit' | 'mission:cancel' {
  return kind === 'workflow:stop' || kind === 'active:execute' || kind === 'draft:create' || kind === 'handoff:record'
    || kind === 'integrate:merge' || kind === 'review:submit' || kind === 'mission:cancel';
}

async function publishCommandResult(result: Awaited<ReturnType<typeof sendCommand>>, card: WebMissionCard, action: WebCommandAction, context: BoardCommandContext) {
  const { onRefresh, publishOutcome } = context;
  if (result.error?.kind === 'conflict') {
    await onRefresh();
    publishOutcome(card.id, `${result.error.message} Select the refreshed action to try again.`);
    return;
  }
  if (result.status === 'accepted') {
    await onRefresh();
    publishOutcome(card.id, `${action.display} accepted; follow server progress.`);
    return;
  }
  if (result.status !== 'completed') { publishOutcome(card.id, result.error?.message ?? result.status); return; }
  await onRefresh();
  publishOutcome(card.id, action.kind === 'mission:cancel'
    ? `Cancelled ${card.id}: its lifecycle rows are gone and its card has left the board.`
    : action.kind === 'workflow:stop' ? `Stopped run for ${card.id}; mission retained.`
    : `${action.display} ${result.value !== null && typeof result.value === 'object' && 'phase' in result.value && result.value.phase === 'completed' ? 'completed' : 'started'}.`);
}

export async function dispatchBoardCommand(card: WebMissionCard, action: WebCommandAction, control: HTMLButtonElement | undefined, context: BoardCommandContext) {
  const { pendingRef, requestSequence, latestInteraction, mounted, root, setEditRequest, publishPending, publishOutcome } = context;
  if (action.kind === 'mission:edit' && action.state === 'enabled' && control) { setEditRequest({ id: card.id, control }); return; }
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
      requestKey: crypto.randomUUID(),
      missionId: card.id,
      kind: action.kind,
      missionStatusAtRequest: card.status,
    });
    await publishCommandResult(result, card, action, context);
  } catch (error) {
    publishOutcome(card.id, error instanceof Error ? error.message : String(error));
  } finally {
    if (pendingRef.current.get(card.id)?.id === id) { pendingRef.current.delete(card.id); publishPending(); }
    if (control !== undefined && mounted.current && latestInteraction.current === id) { restoreActionFocus(control, root.current); }
  }
}
