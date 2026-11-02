import { blockedForMs, type AgentAvailability, type AgentFamily } from '../../domain/agents.js';
import type { MissionId } from '../../domain/mission.js';

export interface AgentAvailabilityRow {
  readonly family: AgentFamily;
  readonly available: boolean;
  readonly blockedForMs: number;
  readonly reason?: string | null;
  readonly expiresAtMs?: number | null;
  readonly limit?: string | null;
}

/** One mission whose agent is running right now, and the family running it. */
export interface RunningAgentSession {
  readonly missionId: MissionId;
  /** Null when the session cannot be attributed to a family. */
  readonly family: AgentFamily | null;
}

export function projectAgentAvailability(
  agents: readonly AgentAvailability[],
  nowMs: number,
): AgentAvailabilityRow[] {
  return agents.map((agent) => {
    const remaining = blockedForMs(agent.block, nowMs);
    return {
      family: agent.family,
      available: agent.launcherAvailable && remaining === 0,
      blockedForMs: remaining,
      reason: unavailableReason(agent, remaining),
      expiresAtMs: remaining > 0 && agent.block.kind === 'until' ? agent.block.untilMs : null,
      limit: remaining > 0 && agent.block.kind !== 'none' ? agent.block.reason : null,
    };
  });
}

/**
 * Why a family is unavailable right now: an active block explains itself,
 * otherwise a failed launcher probe does. Available families carry no reason —
 * a block whose `until` has elapsed is past state and leaves nothing behind.
 */
function unavailableReason(agent: AgentAvailability, remainingMs: number): string | null {
  if (remainingMs > 0) { return agent.block.kind === 'none' ? null : agent.block.reason; }
  if (!agent.launcherAvailable) { return agent.launcherDetail ?? 'launcher unavailable'; }
  return null;
}
