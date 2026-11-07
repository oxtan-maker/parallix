import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectLimitHit, formatBlockUntil, ceilToNextHour, endOfCurrentUtcMonth } from '../../../../src/application/services/agent-limit.js';
import { failureReason, type FailureReason } from '../../../../src/domain/failure-reason.js';
import { normalizeProviderFailure } from '../../../../src/adapters/process/failure-normalization.js';

const now = new Date('2026-05-01T11:15:00Z');
const diagnostic = 'Forgejo forbidden; quota exhausted; authentication failed; rate limit reached';

for (const agent of ['claude', 'codex', 'custom', 'qwen', 'mistral', 'vibe', 'unknown']) {
  test(`structured quota blocks ${agent} despite conflicting prose (TASK-2829)`, () => {
    const facts = failureReason('agent-quota', 'provider', { resetAt: '2026-05-01T15:35:00Z' });
    for (const stderr of [diagnostic, 'rewritten provider diagnostic']) {
      const hit = detectLimitHit({ agent, status: 1, stderr, failureReason: facts, now });
      assert.equal(hit?.until, formatBlockUntil(new Date('2026-05-01T16:00:00Z')));
      assert.equal(hit?.source, 'structured');
      assert.equal(hit?.reroute, undefined);
    }
  });
  test(`opaque transcript cannot block ${agent} (TASK-2829)`, () => {
    for (const status of [0, 1, null, undefined]) {
      assert.equal(detectLimitHit({ agent, status, stderr: diagnostic, now }), null);
    }
    for (const code of ['infrastructure', 'state-machine', 'provider-auth', 'resource-exhausted', 'process-failed', 'unexpected'] as const) {
      assert.equal(detectLimitHit({ agent, status: 1, stderr: diagnostic, failureReason: failureReason(code, 'provider'), now }), null);
    }
    assert.equal(detectLimitHit({ agent, status: 1, stderr: diagnostic, failureReason: { version: 99, code: 'agent-quota' }, now }), null);
    assert.equal(detectLimitHit({ agent, status: 1, stderr: diagnostic, failureReason: { version: 1, code: 'future' }, now }), null);
  });
}

test('successful launches do not persist quota blocks from quoted evidence', () => {
  assert.equal(detectLimitHit({ agent: 'claude', status: 0, failureReason: failureReason('agent-quota', 'provider'), now }), null);
  assert.equal(detectLimitHit({ agent: '', status: 1, failureReason: failureReason('agent-quota', 'provider'), now }), null);
});

test('normalized Claude rate-limit stream drives reset-aware block detection (TASK-2838)', () => {
  const stdout = fs.readFileSync(new URL('../../../fixtures/claude-quota-rejected.jsonl', import.meta.url), 'utf8');
  const normalized = normalizeProviderFailure({ status: 1, stdout });
  const hit = detectLimitHit({ agent: 'claude', status: 1, failureReason: normalized, now: new Date('2026-11-03T18:00:00Z') });

  assert.equal(hit?.source, 'structured');
  assert.equal(hit?.reason, 'typed: agent-quota');
  assert.equal(hit?.until, formatBlockUntil(ceilToNextHour(new Date('2026-11-03T20:50:00.000Z'))));
});

test('model entitlement and transient rate limit reroute without family blocks', () => {
  const entitlement = detectLimitHit({ agent: 'qwen', status: 1, failureReason: failureReason('provider-entitlement', 'provider'), now });
  assert.equal(entitlement?.reroute, true);
  assert.equal(entitlement?.kind, 'entitlement');
  assert.equal(entitlement?.until, undefined);
  const rate = detectLimitHit({ agent: 'qwen', status: 1, failureReason: failureReason('provider-rate-limit', 'provider'), now });
  assert.equal(rate?.reroute, true);
  assert.equal(rate?.until, undefined);
});

test('typed provider unavailability creates a bounded checked block (TASK-2837)', () => {
  const hit = detectLimitHit({ agent: 'claude', status: 1, failureReason: failureReason('provider-unavailable', 'provider'), now });
  assert.equal(hit?.until, formatBlockUntil(new Date('2026-05-01T13:00:00Z')));
  assert.equal(hit?.source, 'structured');
  assert.equal(hit?.reason, 'typed: provider-unavailable');
});

test('structured retry-after and fallback resets remain bounded and round upwards', () => {
  for (const context of ([{ retryAfterSeconds: 1800 }, { resetAt: '2026-05-01T11:45:00Z' }] as NonNullable<FailureReason['context']>[])) {
    assert.equal(detectLimitHit({ agent: 'claude', status: 1, now, failureReason: failureReason('agent-quota', 'provider', context) })?.until,
      formatBlockUntil(new Date('2026-05-01T12:00:00Z')));
  }
  for (const context of ([{}, { resetAt: 'invalid' }, { resetAt: '2020-01-01T00:00:00Z' }, { retryAfterSeconds: -1 }] as NonNullable<FailureReason['context']>[])) {
    assert.equal(detectLimitHit({ agent: 'claude', status: 1, now, failureReason: failureReason('agent-quota', 'provider', context) })?.until,
      formatBlockUntil(new Date('2026-05-01T13:00:00Z')));
  }
  for (const agent of ['mistral', 'vibe']) {
    const hit = detectLimitHit({ agent, status: 1, now, failureReason: failureReason('agent-quota', 'provider') });
    assert.equal(hit?.until, formatBlockUntil(endOfCurrentUtcMonth(now)));
    assert.equal(hit?.source, 'month-end');
  }
});

test('retained Claude quota reset blocks the family until the structured reset (TASK-2837)', () => {
  const failure = normalizeProviderFailure({
    status: 1,
    stdout: JSON.stringify({
      type: 'rate_limit_event',
      api_error_status: 429,
      api_error: 'usage_limit_reached',
      rate_limit_info: { status: 'rejected', resetsAt: '2026-05-01T15:35:00Z' },
      diagnostic: 'wording is not classification evidence',
    }),
  });

  const hit = detectLimitHit({ agent: 'claude', status: 1, failureReason: failure, now });
  assert.equal(hit?.until, formatBlockUntil(new Date('2026-05-01T16:00:00Z')));
  assert.equal(hit?.source, 'structured');
});

test('process termination stays independent of transcript keywords and SIGTERM stays local (TASK-2729)', () => {
  for (const signal of ['SIGINT', 'SIGKILL', 'SIGHUP']) {
    const hit = detectLimitHit({ agent: 'codex', signal, status: null, stderr: diagnostic, now, failureReason: failureReason('process-terminated', 'process') });
    assert.equal(hit?.until, formatBlockUntil(new Date('2026-05-01T12:00:00Z')));
    assert.equal(hit?.source, 'sigint');
  }
  assert.equal(detectLimitHit({ agent: 'codex', status: null, signal: 'SIGTERM', stderr: diagnostic, now }), null);
});

test('hour rounding preserves exact boundaries and carries day and year rollover', () => {
  for (const [input, expected] of [
    ['2026-05-01T11:00:00Z', '2026-05-01T11:00:00Z'],
    ['2026-05-01T11:00:01Z', '2026-05-01T12:00:00Z'],
    ['2026-12-31T23:59:59Z', '2027-01-01T00:00:00Z'],
  ]) { assert.equal(ceilToNextHour(new Date(input)).toISOString(), expected.replace('Z', '.000Z')); }
  assert.equal(endOfCurrentUtcMonth(new Date('2026-12-31T23:59:59Z')).toISOString(), '2027-01-01T00:00:00.000Z');
});
