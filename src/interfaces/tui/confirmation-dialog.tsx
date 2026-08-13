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
  return `px active ${missionId}`;
}

export function ConfirmationDialog({ kind, missionId }: ConfirmationDialogProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">CONFIRM CONSEQUENTIAL ACTION</Text>
      <Text>{applicationCommandText(kind, missionId)}</Text>
      <Text color="gray">Enter: confirm · Escape: cancel</Text>
    </Box>
  );
}
