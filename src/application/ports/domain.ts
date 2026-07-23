import type { AgentSelectionSnapshot } from '../../domain/agents.js';
import type { Mission, MissionId, MissionStatus } from '../../domain/mission.js';

export type MissionLoadResult =
  | { readonly kind: 'found'; readonly mission: Mission }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Persistence ports belong to the application layer; the domain stays store-agnostic. */
export interface MissionStore {
  load(_id: MissionId): Promise<MissionLoadResult>;
  save(_mission: Mission, _expectedStatus: MissionStatus): Promise<void>;
}

export interface AgentSelectionSnapshotPort {
  load(): Promise<AgentSelectionSnapshot>;
}
