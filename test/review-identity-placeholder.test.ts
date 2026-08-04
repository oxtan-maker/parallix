
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompactReviewPrompt, buildCompactActOnReviewPrompt } = require('../.test-runtime/adapters/review/review-prompts.js');

test('buildCompactReviewPrompt uses actualReviewer when provided', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'claude',
    branch: 'mission/task-1051',
    implementer: 'codex',
    attempt: 1,
    actualReviewer: 'vibe'
  });

  assert.match(prompt, /The workflow runs the declared verification gate before this review\. Do not invoke `px` yourself\./);
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
