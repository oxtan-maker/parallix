import type { BoardProjection } from '../../application/projections/board.js';
import type { BoardLane } from '../../application/projections/mission-board.js';
import { BOARD_LANES } from './lane-column.js';

export type NavigationKey = 'up' | 'down' | 'left' | 'right';

export interface BoardNavigationState {
  readonly selectedMissionId: string | null;
  readonly visibleStarts: Readonly<Record<BoardLane, number>>;
}

function emptyStarts(): Record<BoardLane, number> {
  return { backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 0 };
}

function cardsFor(projection: BoardProjection, lane: BoardLane) {
  return projection.stages.find((stage) => stage.lane === lane)?.cards ?? [];
}

function selection(projection: BoardProjection, selectedMissionId: string | null): { lane: BoardLane; index: number } | null {
  for (const lane of BOARD_LANES) {
    const index = cardsFor(projection, lane).findIndex((card) => card.id === selectedMissionId);
    if (index >= 0) { return { lane, index }; }
  }
  return null;
}

function keepVisible(start: number, index: number, cardCount: number, maxVisibleCards: number): number {
  const size = Math.max(1, maxVisibleCards);
  const maxStart = Math.max(0, cardCount - size);
  if (index < start) { return index; }
  if (index >= start + size) { return Math.min(maxStart, index - size + 1); }
  return Math.min(maxStart, start);
}

function withSelection(
  state: BoardNavigationState,
  projection: BoardProjection,
  lane: BoardLane,
  index: number,
  maxVisibleCards: number,
): BoardNavigationState {
  const cards = cardsFor(projection, lane);
  const selected = cards[index];
  if (!selected) { return state; }
  return {
    selectedMissionId: selected.id,
    visibleStarts: {
      ...state.visibleStarts,
      [lane]: keepVisible(state.visibleStarts[lane], index, cards.length, maxVisibleCards),
    },
  };
}

/** Initial view-only selection: the first card in board order, if any. */
export function createNavigationState(projection: BoardProjection): BoardNavigationState {
  const firstLane = BOARD_LANES.find((lane) => cardsFor(projection, lane).length > 0);
  return {
    selectedMissionId: firstLane ? cardsFor(projection, firstLane)[0]?.id ?? null : null,
    visibleStarts: emptyStarts(),
  };
}

/**
 * Move only TUI view state. Horizontal movement wraps and skips empty lanes;
 * vertical movement stops at the selected lane's first and last card.
 */
export function moveSelection(
  state: BoardNavigationState,
  projection: BoardProjection,
  key: NavigationKey,
  maxVisibleCards: number,
): BoardNavigationState {
  const current = selection(projection, state.selectedMissionId)
    ?? selection(projection, createNavigationState(projection).selectedMissionId);
  if (!current) { return createNavigationState(projection); }

  if (key === 'up') {
    return withSelection(state, projection, current.lane, Math.max(0, current.index - 1), maxVisibleCards);
  }
  if (key === 'down') {
    const last = cardsFor(projection, current.lane).length - 1;
    return withSelection(state, projection, current.lane, Math.min(last, current.index + 1), maxVisibleCards);
  }

  const direction = key === 'left' ? -1 : 1;
  const start = BOARD_LANES.indexOf(current.lane);
  for (let step = 1; step < BOARD_LANES.length; step += 1) {
    const lane = BOARD_LANES[(start + direction * step + BOARD_LANES.length) % BOARD_LANES.length]!;
    const cards = cardsFor(projection, lane);
    if (cards.length > 0) {
      return withSelection(state, projection, lane, Math.min(current.index, cards.length - 1), maxVisibleCards);
    }
  }
  return state;
}
