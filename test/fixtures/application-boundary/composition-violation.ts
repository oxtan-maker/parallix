import { createExecuteMissionPorts } from '../../../src/platform/runtime/lib/adapters/execute-mission-adapters.js';
import { LegacyStatsBackfillAdapter } from '../../../src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.js';

const graph = createExecuteMissionPorts('fixture-root', { missionTransitionStore: null as never });
const stats = new LegacyStatsBackfillAdapter('fixture-root');
export { graph, stats };
