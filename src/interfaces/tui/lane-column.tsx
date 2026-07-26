import React from 'react';
import { Box, Text } from 'ink';
import type { BoardStage } from '../../application/projections/board.js';
import type { BoardLane } from '../../application/projections/mission-board.js';
import { MissionCard, DEFAULT_CARD_WIDTH } from './mission-card.js';

// ---------------------------------------------------------------------------
// LaneColumn — one board lane: header, MissionCard rows, empty-lane message.
// ---------------------------------------------------------------------------

/** The six board lanes, in board order. */
export const BOARD_LANES: readonly BoardLane[] = [
  'backlog', 'refined', 'active', 'review', 'integration', 'done',
];

/** Column heading text per lane. */
export const LANE_LABELS: Record<BoardLane, string> = {
  backlog: 'BACKLOG',
  refined: 'REFINED',
  active: 'ACTIVE',
  review: 'REVIEW',
  integration: 'INTEGRATION',
  done: 'DONE',
};

/** Cards rendered before the overflow indicator takes over. */
export const DEFAULT_VISIBLE_CARDS = 8;

/** Message shown for a lane that holds no cards. Always names the lane. */
export function emptyLaneMessage(lane: BoardLane): string {
  return `nothing in ${lane}`;
}

export interface LaneColumnProps {
  readonly stage: BoardStage;
  /** WIP count for this lane, taken from `BoardProjection.wipCounts`. */
  readonly count: number;
  /** Content width of the column, in columns. */
  readonly width?: number;
  /** Maximum cards rendered before the "+N more" indicator. */
  readonly maxVisibleCards?: number;
  /** First card shown in this lane's view-only scrolling window. */
  readonly visibleStart?: number;
  /** The selected mission id, for focus rendering only. */
  readonly selectedMissionId?: string | null;
}

/**
 * LaneColumn — renders one `BoardStage` as a titled column.
 *
 * Overflowing lanes render the first `maxVisibleCards` cards followed by a
 * "+N more" indicator, so a long lane cannot stretch the column past the
 * height the layout gave it.
 */
export function LaneColumn({
  stage,
  count,
  width = DEFAULT_CARD_WIDTH,
  maxVisibleCards = DEFAULT_VISIBLE_CARDS,
  visibleStart = 0,
  selectedMissionId = null,
}: LaneColumnProps): React.ReactElement {
  const cards = stage.cards;
  const start = Math.max(0, Math.min(visibleStart, Math.max(0, cards.length - maxVisibleCards)));
  const visible = cards.slice(start, start + Math.max(0, maxVisibleCards));
  const hidden = cards.length - start - visible.length;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="gray">{'── '}</Text>
        <Text bold>{LANE_LABELS[stage.lane]}</Text>
        <Text color="gray">{` ${count}`}</Text>
      </Box>

      <Box flexDirection="column" paddingTop={1}>
        {cards.length === 0 ? (
          <Text dimColor>{emptyLaneMessage(stage.lane)}</Text>
        ) : (
          visible.map((card) => (
            <MissionCard key={card.id} card={card} width={width} selected={card.id === selectedMissionId} />
          ))
        )}
        {hidden > 0 && <Text dimColor>{`${start > 0 ? `↑${start} · ` : ''}+${hidden} more`}</Text>}
      </Box>
    </Box>
  );
}
