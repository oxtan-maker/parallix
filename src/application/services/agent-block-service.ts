import type { AgentBlockEntry, AgentBlocklistRepository } from '../../adapters/sqlite/ports.js';

export interface AgentBlockState {
  readonly agent: string;
  readonly eligible: boolean;
  readonly blocked: boolean;
  readonly until: string | null;
  readonly reason: string | null;
  /** The quota/limit diagnostic, represented by the persisted block reason. */
  readonly limit: string | null;
}

export function parseAgentBlockUntil(until: string): number {
  return Date.parse(until.replace(' ', 'T') + (until.includes('T') ? '' : ':00'));
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
    return this.toState(agent, await this.repository.findByAgent(agent), nowMs);
  }

  async queryAll(agents: readonly string[], nowMs = Date.now()): Promise<readonly AgentBlockState[]> {
    const entries = await this.repository.findAll();
    const byAgent = new Map(entries.map((entry) => [entry.agent.toLowerCase(), entry]));
    return agents.map((agent) => this.toState(agent, byAgent.get(agent.toLowerCase()), nowMs));
  }

  async block(agent: string, until: string, reason: string | null = null): Promise<AgentBlockState> {
    await this.repository.save({ agent, blocked: true, until, reason: reason ?? undefined });
    return this.query(agent);
  }

  async unblock(agent: string): Promise<AgentBlockState> {
    await this.repository.deleteByAgent(agent);
    return this.query(agent);
  }

  private toState(agent: string, entry: AgentBlockEntry | undefined, nowMs: number): AgentBlockState {
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
}
