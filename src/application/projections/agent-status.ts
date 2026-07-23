import { blockedForMs, type AgentAvailability, type AgentFamily } from '../../domain/agents.js';

export interface AgentAvailabilityRow {
  readonly family: AgentFamily;
  readonly available: boolean;
  readonly blockedForMs: number;
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
    };
  });
}
