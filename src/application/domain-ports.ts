import type { AgentSelectionSnapshot } from '../domain/agents.js';
import type { Mission, MissionId } from '../domain/mission.js';

export type MissionVersion = number & { readonly __brand: 'MissionVersion' };

export function missionVersion(value: number): MissionVersion {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid Mission version: ${value}`);
  }
  return value as MissionVersion;
}

export type MissionLoadResult =
  | { readonly kind: 'found'; readonly mission: Mission; readonly version: MissionVersion }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Persistence ports belong to the application layer; the domain stays store-agnostic. */
export interface MissionStore {
  load(_id: MissionId): Promise<MissionLoadResult>;
  /**
   * Insert when expectedVersion is null, otherwise compare-and-swap the exact
   * aggregate revision returned by load().
   */
  save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion>;
}

export interface AgentSelectionSnapshotPort {
  load(): Promise<AgentSelectionSnapshot>;
}
