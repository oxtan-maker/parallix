import { createExecuteMissionPorts } from '../../../src/adapters/mission/execute-mission-adapters.js';
import { StatsRecoveryAdapter } from '../../../src/adapters/mission/stats-backfill-adapter.js';

const graph = createExecuteMissionPorts('fixture-root', { missionTransitionStore: { load: async () => ({ kind: 'missing' }), save: async () => { throw new Error('Unexpected save'); }, saveWithTransition: async () => { throw new Error('Unexpected transition'); } } });
const stats = new StatsRecoveryAdapter('fixture-root');
export { graph, stats };
