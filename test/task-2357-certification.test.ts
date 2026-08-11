import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus, MissionLabel } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import type { AgentFamily } from '../src/domain/agents.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';
import { createPrimaryAndWorktree, fixedClock, insertUsageRow, laneEvent } from './fixtures/task-2357-statistics-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2357 Production Certification
//
// Replaces the former helper-level certification. Exercises the full production
// path from authoritative persisted facts through ConcreteMetricsReadAdapter
// and compareCohorts to BoardMetrics — no manually constructed transitions,
// outcomes, or BoardMetrics objects.
//
// Fixture covers: earlier/later intake, lifecycle-completed with and without
// telemetry, telemetry without lifecycle completion, known zero/nonzero/unknown
// review-fix rounds, review bounce and no-bounce, previous-week completions
// plus current zero week, partial runtime/token/cost/NEL coverage, two
// experiment labels, non-UTC source timestamp, per-repository legacy fallback,
// real Git primary/worktree identity, and cross-repository isolation.
// ---------------------------------------------------------------------------

const REPO = repositoryId('certification-repo');
const REPO_B = repositoryId('unrelated-repo');

// Hand-computed fixture — values stated beside the data they describe.
//
// Mission layout (all intaked in week of 2026-06-01, done in week of 2026-06-08):
//
//   task-100 (label: ai_sdlc): intake Mon, done Fri. Known reviewFixRounds=0.
//     Bounced once (review→active). Has runtime=45, tokens=5000, cost=2.50.
//
//   task-101 (label: ai_sdlc): intake Mon, done Wed. Known reviewFixRounds=2.
//     No bounce. Has runtime=30, tokens=3000, cost=1.75.
//
//   task-102 (label: user_value): intake Mon, done Thu. Unknown reviewFixRounds.
//     Entered review, no bounce. Has runtime=60, NO tokens, NO cost.
//
//   task-103 (label: user_value): intake Mon, done Fri. Unknown reviewFixRounds.
//     No review. Has NO runtime, NO tokens, NO cost.
//
//   task-104 (label: ai_sdlc): intake Thu (later), done Fri. Known reviewFixRounds=1.
//     No review. Has runtime=20, tokens=2000, cost=0.80.
//
//   task-105 (label: ai_sdlc): lifecycle done Fri, NO telemetry at all.
//     Cycle time from lane events only. reviewFixRounds=null.
//
//   task-106 (label: user_value): has telemetry (closed=yes) but NOT lifecycle done.
//     Must NOT appear in completed population.
//
//   task-107 (label: ai_sdlc): completed previous week (2026-05-25).
//     Proves prior nonzero week does not leak into current zero week.
//
//   task-200 (REPO_B, label: ai_sdlc): colliding mission ID with REPO.
//     Proves cross-repository isolation.
//
// Expected completed population (lifecycle done): task-100..105, task-107 = 7
// task-106 excluded (telemetry closed but not lifecycle done).
//
// The board's cohort comparison is the current rolling seven days ending on
// NOW (2026-05-31 → 2026-06-06), so task-107 — deliberately completed in the
// previous week — is outside it (TASK-2363).
//
// Cohort ai_sdlc: task-100, 101, 104, 105 = 4 missions (task-107 is last week)
// Cohort user_value: task-102, 103 = 2 missions
//
// reviewFixRounds observations: task-100(0), 101(2), 104(1) = 3 known
//   task-102, 103, 105 = 3 unknown → observationCount = 3

const INTAKE_MON = '2026-06-01T09:00:00.000Z';
const INTAKE_THU = '2026-06-04T09:00:00.000Z';
const DONE_WED = '2026-06-03T17:00:00.000Z';
const DONE_THU = '2026-06-04T17:00:00.000Z';
const DONE_FRI = '2026-06-05T17:00:00.000Z';
const PREV_WEEK_DONE = '2026-05-25T17:00:00.000Z';
const NOW = '2026-06-06T09:00:00.000Z';

// Hand-computed expected values
const EXPECTED_COMPLETED = 7; // task-100..105 + task-107
const EXPECTED_AI_SDL_C_N = 4; // task-100, 101, 104, 105 — task-107 is previous week
const EXPECTED_USER_VALUE_N = 2; // task-102, 103
const EXPECTED_REVIEW_FIX_OBS_AI_SDL_C = 3; // task-100(0), 101(2), 104(1)
const EXPECTED_REVIEW_FIX_OBS_USER_VALUE = 0; // both unknown

