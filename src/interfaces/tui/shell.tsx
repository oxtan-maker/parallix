import { BoardShellView, RAIL_WIDTH } from './shell-view.js';
import { useBoardShellActions } from './shell-actions.js';
export { AttentionItems, attentionWhy, attentionCommand } from './shell-attention.js';
export type { AttentionItemsProps } from './shell-attention.js';
export { navigationKeyForInput } from './shell-keyboard.js';
import React from 'react';
import { useApp } from 'ink';

import type { BoardProjection } from '../../application/projections/board.js';

import type { BoardCommandDispatcher, BoardProgressSink } from '../../application/controller/board-command.js';

import { selectLayoutMode, useTerminalDimensions, MIN_LANE_WIDTH } from './board-layout.js';
import { BOARD_LANES } from './lane-column.js';
import { createNavigationState } from './navigation.js';
import { visibleCardsForHeight } from './board-layout.js';

import type { BoardProjectionListener } from '../../application/projections/board-subscription.js';

// ---------------------------------------------------------------------------
// TUI Shell — static read-only board from a BoardProjection
// Layout derived from: /tmp/Parallix Kanban Board Controller.zip
//
// Design box hierarchy (Ink mapping):
//   root (flex column)
//     ├─ top bar (flex row): px board | repo | wip·attn | staleness
//     ├─ main (flex:1) — ROW when wide, COLUMN when narrow
//     │   ├─ attention rail (width:34 when wide, full width when narrow)
//     │   │   └─ cards: rank | slug | [reason] | why | $cmd
//     │   └─ BoardLayout (flex:1): the six LaneColumns, side by side or stacked
//     ├─ command log (flex-shrink:0, border-top)
//     └─ footer: $ prompt
//
// The six lanes and their cards live in ./board-layout.tsx, ./lane-column.tsx,
// and ./mission-card.tsx. The shell owns only the surrounding chrome.
// ---------------------------------------------------------------------------

/** Width of the attention rail in the wide layout, in terminal columns. */

/** Format attention reason into "why" text (matches design attention rail). */
export interface BoardShellProps {
  readonly projection: BoardProjection;
  /** Terminal width override; defaults to the live terminal width. */
  readonly columns?: number;
  /** Terminal height override; defaults to the live terminal height. */
  readonly rows?: number;
  /** Test and embedding override for initial view-only selection. */
  readonly initialSelectedMissionId?: string | null;
  /** Supplied by the composition root; the shell never constructs an effect adapter. */
  readonly commandControllerFactory?: (_progress: BoardProgressSink) => BoardCommandDispatcher;
  /** Rebuilds read data after a stale-state conflict. */
  readonly refreshProjection?: () => Promise<BoardProjection>;
  /** Application-owned live projection updates for an interactive board. */
  readonly subscribeProjection?: (_onChange: BoardProjectionListener) => () => void;
  /** Test override for the FLOW panel's initial visibility. */
  readonly initialFlowOpen?: boolean;
}

/**
 * BoardShell — renders the full design layout.
 *
 * Wide terminal: attention rail beside the six lane columns.
 * Narrow terminal: attention rail above a single stacked column of lanes.
 * In headless mode (piped): Ink renders as static text dump.
 */
