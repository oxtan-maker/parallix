import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import type { RepositoryId } from '../src/domain/repository.js';

const require = createRequire(import.meta.url);
const stats = require('../.test-runtime/adapters/cli/commands/stats.js');

const REPOSITORY = 'acme/widgets' as RepositoryId;
const WINDOW = stats.createWindow('2026-08-03', 1);

class MemoryUsageRepository implements UsageRepository {
  constructor(private readonly records: readonly UsageRecord[]) {}
  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }
  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> { return this.records.filter(predicate); }
  async save(): Promise<void> {}
  async saveAll(): Promise<void> {}
  async clear(): Promise<void> {}
}

class EmptyLaneEventRepository implements BoardLaneEventRepository {
  async append(): Promise<boolean> { return true; }
  async findByMissionId(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async findAll(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async findByRepositoryId(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async clear(): Promise<void> {}
}

const ROWS: readonly UsageRecord[] = [
  { repo: REPOSITORY, mission: 'Task-2347.08', date: '2026-08-03', closed: 'yes', classification: 'ai_sdlc', duration_minutes: 30, pr_fix_rounds: 1 },
  { repo: REPOSITORY, mission: 'task-2347.08', date: '2026-08-03', closed: 'yes', classification: 'ai_sdlc', duration_minutes: 30, pr_fix_rounds: 1 },
];

test('task-2347.08 repro: CLI and board agree on identity, completions, and cycle time', async () => {
  const cli = stats.summarizeMissionWindow(ROWS, WINDOW);
  const board = new ConcreteMetricsReadAdapter({
    laneEventRepo: new EmptyLaneEventRepository(),
    usageRepo: new MemoryUsageRepository(ROWS),
    repositoryId: REPOSITORY,
  });
  const outcomes = await board.readOutcomes();
  const metrics = await board.buildMetrics(new Map<MissionId, MissionStatus>());

  assert.equal(cli.total, outcomes.length, 'mission count must agree');
  assert.deepEqual([...new Set(outcomes.map((outcome) => outcome.missionId.toLowerCase()))], ['task-2347.08']);
  assert.equal(metrics.medianStateTimes.series.at(-1)?.value, 0, 'cycle-time figure must agree for the same completed mission');
});