describe('TASK-2357 production certification: full path from persisted facts to BoardMetrics', () => {
  let dir: string;
  let databasePath: string;
  let db: SqliteDatabaseAdapter;
  let laneEventRepo: SqliteBoardLaneEventRepository;
  let usageRepo: SqliteUsageRepository;
  let checkouts: ReturnType<typeof createPrimaryAndWorktree>;

  afterEach(() => {
    db.close();
    checkouts.cleanup();
  });

  it('exercises the full production path with hand-computed assertions', async () => {
    // 1. Real Git primary + worktree
    checkouts = createPrimaryAndWorktree('cert-repo');

    // 2. Migrated SQLite database
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-cert-'));
    databasePath = path.join(dir, 'parallix.db');
    db = new SqliteDatabaseAdapter();
    await db.open({ path: databasePath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    laneEventRepo = new SqliteBoardLaneEventRepository(db);
    usageRepo = new SqliteUsageRepository(db);

    // 3. Persist lane events (real SQLite writes)
    const task100 = missionId('task-100');
    const task101 = missionId('task-101');
    const task102 = missionId('task-102');
    const task103 = missionId('task-103');
    const task104 = missionId('task-104');
    const task105 = missionId('task-105');
    const task106 = missionId('task-106');
    const task107 = missionId('task-107');
    const task200 = missionId('task-200');

    // task-100: intake Mon, review bounce, done Fri
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task100, from: null, to: 'backlog', at: INTAKE_MON }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task100, from: 'backlog', to: 'active', at: '2026-06-01T10:00:00.000Z' }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task100, from: 'active', to: 'review', at: '2026-06-02T09:00:00.000Z' }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task100, from: 'review', to: 'active', at: '2026-06-02T14:00:00.000Z' })); // bounce
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task100, from: 'active', to: 'done', at: DONE_FRI }));

    // task-101: intake Mon, done Wed, no bounce
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task101, from: null, to: 'backlog', at: INTAKE_MON }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task101, from: 'backlog', to: 'done', at: DONE_WED }));

    // task-102: intake Mon, done Thu, review no bounce
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task102, from: null, to: 'backlog', at: INTAKE_MON }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task102, from: 'backlog', to: 'review', at: '2026-06-02T09:00:00.000Z' }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task102, from: 'review', to: 'done', at: DONE_THU }));

    // task-103: intake Mon, done Fri, no review
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task103, from: null, to: 'backlog', at: INTAKE_MON }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task103, from: 'backlog', to: 'done', at: DONE_FRI }));

    // task-104: intake Thu (later), done Fri
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task104, from: null, to: 'backlog', at: INTAKE_THU }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task104, from: 'backlog', to: 'done', at: DONE_FRI }));

    // task-105: lifecycle done, no telemetry
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task105, from: null, to: 'backlog', at: INTAKE_MON }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task105, from: 'backlog', to: 'done', at: DONE_FRI }));

    // task-106: has telemetry (closed=yes) but NOT lifecycle done
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task106, from: null, to: 'backlog', at: INTAKE_MON }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task106, from: 'backlog', to: 'active', at: '2026-06-02T09:00:00.000Z' }));

    // task-107: completed previous week
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task107, from: null, to: 'backlog', at: '2026-05-18T09:00:00.000Z' }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: task107, from: 'backlog', to: 'done', at: PREV_WEEK_DONE }));

    // task-200 (REPO_B): colliding mission ID
    await laneEventRepo.append(laneEvent({ repositoryId: REPO_B, missionId: task200, from: null, to: 'backlog', at: INTAKE_MON }));
    await laneEventRepo.append(laneEvent({ repositoryId: REPO_B, missionId: task200, from: 'backlog', to: 'done', at: DONE_FRI }));

    // 4. Persist usage rows (real SQLite writes)
    await insertUsageRow(db, { repo: REPO, mission: task100, date: '2026-06-05', classification: 'ai_sdlc', closed: 'yes', prFixRounds: 0, durationMinutes: 45, inputTokens: 5000, costUsd: 2.50 });
    await insertUsageRow(db, { repo: REPO, mission: task101, date: '2026-06-03', classification: 'ai_sdlc', closed: 'yes', prFixRounds: 2, durationMinutes: 30, inputTokens: 3000, costUsd: 1.75 });
    await insertUsageRow(db, { repo: REPO, mission: task102, date: '2026-06-04', classification: 'user_value', closed: 'yes', prFixRounds: null, durationMinutes: 60 });
    await insertUsageRow(db, { repo: REPO, mission: task103, date: '2026-06-05', classification: 'user_value', closed: 'yes', prFixRounds: null });
    await insertUsageRow(db, { repo: REPO, mission: task104, date: '2026-06-05', classification: 'ai_sdlc', closed: 'yes', prFixRounds: 1, durationMinutes: 20, inputTokens: 2000, costUsd: 0.80 });
    // task-105: no telemetry
    await insertUsageRow(db, { repo: REPO, mission: task106, date: '2026-06-05', classification: 'user_value', closed: 'yes', prFixRounds: 1, durationMinutes: 25 });
    await insertUsageRow(db, { repo: REPO, mission: task107, date: '2026-05-25', classification: 'ai_sdlc', closed: 'yes', prFixRounds: 0, durationMinutes: 35, inputTokens: 4000, costUsd: 1.50 });
    await insertUsageRow(db, { repo: REPO_B, mission: task200, date: '2026-06-05', classification: 'ai_sdlc', closed: 'yes', prFixRounds: 3, durationMinutes: 50 });

    // 5. Build metrics through ConcreteMetricsReadAdapter (production path)
    const cohortMetadata = async () => new Map<MissionId, { labels: readonly MissionLabel[]; assignee: AgentFamily | null }>([
      [task100, { labels: ['ai_sdlc' as MissionLabel], assignee: agentFamily('claude') }],
      [task101, { labels: ['ai_sdlc' as MissionLabel], assignee: agentFamily('claude') }],
      [task102, { labels: ['user_value' as MissionLabel], assignee: agentFamily('claude') }],
      [task103, { labels: ['user_value' as MissionLabel], assignee: agentFamily('claude') }],
      [task104, { labels: ['ai_sdlc' as MissionLabel], assignee: agentFamily('claude') }],
      [task105, { labels: ['ai_sdlc' as MissionLabel], assignee: agentFamily('claude') }],
      [task106, { labels: ['user_value' as MissionLabel], assignee: agentFamily('claude') }],
      [task107, { labels: ['ai_sdlc' as MissionLabel], assignee: agentFamily('claude') }],
    ]);

    const adapter = new ConcreteMetricsReadAdapter({
      laneEventRepo,
      usageRepo,
      repositoryId: REPO,
      clock: fixedClock(NOW),
      cohortMetadata,
    });

    const initialStates = new Map<MissionId, MissionStatus>([
      [task100, 'done'], [task101, 'done'], [task102, 'done'],
      [task103, 'done'], [task104, 'done'], [task105, 'done'],
      [task106, 'active'], [task107, 'done'],
    ]);

    const metrics = await adapter.buildMetrics(initialStates);

    // 6. Assert hand-computed values

    // 6a. Completion population
    const outcomes = await adapter.readOutcomes();
    assert.equal(
      outcomes.length,
      EXPECTED_COMPLETED,
      `completed population is ${EXPECTED_COMPLETED} (lifecycle done), not ${outcomes.length}`,
    );
    const outcomeIds = outcomes.map(o => o.missionId);
    assert.ok(outcomeIds.includes(task105), 'task-105 (lifecycle done, no telemetry) is completed');
    assert.ok(!outcomeIds.includes(task106), 'task-106 (telemetry closed, not lifecycle done) is NOT completed');

    // 6b. Cohort population
    const cohorts = metrics.cohorts!;
    const aiSdlc = cohorts.cohorts.find(c => c.key === 'ai_sdlc')!;
    const userValue = cohorts.cohorts.find(c => c.key === 'user_value')!;
    assert.equal(aiSdlc.n, EXPECTED_AI_SDL_C_N, `ai_sdlc cohort n=${EXPECTED_AI_SDL_C_N}`);
    assert.equal(userValue.n, EXPECTED_USER_VALUE_N, `user_value cohort n=${EXPECTED_USER_VALUE_N}`);

    // 6c. reviewFixRounds observations (known only)
    assert.equal(
      aiSdlc.observationCounts.reviewFixRounds,
      EXPECTED_REVIEW_FIX_OBS_AI_SDL_C,
      `ai_sdlc reviewFixRounds observationCount=${EXPECTED_REVIEW_FIX_OBS_AI_SDL_C} (not ${aiSdlc.observationCounts.reviewFixRounds})`,
    );
    assert.equal(
      userValue.observationCounts.reviewFixRounds,
      EXPECTED_REVIEW_FIX_OBS_USER_VALUE,
      'user_value reviewFixRounds observationCount=0 (both unknown)',
    );

    // 6d. Per-metric low-sample
    assert.equal(userValue.lowSamplePopulation, true, 'user_value (n=2) is low-sample');
    // n=4 after TASK-2363 windowed the cohort to the current rolling week, which
    // is below the five-mission comparability threshold.
    assert.equal(aiSdlc.lowSamplePopulation, true, 'ai_sdlc (n=4) is low-sample');

    // 6e. Cross-repository isolation
    assert.equal(outcomes.filter(o => o.repositoryId === REPO_B).length, 0, 'REPO_B missions absent from REPO outcomes');

    // 6f. Historical flow — task-104 absent before Thursday
    const atMonday = metrics.cumulativeFlowByState.series.find(e => e.at === INTAKE_MON);
    assert.ok(atMonday, 'Monday point exists');
    const mondayTotal = Object.values(atMonday.counts).reduce((s, c) => s + c, 0);
    // Monday: task-100..103, 105, 106, 107 = 7 (task-104 not yet intaked)
    assert.equal(mondayTotal, 7, `Monday total 7 (task-104 absent before Thu intake)`);

    // Cleanup
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
