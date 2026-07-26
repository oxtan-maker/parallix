import React from 'react';
import { useApp, useInput, Box, Text } from 'ink';
import type { Key } from 'ink';
import type { BoardProjection } from '../../application/projections/board.js';
import type { MissionCard } from '../../application/projections/mission-board.js';
import type { MissionDetail } from '../../application/projections/mission-detail.js';
import { BoardLayout, selectLayoutMode, useTerminalDimensions, MIN_LANE_WIDTH } from './board-layout.js';
import { BOARD_LANES } from './lane-column.js';
import { MissionDetailPanel } from './mission-detail-panel.js';
import { createNavigationState, moveSelection, type NavigationKey } from './navigation.js';
import { visibleCardsForHeight } from './board-layout.js';

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
const RAIL_WIDTH = 34;

/** Format attention reason into "why" text (matches design attention rail). */
export function attentionWhy(reason: { kind: string; detail?: string }): string {
  switch (reason.kind) {
    case 'blocking':
      return reason.detail || 'mission is blocked';
    case 'gate-failed':
      return reason.detail || 'verification gate failed';
    case 'review-lane':
      return reason.detail || 'awaiting review decision';
    case 'integrate-lane':
      return reason.detail || 'awaiting integration';
    default:
      return reason.detail || '';
  }
}

/** Suggest the px command for an attention item. */
export function attentionCommand(card: MissionCard, reason: { kind: string }): string {
  switch (reason.kind) {
    case 'integrate-lane':
      return `px integrate ${card.id}`;
    case 'review-lane':
      return `px review ${card.id}`;
    case 'gate-failed':
    case 'blocking':
      return `px active ${card.id}`;
    default:
      return `px ${card.lane} ${card.id}`;
  }
}

export interface BoardShellProps {
  readonly projection: BoardProjection;
  /** Terminal width override; defaults to the live terminal width. */
  readonly columns?: number;
  /** Terminal height override; defaults to the live terminal height. */
  readonly rows?: number;
  /** Shared application projections keyed by mission id; the TUI never loads them itself. */
  readonly missionDetails?: ReadonlyMap<string, MissionDetail>;
  /** Test and embedding override for initial view-only selection. */
  readonly initialSelectedMissionId?: string | null;
}

/**
 * BoardShell — renders the full design layout.
 *
 * Wide terminal: attention rail beside the six lane columns.
 * Narrow terminal: attention rail above a single stacked column of lanes.
 * In headless mode (piped): Ink renders as static text dump.
 */
