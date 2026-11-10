import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../../src/application/ports/operation-history.js';
import type { UsageFilter, UsageFilterField, UsageRecord, UsageRepository } from '../../src/application/ports/mission-measurements.js';
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

/** Test-double equivalent of the SQL equality conjunction the sqlite adapter issues. */
export function matchesUsageFilter(record: UsageRecord, filter: UsageFilter): boolean {
  return (Object.keys(filter) as UsageFilterField[]).every(
    // Same rule as the adapter: a record never exposes empty text, so an empty-string constraint is unsatisfiable.
    (field) => filter[field] === undefined || (filter[field] !== '' && record[field] === filter[field]),
  );
}

/** In-memory usage telemetry; every write is a no-op so fixtures stay fixed. */
export class FakeUsageRepository implements UsageRepository {
  private readonly records: readonly UsageRecord[];

  constructor(records: readonly UsageRecord[]) { this.records = records; }

  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }

  async findWhere(filter: UsageFilter): Promise<readonly UsageRecord[]> {
    return this.records.filter((record) => matchesUsageFilter(record, filter));
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
