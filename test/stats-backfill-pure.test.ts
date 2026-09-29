// @ts-nocheck -- TASK-2535: partial test doubles for the stats-backfill pure
// export (extractDateOnly).
// Mirrors the established mockModule/@ts-nocheck pattern in test/stats-backfill.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractDateOnly } from '../src/adapters/cli/commands/stats-backfill.js';

test('extractDateOnly parses an ISO date prefix', () => {
  assert.equal(extractDateOnly('2024-03-01'), '2024-03-01');
  assert.equal(extractDateOnly('2024-03-01T12:00:00Z'), '2024-03-01');
});

test('extractDateOnly returns null for non-matching or nullish input', () => {
  assert.equal(extractDateOnly('not a date'), null);
  assert.equal(extractDateOnly(''), null);
  assert.equal(extractDateOnly(null), null);
  assert.equal(extractDateOnly(undefined), null);
});
