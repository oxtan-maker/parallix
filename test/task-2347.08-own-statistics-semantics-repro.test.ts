import test from 'node:test';
import assert from 'node:assert/strict';

import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import type { RepositoryId } from '../src/domain/repository.js';
// `createWindow` and friends hang off the default export object, not the
// module's named exports, so this must be the default import.
import stats from '../src/adapters/cli/commands/stats.js';

const REPOSITORY = 'acme/widgets' as RepositoryId;
// @ts-expect-error -- TASK-2328: runtime-only property absent from the inferred type.
const WINDOW = stats.createWindow('2026-08-03', 1);

class MemoryUsageRepository implements UsageRepository {
  constructor(private readonly records: readonly UsageRecord[]) {}
  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }
  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> { return this.records.filter(predicate); }
  async save(): Promise<void> {}
  async saveAll(): Promise<void> {}
  async clear(): Promise<void> {}
}

class DoneLaneEventRepository implements BoardLaneEventRepository {
  async append(): Promise<boolean> { return true; }
  async findByMissionId(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async findAll(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async findByRepositoryId(): Promise<readonly BoardLaneEventEntry[]> {
    return [{ repositoryId: REPOSITORY, missionId: 'task-2347.08' as MissionId, fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-08-03T00:00:00Z', idempotencyKey: 'task-2347.08-done' }];
  }
  async clear(): Promise<void> {}
}

const ROWS: readonly UsageRecord[] = [
  { repo: REPOSITORY, mission: 'Task-2347.08', date: '2026-08-03', classification: 'ai_sdlc', duration_minutes: 30, pr_fix_rounds: 1 },
  { repo: REPOSITORY, mission: 'task-2347.08', date: '2026-08-03', classification: 'ai_sdlc', duration_minutes: 30, pr_fix_rounds: 1 },
];

test('task-2347.08 repro: CLI and board agree on identity, completions, and cycle time', async () => {
  // @ts-expect-error -- TASK-2328: runtime-only property absent from the inferred type.
  const cli = stats.summarizeMissionWindow(ROWS, WINDOW, new Set([`${REPOSITORY}::task-2347.08`]));
  const board = new ConcreteMetricsReadAdapter({
    laneEventRepo: new DoneLaneEventRepository(),
    usageRepo: new MemoryUsageRepository(ROWS),
    repositoryId: REPOSITORY,
    // Both sides report the same decision window. The CLI window above ends on
    // 2026-08-03, so the board's rolling window is evaluated on that day too;
    // otherwise the comparison is between two different weeks.
    clock: () => '2026-08-03T12:00:00.000Z',
  });
  const outcomes = await board.readOutcomes();
  const metrics = await board.buildMetrics(new Map<MissionId, MissionStatus>());

  assert.equal(cli.total, outcomes.length, 'mission count must agree');
  assert.deepEqual([...new Set(outcomes.map((outcome) => outcome.missionId.toLowerCase()))], ['task-2347.08']);
  assert.equal(metrics.medianStateTimes.series.at(-1)?.value, 0, 'cycle-time figure must agree for the same completed mission');
});
