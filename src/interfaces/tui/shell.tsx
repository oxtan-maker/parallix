import React from 'react';
import { useApp, useStdin, Box, Text } from 'ink';
import type { BoardProjection } from '../../application/projections/board.js';
import type { MissionCard } from '../../application/projections/mission-board.js';
import { BoardLayout, selectLayoutMode, useTerminalDimensions, MIN_LANE_WIDTH } from './board-layout.js';
import { BOARD_LANES } from './lane-column.js';

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
function attentionWhy(reason: { kind: string; detail?: string }): string {
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
function attentionCommand(card: MissionCard, reason: { kind: string }): string {
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
}

/**
 * BoardShell — renders the full design layout.
 *
 * Wide terminal: attention rail beside the six lane columns.
 * Narrow terminal: attention rail above a single stacked column of lanes.
 * In headless mode (piped): Ink renders as static text dump.
 */
export function BoardShell({ projection, columns, rows }: BoardShellProps): React.ReactElement {
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
            <AttentionItems queue={projection.attentionQueue} />
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
          />
        </Box>
      </Box>

      {/* ═══ COMMAND LOG ═══ */}
      <Box flexDirection="column" borderTopColor="gray" paddingTop={1} minHeight={3}>
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
      </Box>

      {/* Key handler */}
      <KeyHandler onExit={() => exit(0)} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

function AttentionItems({ queue }: { readonly queue: BoardProjection['attentionQueue'] }): React.ReactElement {
  const items = queue.filter((item) => item.reason.kind !== 'none');

  if (items.length === 0) {
    return <Text dimColor>nothing needs attention</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.slice(0, 5).map((item, idx) => (
        <Box key={item.missionId} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="gray">{String(idx + 1).padStart(2, '0')}</Text>
            <Text bold color="blue">{` ${item.card.id}`}</Text>
          </Box>
          <Box>
            <Text color={getReasonColor(item.reason.kind)}>{` [${item.reason.kind}]`}</Text>
          </Box>
          <Box>
            <Text wrap="end" dimColor>{attentionWhy(item.reason)}</Text>
          </Box>
          <Box>
            <Text wrap="end" color="gray">{`$ ${attentionCommand(item.card, item.reason)}`}</Text>
          </Box>
        </Box>
      ))}
      {items.length > 5 && (
        <Text dimColor>{`+${items.length - 5} more`}</Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Key handler — exits on 'q' or Ctrl+C
// ---------------------------------------------------------------------------

function KeyHandler({ onExit }: { readonly onExit: () => void }): React.ReactElement {
  const { stdin, setRawMode } = useStdin();

  React.useEffect(() => {
    const handleData = (data: string | Buffer) => {
      const char = typeof data === 'string' ? data : data.toString();
      if (char === 'q' || char === '\u0003') {
        onExit();
      }
    };

    try {
      setRawMode(true);
    } catch {
      // stdin is not a TTY (piped / CI) — skip raw mode
    }
    stdin.resume();
    stdin.on('data', handleData);

    return () => {
      stdin.removeListener('data', handleData);
      try { setRawMode(false); } catch {}
    };
  }, [stdin, setRawMode, onExit]);

  return <></>;
}
