import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactReviewPrompt, buildReviewPrompt } from '../src/adapters/review/review-prompts.js';

const reviewArgs = {
  reviewer: 'codex',
  branch: 'mission/task-2359',
  implementer: 'claude',
  focus: 'all',
  attempt: 1,
  reviewBaseline: 'review-baseline-sha',
};

function renderedReviewPrompts(): Array<[string, string]> {
  return [
    ['buildReviewPrompt', buildReviewPrompt(reviewArgs)],
    ['buildCompactReviewPrompt', buildCompactReviewPrompt(reviewArgs)],
  ];
}

test('task-2359: rendered review prompts treat unrelated PR history as context only (buildReviewPrompt + buildCompactReviewPrompt)', () => {
  for (const [builder, prompt] of renderedReviewPrompts()) {
    assert.match(prompt, /PR metadata, commit ancestry, and historical commits outside `git diff review-baseline-sha\.\.HEAD` are context only/i, builder);
    assert.match(prompt, /must not produce a mission finding, request-changes verdict, or workflow block/i, builder);
  }
});

test('task-2359: rendered review prompts ground findings in the mission diff, checkpoint evidence, or unidentified reviewed revision', () => {
  for (const [builder, prompt] of renderedReviewPrompts()) {
    assert.match(prompt, /findings.*grounded in `git diff review-baseline-sha\.\.HEAD`, mission\/checkpoint evidence, or inability to identify the reviewed revision/i, builder);
  }
});

test('task-2359: rendered review prompts require a finding when the mission materially worsened the inconsistency', () => {
  for (const [builder, prompt] of renderedReviewPrompts()) {
    assert.match(prompt, /mission.*introduced or materially worsened the inconsistency/i, builder);
  }
});

test('task-2359: rendered review prompts require a finding for materially false checkpoint evidence', () => {
  for (const [builder, prompt] of renderedReviewPrompts()) {
    assert.match(prompt, /checkpoint evidence.*materially false/i, builder);
  }
});

test('task-2359: rendered review prompts require a finding when the review surface cannot identify the reviewed revision', () => {
  for (const [builder, prompt] of renderedReviewPrompts()) {
    assert.match(prompt, /review surface cannot identify the (exact )?reviewed revision/i, builder);
  }
});

test('task-2359: rendered review prompts retain rebasing-artifact guidance', () => {
  for (const [builder, prompt] of renderedReviewPrompts()) {
    assert.match(prompt, /Rebasing Artifacts:/, builder);
    assert.match(prompt, /stale-baseline noise as rebasing artifacts, not mission changes/i, builder);
  }
});
