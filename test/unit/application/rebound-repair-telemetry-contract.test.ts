/**
 * Durable rebound repair telemetry contract (TASK-2653).
 *
 * Boundary: the record the kernel hands to the composition-bound sink for each
 * completed repair attempt. Split from the kernel contract suite, which is near
 * its size cap. Mock-only: a port double stands in for operational history.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { rebound, type ReboundContext, type ReboundReason } from '../../../src/application/rebound-kernel.js';
import { configureReboundTelemetry, REBOUND_REPAIR_EVENT } from '../../../src/application/rebound-telemetry.js';
import type { OperationalHistoryEntry } from '../../../src/application/ports/operation-history.js';

const gateReason: ReboundReason = { kind: 'gate-failure', area: 'static-analysis', command: 'verify', exitCode: 1, stdout: 'lint error in a.ts', stderr: '' };

function bind(append: (_entry: OperationalHistoryEntry) => Promise<void>) {
  configureReboundTelemetry({ repositoryId: 'repo-1', history: { append } });
}

function contextFor(verify: ReboundContext['verify'], overrides: Partial<ReboundContext> = {}): ReboundContext {
  return {
    slug: 'task-2653',
    worktree: '',
    implementer: 'codex',
    verify,
    startAgent: async () => ({ agent: 'codex', result: { status: 0, provider: 'openai', model: 'gpt-x' } as { status: number } }),
    log: () => {},
    error: () => {},
    ...overrides,
  };
}

afterEach(() => configureReboundTelemetry(null));

test('TASK-2653: a first-attempt pass records one targeted pass row with agent, provider and model', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  await rebound(gateReason, contextFor(() => ({ ok: true }), { readHead: () => 'abc' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventType, REBOUND_REPAIR_EVENT);
  const data = JSON.parse(rows[0].eventData);
  assert.deepEqual(
    { ...data, occurrenceId: typeof data.occurrenceId, durationMs: typeof data.durationMs },
    {
      occurrenceId: 'string', missionId: 'task-2653', repositoryId: 'repo-1', reasonKind: 'gate-failure', area: 'static-analysis',
      attempt: 1, maxAttempts: 2, strategy: 'targeted', context: 'resumed', agent: 'codex', provider: 'openai', model: 'gpt-x',
      fingerprintBefore: data.fingerprintBefore, fingerprintAfter: data.fingerprintBefore, headBefore: 'abc', headAfter: 'abc',
      outcome: 'pass', durationMs: 'number',
    },
  );
});

test('TASK-2653: targeted advance then fresh rescue share one occurrence and differ by attempt, strategy and context', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  const results = [{ ok: false, diagnostic: 'still failing' }, { ok: true }];
  await rebound(gateReason, contextFor(() => results.shift()!));
  const [first, second] = rows.map((row) => JSON.parse(row.eventData));
  assert.equal(rows.length, 2);
  assert.equal(first.occurrenceId, second.occurrenceId);
  assert.deepEqual([first.attempt, first.strategy, first.context, first.outcome], [1, 'targeted', 'resumed', 'advance']);
  assert.deepEqual([second.attempt, second.strategy, second.context, second.outcome], [2, 'fresh-diagnostic', 'fresh', 'rescue']);
  assert.notEqual(first.fingerprintBefore, first.fingerprintAfter, 'a failed attempt records the fingerprint it ended on');
});

test('TASK-2653: an exhausted budget records escalate on the last attempt, one row per attempt', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  const outcome = await rebound(gateReason, contextFor(() => ({ ok: false, diagnostic: 'nope' })));
  assert.equal(outcome.outcome, 'exhausted');
  assert.deepEqual(rows.map((row) => JSON.parse(row.eventData).outcome), ['advance', 'escalate']);
});

test('TASK-2653: a failing history append is logged and does not change the rebound outcome', async () => {
  const logs: string[] = [];
  bind(async () => { throw new Error('db locked'); });
  const outcome = await rebound(gateReason, contextFor(() => ({ ok: true }), { log: (msg) => logs.push(msg) }));
  assert.equal(outcome.outcome, 'fixed');
  assert.ok(logs.some((line) => /could not be recorded: db locked/.test(line)));
});

test('TASK-2653: a launch that exits non-zero still spends an attempt and records one row', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  const outcome = await rebound(gateReason, contextFor(() => ({ ok: true }), {
    startAgent: async () => ({ agent: 'codex', result: { status: 1, provider: 'openai', model: 'gpt-x' } as { status: number } }),
  }));
  assert.equal(outcome.outcome, 'exhausted');
  const data = rows.map((row) => JSON.parse(row.eventData));
  assert.deepEqual(data.map((row) => [row.attempt, row.strategy, row.outcome]), [[1, 'targeted', 'advance'], [2, 'fresh-diagnostic', 'escalate']]);
  assert.equal(data[0].fingerprintBefore, data[0].fingerprintAfter);
  assert.deepEqual(data.map((row) => [row.provider, row.model]), [['openai', 'gpt-x'], ['openai', 'gpt-x']], 'a completed non-zero run keeps its reported provider and model');
});
