import React from 'react';
import { Box, Text } from 'ink';
import type { AgentAvailabilityMetric } from '../../application/projections/board.js';
import type { AgentFamily } from '../../domain/agents.js';
import type { MissionCard } from '../../application/projections/mission-board.js';

// ---------------------------------------------------------------------------
// AgentStrip — horizontal strip of agent availability entries
//
// Renders above the board (below top bar / FLOW panel). Each entry shows:
//   ● family-name  sessions:N  [countdown]
// Green dot for available, red dot for blocked.
// Session count is aggregated from card agent fields (display-only).
// ---------------------------------------------------------------------------

/** Format a countdown from milliseconds into a human-readable string. */
function formatCountdown(ms: number): string {
  if (ms === Infinity) { return '∞'; }
  if (ms === 0) { return ''; }
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) { return `${minutes}m`; }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours < 24) {
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Count active sessions for each agent family from the board's cards. */
function aggregateSessions(
  cards: readonly MissionCard[],
  families: readonly AgentFamily[],
): ReadonlyMap<AgentFamily, number> {
  const counts = new Map<AgentFamily, number>();
  for (const family of families) { counts.set(family, 0); }
  for (const card of cards) {
    if (card.agent && counts.has(card.agent)) {
      counts.set(card.agent, counts.get(card.agent)! + 1);
    }
  }
  return counts;
}

export interface AgentStripProps {
  readonly agentAvailability: readonly AgentAvailabilityMetric[];
  /** All cards on the board, used for session aggregation. */
  readonly cards: readonly MissionCard[];
}

/**
 * AgentStrip — one entry per agent family from BoardMetrics.agentAvailability.
 *
 * Each entry: [dot] family-name sessions:N [countdown]
 * Dot color: green=available, red=blocked.
 */
export function AgentStrip({ agentAvailability, cards }: AgentStripProps): React.ReactElement {
  if (agentAvailability.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text color="gray">{'agents: unavailable'}</Text>
      </Box>
    );
  }

  const families = agentAvailability.map((a) => a.family);
  const sessions = aggregateSessions(cards, families);

  return (
    <Box flexDirection="row" justifyContent="flex-start" marginBottom={1}>
      {agentAvailability.map((agent) => {
        const dotColor = agent.available ? 'green' : 'red';
        const sessionCount = sessions.get(agent.family) ?? 0;
        const countdown = !agent.available && agent.blockedForMs > 0 ? formatCountdown(agent.blockedForMs) : '';
        return (
          <Box key={agent.family} marginRight={3}>
            <Text color={dotColor}>{'●'}</Text>
            <Text color="gray">{` ${agent.family}`}</Text>
            <Text dimColor>{` sessions:${sessionCount}`}</Text>
            {countdown && <Text dimColor color="yellow">{` ${countdown}`}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
