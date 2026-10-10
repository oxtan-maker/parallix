import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewClassification } from '../../../src/composition/review-classification.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

const classify = (env: Record<string, string | undefined>) =>
  createReviewClassification('task-2658', '/unused', resolveConfiguration(env).decision);

// Tokenizer initialization is suite setup, matching the decision adapter owner.
before(() => {
  classify({ OPENROUTER_API_KEY: 'disposable' }).decision.requestBudget({ state: '', questions: { q: { type: 'boolean', instructions: 'x' } } });
});

// Owns the operator configuration binding; application suites own routing effects.
test('repeat review is opt-out and invalid modes keep the general reviewer (TASK-2658)', async () => {
  for (const value of [undefined, '', 'on', ' ON ']) {
    assert.equal(classify({ PARALLIX_JEV_REVIEW: value }).mode, 'enabled');
  }
  for (const value of ['off', 'false', 'unknown']) {
    assert.equal(classify({ PARALLIX_JEV_REVIEW: value }).mode, 'disabled');
  }
  assert.equal(classify({ PARALLIX_JEV_REVIEW: 'shadow' }).mode, 'shadow');
  assert.equal((await classify({}).decision.available()).status, 'setup-required');
});

test('panel uses the configured Jev route and admits every frozen question through its budget (TASK-2716)', async () => {
  const { PANEL_QUESTIONS } = await import('../../../src/application/review-classification/panel-questions.js');
  const ports = classify({ JEV_CODE_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'disposable', TYPESAFE_DEFAULT_MODEL: 'jev-1.13' });
  assert.deepEqual(await ports.decision.available(), { status: 'available', provider: 'openrouter', model: 'jev-1.13' });
  for (const question of Object.values(PANEL_QUESTIONS)) {
    const budget = ports.decision.requestBudget({ state: { finding: 'x.java:1 preserve output' }, questions: { resolution: question } });
    assert.ok(budget.inputTokens <= 32000);
    assert.ok(budget.contextTokens <= 30000);
    assert.ok(budget.requestBytes <= budget.maxRequestBytes);
  }
});
