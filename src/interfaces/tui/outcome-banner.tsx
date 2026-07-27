import React from 'react';
import { Box, Text } from 'ink';
import type { BoardCommandResult } from '../../application/controller/board-command.js';

export interface OutcomeBannerProps { readonly outcome: BoardCommandResult; }

const outcomePresentation = {
  completed: { icon: '✓', color: 'green' as const, label: 'COMPLETED' },
  rejected: { icon: '!', color: 'yellow' as const, label: 'REJECTED' },
  failed: { icon: '✕', color: 'red' as const, label: 'FAILED' },
  cancelled: { icon: '○', color: 'yellow' as const, label: 'CANCELLED' },
};

export function outcomeMessage(outcome: BoardCommandResult): string {
  if (outcome.status === 'completed') { return 'Command completed; re-query the board for durable state.'; }
  const evidence = outcome.durableEvidence.length > 0 ? ' Durable partial state exists; re-query the board.' : '';
  return `${outcome.error?.message ?? 'Command did not complete.'}${evidence}`;
}

export function OutcomeBanner({ outcome }: OutcomeBannerProps): React.ReactElement {
  const presentation = outcomePresentation[outcome.status];
  return (
    <Box borderStyle="single" borderColor={presentation.color} paddingX={1}>
      <Text color={presentation.color} bold>{`${presentation.icon} ${presentation.label}: `}</Text>
      <Text color={presentation.color}>{outcomeMessage(outcome)}</Text>
    </Box>
  );
}