function useBoardShellState({ projection, columns, rows, initialSelectedMissionId, commandControllerFactory, refreshProjection, subscribeProjection, initialFlowOpen = false }: BoardShellProps) {
  const { exit } = useApp();
  const inputProjection = projection;
  const projectionRef = React.useRef(inputProjection);
  const [, redraw] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => { projectionRef.current = inputProjection; redraw(); }, [inputProjection]);
  React.useEffect(
    () => subscribeProjection?.((nextProjection) => { projectionRef.current = nextProjection; redraw(); }),
    [subscribeProjection],
  );
  projection = projectionRef.current;
  const detected = useTerminalDimensions();
  const width = columns ?? detected.columns;
  const height = rows ?? detected.rows;

  /* Layout mode is selected from the raw terminal width so the ≥100
   * wide-layout contract holds for the full px ui surface. */
  const mode = selectLayoutMode(width);

  /* The attention rail can only sit beside the board when the terminal
   * is wide enough for both the rail and six lanes at their minimum width.
   * 6 × 12 (min lane) + 5 (margins) + 2 (gutter) + 34 (rail) = 113.
   * Below that the rail moves above the board but lanes stay side by side. */
  const LANE_AREA_MIN = BOARD_LANES.length * MIN_LANE_WIDTH + (BOARD_LANES.length - 1) + 2;
  const railBeside = width >= RAIL_WIDTH + LANE_AREA_MIN;
  const boardWidth = railBeside ? Math.max(1, width - RAIL_WIDTH - 2) : width;

  const hasStale = projection.sourceFacts.some((fact) => fact.status === 'stale');
  const hasUnavailable = projection.sourceFacts.some((fact) => fact.status === 'unavailable');

  const wipCount = projection.inFlightWip;
  const attnCount = projection.attentionQueue.filter(
    (item) => item.reason.kind !== 'none',
  ).length;
  const maxVisibleCards = visibleCardsForHeight(mode, height);
  const [navigation, setNavigation] = React.useState(() => {
    const initial = createNavigationState(projection);
    return initialSelectedMissionId && projection.stages.some((stage) => stage.cards.some((card) => card.id === initialSelectedMissionId))
      ? { ...initial, selectedMissionId: initialSelectedMissionId }
      : initial;
  });
  const [showKeyboardHelp, setShowKeyboardHelp] = React.useState(false);
  const [flowOpen, setFlowOpen] = React.useState(initialFlowOpen);
  const [focusedAttentionIndex, setFocusedAttentionIndex] = React.useState(0);
  const [focusedArea, setFocusedArea] = React.useState<'rail' | 'board'>('board');
  const [doneCollapsed, setDoneCollapsed] = React.useState(false);
  const actions = useBoardShellActions(projection, navigation.selectedMissionId, projectionRef, redraw, commandControllerFactory, refreshProjection);
  /* Bidirectional sync: when the board's selected mission changes (via lane-
   * card selection), update the focused attention rail item to match. */
  const queueItems = projection.attentionQueue.filter(
    (item) => item.reason.kind !== 'none',
  );
  React.useEffect(() => {
    if (!navigation.selectedMissionId || queueItems.length === 0) { return; }
    const idx = queueItems.findIndex((item) => item.missionId === navigation.selectedMissionId);
    if (idx >= 0) { setFocusedAttentionIndex(idx); }
  }, [navigation.selectedMissionId]);

  /* Compute per-source status for attention item rendering. */
  const sourceStatusMap = React.useMemo(() => {
    const map = new Map<string, 'fresh' | 'stale' | 'unavailable'>();
    for (const fact of projection.sourceFacts) {
      map.set(fact.source, fact.status);
    }
    return map;
  }, [projection.sourceFacts]);

  return { projection, width, height, mode, railBeside, boardWidth, hasStale, hasUnavailable, wipCount, attnCount, navigation, showKeyboardHelp, flowOpen, focusedAttentionIndex, focusedArea, doneCollapsed, queueItems, sourceStatusMap, exit, setNavigation, maxVisibleCards, setShowKeyboardHelp, setFlowOpen, setDoneCollapsed, setFocusedAttentionIndex, setFocusedArea, ...actions };
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Key handler — Ink parses terminal escape sequences before this callback sees
// them. Do not match raw bytes here: terminals may split an escape sequence
// across data events, and sequences vary with modifiers and terminal modes.
// ---------------------------------------------------------------------------

export type BoardShellState = ReturnType<typeof useBoardShellState>;
export function BoardShell(props: BoardShellProps): React.ReactElement { return <BoardShellView state={useBoardShellState(props)} />; }
