import React from 'react';
import { Box, Text } from 'ink';
import type { BoardCommandKind } from '../../application/controller/board-command.js';

export interface ConfirmationDialogProps {
  readonly kind: BoardCommandKind;
  readonly missionId: string;
}

/** Exact command text is informational; Enter is still required to dispatch. */
export function applicationCommandText(kind: BoardCommandKind, missionId: string): string {
  if (kind === 'review:submit') { return `px review ${missionId}`; }
  if (kind === 'integrate:merge') { return `px integrate ${missionId}`; }
  if (kind === 'mission:cancel') { return `px cancel ${missionId} --yes`; }
  return `px active ${missionId}`;
}

/**
 * Cancellation destroys rows rather than moving a lane, so it does not accept
 * the Enter every other confirmation takes: a reflexive Enter on the wrong card
 * cannot delete a mission.
 */
export function ConfirmationDialog({ kind, missionId }: ConfirmationDialogProps): React.ReactElement {
  if (kind === 'mission:cancel') {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
        <Text bold color="red">CONFIRM DESTRUCTIVE CANCELLATION</Text>
        <Text>{applicationCommandText(kind, missionId)}</Text>
        <Text color="gray">{`Deletes ${missionId} lifecycle rows for good. Usage statistics are kept; the branch and worktree stay for you to remove.`}</Text>
        <Text color="gray">Shift+X again: delete · Escape: dismiss (Enter does nothing)</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">CONFIRM CONSEQUENTIAL ACTION</Text>
      <Text>{applicationCommandText(kind, missionId)}</Text>
      <Text color="gray">Enter: confirm · Escape: cancel</Text>
    </Box>
  );
}
