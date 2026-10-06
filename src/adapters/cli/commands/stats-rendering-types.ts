/** Declared row and report models for stats rendering. */
import type { StatsRow } from '../../../application/services/statistics-row.js';

export type ReportRow = StatsRow & { reportedImplementer?: string };
export type DateWindow = { start: Date; end: Date };
export interface MissionGroupOptions {
  completedOnly?: boolean;
  completedMissionKeys?: ReadonlySet<string>;
  completedMissionOwners?: ReadonlyMap<string, string | null>;
}
export interface AgentWindowOptions extends MissionGroupOptions {
  rootDir?: string | null;
  deriveFixRoundsFn?: ((_mission: string | undefined, _rootDir: string, _repo: string | undefined) => string | number | null | undefined) | null;
}
export interface MissionStats {
  implementer: string; missions: number; averageFixRounds: string | null; prFixObservationCount: number;
}

