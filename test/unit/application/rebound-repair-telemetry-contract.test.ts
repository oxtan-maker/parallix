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

test('TASK-2653: a first-attempt pass records one fresh rescue row with agent, provider and model', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  await rebound(gateReason, contextFor(() => ({ ok: true as const }), { readHead: () => 'abc' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventType, REBOUND_REPAIR_EVENT);
  const data = JSON.parse(rows[0].eventData);
  assert.deepEqual(
    { ...data, occurrenceId: typeof data.occurrenceId, durationMs: typeof data.durationMs },
    {
      occurrenceId: 'string', missionId: 'task-2653', repositoryId: 'repo-1', reasonKind: 'gate-failure', area: 'static-analysis',
      attempt: 1, maxAttempts: 2, strategy: 'fresh-diagnostic', context: 'fresh', role: 'implementer', agent: 'codex', provider: 'openai', model: 'gpt-x',
      fingerprintBefore: data.fingerprintBefore, fingerprintAfter: data.fingerprintBefore, headBefore: 'abc', headAfter: 'abc',
      outcome: 'rescue', durationMs: 'number',
    },
  );
});

test('TASK-2653: fresh advance then fresh rescue share one occurrence with fresh strategy and context on both attempts', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  const results = [{ ok: false, diagnostic: 'still failing' }, { ok: true }];
  await rebound(gateReason, contextFor(() => results.shift()!));
  const [first, second] = rows.map((row) => JSON.parse(row.eventData));
  assert.equal(rows.length, 2);
  assert.equal(first.occurrenceId, second.occurrenceId);
  assert.deepEqual([first.attempt, first.strategy, first.context, first.outcome], [1, 'fresh-diagnostic', 'fresh', 'advance']);
  assert.deepEqual([second.attempt, second.strategy, second.context, second.outcome], [2, 'fresh-diagnostic', 'fresh', 'rescue']);
  assert.notEqual(first.fingerprintBefore, first.fingerprintAfter, 'a failed attempt records the fingerprint it ended on');
});

test('TASK-2653: an exhausted budget records escalate on the last attempt, one row per attempt', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  const outcome = await rebound(gateReason, contextFor(() => ({ ok: false as const, diagnostic: 'nope' })));
  assert.equal(outcome.outcome, 'exhausted');
  assert.deepEqual(rows.map((row) => JSON.parse(row.eventData).outcome), ['advance', 'escalate']);
});

test('TASK-2653: a failing history append is logged and does not change the rebound outcome', async () => {
  const logs: string[] = [];
  bind(async () => { throw new Error('db locked'); });
  const outcome = await rebound(gateReason, contextFor(() => ({ ok: true as const }), { log: (msg) => logs.push(msg) }));
  assert.equal(outcome.outcome, 'fixed');
  assert.ok(logs.some((line) => /could not be recorded: db locked/.test(line)));
});

test('TASK-2653: a launch that exits non-zero still spends an attempt and records one row', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async (entry) => { rows.push(entry); });
  const outcome = await rebound(gateReason, contextFor(() => ({ ok: true as const }), {
    startAgent: async () => ({ agent: 'codex', result: { status: 1, provider: 'openai', model: 'gpt-x' } as { status: number } }),
  }));
  assert.equal(outcome.outcome, 'exhausted');
  const data = rows.map((row) => JSON.parse(row.eventData));
  assert.deepEqual(data.map((row) => [row.attempt, row.strategy, row.outcome]), [[1, 'fresh-diagnostic', 'advance'], [2, 'fresh-diagnostic', 'escalate']]);
  assert.equal(data[0].fingerprintBefore, data[0].fingerprintAfter);
  assert.deepEqual(data.map((row) => [row.provider, row.model]), [['openai', 'gpt-x'], ['openai', 'gpt-x']], 'a completed non-zero run keeps its reported provider and model');
});

