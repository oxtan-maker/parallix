import test from 'node:test';
import assert from 'node:assert/strict';
'use strict';

import { detectLimitHit, findLimitHitMatch, PATTERN_SETS } from '../src/application/services/agent-limit.js';

test('qwen PATTERN_SETS exists with two patterns', () => {
  assert.ok(PATTERN_SETS.qwen, 'qwen pattern set exists');
  assert.equal(PATTERN_SETS.qwen.length, 2, 'two qwen patterns (quota + rate-limit)');
});

test('qwen quota pattern matches "429 Allocated quota exceeded"', () => {
  const match = findLimitHitMatch('qwen', 'Error: 429 Allocated quota exceeded');
  assert.ok(match, 'quota pattern matched');
  assert.ok(/Allocated quota exceeded/i.test(match.pattern.source));
});

test('qwen rate-limit pattern matches "429 Requests rate limit exceeded"', () => {
  const match = findLimitHitMatch('qwen', 'Error: 429 Requests rate limit exceeded');
  assert.ok(match, 'rate-limit pattern matched');
  assert.ok(/Requests rate limit exceeded/i.test(match.pattern.source));
});

test('qwen quota-exceeded: timed block with reason (parseResetTime tried first)', () => {
  const result = detectLimitHit({
    agent: 'qwen',
    stdout: '',
    stderr: 'Error: 429 Allocated quota exceeded. Your quota will reset at 2026-08-12T10:00:00+00:00.',
    status: 1,
    signal: null,
    error: null,
    now: new Date('2026-08-12T09:00:00Z'),
  });

  assert.ok(result, 'limit hit detected');
  assert.equal(result.reroute, undefined, 'quota is not a reroute');
  assert.ok(result.until, 'has until timestamp');
  assert.equal(result.source, 'parsed', 'reset time parsed from transcript');
  assert.ok(result.reason, 'has reason');
  assert.ok(result.reason.includes('parsed'), 'reason indicates parsed');
});

test('qwen quota-exceeded: fallback hours when no reset text', () => {
  const result = detectLimitHit({
    agent: 'qwen',
    stdout: '',
    stderr: 'Error: 429 Allocated quota exceeded',
    status: 1,
    signal: null,
    error: null
  });

  assert.ok(result, 'limit hit detected');
  assert.equal(result.reroute, undefined, 'quota is not a reroute');
  assert.ok(result.until, 'has until timestamp');
  assert.equal(result.source, 'fallback', 'fallback when no reset time in text');
  assert.ok(result.reason.includes('fallback'), 'reason indicates fallback');
});

test('qwen quota-exceeded: recognizes the CLI insufficient_quota transcript', () => {
  const result = detectLimitHit({
    agent: 'qwen',
    stdout: 'Quota exhausted: Your token-plan 1-week quota has been exhausted. The quota will reset at 08-18 14:27:00 UTC. (cause: insufficient_quota: 429)',
    stderr: '',
    status: 1,
    signal: null,
    error: null,
    now: new Date('2026-08-12T12:00:00Z')
  });

  assert.ok(result, 'the real Qwen CLI quota transcript is a timed block');
  assert.equal(result.reroute, undefined);
  assert.equal(result.source, 'parsed', 'the provider reset date avoids an hourly retry loop');
});

test('qwen rate-limit: reroute without long block', () => {
  const result = detectLimitHit({
    agent: 'qwen',
    stdout: '',
    stderr: 'Error: 429 Requests rate limit exceeded. Please retry after 1 minute.',
    status: 1,
    signal: null,
    error: null
  });

  assert.ok(result, 'limit hit detected');
  assert.equal(result.reroute, true, 'rate-limit returns reroute signal');
  assert.ok(result.reason, 'has reason');
  assert.ok(result.reason.includes('rate limit'), 'reason mentions rate limit');
});

test('qwen non-quota failure: no block (no pattern match)', () => {
  // Auth error or connectivity issue — no qwen pattern matches
  const result = detectLimitHit({
    agent: 'qwen',
    stdout: '',
    stderr: 'Error: Authentication failed. Invalid API key.',
    status: 1,
    signal: null,
    error: null
  });

  assert.equal(result, null, 'non-quota failure returns null (no block)');
});

test('qwen non-quota failure: network error not blocked', () => {
  const result = detectLimitHit({
    agent: 'qwen',
    stdout: '',
    stderr: 'connect ECONNREFUSED 127.0.0.1:3000',
    status: 1,
    signal: null,
    error: { code: 'ECONNREFUSED' }
  });

  assert.equal(result, null, 'network error returns null (no block)');
});

test('qwen successful run: no limit hit even if transcript mentions quota', () => {
  // Successful child (exit 0) — limit phrases in output are quoted text,
  // not a real limit hit.
  const result = detectLimitHit({
    agent: 'qwen',
    stdout: 'The agent noted: "429 Allocated quota exceeded" in the logs.',
    stderr: '',
    status: 0,
    signal: null,
    error: null
  });

  assert.equal(result, null, 'exit 0 means no limit hit (quoted text)');
});

test('qwen quota pattern order: quota matched before rate-limit in combined text', () => {
  // When both phrases appear, quota should match first (listed first in PATTERN_SETS)
  const text = 'First: 429 Allocated quota exceeded. Then: 429 Requests rate limit exceeded.';
  const match = findLimitHitMatch('qwen', text);
  assert.ok(match, 'pattern matched');
  assert.ok(/Allocated quota exceeded/i.test(match.pattern.source), 'quota pattern matched first');
});
