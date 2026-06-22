const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompactReviewPrompt, buildCompactActOnReviewPrompt } = require('../lib/review/review-prompts');

test('buildCompactReviewPrompt uses actualReviewer when provided', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'claude',
    branch: 'mission/task-1051',
    implementer: 'codex',
    attempt: 1,
    actualReviewer: 'mistral'
  });

  assert.match(prompt, /px review task-1051 --verify/);
  assert.match(prompt, /\$review all/);
  assert.doesNotMatch(prompt, /Reviewer: claude/);
  assert.doesNotMatch(prompt, /Reviewer: mistral/);
});

test('buildCompactActOnReviewPrompt uses actualImplementer when provided', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'qwen',
    branch: 'mission/task-1051',
    attempt: 1,
    actualImplementer: 'codex'
  });

  assert.match(prompt, /You are the implementer agent family: `codex`/);
  assert.match(prompt, /task-1051-round-resolution\.md/);
  assert.ok(!prompt.includes('agent family: `qwen`'), 'Should not contain the original implementer in identity spot');
});
