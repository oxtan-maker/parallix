import type { AgentFamily } from '../../domain/agents.js';
import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { SessionMarker, SessionRole } from '../../domain/session.js';
import { shouldResume as domainShouldResume } from '../../domain/session.js';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteSessionMarkerRepository } from './session-marker-repository.js';

/**
 * Concrete `SessionMarkerPort` backed by the SQLite `session_markers` table.
 *
 * Bridges the domain `SessionMarker` type to `SessionMarkerEntry` in the
 * adapter layer. Uses `SqliteSessionMarkerRepository` for all storage
 * operations.
 *
 * Authority: `database-owned-domain-state` (ADR 0053).
 */
export class SqliteSessionMarkerAdapter implements SessionMarkerPort {
  private repo: SqliteSessionMarkerRepository;

  constructor(db: SqliteDatabaseAdapter, repositoryId: RepositoryId) {
    this.repo = new SqliteSessionMarkerRepository(db, repositoryId);
  }

  async find(missionId: MissionId, role: SessionRole): Promise<SessionMarker | null> {
    const entry = await this.repo.findByMissionAndRole(missionId, role);
    if (entry === undefined) {
      return null;
    }
    return {
      missionId: entry.missionId,
      role: entry.role,
      agent: entry.agent,
      lastLaunched: entry.lastLaunched,
      sessionId: entry.sessionId,
    };
  }

  async save(marker: SessionMarker): Promise<void> {
    await this.repo.save({
      missionId: marker.missionId,
      role: marker.role,
      agent: marker.agent,
      lastLaunched: marker.lastLaunched,
      sessionId: marker.sessionId,
    });
  }

  async delete(missionId: MissionId, role: SessionRole): Promise<void> {
    await this.repo.deleteByMissionAndRole(missionId, role);
  }

  async shouldResume(missionId: MissionId, role: SessionRole, agent: AgentFamily): Promise<boolean> {
    const marker = await this.find(missionId, role);
    return domainShouldResume(marker, missionId, role, agent);
  }
}
