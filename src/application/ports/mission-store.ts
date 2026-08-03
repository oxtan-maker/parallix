import type { AgentFamily } from '../../domain/agents.js';
import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { SessionRole } from '../../domain/session.js';

export interface SessionMarkerEntry {
  readonly repositoryId: RepositoryId;
  readonly missionId: MissionId;
  readonly role: SessionRole;
  readonly agent: AgentFamily;
  readonly lastLaunched: string;
  readonly sessionId: string | null;
  readonly updatedAt: string;
}

export type SessionMarkerWrite = Omit<SessionMarkerEntry, 'repositoryId' | 'updatedAt'>;

export interface SessionMarkerRepository {
  findByMissionAndRole(_missionId: MissionId, _role: SessionRole): Promise<SessionMarkerEntry | undefined>;
  save(_entry: SessionMarkerWrite): Promise<void>;
  deleteByMissionAndRole(_missionId: MissionId, _role: SessionRole): Promise<void>;
  findAll(): Promise<readonly SessionMarkerEntry[]>;
  clear(): Promise<void>;
}
