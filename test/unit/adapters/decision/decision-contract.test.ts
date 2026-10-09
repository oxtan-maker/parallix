import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionPort } from '../../../../src/composition/decision.js';
import { resolveDecisionProvider } from '../../../../src/adapters/decision/provider.js';
import type { DecisionRequest } from '../../../../src/application/ports/decision.js';
import { DecisionError } from '../../../../src/application/ports/decision.js';
import { resolveConfiguration } from '../../../../src/composition/config.js';

const resolveFromEnvironment = (env: Record<string, string | undefined>) => resolveDecisionProvider(resolveConfiguration(env).decision);
const portFromEnvironment = ({ env, transport }: { env: Record<string, string | undefined>; transport?: typeof fetch }) =>
  createDecisionPort(resolveConfiguration(env).decision, transport);

// New owner: generic provider discovery and normalized decision transport; no workflow consumer exists.
const request: DecisionRequest = { state: { text: 'All tests passed.' }, questions: {
  green: { type: 'boolean', instructions: 'Did tests pass?' },
  category: { type: 'choice', instructions: 'Choose status', criteria: { pass: 'Passed', fail: 'Failed' } },
  quality: { type: 'score', instructions: 'Score success', criteria: ['Failed', 'Passed'] },
} };
const response = () => ({ model: 'jev-1.13', answers: {
  green: { type: 'noul', noul: 0.97 },
  category: { type: 'choice', choice: 'pass', probabilities: { pass: 0.98, fail: 0.02 }, confidence: 0.96 },
  quality: { type: 'score', score: 0.98, legend: { '0': 'Failed', '1': 'Passed' }, probabilities: { '0': 0.02, '1': 0.98 }, confidence: 0.96 },
}, usage: { input_tokens: 42, output_tokens: 0, cost: 0.00001 } });
function transport(body: unknown): typeof fetch { return async () => new Response(JSON.stringify(body)); }
// The jev-1.13 tokenizer loads lazily on the first token count (~0.4 s CPU,
// cached per process); warm it once so no test's CPU budget carries the load.
before(async () => { await portFromEnvironment({ env: { OPENROUTER_API_KEY: 'secret' }, transport: transport(response()) }).decide(request); });

test('discovers each sole conventional provider without prompting (TASK-2664)', () => {
  for (const [provider, key] of [['typesafe', 'TYPESAFE_API_KEY'], ['openrouter', 'OPENROUTER_API_KEY'], ['vercel', 'AI_GATEWAY_API_KEY']]) {
    const resolved = resolveFromEnvironment({ [key]: 'opaque-key' });
    assert.equal(resolved.availability.status, 'available');
    assert.equal(resolved.route?.provider, provider);
    assert.equal(resolved.route?.apiKey, 'opaque-key');
    assert.ok(!JSON.stringify(resolved.availability).includes('opaque-key'));
  }
});

test('requires setup for missing, ambiguous, unsupported, or invalid configuration', () => {
  for (const env of [{}, { OPENAI_API_KEY: 'ignored' },
    { TYPESAFE_API_KEY: 'a', OPENROUTER_API_KEY: 'b' },
    { JEV_CODE_PROVIDER: 'unknown', OPENROUTER_API_KEY: 'b' },
    { JEV_CODE_PROVIDER: 'vercel', OPENROUTER_API_KEY: 'b' },
    { OPENROUTER_API_KEY: 'b', TYPESAFE_BASE_URL: 'https://proxy.example' },
    { OPENROUTER_API_KEY: 'b', TYPESAFE_BASE_URL: 'http://openrouter.ai/api' },
    { OPENROUTER_API_KEY: 'b', TYPESAFE_BASE_URL: 'https://user:secret@openrouter.ai/api' },
    { OPENROUTER_API_KEY: 'b', TYPESAFE_BASE_URL: 'https://openrouter.ai/api?q=secret' },
    { OPENROUTER_API_KEY: 'b', TYPESAFE_BASE_URL: 'invalid' },
    { OPENROUTER_API_KEY: 'b', JEV_CODE_TIMEOUT_MS: '0' },
    { OPENROUTER_API_KEY: 'b', JEV_CODE_TIMEOUT_MS: 'Infinity' }]) {
    assert.equal(resolveFromEnvironment(env).availability.status, 'setup-required');
  }
});

