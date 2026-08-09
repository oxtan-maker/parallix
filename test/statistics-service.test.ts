import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isCompletedStatisticsRow,
  statisticsEvaluationInstants,
  statisticsMissionKey,
  statisticsRowInWindow,
  summarizeCompletedMissionWindow,
  utcHourBucket,
} from '../src/application/services/statistics-service.js';

const window = { start: new Date('2026-08-03T00:00:00Z'), end: new Date('2026-08-03T00:00:00Z') };

test('statistics service owns canonical mission identity, completion, and reporting windows', () => {
  const rows = [
    { repo: 'acme', mission: 'Task-1', date: '2026-08-03', closed: 'yes' },
    { repo: 'acme', mission: 'task-1', date: '2026-08-03', closed: 'yes' },
    { repo: 'acme', mission: 'task-2', date: '2026-08-03', closed: 'true' },
    { repo: 'acme', mission: 'task-3', date: '2026-08-04', closed: 'yes' },
  ];
  assert.equal(statisticsMissionKey(rows[0]!), 'acme::task-1');
  assert.equal(isCompletedStatisticsRow(rows[2]!), false);
  assert.equal(statisticsRowInWindow(rows[3]!, window), false);
  assert.deepEqual(summarizeCompletedMissionWindow(rows, window).missions.map((row) => row.mission), ['Task-1']);
});

test('statistics service buckets equivalent offsets in the same UTC hour', () => {
  assert.equal(utcHourBucket('2026-08-03T10:45:00+02:00'), '2026-08-03T08:00:00.000Z');
  assert.deepEqual(
    statisticsEvaluationInstants(['2026-08-03T10:45:00+02:00', '2026-08-03T08:05:00Z']),
    ['2026-08-03T08:00:00.000Z'],
  );
});
