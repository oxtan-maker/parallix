import test from 'node:test';
import assert from 'node:assert/strict';
import { trailingBugShare, selectBugTrend } from '../../../../src/application/services/statistics-bug-trend.js';

test('trailing bug share averages observed shares in three calendar weeks', () => {
  assert.deepEqual(trailingBugShare([1, 0.5, null, 0, null, null, null]), [1, 0.75, 0.75, 0.25, 0, 0, null]);
});

test('bug trend direction compares consecutive trailing averages', () => {
  const weeks = selectBugTrend([
    { repo: 'r', mission: 'a', closedAt: '2026-09-07T00:00:00Z', labels: ['bug'] },
    { repo: 'r', mission: 'b', closedAt: '2026-09-14T00:00:00Z', labels: [] },
    { repo: 'r', mission: 'c', closedAt: '2026-09-21T00:00:00Z', labels: ['bug'] },
  ], new Date('2026-09-07'), new Date('2026-09-27'));
  assert.deepEqual(weeks?.map(week => week.direction), [null, 'falling', 'rising']);
});

test('full UTC weeks cross year boundaries and include Sunday instants only in their week', () => {
  const weeks = selectBugTrend([
    { repo: 'r', mission: 'a', closedAt: '2026-01-05T00:30:00+01:00', labels: ['bug'] },
    { repo: 'r', mission: 'b', closedAt: '2026-01-05T00:00:00Z', labels: [] },
    { repo: 'r', mission: 'invalid', closedAt: 'invalid', labels: ['bug'] },
  ], new Date('2025-12-29'), new Date('2026-01-11'));
  assert.deepEqual(weeks?.map(week => [week.start, week.bugs, week.completed, week.share]), [
    ['2025-12-29', 1, 1, 1], ['2026-01-05', 0, 1, 0],
  ]);
  assert.deepEqual(selectBugTrend([], new Date('2026-01-06'), new Date('2026-01-11')), []);
  assert.equal(selectBugTrend(null, new Date('2026-01-05'), new Date('2026-01-11')), null);
});
