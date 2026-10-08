import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBugTrend } from '../../../../src/application/services/statistics-bug-trend.js';
import { selectStatsReport } from '../../../../src/application/services/statistics-report-selection.js';

const outcomes = [
  { repo: 'r', mission: 'previous', closedAt: '2026-10-01T23:59:59Z', labels: ['bug', 'ai_sdlc'] },
  { repo: 'r', mission: 'first', closedAt: '2026-10-02T00:00:00Z', labels: ['user_value'] },
  { repo: 'r', mission: 'delivery', closedAt: '2026-10-07T12:00:00Z', labels: ['bug', 'user_value'] },
  { repo: 'r', mission: 'last', closedAt: '2026-10-08T23:59:59.999Z', labels: [] },
];

test('rolling bug populations include midnight and late last-day deliveries with previous separation (TASK-2685)', () => {
  const selection = selectStatsReport([], outcomes, { mode: 'weekly', timeZone: 'UTC', today: '2026-10-08' });
  assert.deepEqual(selection.bugTrend?.map(row => [row.start, row.end, row.completed, row.bugs, row.share]), [
    ['2026-10-02', '2026-10-08', 3, 1, 1 / 3], ['2026-09-25', '2026-10-01', 1, 1, 1],
  ]);
  assert.equal(selection.current.flow?.userValue, 2);
  assert.equal(selection.previous?.flow?.aiSdlc, 1);
});

test('same-day clock changes preserve populations and new deliveries shift bug share (TASK-2685)', () => {
  const select = (today: string, source = outcomes) => selectStatsReport([], source, { mode: 'weekly', timeZone: 'UTC', today });
  assert.deepEqual(select('2026-10-08T00:00:00Z'), select('2026-10-08T23:59:59Z'));
  assert.equal(select('2026-10-08', [...outcomes, { repo: 'r', mission: 'new', closedAt: '2026-10-08T15:00:00Z', labels: ['bug'] }]).bugTrend?.[0].share, 0.5);
});

test('explicit partial weeks retain all deliveries and normalize offset timestamps (TASK-2685)', () => {
  const rows = selectBugTrend([
    { repo: 'r', mission: 'offset', closedAt: '2026-01-05T00:30:00+01:00', labels: ['bug'] },
    { repo: 'r', mission: 'next', closedAt: '2026-01-05T00:00:00Z', labels: [] },
    { repo: 'r', mission: 'bad', closedAt: 'invalid', labels: ['bug'] },
  ], new Date('2026-01-04'), new Date('2026-01-04'), 'UTC');
  assert.deepEqual(rows?.map(row => [row.start, row.end, row.bugs, row.completed, row.share]), [['2026-01-04', '2026-01-04', 1, 1, 1]]);
});

test('empty and unavailable bug populations differ from observed zero (TASK-2685)', () => {
  const start = new Date('2026-10-02'); const end = new Date('2026-10-08');
  assert.equal(selectBugTrend(null, start, end), null);
  assert.equal(selectBugTrend([], start, end)?.[0].share, null);
  assert.equal(selectBugTrend([outcomes[1]!], start, end)?.[0].share, 0);
});
