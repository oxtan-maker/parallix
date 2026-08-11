import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../../src/application/ports/operation-history.js';
import type { UsageRecord, UsageRepository } from '../../src/application/ports/mission-measurements.js';
import { ConcreteMetricsReadAdapter } from '../../src/application/projections/metrics-read-adapter.js';
import type { RepositoryId } from '../../src/domain/repository.js';

/** In-memory lane-event history; every write is a no-op so fixtures stay fixed. */
export class FakeLaneEventRepository implements BoardLaneEventRepository {
  private readonly entries: readonly BoardLaneEventEntry[];

  constructor(entries: readonly BoardLaneEventEntry[]) { this.entries = entries; }

  async append(): Promise<boolean> { return true; }

  async findByMissionId(id: string): Promise<readonly BoardLaneEventEntry[]> {
    return this.entries.filter((entry) => entry.missionId === id);
  }

  async findAll(): Promise<readonly BoardLaneEventEntry[]> { return this.entries; }

  async findByRepositoryId(repositoryId: string): Promise<readonly BoardLaneEventEntry[]> {
    return this.entries.filter((entry) => entry.repositoryId === repositoryId);
  }

  async clear(): Promise<void> { /* fixture is immutable */ }
}

/** In-memory usage telemetry; every write is a no-op so fixtures stay fixed. */
export class FakeUsageRepository implements UsageRepository {
  private readonly records: readonly UsageRecord[];

  constructor(records: readonly UsageRecord[]) { this.records = records; }

  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }

  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> {
    return this.records.filter((record) => predicate(record));
  }

  async save(): Promise<void> { /* fixture is immutable */ }

  async saveAll(): Promise<void> { /* fixture is immutable */ }

  async clear(): Promise<void> { /* fixture is immutable */ }
}

/** One lane transition, with an idempotency key derived from its own facts. */
export function laneEvent(
  repositoryId: RepositoryId,
  missionId: string,
  fromStatus: string | null,
  toStatus: string,
  trigger: string,
  occurredAt: string,
): BoardLaneEventEntry {
  return {
    repositoryId,
    missionId,
    fromStatus,
    toStatus,
    trigger,
    agent: 'codex',
    occurredAt,
    idempotencyKey: `${missionId}-${toStatus}-${occurredAt}`,
  };
}

/**
 * A metrics read adapter backed entirely by the given in-memory rows.
 *
 * `clock` pins the projection instant. Completed-mission metrics are reported
 * over a rolling seven-day decision window, so a test whose fixture carries
 * fixed dates must pin the clock beside them or the fixture silently ages out
 * of the window.
 */
export function metricsAdapter(
  repositoryId: RepositoryId,
  entries: readonly BoardLaneEventEntry[],
  records: readonly UsageRecord[],
  clock?: () => string,
): ConcreteMetricsReadAdapter {
  return new ConcreteMetricsReadAdapter({
    laneEventRepo: new FakeLaneEventRepository(entries),
    usageRepo: new FakeUsageRepository(records),
    repositoryId,
    ...(clock === undefined ? {} : { clock }),
  });
}
