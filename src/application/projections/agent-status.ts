import { blockedForMs, type AgentAvailability, type AgentFamily } from '../../domain/agents.js';
import type { MissionId } from '../../domain/mission.js';

export interface AgentAvailabilityRow {
  readonly family: AgentFamily;
  readonly available: boolean;
  readonly blockedForMs: number;
  readonly reason?: string | null;
  readonly expiresAtMs?: number | null;
  readonly limit?: string | null;
  /**
   * Missions this family is running right now, or `null` when liveness could
   * not be observed. Null means unknown and must not be shown as zero.
   */
  readonly runningSessions?: number | null;
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
  runningSessions: readonly RunningAgentSession[] | null = null,
): AgentAvailabilityRow[] {
  const runningByFamily = countByFamily(runningSessions);
  return agents.map((agent) => {
    const remaining = blockedForMs(agent.block, nowMs);
    return {
      family: agent.family,
      available: agent.launcherAvailable && remaining === 0,
      blockedForMs: remaining,
      reason: unavailableReason(agent, remaining),
      expiresAtMs: remaining > 0 && agent.block.kind === 'until' ? agent.block.untilMs : null,
      limit: remaining > 0 && agent.block.kind !== 'none' ? agent.block.reason : null,
      runningSessions: runningByFamily === null ? null : runningByFamily.get(agent.family) ?? 0,
    };
  });
}

/**
 * Running sessions that no source could attribute to a family, or `null` when
 * liveness was not observed at all. Counting them keeps the strip's total
 * honest when a `px review` or `px resolve-conflict` process cannot say which
 * family it is running.
 */
export function countUnattributedSessions(
  sessions: readonly RunningAgentSession[] | null,
): number | null {
  if (sessions === null) { return null; }
  return sessions.filter((session) => session.family === null).length;
}

/** Running sessions per family, or null when liveness was not observed. */
function countByFamily(
  sessions: readonly RunningAgentSession[] | null,
): ReadonlyMap<AgentFamily, number> | null {
  if (sessions === null) { return null; }
  const counts = new Map<AgentFamily, number>();
  for (const session of sessions) {
    if (session.family === null) { continue; }
    counts.set(session.family, (counts.get(session.family) ?? 0) + 1);
  }
  return counts;
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