test('owned workflow records final recovery accounting without inferring exhaustion from escalation (TASK-2772)', async () => {
  const { configureMissionWriteAuthorization } = await import('../../../src/application/ports/mission-write-authorization.js');
  const { REBOUND_OUTCOME_EVENT } = await import('../../../src/application/rebound-telemetry.js');
  const rows: OperationalHistoryEntry[] = [];
  bind(async entry => { rows.push(entry); });
  configureMissionWriteAuthorization({ operationId: 'owned', assert: async () => {} });
  try {
    for (const [expected, verify, reason] of [
      ['fixed', () => ({ ok: true }), gateReason],
      ['exhausted', () => ({ ok: false, diagnostic: 'still failing' }), gateReason],
      ['human-only', () => ({ ok: false }), { ...gateReason, invalidContract: { command: 'verify', diagnostic: 'invalid contract', authorityReason: 'locked gate', proposedCorrection: 'operator decision' } }],
    ] as const) {
      const result = await rebound(reason, contextFor(verify));
      assert.equal(result.outcome, expected);
      const event = JSON.parse(rows.filter(row => row.eventType === REBOUND_OUTCOME_EVENT).at(-1)!.eventData);
      assert.equal(event.outcome, result.outcome);
      assert.equal(event.attempts, result.attempts);
      assert.equal(event.operationId, 'owned');
    }
  } finally { configureMissionWriteAuthorization(null); }
});

test('fresh human stop after one launch retains one attempt in dossier and telemetry (TASK-2778)', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async entry => { rows.push(entry); });
  let launches = 0;
  const outcome = await rebound(gateReason, contextFor(() => ({ ok: false, diagnostic: 'operator decision',
    reason: { kind: 'declared-gate-validation', command: 'verify', diagnostic: 'operator decision' } }), {
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
  }));
  assert.equal(launches, 1);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.outcome, 'human-only');
  assert.equal(outcome.attemptsDetail?.length, 1);
  assert.match(outcome.dossier!, /Stage: declared-gate-validation/);
  assert.match(outcome.dossier!, /Attempt 1:/);
  assert.doesNotMatch(outcome.dossier!, /Attempt 2:/);
  const data = JSON.parse(rows[0].eventData);
  assert.equal(data.attempt, 1);
  assert.equal(data.outcome, 'escalate');
});

test('repaired gate followed by structured conflict routes semantic resolver and reports current stop (TASK-2778)', async () => {
  const prompts: string[] = [];
  let checks = 0;
  const conflict: ReboundReason = { kind: 'rebase-conflict', files: ['shared.ts'], diagnostic: 'shared.ts needs semantic resolution' };
  const result = await rebound(gateReason, contextFor(() => ++checks === 1
    ? { ok: false, reason: conflict, diagnostic: conflict.diagnostic }
    : { ok: true }, {
    startAgent: async (_step, options) => { prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : String(options.prompt)); return { agent: 'codex', result: { status: 0 } }; },
  }));
  assert.equal(result.outcome, 'fixed');
  assert.equal(result.attempts, 2);
  assert.match(prompts[1], /REBASE CONFLICT/);
  assert.match(prompts[1], /Review shared conflicts semantically/);
  assert.notEqual(result.classification.failureClass, 'InfraBlocker');
});

test('reviewer output telemetry names the actual reviewer and fallback (px-0017)', async () => {
  const rows: OperationalHistoryEntry[] = [];
  bind(async entry => { rows.push(entry); });
  await rebound({ kind: 'agent-timeout', role: 'reviewer', diagnostic: 'missing verdict' }, contextFor(() => ({ ok: true }), {
    implementer: 'claude', role: 'reviewer',
    startAgent: async () => ({ agent: 'custom', result: { status: 0 } }),
    applyAgentFallback: ({ launchResult }) => launchResult?.agent ?? 'claude',
  }));
  const data = JSON.parse(rows[0].eventData);
  assert.equal(data.role, 'reviewer');
  assert.equal(data.agent, 'custom');
});
