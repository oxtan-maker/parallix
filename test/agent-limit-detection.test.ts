// Agent limit detection contract: pattern sets, reset-time parsing, block-until formatting,
// Qwen quota detection, and the Qwen 403 / Vibe rate-limit classification.
//
// Behavior-owned suite (TASK-2622.11). Legacy case names are unchanged; each section keeps its
// historical task provenance.
//   Limit-hit detection: TASK-2328 seam migration
//   Qwen limit detection: no task ID in the legacy file
//   Qwen 403 / Vibe rate limit: task-2616

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { getPatternsForAgent, findLimitHitMatch, clipContext, parseIsoOffset, parseIso, parseTwelveHour, parseTwentyFourHour, parseRelative, parseRetryAfter, parseRetryAtDate, projectClockTime, parseResetTime, formatBlockUntil, ceilToNextHour, detectLimitHit, PATTERN_SETS } from '../src/application/services/agent-limit.js';
import { shouldPersistLaunchFailureBlock, startAgent } from '../src/adapters/agents/agents.js';

describe('Limit-hit detection', () => {
  // ---------- getPatternsForAgent ----------

  test('getPatternsForAgent returns patterns for claude', () => {
    const patterns = getPatternsForAgent('claude');
    assert.ok(Array.isArray(patterns));
    assert.ok(patterns.length > 0);
  });

  test('getPatternsForAgent returns patterns for codex', () => {
    const patterns = getPatternsForAgent('codex');
    assert.ok(Array.isArray(patterns));
    assert.ok(patterns.length > 0);
  });

  test('getPatternsForAgent returns patterns for gemini', () => {
    const patterns = getPatternsForAgent('gemini');
    assert.ok(Array.isArray(patterns));
  });

  test('getPatternsForAgent returns patterns for mistral', () => {
    const patterns = getPatternsForAgent('mistral');
    assert.ok(Array.isArray(patterns));
    assert.ok(patterns.length > 0);
  });

  test('getPatternsForAgent returns empty array for unknown agent', () => {
    const patterns = getPatternsForAgent('unknown');
    assert.deepEqual(patterns, []);
  });

  // ---------- findLimitHitMatch ----------

  test('findLimitHitMatch finds matching phrase in stdout', () => {
    const match = findLimitHitMatch('claude', 'Hello Claude usage limit reached. Your limit will reset at 5pm (UTC).');
    assert.ok(match);
    assert.equal(typeof match.index, 'number');
  });

  test('findLimitHitMatch returns null when no match', () => {
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    const match = findLimitHitMatch('Hello world', ['claude'], 'stdout');
    assert.equal(match, null);
  });

  test('findLimitHitMatch finds mistral quota exceeded', () => {
    const match = findLimitHitMatch('mistral', 'Mistral AI quota exceeded. Please try again later.');
    assert.ok(match);
    assert.equal(typeof match.index, 'number');
  });

  test('findLimitHitMatch finds mistral rate limit', () => {
    const match = findLimitHitMatch('mistral', 'Mistral AI rate limit reached');
    assert.ok(match);
    assert.equal(typeof match.index, 'number');
  });

  test('findLimitHitMatch does NOT match bare quota exceeded for mistral', () => {
    // Bare "quota exceeded" without mistral/vibe context should not match
    const match = findLimitHitMatch('mistral', 'reviewed comment: quota exceeded');
    assert.equal(match, null);
  });

  test('findLimitHitMatch does NOT match bare rate limit exceeded for mistral', () => {
    // Bare "rate limit exceeded" without mistral/vibe context should not match
    const match = findLimitHitMatch('mistral', 'reviewed comment: rate limit exceeded');
    assert.equal(match, null);
  });

  test('detectLimitHit returns null for mistral when quoted quota exceeded text appears with launcher success', () => {
    // Even if "quota exceeded" appears in transcript, if launcher succeeded (status 0),
    // it should not be treated as a limit hit
    const result = detectLimitHit({
      agent: 'mistral',
      stdout: 'reviewed comment: quota exceeded',
      stderr: '',
      status: 0,
      signal: null,
      error: null
    });
    assert.equal(result, null);
  });

  // ---------- clipContext ----------

  test('clipContext returns surrounding context around match', () => {
    const text = 'x'.repeat(100) + 'LIMIT_REACHED' + 'y'.repeat(100);
    const clip = clipContext(text, 100, 'LIMIT_REACHED'.length);
    assert.ok(clip.includes('LIMIT_REACHED'));
  });

  // ---------- parseIsoOffset ----------

  test('parseIsoOffset parses PT1H5M format', () => {
    const result = parseIsoOffset('+01:05');
    assert.equal(result, 65); // minutes
  });

  test('parseIsoOffset parses PT30M format', () => {
    const result = parseIsoOffset('-00:30');
    assert.equal(result, -30);
  });

  test('parseIsoOffset returns null for invalid format', () => {
    const result = parseIsoOffset('not-an-iso');
    assert.equal(result, null);
  });

  // ---------- parseRetryAfter ----------

  test('parseRetryAfter parses numeric seconds', () => {
    const now = new Date('2026-05-01T10:00:00Z');
    const result = parseRetryAfter('retry-after: 3600', now);
    assert.equal(result.getTime(), now.getTime() + 3600 * 1000);
  });

  test('parseRetryAfter returns null for non-numeric', () => {
    const result = parseRetryAfter('abc', new Date('2026-05-01T10:00:00Z'));
    assert.equal(result, null);
  });

  // ---------- projectClockTime ----------

  test('projectClockTime projects a reset offset to a future clock time', () => {
    const now = new Date('2026-05-01T10:00:00Z');
    const result = projectClockTime(now, 11, 0);
    assert.ok(result.getTime() >= now.getTime());
  });

  // ---------- parseResetTime ----------

  test('parseResetTime handles ISO offset format', () => {
    const result = parseResetTime('2026-05-01T11:00:00Z');
    assert.ok(result instanceof Date);
  });

  test('parseResetTime handles numeric seconds', () => {
    const now = new Date('2026-05-01T10:00:00Z');
    const result = parseResetTime('retry-after: 1800', now);
    assert.ok(result instanceof Date);
  });

  test('parseResetTime handles the reported Claude transcript clock time', () => {
    const now = new Date('2026-05-01T16:30:00+02:00');
    const result = parseResetTime("You've hit your limit · resets 7:10pm (Europe/Stockholm)", now);
    assert.ok(result instanceof Date);
    assert.equal(result.getHours(), 19);
    assert.equal(result.getMinutes(), 10);
    assert.ok(result.getTime() > now.getTime(), 'parsed reset time must be in the future');
  });

  // ---------- formatBlockUntil ----------

  test('formatBlockUntil formats YYYY-MM-DD HH', () => {
    const date = new Date('2026-05-01T18:00:00Z');
    const result = formatBlockUntil(date);
    assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}$/);
  });

  // ---------- ceilToNextHour ----------

  test('ceilToNextHour rounds up to next hour', () => {
    const now = new Date('2026-05-01T10:30:00Z');
    const result = ceilToNextHour(now);
    assert.equal(result.getUTCMinutes(), 0);
    assert.equal(result.getUTCHours(), 11);
  });

  test('ceilToNextHour same hour stays same', () => {
    const now = new Date('2026-05-01T10:00:00Z');
    const result = ceilToNextHour(now);
    assert.equal(result.getUTCMinutes(), 0);
    assert.equal(result.getUTCHours(), 10);
  });

  // ---------- detectLimitHit ----------

  test('detectLimitHit returns null when status is 0 (success)', () => {
    const result = detectLimitHit({
      agent: 'claude',
      stdout: 'Claude usage limit reached',
      stderr: '',
      status: 0,
      signal: null,
      error: null
    });
    assert.equal(result, null);
  });

  test('detectLimitHit returns null when status is non-zero but no phrase match', () => {
    const result = detectLimitHit({
      agent: 'claude',
      stdout: 'Hello world',
      stderr: '',
      status: 1,
      signal: null,
      error: null
    });
    assert.equal(result, null);
  });

  test('detectLimitHit returns null when error is set (spawn error)', () => {
    const result = detectLimitHit({
      agent: 'claude',
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      error: new Error('ENOENT')
    });
    assert.equal(result, null);
  });

  test('detectLimitHit parses the reported Claude transcript and rounds the block to the next local hour', () => {
    const now = new Date('2026-05-01T16:30:00+02:00');
    const result = detectLimitHit({
      agent: 'claude',
      stdout: "You've hit your limit · resets 7:10pm (Europe/Stockholm)",
      stderr: '',
      status: 1,
      signal: null,
      error: null,
      now
    });

    assert.ok(result);
    assert.equal(result.until, '2026-05-01 20');
    assert.equal(result.source, 'parsed');
    assert.ok(result.reason);
    assert.ok(result.reason.startsWith('parsed:'));
  });

  for (const apostrophe of ["'", '’']) {
    test(`detectLimitHit classifies the Claude session limit with parsed reset (${apostrophe}) (TASK-2628)`, () => {
      const now = new Date('2026-05-01T16:30:00+02:00');
      const result = detectLimitHit({
        agent: 'claude',
        stdout: `You${apostrophe}ve hit your session limit · resets 6:20pm (Europe/Stockholm)`,
        stderr: '',
        status: 1,
        signal: null,
        error: null,
        now
      });

      assert.ok(result);
      assert.equal(result.source, 'parsed');
      assert.equal(result.until, '2026-05-01 19');
    });
  }

  test('parseResetTime parses the Claude session limit clock time to a future instant (TASK-2628)', () => {
    const now = new Date('2026-05-01T16:30:00+02:00');
    const result = parseResetTime("You've hit your session limit · resets 6:20pm (Europe/Stockholm)", now);
    assert.ok(result instanceof Date);
    assert.equal(result.getHours(), 18);
    assert.equal(result.getMinutes(), 20);
    assert.ok(result.getTime() > now.getTime(), 'parsed reset time must be in the future');
  });

  test('detectLimitHit ignores ordinary Claude output mentioning a session (TASK-2628)', () => {
    const result = detectLimitHit({
      agent: 'claude',
      stdout: 'Starting a new session; your session limit settings are unchanged.',
      stderr: '',
      status: 1,
      signal: null,
      error: null
    });
    assert.equal(result, null);
  });

  test('detectLimitHit blocks a reported Claude session limit and ignores a quoted review phrase (TASK-2635)', () => {
    const now = new Date('2026-10-02T12:00:00+02:00');
    const hit = detectLimitHit({
      agent: 'claude',
      stdout: "You've hit your session limit · resets 2:10pm (Europe/Stockholm)",
      status: 1,
      now,
    });

    assert.ok(hit, 'the reported provider failure must block');
    assert.equal(hit.source, 'parsed');
    assert.ok(hit.until! > formatBlockUntil(now), 'block must be in the future');
    assert.equal(shouldPersistLaunchFailureBlock('claude', { stderr: "You've hit your session limit", status: 1 }), true);
    assert.equal(
      shouldPersistLaunchFailureBlock('claude', { stderr: 'The review quotes: "You\'ve hit your session limit"', status: 1 }),
      false,
      'quoted review prose is not a provider limit hit',
    );
  });

  test('detectLimitHit returns reason for fallback source', () => {
    const result = detectLimitHit({
      agent: 'codex',
      stdout: '',
      stderr: 'you\'ve hit your weekly usage limit',
      status: 1,
      signal: null,
      error: null
    });

    assert.ok(result);
    assert.equal(result.source, 'fallback');
    assert.ok(result.reason);
    assert.ok(result.reason.includes('usage limit reached'));
  });

  test('detectLimitHit blocks the Mistral family through the end of the UTC month when no reset time parses', () => {
    const now = new Date('2026-09-18T14:00:00Z');
    const result = detectLimitHit({
      agent: 'mistral',
      stdout: '',
      stderr: 'Mistral AI rate limit reached. Please try again later.',
      status: 1,
      signal: null,
      error: null,
      now
    });

    assert.ok(result);
    assert.equal(new Date(result.until.replace(' ', 'T') + ':00').getTime(), Date.UTC(2026, 9, 1));
    assert.equal(result.source, 'month-end');
    assert.ok(result.reason.startsWith('month-end:'));
  });

  test('detectLimitHit applies the Mistral month-end block to vibe at the UTC month boundary', () => {
    const now = new Date('2026-09-30T23:59:00Z');
    const result = detectLimitHit({
      agent: 'vibe',
      stdout: '',
      stderr: 'Vibe rate limit exceeded.',
      status: 1,
      signal: null,
      error: null,
      now
    });

    assert.ok(result);
    assert.equal(new Date(result.until.replace(' ', 'T') + ':00').getTime(), Date.UTC(2026, 9, 1));
    assert.equal(result.source, 'month-end');
  });

  test('detectLimitHit honors a parsed Mistral reset before month-end', () => {
    const result = detectLimitHit({
      agent: 'mistral',
      stdout: '',
      stderr: 'Mistral AI rate limit reached. Retry at 2026-09-20T12:15:00Z.',
      status: 1,
      signal: null,
      error: null,
      now: new Date('2026-09-18T14:00:00Z')
    });

    assert.ok(result);
    assert.equal(new Date(result.until.replace(' ', 'T') + ':00').getTime(), Date.UTC(2026, 8, 20, 13));
    assert.equal(result.source, 'parsed');
  });

  test('detectLimitHit returns reason for sigint source', () => {
    const result = detectLimitHit({
      agent: 'mistral',
      stdout: '',
      stderr: '',
      status: null,
      signal: 'SIGINT',
      error: null
    });

    assert.ok(result);
    assert.equal(result.source, 'sigint');
    assert.ok(result.reason);
    assert.ok(result.reason.startsWith('sigint:'));
    assert.ok(result.reason.includes('SIGINT'));
  });

  test('detectLimitHit returns reason field alongside until and source for limit-hit patterns', () => {
    const result = detectLimitHit({
      agent: 'claude',
      stdout: 'Claude usage limit reached',
      stderr: '',
      status: 1,
      signal: null,
      error: null
    });

    assert.ok(result);
    assert.equal(typeof result.until, 'string');
    assert.equal(typeof result.source, 'string');
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  });

  test('detectLimitHit returns reason for fallback source', () => {
    const result = detectLimitHit({
      agent: 'codex',
      stdout: '',
      stderr: 'you\'ve hit your weekly usage limit',
      status: 1,
      signal: null,
      error: null
    });

    assert.ok(result);
    assert.equal(result.source, 'fallback');
    assert.ok(result.reason);
    assert.ok(result.reason.includes('usage limit reached'));
  });

  test('detectLimitHit returns reason for sigint source', () => {
    const result = detectLimitHit({
      agent: 'mistral',
      stdout: '',
      stderr: '',
      status: null,
      signal: 'SIGINT',
      error: null
    });

    assert.ok(result);
    assert.equal(result.source, 'sigint');
    assert.ok(result.reason);
    assert.ok(result.reason.startsWith('sigint:'));
    assert.ok(result.reason.includes('SIGINT'));
  });

  test('detectLimitHit returns reason field alongside until and source for limit-hit patterns', () => {
    const result = detectLimitHit({
      agent: 'claude',
      stdout: 'Claude usage limit reached',
      stderr: '',
      status: 1,
      signal: null,
      error: null
    });

    assert.ok(result);
    assert.equal(typeof result.until, 'string');
    assert.equal(typeof result.source, 'string');
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  });
});

