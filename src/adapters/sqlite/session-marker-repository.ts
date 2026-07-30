import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { agentFamily } from '../../domain/agents.js';
import { missionId } from '../../domain/mission.js';
import { repositoryId } from '../../domain/repository.js';
import type { RepositoryId } from '../../domain/repository.js';
import { sessionRole } from '../../domain/session.js';
import type { SessionRole } from '../../domain/session.js';
import type {
  SessionMarkerEntry,
  SessionMarkerRepository,
  SessionMarkerWrite,
} from './ports.js';

type SessionMarkerRow = {
  repository_id: unknown;
  mission_id: unknown;
  role: unknown;
  agent: unknown;
  last_launched: unknown;
  session_id: unknown;
  updated_at: unknown;
};

function decodeSessionRole(value: unknown): SessionRole {
  if (typeof value !== 'string') {
    throw new Error(`Invalid persisted session role: ${JSON.stringify(value)}`);
  }
  return sessionRole(value);
}

function decodeString(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid persisted ${column}: expected text`);
  }
  return value;
}

function decodeTimestamp(value: unknown, column: string): string {
  const timestamp = decodeString(value, column);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid persisted ${column}: ${JSON.stringify(timestamp)}`);
  }
  return timestamp;
}

function decodeSessionMarkerRow(row: SessionMarkerRow): SessionMarkerEntry {
  const persistedSessionId = row.session_id;
  if (persistedSessionId !== null && typeof persistedSessionId !== 'string') {
    throw new Error('Invalid persisted session_id: expected text or null');
  }

  return {
    repositoryId: repositoryId(decodeString(row.repository_id, 'repository_id')),
    missionId: missionId(decodeString(row.mission_id, 'mission_id')),
    role: decodeSessionRole(row.role),
    agent: agentFamily(decodeString(row.agent, 'agent')),
    lastLaunched: decodeTimestamp(row.last_launched, 'last_launched'),
    sessionId: persistedSessionId === null
      ? null
      : decodeString(persistedSessionId, 'session_id'),
    updatedAt: decodeTimestamp(row.updated_at, 'updated_at'),
  };
}

function validateWrite(entry: SessionMarkerWrite): void {
  missionId(entry.missionId);
  decodeSessionRole(entry.role);
  agentFamily(entry.agent);
  decodeTimestamp(entry.lastLaunched, 'last_launched');
  if (entry.sessionId !== null && typeof entry.sessionId !== 'string') {
    throw new Error('Invalid session_id: expected text or null');
  }
}

/**
 * SQLite-backed session marker repository.
 *
 * Implements `SessionMarkerRepository` using parameterized SQL and
 * `ON CONFLICT(repository_id, mission_id, role) DO UPDATE` for idempotent
 * repository-scoped upserts.
 *
 * Authority mapping: `database-owned-domain-state` (ADR 0053).
 * Maps to TASK-2322.02 domain concept: `SessionMarker` in `src/domain/session.ts`.
 */
export class SqliteSessionMarkerRepository implements SessionMarkerRepository {
  private db: SqliteDatabaseAdapter;
  private repositoryId: RepositoryId;

  constructor(db: SqliteDatabaseAdapter, owningRepositoryId: RepositoryId) {
    this.db = db;
    this.repositoryId = repositoryId(owningRepositoryId);
  }

  async findByMissionAndRole(
    requestedMissionId: SessionMarkerEntry['missionId'],
    role: SessionRole,
  ): Promise<SessionMarkerEntry | undefined> {
    missionId(requestedMissionId);
    decodeSessionRole(role);
    const rows = await this.db.query<SessionMarkerRow>(
      `SELECT repository_id, mission_id, role, agent, last_launched, session_id, updated_at
       FROM session_markers
       WHERE repository_id = ? AND mission_id = ? AND role = ?;`,
      [this.repositoryId, requestedMissionId, role],
    );

    if (rows.length === 0) {
      return undefined;
    }

    return decodeSessionMarkerRow(rows[0]);
  }

  async save(entry: SessionMarkerWrite): Promise<void> {
    validateWrite(entry);
    await this.db.execute(
      `INSERT INTO session_markers
         (repository_id, mission_id, role, agent, last_launched, session_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(repository_id, mission_id, role) DO UPDATE SET
         agent = excluded.agent,
         last_launched = excluded.last_launched,
         session_id = excluded.session_id,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now');`,
      [
        this.repositoryId,
        entry.missionId,
        entry.role,
        entry.agent,
        entry.lastLaunched,
        entry.sessionId ?? null,
      ],
    );
  }

  async deleteByMissionAndRole(
    requestedMissionId: SessionMarkerEntry['missionId'],
    role: SessionRole,
  ): Promise<void> {
    missionId(requestedMissionId);
    decodeSessionRole(role);
    await this.db.execute(
      `DELETE FROM session_markers
       WHERE repository_id = ? AND mission_id = ? AND role = ?;`,
      [this.repositoryId, requestedMissionId, role],
    );
  }

  async findAll(): Promise<readonly SessionMarkerEntry[]> {
    const rows = await this.db.query<SessionMarkerRow>(
      `SELECT repository_id, mission_id, role, agent, last_launched, session_id, updated_at
       FROM session_markers
       WHERE repository_id = ?
       ORDER BY mission_id ASC, role ASC`,
      [this.repositoryId],
    );

    return rows.map(decodeSessionMarkerRow);
  }

  async clear(): Promise<void> {
    await this.db.execute(
      'DELETE FROM session_markers WHERE repository_id = ?;',
      [this.repositoryId],
    );
  }
}
