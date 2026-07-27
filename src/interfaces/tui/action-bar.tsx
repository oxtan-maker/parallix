import React from 'react';
import { Box, Text } from 'ink';
import type { BoardCommandKind } from '../../application/controller/board-command.js';
import { isIntegratedCapability, unavailableReason } from '../../application/controller/board-command.js';
import type { MissionCard } from '../../application/projections/mission-board.js';

/** The complete, currently declared command vocabulary. Keep this local to the
 * interface so the controller contract remains the source of truth. */
export const BOARD_ACTION_KINDS: readonly BoardCommandKind[] = [
  'active:execute',
  'draft:create',
  'checkpoint:record',
  'review:submit',
  'review:act-on-findings',
  'approve:review',
  'integrate:merge',
];

export interface ActionBarProps {
  readonly mission: MissionCard | null;
  readonly selectedKind?: BoardCommandKind | null;
  readonly onSelect?: (_kind: BoardCommandKind) => void;
}

/**
 * Render command availability as diagnostic state. The sole dispatchable
 * action is determined by the application capability registry, never by UI
 * styling or a shortcut alone.
 */
export function ActionBar({ mission, selectedKind = null, onSelect }: ActionBarProps): React.ReactElement {
  if (!mission) {
    return <Text dimColor>no mission selected</Text>;
  }

  return (
    <Box flexDirection="column" borderTopColor="gray" paddingTop={1}>
      <Text bold color="cyan">ACTIONS</Text>
      {BOARD_ACTION_KINDS.map((kind) => {
        const integrated = isIntegratedCapability(kind);
        const enabled = integrated && mission.commands.some((command) => command.command === 'active' && command.enabled);
        const reason = enabled ? null : unavailableReason(kind) ?? 'Mission cannot be activated from its current state';
        const selected = selectedKind === kind;
        return (
          <Box key={kind}>
            <Text color={selected ? 'cyan' : enabled ? 'green' : 'gray'}>{selected ? '▶ ' : '  '}</Text>
            <Text color={enabled ? 'green' : 'gray'}>{enabled ? '● ' : '○ '}</Text>
            <Text color={enabled ? 'green' : 'gray'}>{kind}</Text>
            {!enabled && <Text dimColor>{` — ${reason}`}</Text>}
            {enabled && <Text dimColor> — Enter to confirm</Text>}
          </Box>
        );
      })}
      {/* This callback is deliberately reachable only for integrated commands. */}
      {onSelect && <ActionSelection onSelect={onSelect} />}
    </Box>
  );
}

function ActionSelection({ onSelect }: { readonly onSelect: (_kind: BoardCommandKind) => void }): null {
  // The shell owns keyboard input. This marker preserves a narrow component
  // API for non-keyboard embeddings without making disabled rows actionable.
  void onSelect;
  return null;
}

export function canDispatchAction(kind: BoardCommandKind, mission: MissionCard | null): boolean {
  return kind === 'active:execute'
    && isIntegratedCapability(kind)
    && Boolean(mission?.commands.some((command) => command.command === 'active' && command.enabled));
}
