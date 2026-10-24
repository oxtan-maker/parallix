import { agentBlockState, type AgentBlockState } from '../../application/services/agent-block-service.js';
import type { AgentBlockEntry } from '../../application/ports/agent-blocklist.js';
import { parseBlockUntil, type AgentConfig } from './agent-config.js';

function localOverride(agent: string, config: AgentConfig | null | undefined, nowMs: number): AgentBlockState | null {
  const entry = config?.blocklist?.[agent];
  if (entry === undefined) { return null; }
  const block = entry && typeof entry === 'object' ? entry as { blocked?: unknown; until?: unknown; reason?: string | null } : null;
  const unblocked = entry === false || block?.blocked === false;
  if (unblocked) {
    return { agent, eligible: true, blocked: false, until: null, reason: null, limit: null };
  }
  const indefinitelyBlocked = entry === true || block?.blocked === true;
  if (indefinitelyBlocked) {
    return { agent, eligible: false, blocked: true, until: null, reason: block?.reason ?? null, limit: null };
  }
  return timedOverride(agent, block, nowMs);
}

function timedOverride(agent: string, block: { until?: unknown; reason?: string | null } | null, nowMs: number): AgentBlockState | null {
  if (block && typeof block.until === 'string') {
    const until = block.until;
    if (parseBlockUntil(until) > nowMs) {
      return { agent, eligible: false, blocked: true, until, reason: block.reason ?? null, limit: null };
    }
  }

  return null;
}

/**
 * The single authority for an agent family's block decision. SQLite supplies
 * the runtime state; an explicit effective local-config entry overrides it.
 * In particular, `{ "blocked": false }` clears a runtime SQLite block.
 */
function resolveAgentBlockAuthority(
  agent: string,
  runtimeState: AgentBlockState,
  config: AgentConfig | null | undefined,
  nowMs = Date.now(),
): AgentBlockState {
  return localOverride(agent, config, nowMs) ?? runtimeState;
}

/**
 * Synchronous selection decision over once-materialized persisted rows: the
 * rows are interpreted at the current instant by the same rule as
 * AgentBlockService, then the explicit local config entry takes precedence.
 */
function isPersistedAgentBlocked(
  agent: string,
  persisted: Readonly<Record<string, AgentBlockEntry>>,
  config: AgentConfig | null | undefined,
  nowMs = Date.now(),
): boolean {
  return resolveAgentBlockAuthority(agent, agentBlockState(agent, persisted[agent.toLowerCase()], nowMs), config, nowMs).blocked;
}

export { resolveAgentBlockAuthority, isPersistedAgentBlocked };
