import test from 'node:test';
import assert from 'node:assert/strict';

import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import {
  medianStateTimes,
  reviewLoopRateSeries,
  throughputSeries,
  weeklyThroughputSeries,
} from '../src/application/projections/metrics.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import type { MissionOutcome } from '../src/domain/usage.js';

class InMemoryUsageRepository implements UsageRepository {
  constructor(private readonly records: readonly UsageRecord[]) {}

  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }
  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> {
    return this.records.filter(predicate);
  }
  async save(): Promise<void> {}
  async saveAll(): Promise<void> {}
  async clear(): Promise<void> {}
}

test('throughput excludes active and review telemetry, and weekly buckets use closure week', async () => {
  const adapter = new ConcreteMetricsReadAdapter({
    // Partial double: this test only reads lane events, so the writing half of
    // the port is deliberately absent and the cast goes through `unknown`.
    laneEventRepo: { findByRepositoryId: async () => [] } as unknown as BoardLaneEventRepository,
    usageRepo: new InMemoryUsageRepository([
      { repo: 'parallix', mission: 'task-closed', date: '2026-06-01', closed: 'yes', duration_minutes: 10 },
      { repo: 'parallix', mission: 'task-active', date: '2026-07-27', stage: 'active', closed: 'no', duration_minutes: 20 },
      { repo: 'parallix', mission: 'task-review', date: '2026-07-28', stage: 'review', closed: 'no', duration_minutes: 30 },
    ]),
    repositoryId: 'parallix' as never,
  });

  const metrics = await adapter.buildMetrics(new Map());
  assert.equal(metrics.throughput.series.at(-1)?.value, 1);

  const weeks = weeklyThroughputSeries([
    { missionId: 'task-old' as never, repositoryId: 'parallix' as never, createdAt: '2026-05-26T00:00:00Z', closedAt: '2026-06-01T00:00:00Z', cycleTimeMinutes: 10, reviewFixRounds: 0, runs: [] },
    { missionId: 'task-current' as never, repositoryId: 'parallix' as never, createdAt: '2026-07-27T00:00:00Z', closedAt: '2026-08-02T00:00:00Z', cycleTimeMinutes: 10, reviewFixRounds: 0, runs: [] },
  ] as unknown as readonly MissionOutcome[]);
  assert.deepEqual(weeks.series, [
    { at: '2026-06-01T00:00:00.000Z', value: 1 },
    { at: '2026-07-27T00:00:00.000Z', value: 1 },
  ]);
});

test('historical metrics exclude outcomes closed after each instant', () => {
  const outcomes = [
    { missionId: 'task-early' as never, repositoryId: 'parallix' as never, createdAt: '2026-07-01T00:00:00Z', closedAt: '2026-07-10T00:00:00Z', cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
    { missionId: 'task-late' as never, repositoryId: 'parallix' as never, createdAt: '2026-07-11T00:00:00Z', closedAt: '2026-07-20T00:00:00Z', cycleTimeMinutes: 30, reviewFixRounds: 3, runs: [] },
  ] as unknown as readonly MissionOutcome[];
  const instants = ['2026-07-15T00:00:00Z', '2026-07-21T00:00:00Z'];

  assert.deepEqual(throughputSeries(outcomes, instants).series.map((point) => point.value), [1, 2]);
  assert.deepEqual(medianStateTimes(outcomes, instants).series.map((point) => point.value), [10, 20]);
  assert.deepEqual(reviewLoopRateSeries(outcomes, instants).series.map((point) => point.value), [1, 2]);
});
