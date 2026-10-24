import type { AgentBlockEntry, AgentBlocklistRepository } from '../ports/agent-blocklist.js';
import type { AgentBlock } from '../../domain/agents.js';

export interface AgentBlockState {
  readonly agent: string;
  readonly eligible: boolean;
  readonly blocked: boolean;
  readonly until: string | null;
  readonly reason: string | null;
  /** The quota/limit diagnostic, represented by the persisted block reason. */
  readonly limit: string | null;
}

const HOURLY_UNTIL = /^\d{4}-\d{2}-\d{2} \d{2}$/;
const ISO_UNTIL = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

/**
 * Instant of a persisted block expiry. Legacy hourly values (`YYYY-MM-DD HH`)
 * are local time; ISO date-times keep their offset and sub-hour precision.
 * Any other shape is NaN, so an active block with it stays blocked rather than
 * relying on the engine's lenient fallback date parser.
 */
function parseAgentBlockUntil(until: string): number {
  if (HOURLY_UNTIL.test(until)) { return Date.parse(until.replace(' ', 'T') + ':00'); }
  return ISO_UNTIL.test(until) ? Date.parse(until.replace(' ', 'T')) : NaN;
}

/**
 * The one interpretation of a persisted block row at a given instant. Only an
 * active row blocks; it stops blocking exactly at a parseable expiry, while an
 * unparseable expiry keeps the conservative blocked result.
 */
export function agentBlockState(agent: string, entry: AgentBlockEntry | undefined, nowMs: number): AgentBlockState {
  const untilMs = entry?.until ? parseAgentBlockUntil(entry.until) : NaN;
  const expired = Number.isFinite(untilMs) && untilMs <= nowMs;
  const blocked = Boolean(entry?.blocked) && !expired;
  return {
    agent,
    eligible: !blocked,
    blocked,
    until: blocked ? entry?.until ?? null : null,
    reason: blocked ? entry?.reason ?? null : null,
    limit: blocked ? entry?.reason ?? null : null,
  };
}

/** Domain block for an interpreted state; an unparseable expiry stays blocked without inventing an instant. */
export function agentBlockOf(state: AgentBlockState): AgentBlock {
  if (!state.blocked) { return { kind: 'none' }; }
  const untilMs = state.until ? parseAgentBlockUntil(state.until) : NaN;
  return Number.isFinite(untilMs) ? { kind: 'until', untilMs, reason: state.reason } : { kind: 'indefinite', reason: state.reason };
}

/**
 * Application boundary for AgentBlock state.
 *
 * Repository errors intentionally propagate: callers must report a failed
 * checked-state operation rather than consulting a compatibility file.
 */
export class AgentBlockService {
  private readonly repository: AgentBlocklistRepository;

  constructor(repository: AgentBlocklistRepository) {
    this.repository = repository;
  }

  async query(agent: string, nowMs = Date.now()): Promise<AgentBlockState> {
    return agentBlockState(agent, await this.repository.findByAgent(agent), nowMs);
  }

  async queryAll(agents: readonly string[], nowMs = Date.now()): Promise<readonly AgentBlockState[]> {
    const entries = await this.repository.findAll();
    const byAgent = new Map(entries.map((entry) => [entry.agent.toLowerCase(), entry]));
    return agents.map((agent) => agentBlockState(agent, byAgent.get(agent.toLowerCase()), nowMs));
  }

  async block(agent: string, until: string, reason: string | null = null): Promise<AgentBlockState> {
    await this.repository.save({ agent, blocked: true, until, reason: reason ?? undefined });
    return this.query(agent);
  }

  async unblock(agent: string): Promise<AgentBlockState> {
    await this.repository.deleteByAgent(agent);
    return this.query(agent);
  }
}
