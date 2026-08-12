import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import stats, { recordStageStats, upsertMeasurementRow } from '../src/adapters/cli/commands/stats.js';
import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  fixedClock,
  laneEvent,
  withStatisticsDatabase,
} from './fixtures/task-2357-statistics-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2363 integrity defect A — a stage row with no review-fix count yet must
// not fabricate a measured zero.
//
// TASK-2357 already proved that an explicit `null` survives SQLite → read →
// MissionOutcome → cohort (test/task-2357.c-unknown-review-fix-rounds.test.ts).
// The remaining producer gap was `recordStageStats` / `accumulateStageStats`
// defaulting `prFixRounds` to '0'. Former behavior that makes these fail: that
// default, which wrote 0 into every draft and active stage row.
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const KNOWN_ZERO = missionId('task-500');
const UNKNOWN = missionId('task-501');

const INTAKE = '2026-06-01T09:00:00.000Z';
const DONE = '2026-06-02T09:00:00.000Z';
const NOW = '2026-06-03T09:00:00.000Z';

function repoWithMission(slug: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2363-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'tasks', `${slug} - fixture.md`),
    `---\nid: ${slug.toUpperCase()}\ntitle: fixture\nstatus: active\nlabels: [ai_sdlc]\n---\n\n## Description\n`,
  );
  return root;
}

describe('TASK-2363 defect A: an unrecorded review-fix count stays unknown', () => {
  it('writes SQL NULL when a stage row has no review-fix count yet', async () => {
    const root = repoWithMission('task-501');
    await withStatisticsDatabase(async ({ db, databasePath }) => {
      const store = new SqliteMeasurementStore(databasePath);
      try {
        recordStageStats({ slug: 'task-501', stage: 'active', rootDir: root, date: '2026-06-02', implementer: 'claude', store } as any);
      } finally {
        store.close();
      }
      const rows = await db.query<{ pr_fix_rounds: unknown }>(
        'SELECT pr_fix_rounds FROM usage_statistics;',
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.pr_fix_rounds, null, 'an unrecorded count must be SQL NULL, not 0');
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps an explicitly recorded zero as a zero', async () => {
    const root = repoWithMission('task-500');
    await withStatisticsDatabase(async ({ db, databasePath }) => {
      const store = new SqliteMeasurementStore(databasePath);
      try {
        recordStageStats({ slug: 'task-500', stage: 'review', rootDir: root, date: '2026-06-02', reviewer: 'claude', prFixRounds: '0', store } as any);
      } finally {
        store.close();
      }
      const rows = await db.query<{ pr_fix_rounds: unknown }>(
        'SELECT pr_fix_rounds FROM usage_statistics;',
      );
      assert.equal(rows[0]?.pr_fix_rounds, 0, 'a measured zero stays a zero');
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('carries the distinction through to the windowed cohort', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo, databasePath }) => {
      for (const mission of [KNOWN_ZERO, UNKNOWN]) {
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'done', at: DONE }));
      }
      const store = new SqliteMeasurementStore(databasePath);
      try {
        upsertMeasurementRow({
          date: '2026-06-02', repo: REPO, mission: KNOWN_ZERO, classification: 'ai_sdlc',
          implementer: 'claude', pr_fix_rounds: '0', stage: 'default',
        } as any, { store });
        upsertMeasurementRow({
          date: '2026-06-02', repo: REPO, mission: UNKNOWN, classification: 'ai_sdlc',
          implementer: 'claude', stage: 'default',
        } as any, { store });
      } finally {
        store.close();
      }

      const adapter = new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      });
      const outcomes = await adapter.readOutcomes();
      assert.equal(
        outcomes.find((outcome) => outcome.missionId === KNOWN_ZERO)?.reviewFixRounds,
        0,
        'a measured zero stays 0',
      );
      assert.equal(
        outcomes.find((outcome) => outcome.missionId === UNKNOWN)?.reviewFixRounds,
        null,
        'an omitted count reaches the outcome as null',
      );

      const metrics = await adapter.buildMetrics(new Map<MissionId, MissionStatus>([
        [KNOWN_ZERO, 'done'],
        [UNKNOWN, 'done'],
      ]));
      const cohort = metrics.cohorts?.cohorts.find((entry) => entry.key === 'ai_sdlc');
      assert.equal(cohort?.n, 2, 'both missions are in the decision window population');
      assert.equal(cohort?.observationCounts.reviewFixRounds, 1, 'only the measured zero is an observation');
      assert.equal(cohort?.medianReviewFixRounds, 0);
    });
  });
});

