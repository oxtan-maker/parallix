import React from 'react';
import { useApp, useInput, Box, Text } from 'ink';
import type { Key } from 'ink';
import type { BoardProjection } from '../../application/projections/board.js';
import type { AttentionAction } from '../../application/projections/board.js';
import type { MissionCard } from '../../application/projections/mission-board.js';
import type { Capability } from '../../application/contracts.js';
import type {
  BoardCommandDispatcher,
  BoardCommandKind,
  BoardCommandResult,
  BoardProgressSink,
} from '../../application/controller/board-command.js';
import { cancelledOutcome, unavailableCapability, unavailableReason } from '../../application/controller/board-command.js';
import { projectMissionActivity } from '../../application/projections/mission-activity.js';
import { BoardLayout, selectLayoutMode, useTerminalDimensions, MIN_LANE_WIDTH } from './board-layout.js';
import { BOARD_LANES } from './lane-column.js';
import { createNavigationState, moveSelection, type NavigationKey } from './navigation.js';
import { visibleCardsForHeight } from './board-layout.js';
import { canDispatchAction } from './action-bar.js';
import { ConfirmationDialog } from './confirmation-dialog.js';
import { OutcomeBanner } from './outcome-banner.js';
import { FlowPanel } from './flow-panel.js';
import { AgentStrip } from './agent-strip.js';
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
export function attentionCommand(card: MissionCard, reason: { kind: string }, action?: AttentionAction): string {
  if (action) { return action.display; }
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
export function BoardShell({ projection, columns, rows, initialSelectedMissionId, commandControllerFactory, refreshProjection, subscribeProjection, initialFlowOpen = false }: BoardShellProps): React.ReactElement {
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
  const throughput = projection.metrics.weeklyThroughput.series.at(-1)?.value ?? null;
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
  const [confirmation, setConfirmation] = React.useState<{ kind: BoardCommandKind; mission: MissionCard } | null>(null);
  const [outcome, setOutcome] = React.useState<BoardCommandResult | null>(null);
  const [liveEvents, setLiveEvents] = React.useState<Array<BoardProjection['operationLog'][number] & { sequence: number }>>([]);
  const confirmationRef = React.useRef<{ kind: BoardCommandKind; mission: MissionCard } | null>(null);
  /** Which area the keyboard is focused on: rail or board. Defaults to board for backward compat. */
  const [focusedArea, setFocusedArea] = React.useState<'rail' | 'board'>('board');
  /** Done lane collapsed to a narrow strip. Toggled with Shift+S. */
  const [doneCollapsed, setDoneCollapsed] = React.useState(false);
  const controller = React.useMemo(() => commandControllerFactory?.((event) => {
    setLiveEvents((previous) => [...previous, event].sort((left, right) => left.sequence - right.sequence));
  }), [commandControllerFactory]);

  const dispatchMissionAction = (kind: BoardCommandKind, mission: MissionCard): boolean => {
    setOutcome(null);
    if (!controller?.canExecute(kind)) {
      setOutcome(unavailableCapability(kind, unavailableReason(kind) ?? 'no Mission authority is configured for this interface'));
      return false;
    }
    if (!canDispatchAction(kind, mission, controller)) {
      setOutcome(unavailableCapability(kind, 'Mission cannot be activated from its current state'));
      return false;
    }
    const nextConfirmation = { kind, mission };
    confirmationRef.current = nextConfirmation;
    setConfirmation(nextConfirmation);
    return true;
  };

  const startAction = (missionId: string): boolean => {
    const mission = projection.stages.flatMap((stage) => stage.cards).find((card) => card.id === missionId) ?? null;
    return mission ? dispatchMissionAction('active:execute', mission) : false;
  };

  /** Dispatch a lifecycle shortcut command.
   * Integrated capabilities (active:execute) go through ConfirmationDialog
   * with the same canDispatchAction guard as Enter.
   * Unavailable capabilities report immediately without confirmation (R4). */
  const dispatchLifecycle = (kind: BoardCommandKind): boolean => {
    if (!navigation.selectedMissionId) { return false; }
    const mission = projection.stages.flatMap((stage) => stage.cards).find((card) => card.id === navigation.selectedMissionId) ?? null;
    if (!mission) { return false; }
    if (controller?.canExecute(kind)) {
      /* Integrated: gate on enablement (same check as Enter/startAction). */
      return dispatchMissionAction(kind, mission);
    } else {
      /* Unavailable capability — report immediately without confirmation dialog (R4). */
      const reason = unavailableReason(kind) ?? `${kind} is not yet available`;
      setOutcome(unavailableCapability(kind, reason));
      return false;
    }
  };

  const confirmAction = async () => {
    const pendingConfirmation = confirmationRef.current;
    if (!pendingConfirmation || !controller) { return; }
    const kind = pendingConfirmation.kind;
    const request = {
      operationId: `board-${Date.now()}`,
      kind,
      missionId: pendingConfirmation.mission.id,
      missionStatusAtRequest: pendingConfirmation.mission.status,
      agent: pendingConfirmation.mission.agent,
      capabilities: new Set([kind as Capability] as const),
      cancellation: { requested: false },
    } as const;
    confirmationRef.current = null;
    setConfirmation(null);
    const result = await controller.dispatch(request);
    setOutcome(result);
    if (result.error?.kind === 'conflict' && refreshProjection) {
      const refreshed = await refreshProjection();
      const refreshedMission = refreshed.stages.flatMap((stage) => stage.cards)
        .find((card) => card.id === pendingConfirmation.mission.id) ?? pendingConfirmation.mission;
      const nextConfirmation = { kind, mission: refreshedMission };
      confirmationRef.current = nextConfirmation;
      setConfirmation(nextConfirmation);
    }
  };

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
          {throughput !== null && (
            <>
              <Text color="gray">{` · ${throughput}/wk`}</Text>
            </>
          )}
        </Box>
        <Box>
          {(hasStale || hasUnavailable) && (
            <Text color="yellow">
              {hasStale ? '⚠ stale' : ''}
              {hasStale && hasUnavailable ? ' · ' : ''}
              {hasUnavailable ? '⚠ unavailable' : ''}
              {'  '}
            </Text>
          )}
          <Text color={flowOpen ? 'cyan' : 'gray'}>{flowOpen ? '▤ FLOW' : '▥ FLOW'}</Text>
        </Box>
      </Box>

      {flowOpen && <FlowPanel metrics={projection.metrics} columns={width} />}

      {/* ═══ AGENT STRIP ═══ */}
      <AgentStrip
        agentAvailability={projection.metrics.agentAvailability}
        unattributedRunningSessions={projection.metrics.unattributedRunningSessions}
        missionActivity={projection.stages.flatMap((stage) => stage.cards).map(projectMissionActivity)}
      />

      {/* ═══ MAIN: attention rail + board, side by side or stacked ═══ */}
      <Box flexDirection={railBeside ? 'row' : 'column'} flexGrow={1} minHeight={15}>
        {/* ── OPERATOR RAIL ── */}
        <Box
          flexDirection="column"
          width={railBeside ? RAIL_WIDTH : undefined}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {/* The rail's first content is the attention heading. The previously
              rendered live-work count and `task-… · phase · agent` rows were
              unsupported rail content (task-2408): the authoritative work
              summary lives in the agent strip, not here. */}
          <Box flexDirection="row" paddingTop={1}>
            <Text bold color="yellow">▲ NEEDS YOU NEXT</Text>
            <Text color="gray">{' '}{attnCount}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} paddingTop={1}>
            <AttentionItems
              queue={projection.attentionQueue}
              selectedMissionId={navigation.selectedMissionId}
              focusedIndex={focusedArea === 'rail' ? focusedAttentionIndex : -1}
              sourceStatusMap={sourceStatusMap}
              commandController={controller}
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
            doneCollapsed={doneCollapsed}
          />
        </Box>
      </Box>

      {confirmation && <ConfirmationDialog kind={confirmation.kind} missionId={confirmation.mission.id} />}
      {outcome && <OutcomeBanner outcome={outcome} />}

      {/* ═══ COMMAND LOG ═══ */}
      <Box flexDirection="column" borderTopColor="gray" paddingTop={1} minHeight={3}>
        {[...projection.operationLog, ...liveEvents].length > 0 ? (
          [...projection.operationLog, ...liveEvents].slice(-4).map((entry, idx) => (
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
            ? 'arrows/WASD: move · Enter: execute · Ctrl+D/A/R: lifecycle · Shift+S: done · f: FLOW · ?: hide help · q/Ctrl+C: quit'
            : 'arrows/WASD: move · Enter: execute · Ctrl+D/A/R: lifecycle · Shift+S: done · f: FLOW · ?: help · q: quit'}
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
        onToggleFlow={() => setFlowOpen((visible) => !visible)}
        onToggleDone={() => setDoneCollapsed((c) => !c)}
        onEnterAttention={(item) => {
          setNavigation((previous) => ({ ...previous, selectedMissionId: item.missionId }));
          dispatchMissionAction(item.action.kind, item.card);
        }}
        onStartAction={startAction}
        selectedMissionId={navigation.selectedMissionId}
        onConfirm={() => { void confirmAction(); }}
        onCancel={() => {
          confirmationRef.current = null;
          setConfirmation(null);
          setOutcome(cancelledOutcome('cancelled before dispatch'));
        }}
        onLifecycle={dispatchLifecycle}
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
  readonly commandController?: BoardCommandDispatcher;
}

export function AttentionItems({ queue, selectedMissionId, focusedIndex, sourceStatusMap, commandController }: AttentionItemsProps): React.ReactElement {
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
              <Text wrap="end" color="gray">{`$ ${attentionCommand(item.card, item.reason, item.action)}`}</Text>
            </Box>
            <Box>
              <Text color={canDispatchAction(item.action.kind, item.card, commandController) ? 'green' : 'gray'}>
                {canDispatchAction(item.action.kind, item.card, commandController) ? ' run \u25b6' : ' unavailable'}
              </Text>
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
  for (const source of item.dependsOnSources) {
    const status = sourceStatusMap.get(source);
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

/** PTYs can normalize Enter from carriage return to line feed before Ink reads it. */
function isUnmodifiedEnter(input: string, key: Pick<Key, 'return' | 'ctrl' | 'meta'>): boolean {
  return (input === '\r' || input === '\n' || key.return) && !key.ctrl && !key.meta;
}

function KeyHandler({ onExit, onNavigate, onToggleHelp, onToggleFlow, onToggleDone, onEnterAttention, onStartAction, selectedMissionId, onConfirm, onCancel, onLifecycle, queueItems: queueItemsList, focusedAttentionIndex: focusedIdx, setFocusedIdx, focusedArea, setFocusedArea }: {
  readonly onExit: () => void;
  readonly onNavigate: (_key: NavigationKey | 'self') => void;
  readonly onToggleHelp: () => void;
  readonly onToggleFlow: () => void;
  readonly onToggleDone: () => void;
  readonly onEnterAttention: (_item: BoardProjection['attentionQueue'][number]) => void;
  readonly onStartAction: (_missionId: string) => boolean;
  readonly selectedMissionId: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Returns whether this shortcut opened a confirmation dialog. */
  readonly onLifecycle: (_kind: BoardCommandKind) => boolean;
  readonly queueItems: readonly BoardProjection['attentionQueue'][number][];
  readonly focusedAttentionIndex: number;
  readonly setFocusedIdx: React.Dispatch<React.SetStateAction<number>>;
  readonly focusedArea: 'rail' | 'board';
  readonly setFocusedArea: React.Dispatch<React.SetStateAction<'rail' | 'board'>>;
}): React.ReactElement {
  // Keep Ink's subscription alive across renders. `useInput` resubscribes when
  // its callback identity changes; the shell intentionally re-renders when a
  // confirmation opens or the done lane toggles, so a changing callback can
  // drop the immediately following keypress.
  const latest = React.useRef({
    onExit, onNavigate, onToggleHelp, onToggleFlow, onToggleDone,
    onEnterAttention, onStartAction, selectedMissionId, onConfirm, onCancel,
    onLifecycle, queueItemsList, focusedIdx, setFocusedIdx, focusedArea,
    setFocusedArea,
  });
  latest.current = {
    onExit, onNavigate, onToggleHelp, onToggleFlow, onToggleDone,
    onEnterAttention, onStartAction, selectedMissionId, onConfirm, onCancel,
    onLifecycle, queueItemsList, focusedIdx, setFocusedIdx, focusedArea,
    setFocusedArea,
  };
  const confirmationArmedRef = React.useRef(false);

  useInput(React.useCallback((input, key) => {
    const {
      onExit, onNavigate, onToggleHelp, onToggleFlow, onToggleDone,
      onEnterAttention, onStartAction, selectedMissionId, onConfirm, onCancel,
      onLifecycle, queueItemsList, focusedIdx, setFocusedIdx, focusedArea,
      setFocusedArea,
    } = latest.current;
    // Quit is process-wide and must not be swallowed by a confirmation modal.
    if ((input === 'q' && !key.ctrl && !key.meta) || (input === 'c' && key.ctrl)) {
      onExit();
      return;
    }
    if (confirmationArmedRef.current) {
      if (isUnmodifiedEnter(input, key)) {
        confirmationArmedRef.current = false;
        onConfirm();
      }
      if (key.escape) {
        confirmationArmedRef.current = false;
        onCancel();
      }
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
      return;
    }

    if ((input === 'f' || input === 'F') && !key.ctrl && !key.meta) {
      onToggleFlow();
      return;
    }

    /* Lifecycle shortcuts: Ctrl+D = draft, Ctrl+A = activate, Ctrl+R = review.
     * Ctrl+I (integrate) is excluded: Ink reports Ctrl+I as Tab (0x09) with ctrl:false,
     * so it cannot be distinguished from the Tab focus-toggle binding. Confirmed limitation
     * retained as a defensive guard if the confirmation contract changes. */
    if ((key.ctrl || ['\u0004', '\u0001', '\u0012'].includes(input)) && !key.meta && selectedMissionId) {
      const lifecycleMap: Readonly<Record<string, BoardCommandKind>> = {
        d: 'draft:create',
        a: 'active:execute',
        r: 'review:submit',
      };
      const kind = lifecycleMap[({ '\u0004': 'd', '\u0001': 'a', '\u0012': 'r' } as const)[input] ?? input];
      if (kind) {
        confirmationArmedRef.current = onLifecycle(kind);
        return;
      }
    }

    /* Shift+S: toggle done lane collapse.
     * Ink reports Shift+S as input 'S' with no dedicated shift flag. */
    if (input === 'S' && !key.ctrl && !key.meta) {
      onToggleDone();
      return;
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
    if (isUnmodifiedEnter(input, key) && focusedArea === 'rail') {
      const item = queueItemsList[focusedIdx];
      if (item) {
        onNavigate('self');
        onEnterAttention(item);
      }
      return;
    }
    if (isUnmodifiedEnter(input, key) && focusedArea === 'board') {
      // The shell's board selection is already the current card; callback uses
      // the same stable mission id as the projection request.
      if (selectedMissionId) {
        confirmationArmedRef.current = onStartAction(selectedMissionId);
      }
    }
  }, []));

  return <></>;
}
