import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewClassification } from '../../../src/composition/review-classification.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

const classify = (env: Record<string, string | undefined>) =>
  createReviewClassification('task-2658', '/unused', resolveConfiguration(env).decision);

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
