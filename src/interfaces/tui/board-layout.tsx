import React from 'react';
import { Box, useStdout } from 'ink';
import type { BoardProjection, BoardStage } from '../../application/projections/board.js';
import type { BoardLane } from '../../application/projections/mission-board.js';
import { BOARD_LANES, LaneColumn, DEFAULT_VISIBLE_CARDS } from './lane-column.js';

// ---------------------------------------------------------------------------
// BoardLayout — responsive arrangement of the six lane columns.
//
//   width ≥ WIDE_LAYOUT_MIN_COLUMNS → six equal columns, side by side
//   width <  WIDE_LAYOUT_MIN_COLUMNS → one column, lanes stacked vertically
//
// The layout re-renders on terminal resize. Ink 6.8 has no `useWindowDimensions`
// export, so `useTerminalDimensions` below reads the same facts from the stdout
// stream Ink renders to and subscribes to its `resize` event — the supported
// equivalent in this Ink version.
// ---------------------------------------------------------------------------

/** Narrowest terminal that still gets the six-column side-by-side layout. */
export const WIDE_LAYOUT_MIN_COLUMNS = 100;

/** Terminal size assumed when the stream reports none (pipes, CI). */
export const FALLBACK_COLUMNS = 80;
export const FALLBACK_ROWS = 24;

/** Narrowest a single lane column is allowed to get in the wide layout. */
export const MIN_LANE_WIDTH = 12;

/** Rendered height of one MissionCard, including its trailing blank line. */
const CARD_LINES = 6;

/** Terminal rows consumed by chrome (top bar, headers, command log, footer). */
const WIDE_CHROME_ROWS = 12;
const NARROW_CHROME_ROWS = 8;

export type LayoutMode = 'wide' | 'narrow';

/** Select the layout for a terminal width. The breakpoint itself is narrow. */
export function selectLayoutMode(columns: number): LayoutMode {
  return columns >= WIDE_LAYOUT_MIN_COLUMNS ? 'wide' : 'narrow';
}

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

function readDimensions(stdout: NodeJS.WriteStream | undefined): TerminalDimensions {
  return {
    columns: stdout?.columns ?? FALLBACK_COLUMNS,
    rows: stdout?.rows ?? FALLBACK_ROWS,
  };
}

/**
 * Current terminal size, updated whenever the output stream reports a resize.
 *
 * Ink's own renderer listens to the same `resize` event and recomputes layout,
 * so a resize produces exactly one re-rendered frame rather than a second,
 * stale frame appended below the first.
 */
export function useTerminalDimensions(): TerminalDimensions {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = React.useState<TerminalDimensions>(() => readDimensions(stdout));

  React.useEffect(() => {
    if (!stdout || typeof stdout.on !== 'function') {
      return;
    }
    const onResize = (): void => {
      setDimensions((previous) => {
        const next = readDimensions(stdout);
        // Returning the previous object keeps a no-op resize from re-rendering.
        return next.columns === previous.columns && next.rows === previous.rows
          ? previous
          : next;
      });
    };
    stdout.on('resize', onResize);
    // The stream may have resized between first render and this subscription.
    onResize();
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return dimensions;
}

/** Width available to one lane column, given the whole board's width. */
export function laneWidth(mode: LayoutMode, boardColumns: number): number {
  if (mode === 'narrow') {
    return Math.max(MIN_LANE_WIDTH, boardColumns - 2);
  }
  return Math.max(MIN_LANE_WIDTH, Math.floor(boardColumns / BOARD_LANES.length) - 2);
}

/**
 * Cards a lane may render before the "+N more" indicator takes over, so that a
 * busy lane cannot push the board past the terminal's height.
 */
export function visibleCardsForHeight(mode: LayoutMode, rows: number): number {
  const chrome = mode === 'wide' ? WIDE_CHROME_ROWS : NARROW_CHROME_ROWS;
  const available = Math.floor((rows - chrome) / CARD_LINES);
  return Math.min(DEFAULT_VISIBLE_CARDS, Math.max(1, available));
}

function stageFor(projection: BoardProjection, lane: BoardLane): BoardStage {
  return projection.stages.find((stage) => stage.lane === lane) ?? { lane, cards: [], count: 0 };
}

function wipCountFor(projection: BoardProjection, lane: BoardLane): number {
  return projection.wipCounts.find((entry) => entry.lane === lane)?.count ?? 0;
}

export interface BoardLayoutProps {
  readonly projection: BoardProjection;
  /** Board width. Defaults to the live terminal width. */
  readonly columns?: number;
  /** Board height. Defaults to the live terminal height. */
  readonly rows?: number;
  /**
   * Layout mode override. A caller that reserves part of the terminal for its
   * own chrome selects the mode from the *terminal* width and passes only the
   * remaining width as `columns`; without this the board would re-decide the
   * mode from its own smaller width.
   */
  readonly mode?: LayoutMode;
}

/**
 * BoardLayout — the six lanes of a BoardProjection, arranged for the terminal.
 *
 * `columns`/`rows` exist so a caller (and the layout tests) can drive an exact
 * terminal size; when omitted the live dimensions are used.
 */
export function BoardLayout({ projection, columns, rows, mode: modeOverride }: BoardLayoutProps): React.ReactElement {
  const detected = useTerminalDimensions();
  const width = columns ?? detected.columns;
  const height = rows ?? detected.rows;
  const mode = modeOverride ?? selectLayoutMode(width);
  const columnWidth = laneWidth(mode, width);
  const maxVisibleCards = visibleCardsForHeight(mode, height);

  return (
    <Box flexDirection={mode === 'wide' ? 'row' : 'column'} flexGrow={1}>
      {BOARD_LANES.map((lane) => (
        <Box
          key={lane}
          flexDirection="column"
          flexBasis={mode === 'wide' ? 0 : undefined}
          flexGrow={mode === 'wide' ? 1 : 0}
          marginRight={mode === 'wide' ? 1 : 0}
          marginBottom={mode === 'wide' ? 0 : 1}
        >
          <LaneColumn
            stage={stageFor(projection, lane)}
            count={wipCountFor(projection, lane)}
            width={columnWidth}
            maxVisibleCards={maxVisibleCards}
          />
        </Box>
      ))}
    </Box>
  );
}
