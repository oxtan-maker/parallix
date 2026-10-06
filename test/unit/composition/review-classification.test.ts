import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepeatReviewClassification } from '../../../src/composition/review-classification.js';

// Owns the operator configuration binding; application suites own routing effects.
test('repeat review is opt-out and invalid modes keep the general reviewer (TASK-2658)', async () => {
  for (const value of [undefined, '', 'on', ' ON ']) {
    assert.equal(createRepeatReviewClassification('task-2658', '/unused', { PARALLIX_JEV_REVIEW: value }).mode, 'enabled');
  }
  for (const value of ['off', 'false', 'unknown']) {
    assert.equal(createRepeatReviewClassification('task-2658', '/unused', { PARALLIX_JEV_REVIEW: value }).mode, 'disabled');
  }
  assert.equal(createRepeatReviewClassification('task-2658', '/unused', { PARALLIX_JEV_REVIEW: 'shadow' }).mode, 'shadow');
  assert.equal((await createRepeatReviewClassification('task-2658', '/unused', {}).decision.available()).status, 'setup-required');
});
