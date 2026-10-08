import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLintBaseline, isLintBaselineCli } from '../../../scripts/lint-baseline.mjs';

const baseline = {
  '@typescript-eslint/no-explicit-any': 2,
  complexity: 1,
};

test('lint ratchet rejects a new explicit any (TASK-2668.03)', () => {
  const result = checkLintBaseline([{ messages: [
    { ruleId: '@typescript-eslint/no-explicit-any' },
    { ruleId: '@typescript-eslint/no-explicit-any' },
    { ruleId: '@typescript-eslint/no-explicit-any' },
    { ruleId: 'complexity' },
  ] }], baseline);

  assert.equal(result.ok, false);
  assert.deepEqual(result.increased, [{ rule: '@typescript-eslint/no-explicit-any', expected: 2, actual: 3 }]);
  assert.deepEqual(result.decreased, []);
});

test('lint ratchet requires a baseline update after an intentional reduction (TASK-2668.03)', () => {
  const result = checkLintBaseline([{ messages: [{ ruleId: '@typescript-eslint/no-explicit-any' }] }], baseline);

  assert.equal(result.ok, false);
  assert.deepEqual(result.increased, []);
  assert.deepEqual(result.decreased, [{ rule: '@typescript-eslint/no-explicit-any', expected: 2, actual: 1 }, { rule: 'complexity', expected: 1, actual: 0 }]);
});

test('lint ratchet accepts exact committed baseline counts', () => {
  const result = checkLintBaseline([{ messages: [
    { ruleId: '@typescript-eslint/no-explicit-any' },
    { ruleId: '@typescript-eslint/no-explicit-any' },
    { ruleId: 'complexity' },
  ] }], baseline);

  assert.deepEqual(result, {
    counts: { '@typescript-eslint/no-explicit-any': 2, complexity: 1 },
    increased: [], decreased: [], ok: true,
  });
});

test('lint ratchet recognizes its supported Node CLI entrypoint (TASK-2668.03)', () => {
  const scriptUrl = new URL('../../../scripts/lint-baseline.mjs', import.meta.url).href;

  assert.equal(isLintBaselineCli(scriptUrl, ['node', new URL('../../../scripts/lint-baseline.mjs', import.meta.url).pathname]), true);
  assert.equal(isLintBaselineCli(scriptUrl, ['node', 'test-runner.mjs']), false);
});
