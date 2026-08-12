import type { AgentBlockState } from '../../application/services/agent-block-service.js';
import { parseBlockUntil, type AgentConfig } from './agent-config.js';

function localOverride(agent: string, config: AgentConfig | null | undefined, nowMs: number): AgentBlockState | null {
  const entry = config?.blocklist?.[agent];
  if (entry === undefined) { return null; }
  const unblocked = entry === false || (entry && typeof entry === 'object' && (entry as any).blocked === false);
  if (unblocked) {
    return { agent, eligible: true, blocked: false, until: null, reason: null, limit: null };
  }
  const indefinitelyBlocked = entry === true || (entry && typeof entry === 'object' && (entry as any).blocked === true);
  if (indefinitelyBlocked) {
    return {
      agent,
      eligible: false,
      blocked: true,
      until: null,
      reason: entry && typeof entry === 'object' ? (entry as any).reason ?? null : null,
      limit: null,
    };
  }
  if (entry && typeof entry === 'object' && typeof (entry as any).until === 'string') {
    const until = (entry as any).until;
    if (parseBlockUntil(until) > nowMs) {
      return { agent, eligible: false, blocked: true, until, reason: (entry as any).reason ?? null, limit: null };
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

export { resolveAgentBlockAuthority };