test('explicit routes disambiguate and generic SDK credentials follow operator routing', () => {
  const resolved = resolveFromEnvironment({ TYPESAFE_API_KEY: 'generic', OPENROUTER_API_KEY: 'own',
    JEV_CODE_PROVIDER: 'openrouter', TYPESAFE_DEFAULT_MODEL: 'jev-1.13', JEV_CODE_TIMEOUT_MS: '500' });
  assert.equal(resolved.route?.apiKey, 'own');
  assert.equal(resolved.route?.model, 'jev-1.13');
  assert.equal(resolved.route?.timeoutMs, 500);
  assert.equal(resolveFromEnvironment({ TYPESAFE_API_KEY: 'generic', TYPESAFE_BASE_URL: 'https://openrouter.ai/api' }).route?.provider, 'openrouter');
  assert.equal(resolveFromEnvironment({ TYPESAFE_API_KEY: 'generic', JEV_CODE_PROVIDER: 'vercel' }).route?.provider, 'vercel');
  assert.equal(resolveFromEnvironment({ TYPESAFE_API_KEY: 'generic', TYPESAFE_BASE_URL: 'https://proxy.example/' }).route?.endpoint, 'https://proxy.example/v1/systemone');
  assert.equal(resolveFromEnvironment({ OPENROUTER_API_KEY: 'own', JEV_CODE_PROVIDER: 'openrouter', TYPESAFE_BASE_URL: 'https://proxy.example' }).route?.provider, 'openrouter');
  assert.equal(resolveFromEnvironment({ OPENROUTER_API_KEY: 'own', JEV_CODE_PROVIDER: 'openrouter', TYPESAFE_BASE_URL: 'https://api.typesafe.ai' }).availability.status, 'setup-required');
  assert.equal(resolveFromEnvironment({ OPENROUTER_API_KEY: 'own', TYPESAFE_BASE_URL: 'https://api.typesafe.ai' }).availability.status, 'setup-required');
});

test('requestBytes is the exact body size sent for the routed model (TASK-2675)', async () => {
  let sent = 0;
  const env = { OPENROUTER_API_KEY: 'secret', TYPESAFE_DEFAULT_MODEL: 'jev-1.13' };
  const port = portFromEnvironment({ env, transport: async (_url, init) => { sent = Buffer.byteLength(init?.body as string); return new Response(JSON.stringify(response())); } });
  await port.decide(request);
  assert.equal(port.requestBytes(request), sent);
  const longer = portFromEnvironment({ env: { ...env, TYPESAFE_DEFAULT_MODEL: 'jev-1.13-with-a-much-longer-routed-name' } });
  assert.ok(longer.requestBytes(request) > sent);
});

test('composition normalizes mixed questions, probabilities, model and usage', async () => {
  let calls = 0;
  const port = portFromEnvironment({ env: { OPENROUTER_API_KEY: 'secret' }, transport: async (url, init) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/systemone');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer secret');
    const body = JSON.parse(init?.body as string);
    assert.deepEqual(body.state, request.state);
    assert.equal(body.questions.green.type, 'noul');
    assert.deepEqual(body.questions.quality.criteria, ['Failed', 'Passed']);
    return new Response(JSON.stringify(response()));
  } });
  assert.equal((await port.available()).status, 'available');
  assert.equal(calls, 0);
  const result = await port.decide(request);
  assert.equal(calls, 1);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'jev-1.13');
  assert.deepEqual(result.answers.green, { type: 'boolean', probability: 0.97 });
  assert.deepEqual(result.answers.category, { type: 'choice', selected: 'pass', probabilities: { pass: 0.98, fail: 0.02 }, confidence: 0.96 });
  assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 0, cost: 0.00001 });
});

test('setup-required and malformed requests never reach the transport', async () => {
  let calls = 0;
  const mock: typeof fetch = async () => { calls++; return new Response('{}'); };
  await assert.rejects(portFromEnvironment({ env: {}, transport: mock }).decide(request), /Export/);
  const port = portFromEnvironment({ env: { OPENROUTER_API_KEY: 'secret' }, transport: mock });
  for (const input of [
    { state: 'x', questions: {} },
    { state: 'x', questions: { q: { type: 'choice', instructions: 'Pick', criteria: { only: null } } } },
    { state: 'x', questions: { q: { type: 'score', instructions: 'Score', criteria: ['only'] } } },
    { state: 'x', questions: { q: { type: 'boolean', instructions: '' } } },
    { ...request, state: NaN }, { ...request, state: undefined },
    { ...request, state: 'x'.repeat(1_000_001) },
  ]) { await assert.rejects(port.decide(input as DecisionRequest)); }
  assert.equal(calls, 0);
});

test('composition snapshots operator routing without persisting or rereading credentials', async () => {
  const env = { OPENROUTER_API_KEY: 'initial', TYPESAFE_DEFAULT_MODEL: 'pinned-model' };
  const port = portFromEnvironment({ env, transport: async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer initial');
    assert.equal(JSON.parse(init?.body as string).model, 'pinned-model');
    return new Response(JSON.stringify(response()));
  } });
  env.OPENROUTER_API_KEY = 'changed';
  env.TYPESAFE_DEFAULT_MODEL = 'changed';
  await port.decide(request);
});

