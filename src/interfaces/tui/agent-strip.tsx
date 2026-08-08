import React from 'react';
import { Box, Text } from 'ink';
import type { AgentAvailabilityMetric } from '../../application/projections/board.js';

// ---------------------------------------------------------------------------
// AgentStrip — horizontal strip of agent availability entries
//
// Follows the board design's agent family strip: one entry per known family,
//   ● family-name  [countdown ·] N running  [reason]
// green dot when the family is usable, red dot when it is blocked or its
// launcher is not usable on this workstation.
//
// "N running" counts missions with a live agent process, observed from the
// process table (see `detectRunningMissionSessions`). When liveness cannot be
// observed the entry says `running unknown` — the strip never renders an
// unobserved count as zero, and never derives one from board cards. A session
// that runs but cannot be attributed to a family is counted in a trailing
// `N running · family unknown` entry rather than assigned to a guess.
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

/** The running-session text for one family: a count, or an honest unknown. */
function formatRunning(runningSessions: number | null | undefined): string {
  return typeof runningSessions === 'number' ? `${runningSessions} running` : 'running unknown';
}

export interface AgentStripProps {
  readonly agentAvailability: readonly AgentAvailabilityMetric[];
  /**
   * Running sessions no source could attribute to a family. Shown as its own
   * trailing entry so the strip's total matches what is actually running: a
   * `px review` process runs the reviewer and then the act-on-review
   * implementer, and `px resolve-conflict` writes no session marker at all, so
   * neither can be claimed by a family.
   */
  readonly unattributedRunningSessions?: number | null;
}

/**
 * AgentStrip — one entry per agent family from BoardMetrics.agentAvailability.
 *
 * Each entry: [dot] family-name [countdown ·] N running [reason]
 * Dot color: green=available, red=blocked or launcher unavailable.
 */
export function AgentStrip({ agentAvailability, unattributedRunningSessions }: AgentStripProps): React.ReactElement {
  if (agentAvailability.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text color="gray">{'agents: unavailable'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" justifyContent="flex-start" marginBottom={1}>
      {agentAvailability.map((agent) => {
        const dotColor = agent.available ? 'green' : 'red';
        const countdown = !agent.available && agent.blockedForMs > 0 ? formatCountdown(agent.blockedForMs) : '';
        const reason = !agent.available && agent.reason ? agent.reason : '';
        return (
          <Box key={agent.family} marginRight={3}>
            <Text color={dotColor}>{'●'}</Text>
            <Text color="gray">{` ${agent.family}`}</Text>
            {countdown && <Text dimColor color="yellow">{` ${countdown} ·`}</Text>}
            <Text dimColor>{` ${formatRunning(agent.runningSessions)}`}</Text>
            {reason && <Text dimColor color="red">{` ${reason}`}</Text>}
          </Box>
        );
      })}
      {typeof unattributedRunningSessions === 'number' && unattributedRunningSessions > 0 && (
        <Box>
          <Text dimColor>{`${unattributedRunningSessions} running · family unknown`}</Text>
        </Box>
      )}
    </Box>
  );
}
