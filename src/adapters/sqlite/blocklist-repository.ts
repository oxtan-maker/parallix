import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../../application/ports/agent-blocklist.js';

/**
 * SQLite-backed agent blocklist repository.
 *
 * Implements `AgentBlocklistRepository` using parameterized SQL and
 * explicit transactions for multi-statement writes.
 *
 * Authority mapping: each stored field is owned by operator-local authority.
 * Maps to TASK-2294 domain entity: `AgentBlock` in `src/domain/agents.ts`.
 */
export class SqliteBlocklistRepository implements AgentBlocklistRepository {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  async findAll(): Promise<readonly AgentBlockEntry[]> {
    const rows = await this.db.query<{
      agent: unknown;
      blocked: unknown;
      until: unknown;
      reason: unknown;
    }>('SELECT agent, blocked, until, reason FROM agent_blocklist ORDER BY agent ASC');

    return rows.map((row) => ({
      agent: String(row.agent),
      blocked: Boolean(row.blocked),
      until: row.until ? String(row.until) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
    }));
  }

  async findByAgent(agent: string): Promise<AgentBlockEntry | undefined> {
    const rows = await this.db.query<{
      agent: unknown;
      blocked: unknown;
      until: unknown;
      reason: unknown;
    }>(
      'SELECT agent, blocked, until, reason FROM agent_blocklist WHERE agent = ?;',
      [agent],
    );

    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      agent: String(row.agent),
      blocked: Boolean(row.blocked),
      until: row.until ? String(row.until) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
    };
  }

  async save(entry: AgentBlockEntry): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_blocklist (agent, blocked, until, reason, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(agent) DO UPDATE SET
         blocked = excluded.blocked,
         until = excluded.until,
         reason = excluded.reason,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now');`,
      [entry.agent, entry.blocked ? 1 : 0, entry.until ?? null, entry.reason ?? null],
    );
  }

  async deleteByAgent(agent: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM agent_blocklist WHERE agent = ?;',
      [agent],
    );
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM agent_blocklist;');
  }
}
