import { ActiveService } from '../application/active-service.js';
import { StatsBackfillService } from '../application/stats-backfill-service.js';
import { LegacyActiveAdapter } from '../adapters/legacy-active-adapter.js';
import { LegacyStatsBackfillAdapter } from '../adapters/legacy-stats-backfill-adapter.js';

export interface ProductionApplicationServices {
  readonly active: ActiveService;
  readonly statsBackfill: StatsBackfillService;
}

// This is the sole production construction point for the complete concrete graph.
export function createProductionApplicationServices(rootDir: string): ProductionApplicationServices {
  return {
    active: new ActiveService(new LegacyActiveAdapter(rootDir)),
    statsBackfill: new StatsBackfillService(new LegacyStatsBackfillAdapter(rootDir)),
  };
}
