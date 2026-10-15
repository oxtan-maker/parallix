import { createExecuteMissionPorts } from '../../../src/adapters/mission/execute-mission-adapters.js';
import { LegacyStatsBackfillAdapter } from '../../../src/adapters/mission/stats-backfill-adapter.js';

const graph = createExecuteMissionPorts('fixture-root', { missionTransitionStore: { load: async () => ({ kind: 'missing' }), save: async () => { throw new Error('Unexpected save'); }, saveWithTransition: async () => { throw new Error('Unexpected transition'); } } });
const stats = new LegacyStatsBackfillAdapter('fixture-root');
export { graph, stats };
