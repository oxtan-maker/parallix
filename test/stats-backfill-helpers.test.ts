import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDateOnly } from '../src/adapters/cli/commands/stats-backfill.js';

test('extractDateOnly returns the leading ISO date when present', () => {
  assert.equal(extractDateOnly('2026-09-17T15:20:00Z'), '2026-09-17');
});

test('extractDateOnly returns null when no ISO date is present', () => {
  assert.equal(extractDateOnly('not a date'), null);
});

test('extractDateOnly coerces nullish input', () => {
  assert.equal(extractDateOnly(null), null);
  assert.equal(extractDateOnly(undefined), null);
  assert.equal(extractDateOnly(''), null);
});
