import test from 'node:test';
import assert from 'node:assert/strict';

import { detectLimitHit, formatBlockUntil } from '../src/application/services/agent-limit.js';
import { shouldPersistLaunchFailureBlock, startAgent } from '../src/adapters/agents/agents.js';

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
