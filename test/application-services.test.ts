import test from 'node:test';
import assert from 'node:assert/strict';

const { StatsBackfillService } = require('../dist/lib/application/stats-backfill-service');
const { ActiveService } = require('../dist/lib/application/active-service');

function strictStatsPort(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const port = {
    async readProjection() { calls.push('readProjection'); return { rows: [{ mission: 'task-1', implementer: 'codex' }], sources: [{ source: 'stats', status: 'fresh', value: 'now' }] }; },
    async applyRows(rows: unknown[]) { calls.push(`applyRows:${rows.length}`); return [{ id: 'stats-1', source: 'stats', detail: 'wrote row' }]; },
    ...overrides,
  };
  return { port, calls };
}

function strictActivePort(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const port = {
    async validateSlug(slug: string) { calls.push(`validate:${slug}`); return null; },
    async launch(slug: string, agent: string) { calls.push(`launch:${slug}:${agent}`); return { agent, evidence: { id: 'agent-1', source: 'task-markdown', detail: 'agent launched' } }; },
    async recordLaunch(slug: string, agent: string) { calls.push(`record:${slug}:${agent}`); return { id: 'task-1', source: 'task-markdown', detail: 'active recorded' }; },
    async handoff(slug: string, agent: string) { calls.push(`handoff:${slug}:${agent}`); },
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
  assert.equal(result.error.kind, 'capability');
  assert.deepEqual(calls, []);
});

test('stats service cancels at the safe boundary before applying rows', async () => {
  const cancellation = { requested: false };
  const { port, calls } = strictStatsPort({ async readProjection() { calls.push('readProjection'); cancellation.requested = true; return { rows: [], sources: [] }; } });
  const result = await new StatsBackfillService(port).execute({ operationId: 'stats-1', apply: true, capabilities: new Set(['stats:apply']), cancellation });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(calls, ['readProjection']);
});

test('active service calls strict ports in launch-record-handoff order', async () => {
  const { port, calls } = strictActivePort();
  const events: any[] = [];
  const result = await new ActiveService(port, event => events.push(event)).execute({ operationId: 'active-1', slug: 'task-1', agent: 'codex', capabilities: new Set(['active:execute']) });
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['validate:task-1', 'launch:task-1:codex', 'record:task-1:codex', 'handoff:task-1:codex']);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3]);
  assert.equal(events[2].agent, 'codex');
});

test('active service rejects invalid or incapable requests before mutation ports', async () => {
  const incapable = strictActivePort();
  const capabilityResult = await new ActiveService(incapable.port).execute({ operationId: 'active-1', slug: 'task-1', agent: 'codex', capabilities: new Set() });
  assert.equal(capabilityResult.status, 'rejected');
  assert.deepEqual(incapable.calls, []);
  const invalid = strictActivePort();
  const validationResult = await new ActiveService(invalid.port).execute({ operationId: '', slug: 'task-1', agent: 'codex', capabilities: new Set(['active:execute']) });
  assert.equal(validationResult.error.kind, 'validation');
  assert.deepEqual(invalid.calls, []);
});

test('active cancellation after durable record reports partial evidence without rollback claim', async () => {
  const cancellation = { requested: false };
  const { port, calls } = strictActivePort({ async recordLaunch(slug: string, agent: string) { calls.push(`record:${slug}:${agent}`); cancellation.requested = true; return { id: 'task-1', source: 'task-markdown', detail: 'active recorded' }; } });
  const result = await new ActiveService(port).execute({ operationId: 'active-1', slug: 'task-1', agent: 'codex', capabilities: new Set(['active:execute']), cancellation });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.durableEvidence.length, 2);
  assert.deepEqual(calls, ['validate:task-1', 'launch:task-1:codex', 'record:task-1:codex']);
});

test('active adapter failure cannot produce a completed result', async () => {
  const { port } = strictActivePort({ async handoff() { throw new Error('handoff unavailable'); } });
  const result = await new ActiveService(port).execute({ operationId: 'active-1', slug: 'task-1', agent: 'codex', capabilities: new Set(['active:execute']) });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.kind, 'execution');
});
