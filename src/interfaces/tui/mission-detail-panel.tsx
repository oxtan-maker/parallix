import React from 'react';
import { Box, Text } from 'ink';
import type { MissionDetail } from '../../application/projections/mission-detail.js';

export interface MissionDetailPanelProps {
  readonly detail: MissionDetail | null;
  readonly sourceState: 'current' | 'stale' | 'unavailable';
}

/** Renders only the shared application detail projection supplied by the shell. */
export function MissionDetailPanel({ detail, sourceState }: MissionDetailPanelProps): React.ReactElement {
  if (sourceState !== 'current') {
    return <Text color="yellow">detail unavailable: source is {sourceState}</Text>;
  }
  if (!detail) {
    return <Text color="yellow">detail unavailable: no projection for selection</Text>;
  }
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>MISSION DETAIL · {detail.id}</Text>
      <Text>checkpoints: {String(detail.checkpoints.length)}</Text>
      <Text>review: {detail.review ? `${detail.review.status} (round ${detail.review.round})` : 'unavailable'}</Text>
      <Text>NEL: {detail.netEngineeringLines === null ? 'unavailable' : String(detail.netEngineeringLines)}</Text>
    </Box>
  );
}
