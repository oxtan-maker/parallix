import { createExecuteMissionPorts } from '../../../src/adapters/mission/execute-mission-adapters.js';
import { LegacyStatsBackfillAdapter } from '../../../src/adapters/mission/stats-backfill-adapter.js';

const graph = createExecuteMissionPorts('fixture-root', { missionTransitionStore: null as never });
const stats = new LegacyStatsBackfillAdapter('fixture-root');
export { graph, stats };
