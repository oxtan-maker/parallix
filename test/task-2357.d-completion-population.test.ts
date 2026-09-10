import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createStatsCommand, createStatsWorkflowAdapter } from '../src/adapters/cli/commands/stats.js';
import { StatsCommandUseCase } from '../src/application/stats-command-use-case.js';
import type { MissionStore } from '../src/application/domain-ports.js';
import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  fixedClock,
  insertUsageRow,
  laneEvent,
  withStatisticsDatabase,
} from './fixtures/task-2357-statistics-fixture.js';

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

// Render-only `px stats` invocation: the mission-flow report reads
// measurement rows and never consults the Mission authority, so a store
// placeholder satisfies the required wiring without touching derivation.
const stats = createStatsCommand(
  new StatsCommandUseCase(createStatsWorkflowAdapter({} as MissionStore)),
);

/** Hand-computed: two missions entered `done` in the reporting week. */
const EXPECTED_COMPLETED = [DONE_WITH_TELEMETRY, DONE_WITHOUT_TELEMETRY];

async function seed(
  laneEventRepo: { append: (_entry: ReturnType<typeof laneEvent>) => Promise<boolean> },
  db: { execute: (_sql: string, _params: readonly unknown[]) => Promise<unknown> },
): Promise<void> {
  for (const mission of [DONE_WITH_TELEMETRY, DONE_WITHOUT_TELEMETRY, TELEMETRY_WITHOUT_DONE]) {
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
  }
  await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: DONE_WITH_TELEMETRY, from: 'backlog', to: 'done', at: CLOSED }));
  await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: DONE_WITHOUT_TELEMETRY, from: 'backlog', to: 'done', at: CLOSED }));
  await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TELEMETRY_WITHOUT_DONE, from: 'backlog', to: 'active', at: CLOSED }));

  await insertUsageRow(db as never, {
    repo: REPO, mission: DONE_WITH_TELEMETRY, date: '2026-06-02',
    classification: 'user_value', prFixRounds: 1,
  });
  // Telemetry that claims closure for a mission the lifecycle never completed.
  await insertUsageRow(db as never, {
    repo: REPO, mission: TELEMETRY_WITHOUT_DONE, date: '2026-06-02',
    classification: 'ai_sdlc', prFixRounds: 3,
  });
}

describe('TASK-2357 defect D: lifecycle `done` is the only completion definition', () => {
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
    await withStatisticsDatabase(async ({ db, databasePath, laneEventRepo, usageRepo }) => {
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
          rootDir: process.cwd(),
          store,
          laneEventRepo,
          usageRepo,
          repositoryId: REPO,
          log: (message: unknown) => { lines.push(String(message)); },
          error: (message: unknown) => { lines.push(`ERROR ${String(message)}`); },
          exit: () => undefined,
        } as never);
      } finally {
        store.close();
        if (previousDebug === undefined) { delete process.env.DEBUG; } else { process.env.DEBUG = previousDebug; }
      }
      const report = lines.join('\n').replace(/\[[0-9;]*m/g, '');

      // The shared mission-flow section counts lifecycle completions: 2.
      assert.match(report, /Mission flow — current week/, `no mission-flow section in:\n${report}`);
      const flowSection = report.split('Mission flow — current week')[1]?.split('Agent telemetry')[0] ?? '';
      assert.match(flowSection, /# completed missions/, flowSection);
      assert.match(flowSection, /\b2\b/, `expected 2 lifecycle completions in:\n${flowSection}`);

      // The telemetry tables must not present a competing completed count.
      assert.match(report, /Agent telemetry — current week/, report);
      assert.match(report, /# missions with telemetry/, report);
      assert.doesNotMatch(report, /^\s*# missions\s{2,}# user value/m, report);
    });
  });
});