export function BoardShell({ projection, columns, rows, missionDetails, initialSelectedMissionId }: BoardShellProps): React.ReactElement {
  const { exit } = useApp();
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

  const wipCount = projection.wipCounts.reduce((sum, wc) => sum + wc.count, 0);
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
  const [focusedAttentionIndex, setFocusedAttentionIndex] = React.useState(0);
  const [showWave5Message, setShowWave5Message] = React.useState(false);
  /** Which area the keyboard is focused on: rail or board. Defaults to board for backward compat. */
  const [focusedArea, setFocusedArea] = React.useState<'rail' | 'board'>('board');

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

  const detailSourceState: 'current' | 'stale' | 'unavailable' = hasUnavailable
    ? 'unavailable'
    : hasStale ? 'stale' : 'current';

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* ═══ TOP BAR ═══ */}
      <Box flexDirection="row" borderBottomColor="gray" paddingBottom={0} paddingRight={0} paddingLeft={0} justifyContent="space-between">
        <Box>
          <Text bold color="green">px board</Text>
          <Text color="gray">{` ${projection.repositoryId}`}</Text>
          <Text color="gray">{` wip ${wipCount}`}</Text>
          <Text color="gray">{` · attention `}</Text>
          <Text color="yellow">{String(attnCount)}</Text>
        </Box>
        {(hasStale || hasUnavailable) && (
          <Box>
            <Text color="yellow">
              {hasStale ? '⚠ stale' : ''}
              {hasStale && hasUnavailable ? ' · ' : ''}
              {hasUnavailable ? '⚠ unavailable' : ''}
            </Text>
          </Box>
        )}
      </Box>

      {/* ═══ MAIN: attention rail + board, side by side or stacked ═══ */}
      <Box flexDirection={railBeside ? 'row' : 'column'} flexGrow={1} minHeight={15}>
        {/* ── ATTENTION RAIL ── */}
        <Box
          flexDirection="column"
          width={railBeside ? RAIL_WIDTH : undefined}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Box>
            <Text bold color="yellow">▲ NEEDS YOU NEXT</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} paddingTop={1}>
            <AttentionItems
              queue={projection.attentionQueue}
              selectedMissionId={navigation.selectedMissionId}
              focusedIndex={focusedArea === 'rail' ? focusedAttentionIndex : -1}
              sourceStatusMap={sourceStatusMap}
            />
          </Box>
          <Box paddingTop={1}>
            <Text wrap="end" dimColor>{'ranked: integrate>review>active'}</Text>
          </Box>
        </Box>

        {/* ── BOARD AREA: the six lane columns ── */}
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <BoardLayout
            projection={projection}
            mode={mode}
            columns={boardWidth}
            rows={height}
            selectedMissionId={navigation.selectedMissionId}
            visibleStarts={navigation.visibleStarts}
          />
        </Box>
      </Box>

      <MissionDetailPanel
        detail={navigation.selectedMissionId ? missionDetails?.get(navigation.selectedMissionId) ?? null : null}
        sourceState={detailSourceState}
      />

      {/* ═══ COMMAND LOG ═══ */}
      <Box flexDirection="column" borderTopColor="gray" paddingTop={1} minHeight={3}>
        {showWave5Message && (
          <Box>
            <Text color="yellow">execution arrives in wave 5 (TASK-2307)</Text>
          </Box>
        )}
        {projection.operationLog.length > 0 ? (
          projection.operationLog.slice(-4).map((entry, idx) => (
            <Box key={idx}>
              <Text dimColor>{formatLogEntry(entry)}</Text>
            </Box>
          ))
        ) : (
          <Text dimColor>no recent operations</Text>
        )}
        <Box>
          <Text color="gray">$ </Text>
          <Text bold color="green">▌</Text>
        </Box>
        <Text color="gray">
          {showKeyboardHelp
            ? 'arrows or WASD: move selection · ?: hide help · q / Ctrl+C: quit'
            : 'arrows or WASD: move selection · ?: keyboard help · q: quit'}
        </Text>
      </Box>

      {/* Key handler */}
      <KeyHandler
        onExit={() => exit(0)}
        onNavigate={(key) => {
          if (key === 'self') { return; }
          setNavigation((previous) => moveSelection(previous, projection, key, maxVisibleCards));
        }}
        onToggleHelp={() => setShowKeyboardHelp((visible) => !visible)}
        onEnterAttention={(missionId) => {
          setNavigation((previous) => ({ ...previous, selectedMissionId: missionId }));
          setShowWave5Message(true);
        }}
        queueItems={queueItems}
        focusedAttentionIndex={focusedAttentionIndex}
        setFocusedIdx={setFocusedAttentionIndex}
        focusedArea={focusedArea}
        setFocusedArea={setFocusedArea}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

export interface AttentionItemsProps {
  readonly queue: BoardProjection['attentionQueue'];
  readonly selectedMissionId: string | null;
  /** Index of the keyboard-focused item in the filtered queue (-1 when rail not focused). */
  readonly focusedIndex: number;
  /** Per-source status map for rendering ⚠ on items whose source is stale/unavailable. */
  readonly sourceStatusMap: Map<string, 'fresh' | 'stale' | 'unavailable'>;
}

