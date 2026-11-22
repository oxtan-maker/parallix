import type { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../../../src/application/ports/operation-history.js';
// Historical regression provenance: TASK-2357.
/**
 * Completed-mission population for the metrics slice (TASK-2622.13
 * consolidation).
 *
 * integration-ci tier provenance test migrated from
 * `test/task-2357.d-completion-population.test.ts` (TASK-2357 defect D): the
 * completed population is exactly the missions the lifecycle reached `done`,
 * shared by the board projection and the CLI mission-flow report. These exercise
 * the real sqlite operator database and the production `px stats` composition,
 * so they stay in the integration-ci lane. Historical task ID retained in the
 * case name as regression provenance (AC#7).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStatisticsCommand, type StatsCompositionOptions } from '../../../src/composition/stats.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { SqliteMeasurementStore } from '../../../src/adapters/sqlite/measurement-store.js';
import { verificationStatistics as verificationStatisticsProjection } from '../../../src/application/projections/verification-statistics.js';
import { ConcreteMetricsReadAdapter } from '../../../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus } from '../../../src/domain/mission.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import {
  fixedClock,
  insertUsageRow,
  laneEvent,
  withStatisticsDatabase,
} from '../../fixtures/statistics-database.js';

// ---------------------------------------------------------------------------
// TASK-2357 defect D — one completed-mission population.
//
//   A — reached `done`, has telemetry            → completed
//   B — reached `done`, has no telemetry at all  → completed
//   C — has telemetry claiming closure, never reached `done` → not completed
//
// The completed population is exactly {A, B} for BoardMetrics, for cohorts, and
// for the shared CLI mission-flow statistics.
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const DONE_WITH_TELEMETRY = missionId('task-301');
const DONE_WITHOUT_TELEMETRY = missionId('task-302');
const TELEMETRY_WITHOUT_DONE = missionId('task-303');

const INTAKE = '2026-06-01T09:00:00.000Z';
const CLOSED = '2026-06-02T09:00:00.000Z';
const NOW = '2026-06-05T09:00:00.000Z';

const stats = (args: string[], options: StatsCompositionOptions = {}) => createStatisticsCommand(options)(args, options);

/** Hand-computed: two missions entered `done` in the reporting week. */
const EXPECTED_COMPLETED = [DONE_WITH_TELEMETRY, DONE_WITHOUT_TELEMETRY];

async function seed(
  laneEventRepo: { append: (_entry: ReturnType<typeof laneEvent>) => Promise<boolean> },
  db: SqliteDatabaseAdapter,
): Promise<void> {
  for (const mission of [DONE_WITH_TELEMETRY, DONE_WITHOUT_TELEMETRY, TELEMETRY_WITHOUT_DONE]) {
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
  }
  await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: DONE_WITH_TELEMETRY, from: 'backlog', to: 'done', at: CLOSED }));
  await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: DONE_WITHOUT_TELEMETRY, from: 'backlog', to: 'done', at: CLOSED }));
  await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TELEMETRY_WITHOUT_DONE, from: 'backlog', to: 'active', at: CLOSED }));

  await insertUsageRow(db, {
    repo: REPO, mission: DONE_WITH_TELEMETRY, date: '2026-06-02',
    classification: 'user_value', prFixRounds: 1,
  });
  // Telemetry that claims closure for a mission the lifecycle never completed.
  await insertUsageRow(db, {
    repo: REPO, mission: TELEMETRY_WITHOUT_DONE, date: '2026-06-02',
    classification: 'ai_sdlc', prFixRounds: 3,
  });
}

