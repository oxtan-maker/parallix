import React from 'react';
import { Box, Text } from 'ink';
import type { AgentAvailabilityMetric } from '../../application/projections/board.js';
import {
  describeFamilyProviderExecution,
  describeMissionActivityTotals,
  summarizeMissionActivity,
  type MissionActivity,
} from '../../application/projections/mission-activity.js';
import { formatCountdown } from '../../application/projections/agent-countdown.js';

// ---------------------------------------------------------------------------
// AgentStrip — horizontal strip of agent availability entries
//
// Follows the board design's agent family strip: one entry per known family,
//   ● family-name  [countdown ·] N providers executing  [reason]
// green dot when the family is usable, red dot when it is blocked or its
// launcher is not usable on this workstation.
//
// The per-family number is the count of confirmed provider invocations from
// the provider execution reader: zero means none were confirmed, and nothing
// is printed before a reader has run. Failed probes surface as diagnostics on
// the mission that owns them, never as another family's count.
//
// Authoritative mission work — what the operations themselves published — is
// summarised separately in a leading `work:` entry, because that is the only
// source allowed to say an agent is progressing a mission. Both texts come
// from `application/projections/mission-activity.ts`, the same module
// `px status` renders from.
// ---------------------------------------------------------------------------

/**
 * Display-boundary guard for task-2408: a persisted agent-block reason can be
 * the internal quota-matching regex source, e.g. `parsed: (?:\b429\b...)`.
 * That is an implementation detail, not operator state, so it is never
 * rendered verbatim. The `parsed:` payload form is replaced with the same
 * neutral vocabulary the fallback block reason already uses; every other
 * (human-written) launcher or block reason passes through unchanged.
 */
function displayBlockReason(reason: string | null | undefined): string | null {
  if (!reason) { return null; }
  if (reason.startsWith('parsed: ')) { return 'usage limit reached'; }
  return reason;
}

export interface AgentStripProps {
  readonly agentAvailability: readonly AgentAvailabilityMetric[];
  /**
   * Authoritative activity for every mission on the board, summarised into the
   * leading `work:` entry. Omitted when no board projection is available; an
   * empty array simply produces no entry.
   */
  readonly missionActivity?: readonly MissionActivity[];
}

/**
 * AgentStrip — one entry per agent family from BoardMetrics.agentAvailability.
 *
 * Each entry: [dot] family-name [countdown ·] N providers executing [reason]
 * Dot color: green=available, red=blocked or launcher unavailable.
 */
export function AgentStrip({ agentAvailability, missionActivity }: AgentStripProps): React.ReactElement {
  const workSummary = missionActivity === undefined
    ? null
    : describeMissionActivityTotals(summarizeMissionActivity(missionActivity));

  if (agentAvailability.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text color="gray">{'agents: unavailable'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" justifyContent="flex-start" marginBottom={1}>
      {workSummary !== null && (
        <Box marginRight={3}>
          <Text dimColor>{workSummary}</Text>
        </Box>
      )}
      {agentAvailability.map((agent) => {
        const dotColor = agent.available ? 'green' : 'red';
        const countdown = !agent.available && agent.blockedForMs > 0 ? formatCountdown(agent.blockedForMs) : '';
        const reason = agent.available ? '' : displayBlockReason(agent.reason);
        const executing = describeFamilyProviderExecution(agent.runningSessions);
        return (
          <Box key={agent.family} marginRight={3}>
            <Text color={dotColor}>{'●'}</Text>
            <Text color="gray">{` ${agent.family}`}</Text>
            {countdown && <Text dimColor color="yellow">{` ${countdown} ·`}</Text>}
            {executing !== null && <Text dimColor>{` ${executing}`}</Text>}
            {reason && <Text dimColor color="red">{` ${reason}`}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
