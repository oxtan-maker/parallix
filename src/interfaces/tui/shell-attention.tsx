import React from 'react';
import { Box, Text } from 'ink';

import type { BoardProjection } from '../../application/projections/board.js';
import type { AttentionAction } from '../../application/projections/board.js';
import type { MissionCard } from '../../application/projections/mission-board.js';

import type { BoardCommandDispatcher } from '../../application/controller/board-command.js';

import { canDispatchAction } from './action-bar.js';

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
    case 'orphaned-active':
      return reason.detail || 'active mission has no live work';
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
    case 'orphaned-active': return 'yellow';
    default: return 'yellow';
  }
}