export function AttentionItems({ queue, selectedMissionId, focusedIndex, sourceStatusMap }: AttentionItemsProps): React.ReactElement {
  const items = queue.filter((item) => item.reason.kind !== 'none');

  if (items.length === 0) {
    return <Text dimColor>nothing needs attention</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.slice(0, 5).map((item, idx) => {
        const isSelected = item.missionId === selectedMissionId;
        const isFocused = idx === focusedIndex;
        /* Determine status indicator for this item based on source facts. */
        const statusIndicator = getSourceStatusIndicator(item, sourceStatusMap);
        return (
          <Box key={item.missionId} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={isFocused && !isSelected ? 'cyan' : isSelected ? 'cyan' : 'gray'}>
                {isFocused && !isSelected ? '▌ ' : isSelected ? '▶ ' : '  '}
              </Text>
              <Text color="gray">{String(idx + 1).padStart(2, '0')}</Text>
              <Text bold color="blue">{` ${item.card.id}`}</Text>
            </Box>
            <Box>
              <Text color={getReasonColor(item.reason.kind)}>{` [${item.reason.kind}]`}</Text>
              {statusIndicator && (
                <Text color="yellow">{' ' + statusIndicator}</Text>
              )}
            </Box>
            <Box>
              <Text wrap="end" dimColor>{attentionWhy(item.reason)}</Text>
            </Box>
            <Box>
              <Text wrap="end" color="gray">{`$ ${attentionCommand(item.card, item.reason)}`}</Text>
            </Box>
          </Box>
        );
      })}
      {items.length > 5 && (
        <Text dimColor>{`+${items.length - 5} more`}</Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a per-item source status indicator from the global sourceFacts map. */
function getSourceStatusIndicator(
  item: BoardProjection['attentionQueue'][number],
  sourceStatusMap: Map<string, 'fresh' | 'stale' | 'unavailable'>,
): string | null {
  /* Check source facts for any non-fresh status. */
  for (const [source, status] of sourceStatusMap) {
    if (status === 'unavailable') {
      return `⚠ ${source} unavailable`;
    }
    if (status === 'stale') {
      return `⚠ ${source} stale`;
    }
  }
  return null;
}

function getReasonColor(kind: string): 'green' | 'yellow' | 'red' | 'blue' {
  switch (kind) {
    case 'blocking': return 'red';
    case 'gate-failed': return 'yellow';
    case 'review-lane': return 'blue';
    case 'integrate-lane': return 'green';
    default: return 'yellow';
  }
}

function formatLogEntry(entry: { operationId: string; phase: string; message: string; timestamp: string; agent?: string }): string {
  const agentTag = entry.agent ? ` [${entry.agent}]` : '';
  return `${entry.timestamp} ${entry.phase}${agentTag} ${entry.message}`;
}

// ---------------------------------------------------------------------------
// Key handler — Ink parses terminal escape sequences before this callback sees
// them. Do not match raw bytes here: terminals may split an escape sequence
// across data events, and sequences vary with modifiers and terminal modes.
// ---------------------------------------------------------------------------

export function navigationKeyForInput(input: string, key: Pick<Key, 'upArrow' | 'downArrow' | 'leftArrow' | 'rightArrow' | 'ctrl' | 'meta'>): NavigationKey | undefined {
  if (key.upArrow) { return 'up'; }
  if (key.downArrow) { return 'down'; }
  if (key.leftArrow) { return 'left'; }
  if (key.rightArrow) { return 'right'; }
  if (key.ctrl || key.meta) { return undefined; }
  return ({ w: 'up', a: 'left', s: 'down', d: 'right' } as const)[input];
}

function KeyHandler({ onExit, onNavigate, onToggleHelp, onEnterAttention, queueItems: queueItemsList, focusedAttentionIndex: focusedIdx, setFocusedIdx, focusedArea, setFocusedArea }: {
  readonly onExit: () => void;
  readonly onNavigate: (_key: NavigationKey | 'self') => void;
  readonly onToggleHelp: () => void;
  readonly onEnterAttention: (_missionId: string) => void;
  readonly queueItems: readonly BoardProjection['attentionQueue'][number][];
  readonly focusedAttentionIndex: number;
  readonly setFocusedIdx: React.Dispatch<React.SetStateAction<number>>;
  readonly focusedArea: 'rail' | 'board';
  readonly setFocusedArea: React.Dispatch<React.SetStateAction<'rail' | 'board'>>;
}): React.ReactElement {
  useInput((input, key) => {
    if ((input === 'q' && !key.ctrl && !key.meta) || (input === 'c' && key.ctrl)) {
      onExit();
      return;
    }

    const navigation = navigationKeyForInput(input, key);
    if (navigation) {
      /* Arrow keys navigate the focused area. */
      if (focusedArea === 'rail' && queueItemsList.length > 0) {
        if (key.upArrow || input === 'w') {
          setFocusedIdx((previous) => Math.max(0, previous - 1));
          return;
        }
        if (key.downArrow || input === 's') {
          setFocusedIdx((previous) => Math.min(queueItemsList.length - 1, previous + 1));
          return;
        }
      }
      /* Board area: normal navigation (arrows + WASD). */
      if (focusedArea === 'board') { onNavigate(navigation); return; }
      /* When rail is focused and key is not up/down, treat left/right as board nav. */
      if (key.leftArrow || key.rightArrow || input === 'a' || input === 'd') {
        onNavigate(navigation);
        return;
      }
      return;
    }

    if (input === '?' && !key.ctrl && !key.meta) {
      onToggleHelp();
    }

    /* Tab / Shift+Tab: switch focus between rail and board.
     * Ink sets input='' for non-alphanumeric keys; use key.tab instead. */
    if (key.tab && !key.ctrl && !key.meta) {
      setFocusedArea((current) => current === 'rail' ? 'board' : 'rail');
      return;
    }

    /* Enter on the attention rail: select the focused item and show wave-5
     * run-affordance message. Only activates when the rail has keyboard focus;
     * pressing Enter on the board does not trigger attention selection. */
    if ((input === '\r' || key.return) && !key.ctrl && !key.meta && focusedArea === 'rail') {
      const item = queueItemsList[focusedIdx];
      if (item) {
        onNavigate('self');
        onEnterAttention(item.missionId);
      }
      return;
    }
  });

  return <></>;
}
