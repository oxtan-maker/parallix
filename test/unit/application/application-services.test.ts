import type { StatsBackfillPort } from '../../../src/application/ports.js';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const StatsBackfillServiceModule = mockModule<typeof import('../../../src/application/stats-backfill-service.js')>('../../../src/application/stats-backfill-service.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { StatsBackfillService } = StatsBackfillServiceModule;
function strictStatsPort(overrides: Partial<StatsBackfillPort> = {}) {
  const calls: string[] = [];
  const port: StatsBackfillPort = {
    async readProjection() { calls.push('readProjection'); return { rows: [{ mission: 'task-1', implementer: 'codex', date: '', repo: '', classification: '', pr_fix_rounds: '', sources: { date: '', classification: '', implementer: '' } }], sources: [{ source: 'stats', status: 'fresh', value: 'now' }] }; },
    async applyProjection(projection) { calls.push(`applyProjection:${projection.rows.length}`); return [{ id: 'stats-1', source: 'stats', detail: 'wrote evidence' }]; },
    ...overrides,
  };
  return { port, calls };
}

test('stats service reads a source-labelled projection without mutation in query mode', async () => {
  const { port, calls } = strictStatsPort();
  const events: unknown[] = [];
  const result = await new StatsBackfillService(port, event => events.push(event)).execute({ operationId: 'stats-1', apply: false, capabilities: new Set() });
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['readProjection']);
  assert.equal(events.length, 1);
});

test('stats service rejects apply capability before any mutation-port call', async () => {
  const { port, calls } = strictStatsPort();
  const result = await new StatsBackfillService(port).execute({ operationId: 'stats-1', apply: true, capabilities: new Set() });
  assert.equal(result.status, 'rejected');
  assert.ok(result.error);
  assert.equal(result.error.kind, 'capability');
  assert.deepEqual(calls, []);
});

test('stats service refuses apply without an isolated operator copy (TASK-2834)', async () => {
  const { port, calls } = strictStatsPort();
  const result = await new StatsBackfillService(port).execute({ operationId: 'stats-1', apply: true, capabilities: new Set(['stats:apply']) });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.kind, 'validation');
  assert.ok(result.error?.message.includes('isolated consistent database copy'));
  assert.deepEqual(calls, [], 'no port call happens before the isolation check');
});

test('stats service cancels at the safe boundary before applying rows', async () => {
  const cancellation: { requested: boolean } = { requested: false };
  const { port, calls } = strictStatsPort({ async readProjection() { calls.push('readProjection'); cancellation.requested = true; return { rows: [], sources: [] }; } });
  const result = await new StatsBackfillService(port).execute({ operationId: 'stats-1', apply: true, isolatedCopy: { databasePath: '/isolated/copy.db' },
    capabilities: new Set(['stats:apply']), cancellation });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(calls, ['readProjection']);
});