describe('Qwen limit detection', () => {
  'use strict';


  test('qwen PATTERN_SETS includes entitlement, quota, and rate-limit patterns', () => {
    assert.ok(PATTERN_SETS.qwen, 'qwen pattern set exists');
    assert.equal(PATTERN_SETS.qwen.length, 3, 'three qwen patterns (entitlement + quota + rate-limit)');
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
      // Pinned before the transcript's reset time: without it the fixture date
      // falls into the past once the wall clock passes it, and a parsed reset
      // that already elapsed is indistinguishable from having none.
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
});

describe('Qwen 403 and Vibe rate limit (task-2616)', () => {
  const QWEN_MODEL_DENIAL = '[API Error: 403 Access to model denied. Please make sure you are eligible for using the model.]';
  const VIBE_RATE_LIMIT = 'Error: Rate limits exceeded. Please wait a moment before trying again.';

  test('task-2616: Qwen 403 model denial is an actionable scoped entitlement reroute, never a family block', () => {
    const hit = detectLimitHit({
      agent: 'qwen', stderr: QWEN_MODEL_DENIAL, status: 1, signal: null, error: null,
    });

    assert.deepEqual(hit, {
      reroute: true,
      kind: 'entitlement',
      reason: 'model entitlement denied (scoped, no family block)',
    });
    assert.equal(shouldPersistLaunchFailureBlock('qwen', { stderr: QWEN_MODEL_DENIAL, status: 1 }), false);
  });

  test('task-2616: Vibe plural rate limits exceeded gets a checked month-end block', () => {
    const hit = detectLimitHit({
      agent: 'vibe', stderr: VIBE_RATE_LIMIT, status: 1, signal: null, error: null,
      now: new Date('2026-09-18T14:00:00Z'),
    });

    assert.ok(hit && !hit.reroute);
    assert.equal(hit.source, 'month-end');
    assert.equal(hit.until, formatBlockUntil(new Date(Date.UTC(2026, 9, 1))));
    assert.equal(shouldPersistLaunchFailureBlock('vibe', { stderr: VIBE_RATE_LIMIT, status: 1 }), true);
  });

  test('task-2616: Qwen quota blocks, while credentials, transport, and generic exits stay unblocked', () => {
    assert.equal(shouldPersistLaunchFailureBlock('qwen', {
      stderr: 'Quota exhausted: cause: insufficient_quota: 429', status: 1,
    }), true);
    for (const stderr of ['Authentication failed: invalid API key', 'ECONNREFUSED provider', 'generic crash']) {
      assert.equal(shouldPersistLaunchFailureBlock('qwen', { stderr, status: 1 }), false, stderr);
    }
  });

  test('task-2616: silent Vibe review is bounded and falls back to custom without a block', async () => {
    const launched: string[] = [];
    const result = await startAgent('review', {
      prompt: 'Review.', agent: 'vibe', worktree: '/tmp/task-2616-liveness',
      noOutputWatchdog: { initialDelayMs: 1, intervalMs: 1, maxNoOutputMs: 5 },
      isAgentBlockedFn: () => false, assertAgentSupportedFn: () => {}, resolveAgentModelFn: () => null,
      selectAgentFn: (_step: string, options: { exclude: Set<string> }) => options.exclude.has('vibe') ? 'custom' : 'vibe',
      launchAgentFn: (options: { env: { FORGEJO_USER: string }, teeOptions: { noOutputWatchdog: { maxNoOutputMs: number } } }) => {
        const agent = options.env.FORGEJO_USER;
        launched.push(agent);
        if (agent === 'vibe') {
          assert.equal(options.teeOptions.noOutputWatchdog.maxNoOutputMs, 5);
          return { invocation: { command: agent, args: [], options: {} }, resultPromise: Promise.resolve({ status: null, signal: null, stdout: '', stderr: '', error: { code: 'NO_OUTPUT_TIMEOUT' } }) };
        }
        return { invocation: { command: agent, args: [], options: {} }, resultPromise: Promise.resolve({ status: 0, signal: null, stdout: '', stderr: '', error: null }) };
      },
      log: () => {},
    });
    assert.deepEqual(launched, ['vibe', 'custom']);
    assert.equal(result.agent, 'custom');
  });
});
