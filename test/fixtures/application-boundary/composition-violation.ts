import { LegacyActiveAdapter } from '../../../lib/adapters/legacy-active-adapter.js';
import { LegacyStatsBackfillAdapter } from '../../../lib/adapters/legacy-stats-backfill-adapter.js';

const graph = new LegacyActiveAdapter('fixture-root');
const stats = new LegacyStatsBackfillAdapter('fixture-root');
export { graph, stats };
