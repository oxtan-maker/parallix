import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewVerdict } from '../src/adapters/review/review-loop.js';

test('renderReviewVerdict renders an APPROVED verdict as a PASS banner', () => {
  const logs: string[] = [];
  renderReviewVerdict('APPROVED', [], (line) => logs.push(line));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /APPROVED/);
  assert.match(logs[0], /\[PASS\]/);
});

test('renderReviewVerdict surfaces a non-binary verdict only when verbose', () => {
  const quiet: string[] = [];
  renderReviewVerdict('COMMENT', [], (line) => quiet.push(line));
  assert.equal(quiet.length, 0, 'non-binary verdict is silent without verbose');

  const verbose: string[] = [];
  renderReviewVerdict('COMMENT', [], (line) => verbose.push(line), true);
  assert.equal(verbose.length, 1);
  assert.match(verbose[0], /Reviewer outcome = COMMENT/);
});
