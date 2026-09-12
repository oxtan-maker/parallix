


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const buildCompactReviewPromptModule = mockModule<typeof import('../src/adapters/review/review-prompts.js')>('../src/adapters/review/review-prompts.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { buildCompactReviewPrompt, buildCompactActOnReviewPrompt } = buildCompactReviewPromptModule;
test('buildCompactReviewPrompt uses actualReviewer when provided', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'claude',
    branch: 'mission/task-1051',
    implementer: 'codex',
    attempt: 1,
    actualReviewer: 'vibe'
  });

  assert.match(prompt, /Do not invoke `px` yourself, with one exception/);
  assert.match(prompt, /\$review all/);
  assert.doesNotMatch(prompt, /Reviewer: claude/);
  assert.doesNotMatch(prompt, /Reviewer: vibe/);
});

test('buildCompactActOnReviewPrompt uses actualImplementer when provided', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'custom',
    branch: 'mission/task-1051',
    attempt: 1,
    actualImplementer: 'codex'
  });

  assert.match(prompt, /You are the implementer agent family: `codex`/);
  assert.match(prompt, /task-1051-round-resolution\.md/);
  assert.ok(!prompt.includes('agent family: `custom`'), 'Should not contain the original implementer in identity spot');
});