describe("defect D: lifecycle `done` is the only completion definition", () => {
  it('reports exactly the lifecycle-completed missions as outcomes', async () => {
    await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo }) => {
      await seed(laneEventRepo, db);
      const outcomes = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).readOutcomes();

      assert.deepEqual(
        [...outcomes.map((outcome) => outcome.missionId)].sort(),
        [...EXPECTED_COMPLETED].sort(),
      );
      const telemetryFree = outcomes.find((outcome) => outcome.missionId === DONE_WITHOUT_TELEMETRY);
      assert.ok(telemetryFree, 'a lifecycle-completed mission counts without telemetry');
      // Execution measurements stay unavailable rather than becoming zero.
      assert.equal(telemetryFree.totalCostUsd, null);
      assert.equal(telemetryFree.totalInputAndOutputTokens, null);
    });
  });

  it('gives the shared CLI mission-flow report the same population as the board', async () => {
    await withStatisticsDatabase(async ({ dir, db, databasePath, laneEventRepo, usageRepo }) => {
      await seed(laneEventRepo, db);

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>([
        [DONE_WITH_TELEMETRY, 'done'],
        [DONE_WITHOUT_TELEMETRY, 'done'],
        [TELEMETRY_WITHOUT_DONE, 'active'],
      ]));
      assert.equal(metrics.provenance.sampleSize, EXPECTED_COMPLETED.length);

      const lines: string[] = [];
      const store = new SqliteMeasurementStore(databasePath);
      // "# missions with telemetry" renders behind DEBUG only; enable it so this
      // test verifies the column renders when the flag is set.
      const previousDebug = process.env.DEBUG;
      process.env.DEBUG = '1';
      try {
        await stats(['--today', '2026-06-05'], {
          rootDir: dir,
          store,
          missionStore: new SqliteMissionStore(db),
          laneEventRepo,
          usageRepo,
          repositoryId: REPO,
          log: (message: unknown) => { lines.push(String(message)); },
          error: (message: unknown) => { lines.push(`ERROR ${String(message)}`); },
          exit: () => undefined,
        });
      } finally {
        store.close();
        if (previousDebug === undefined) { delete process.env.DEBUG; } else { process.env.DEBUG = previousDebug; }
      }
      const report = lines.join('\n').replace(/\[[0-9;]*m/g, '');

      // The shared mission-flow section counts lifecycle completions: 2.
      assert.match(report, /Mission flow — current week/, `no mission-flow section in:\n${report}`);
      const flowSection = report.split('Mission flow — current week')[1]?.split('Mission flow — previous week')[0] ?? '';
      assert.match(flowSection, /# completed missions/, flowSection);
      assert.match(flowSection, /\b2\b/, `expected 2 lifecycle completions in:\n${flowSection}`);

      // No telemetry table may present a competing completed count.
      assert.doesNotMatch(report, /Agent telemetry/, report);
      assert.doesNotMatch(report, /^\s*# missions\s{2,}# user value/m, report);
    });
  });

  it('reads the verification once per weekly report, limited to the windows and shared by the FLOW observation and the report (TASK-2867.07)', async () => {
    await withStatisticsDatabase(async ({ dir, db, databasePath, laneEventRepo, usageRepo }) => {
      await seed(laneEventRepo, db);
      const verificationReads: { missions: string[]; windows: number }[] = [];
      const verificationStatistics = {
        read: async (missions?: ReadonlySet<string>, windows?: readonly unknown[]) => {
          verificationReads.push({ missions: [...missions ?? []].sort(), windows: windows?.length ?? 0 });
          return verificationStatisticsProjection({ repositoryId: 'fixture-repo', history: [], operations: [], lifecycle: [] });
        },
        readRepository: async () => { throw new Error('a weekly report reads no repository-wide verification'); },
      };
      const store = new SqliteMeasurementStore(databasePath);
      try {
        await stats(['--today', '2026-06-05'], { rootDir: dir, store, missionStore: new SqliteMissionStore(db), laneEventRepo, usageRepo,
          repositoryId: REPO, verificationStatistics, log: () => undefined, error: () => undefined, exit: () => undefined });
      } finally { store.close(); }
      assert.deepEqual(verificationReads, [{ missions: [...EXPECTED_COMPLETED].sort(), windows: 2 }],
        'one read serves the FLOW observation and the verification section, with the two weekly windows');
    });
  });

  it('lists the lane history once and reads rebound repairs once per weekly report (TASK-2867.07)', async () => {
    await withStatisticsDatabase(async ({ dir, db, databasePath, laneEventRepo, usageRepo, historyRepo }) => {
      await seed(laneEventRepo, db);
      const { fixtureMission } = await import('../../fixtures/mission-builders.js');
      const missionStore = new SqliteMissionStore(db);
      for (const mission of EXPECTED_COMPLETED) {
        await missionStore.save(fixtureMission(String(mission), { repositoryId: REPO, status: 'done', closedAt: CLOSED }), null);
      }
      const counts = { laneListings: 0, perMissionLaneReads: 0, repairReads: 0 };
      const countedLane: BoardLaneEventRepository = new Proxy(laneEventRepo, {
        get: (target, property) => {
          if (property === 'findAll') return () => { counts.laneListings += 1; return target.findAll(); };
          if (property === 'findByMissionId') return (missionId: string) => {
            counts.perMissionLaneReads += 1;
            return target.findByMissionId(missionId);
          };
          const value = Reflect.get(target, property) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const countedHistory: OperationalHistoryRepository = new Proxy(historyRepo, {
        get: (target, property) => {
          if (property === 'findReboundRepairs') return () => { counts.repairReads += 1; return target.findReboundRepairs(); };
          const value = Reflect.get(target, property) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const verificationStatistics = {
        read: async () => verificationStatisticsProjection({ repositoryId: 'fixture-repo', history: [], operations: [], lifecycle: [] }),
        readRepository: async () => { throw new Error('a weekly report reads no repository-wide verification'); },
      };
      const store = new SqliteMeasurementStore(databasePath);
      try {
        await stats(['--today', '2026-06-05'], { rootDir: dir, store, missionStore,
          laneEventRepo: countedLane, usageRepo, historyRepo: countedHistory, repositoryId: REPO, verificationStatistics,
          log: () => undefined, error: () => undefined, exit: () => undefined });
      } finally { store.close(); }
      assert.deepEqual(counts, { laneListings: 1, perMissionLaneReads: 0, repairReads: 1 },
        'one collapsed lane listing and one compact rebound-repair read serve every Mission of the run');
    });
  });
});