test('rejects partial, malformed, mismatched and nonfinite provider answers', async () => {
  const invalidBodies: unknown[] = [{}, { model: 'jev', answers: {} }];
  for (const mutate of [
    (body: ReturnType<typeof response>) => { body.answers.green.noul = 1.1; },
    (body: ReturnType<typeof response>) => { body.answers.category.choice = 'unknown'; },
    (body: ReturnType<typeof response>) => { body.answers.category.probabilities.pass = 0.2; },
    (body: ReturnType<typeof response>) => { body.answers.quality.score = 2; },
    (body: ReturnType<typeof response>) => { body.answers.quality.confidence = -1; },
    (body: ReturnType<typeof response>) => { body.usage.input_tokens = -1; },
    (body: ReturnType<typeof response>) => { body.usage.cost = -1; },
  ]) { const body = response(); mutate(body); invalidBodies.push(body); }
  for (const body of invalidBodies) {
    await assert.rejects(portFromEnvironment({ env: { OPENROUTER_API_KEY: 'secret' }, transport: transport(body) }).decide(request), /invalid response/);
  }
});

test('optional score distributions and usage remain optional', async () => {
  const original = response();
  const { probabilities: _probabilities, ...quality } = original.answers.quality;
  const body = { model: original.model, answers: { ...original.answers, quality } };
  const result = await portFromEnvironment({ env: { OPENROUTER_API_KEY: 'secret' }, transport: transport(body) }).decide(request);
  assert.equal(result.usage, undefined);
  assert.equal(result.answers.quality.type, 'score');
});

test('usage blocks have a provider-independent exception distinct from transient limits (TASK-2664)', async () => {
  for (const [key, provider] of [['OPENROUTER_API_KEY', 'openrouter'], ['TYPESAFE_API_KEY', 'typesafe'], ['AI_GATEWAY_API_KEY', 'vercel']]) {
    for (const [status, body, kind] of [
      [402, { error: { message: 'secret' } }, 'usage-blocked'],
      [402, { error: { metadata: { limit_source: 'openrouter_key_limit' } } }, 'usage-blocked'],
      [402, { error: { metadata: { limit_source: 'openrouter_in_flight_budget' } } }, 'rate-limited'],
      [429, { error: { code: 'insufficient_quota' } }, 'usage-blocked'],
      [429, { error: { type: 'budget_exceeded' } }, 'usage-blocked'],
      [429, {}, 'rate-limited'], [401, {}, 'authentication'], [403, {}, 'authentication'],
      [503, {}, 'unavailable'], [422, {}, 'invalid-request'],
    ] as const) {
      let calls = 0;
      const port = portFromEnvironment({ env: { [key]: 'secret' }, transport: async () => {
        calls++; return new Response(JSON.stringify(body), { status });
      } });
      await assert.rejects(port.decide(request), error => {
        assert.ok(error instanceof DecisionError);
        assert.equal(error.kind, kind);
        assert.equal(error.provider, provider);
        assert.ok(!JSON.stringify(error).includes('secret'));
        return true;
      });
      assert.equal(calls, 1);
    }
  }
});

test('HTTP and transport failures redact remote bodies and do not retry or fallback', async () => {
  let calls = 0;
  for (const mock of [
    async () => { calls++; return new Response('secret and private state', { status: 401 }); },
    async () => { calls++; throw new Error('secret and private state'); },
    async () => { calls++; return new Response('secret and private state'); },
  ]) {
    await assert.rejects(portFromEnvironment({ env: { OPENROUTER_API_KEY: 'secret' }, transport: mock }).decide(request), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('secret'));
      assert.ok(!error.message.includes('private state'));
      return true;
    });
  }
  assert.equal(calls, 3);
});

test('Jev budget counts structured state and wire-normalized questions (TASK-2692)', () => {
  const port = portFromEnvironment({ env: { OPENROUTER_API_KEY: 'dummy' } });
  const budget = port.requestBudget({ state: '', questions: { q: { type: 'boolean', instructions: 'x' } } });
  assert.equal(budget.inputTokens, 267, 'retained jevtok empty-state oracle');
  assert.equal(budget.tokenizerModel, 'jev-1.13-20260917');
  assert.equal(budget.maxContextTokens, 30000);
  assert.equal(budget.maxInputTokens, 64000);
  assert.equal(budget.maxRequestBytes, 1000000);
  assert.equal(port.requestBudget(request).requestBytes, port.requestBytes(request));
});

test('byte-small requests exceeding Jev token limits never reach transport (TASK-2692)', async () => {
  let calls = 0;
  const port = portFromEnvironment({ env: { OPENROUTER_API_KEY: 'dummy' }, transport: async () => {
    calls++; return new Response(JSON.stringify(response()));
  } });
  const oversized = { state: '1'.repeat(31000), questions: { q: { type: 'boolean' as const, instructions: 'x' } } };
  const budget = port.requestBudget(oversized);
  assert.ok(budget.requestBytes < budget.maxRequestBytes);
  assert.ok(budget.contextTokens > budget.maxContextTokens);
  await assert.rejects(port.decide(oversized), error => error instanceof DecisionError && error.kind === 'invalid-request');
  assert.equal(calls, 0);
});

test('unknown routed tokenizers cannot supply repair-budget authority (TASK-2692)', () => {
  const port = portFromEnvironment({ env: { OPENROUTER_API_KEY: 'dummy', TYPESAFE_DEFAULT_MODEL: 'future-jev' } });
  assert.throws(() => port.requestBudget(request), /token budget cannot be measured/);
});
