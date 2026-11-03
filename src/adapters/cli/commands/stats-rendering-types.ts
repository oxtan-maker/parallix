/** Declared row and report models for stats rendering. */
import type { ReviewStatistics } from '../../../application/services/review-statistics.js';
import type { StatsRow } from '../../../application/services/statistics-row.js';

export type ReportRow = StatsRow & { reportedImplementer?: string };
export type DateWindow = { start: Date; end: Date };
export interface MissionGroupOptions {
  completedOnly?: boolean;
  completedMissionKeys?: ReadonlySet<string>;
  completedMissionOwners?: ReadonlyMap<string, string | null>;
}
export interface AgentWindowOptions extends MissionGroupOptions {
  readonly reviewObservations?: ReadonlyMap<string, ReviewStatistics>;
}
export interface MissionStats {
  readonly model: string | null; readonly missions: number;
  readonly measuredMissions: number; readonly reimplementationRounds: number;
}
