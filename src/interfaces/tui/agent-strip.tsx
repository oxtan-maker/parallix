import React from 'react';
import { Box, Text } from 'ink';
import type { AgentAvailabilityMetric } from '../../application/projections/board.js';
import {
  describeFamilyCoordinatorEvidence,
  describeMissionActivityTotals,
  summarizeMissionActivity,
  type MissionActivity,
} from '../../application/projections/mission-activity.js';

// ---------------------------------------------------------------------------
// AgentStrip — horizontal strip of agent availability entries
//
// Follows the board design's agent family strip: one entry per known family,
//   ● family-name  [countdown ·] N px cmd live  [reason]
// green dot when the family is usable, red dot when it is blocked or its
// launcher is not usable on this workstation.
//
// The per-family number counts live `px` *processes* observed in the process
// table (see `detectRunningMissionSessions`), not agents: a coordinator spends
// whole phases in git, gates, and file writes with no agent at the keyboard.
// The strip therefore says `N px cmd live`, never `N running`. When liveness
// cannot be observed the entry says `px cmd unknown` — an unobserved count is
// never rendered as zero. A process that cannot be attributed to a family is
// shown in a trailing `N px cmd live · family unknown` entry rather than
// assigned to a guess.
//
// Authoritative mission work — what the operations themselves published — is
// summarised separately in a leading `work:` entry, because that is the only
// source allowed to say an agent is progressing a mission. Both texts come
// from `application/projections/mission-activity.ts`, the same module
// `px status` renders from.
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

export interface AgentStripProps {
  readonly agentAvailability: readonly AgentAvailabilityMetric[];
  /**
   * Live `px` processes no source could attribute to a family. Shown as its
   * own trailing entry so the strip's total matches what was observed: a
   * `px review` process runs the reviewer and then the act-on-review
   * implementer, and `px resolve-conflict` writes no session marker at all, so
   * neither can be claimed by a family.
   */
  readonly unattributedRunningSessions?: number | null;
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
 * Each entry: [dot] family-name [countdown ·] N px cmd live [reason]
 * Dot color: green=available, red=blocked or launcher unavailable.
 */
export function AgentStrip({ agentAvailability, unattributedRunningSessions, missionActivity }: AgentStripProps): React.ReactElement {
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
        const reason = !agent.available && agent.reason ? agent.reason : '';
        return (
          <Box key={agent.family} marginRight={3}>
            <Text color={dotColor}>{'●'}</Text>
            <Text color="gray">{` ${agent.family}`}</Text>
            {countdown && <Text dimColor color="yellow">{` ${countdown} ·`}</Text>}
            <Text dimColor>{` ${describeFamilyCoordinatorEvidence(agent.runningSessions)}`}</Text>
            {reason && <Text dimColor color="red">{` ${reason}`}</Text>}
          </Box>
        );
      })}
      {typeof unattributedRunningSessions === 'number' && unattributedRunningSessions > 0 && (
        <Box>
          <Text dimColor>{`${describeFamilyCoordinatorEvidence(unattributedRunningSessions)} · family unknown`}</Text>
        </Box>
      )}
    </Box>
  );
}
