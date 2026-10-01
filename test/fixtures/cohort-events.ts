/**
 * Shared explicit-clock event-history fixture for the metrics slice
 * (TASK-2622.13 consolidation).
 *
 * Cohort and lifecycle fixtures previously built a fixed completed-mission
 * history from hand-authored lane events and usage records in every test file.
 * This fixture centralises that setup and pins the projection clock beside the
 * fixture dates: completed-mission metrics are reported over a rolling seven-day
 * decision window, so a fixture with fixed dates must carry its own clock or it
 * silently ages out of the window.
 *
 * The seeded history is six completed missions — three labelled `ai_sdlc` and
 * three `user_value` — each with four lane transitions and one usage record, all
 * completing on 2026-08-01. Both cohort assertions (pure `compareCohorts` and
 * the `px stats cohorts` CLI path) consume the same rows.
 */
import type { BoardLaneEventEntry } from '../../src/application/ports/operation-history.js';
import type { UsageRecord } from '../../src/application/ports/mission-measurements.js';
import type { RepositoryId } from '../../src/domain/repository.js';
import { repositoryId } from '../../src/domain/repository.js';
import { laneEvent, FakeLaneEventRepository, FakeUsageRepository } from './metrics-adapter.js';

export interface CohortSeed {
  readonly slug: string;
  readonly label: string;
  readonly minutes: number;
}

/** Six completed missions under the five-mission low-sample threshold. */
export const COHORT_SEEDS: readonly CohortSeed[] = [
  { slug: 'task-2347.09-p1', label: 'ai_sdlc', minutes: 60 },
  { slug: 'task-2347.09-p2', label: 'ai_sdlc', minutes: 120 },
  { slug: 'task-2347.09-p3', label: 'ai_sdlc', minutes: 180 },
  { slug: 'task-2347.09-p4', label: 'user_value', minutes: 240 },
  { slug: 'task-2347.09-p5', label: 'user_value', minutes: 300 },
  { slug: 'task-2347.09-p6', label: 'user_value', minutes: 360 },
] as const;

/** The day every seeded mission completes; the pinned projection clock. */
export const COHORT_COMPLETION_DAY = '2026-08-01T13:00:00Z';

export interface CohortEventHistory {
  readonly repositoryId: RepositoryId;
  readonly laneEvents: readonly BoardLaneEventEntry[];
  readonly usageRecords: readonly UsageRecord[];
  /** Clock pinned to the completion day so the rolling window does not age out. */
  readonly clock: () => string;
  readonly laneRepo: () => FakeLaneEventRepository;
  readonly usageRepo: () => FakeUsageRepository;
}

/** Build the fixed six-mission event history with an explicit completion clock. */
export function cohortEventHistory(
  seeds: readonly CohortSeed[] = COHORT_SEEDS,
  completionDay: string = COHORT_COMPLETION_DAY,
): CohortEventHistory {
  const repo = repositoryId('parallix');
  const laneEvents: readonly BoardLaneEventEntry[] = seeds.flatMap((seed) => [
    laneEvent(repo, seed.slug, 'backlog', 'active', 'activate', '2026-08-01T09:00:00Z'),
    laneEvent(repo, seed.slug, 'active', 'review', 'submit-for-review', '2026-08-01T10:00:00Z'),
    laneEvent(repo, seed.slug, 'review', 'integration', 'approve', '2026-08-01T11:00:00Z'),
    laneEvent(repo, seed.slug, 'integration', 'done', 'integrate', '2026-08-01T12:00:00Z'),
  ]);
  const usageRecords: readonly UsageRecord[] = seeds.map((seed) => ({
    date: '2026-08-01',
    repo,
    mission: seed.slug,
    classification: seed.label,
    implementer_agent: 'codex',
    stage: 'execute',
    provider: 'openai',
    model: 'gpt-5',
    input_tokens: 100,
    output_tokens: 50,
    tool_calls: 4,
    duration_minutes: seed.minutes,
    cost_usd: 1,
    pr_fix_rounds: 0,
  }));
  return {
    repositoryId: repo,
    laneEvents,
    usageRecords,
    clock: () => completionDay,
    laneRepo: () => new FakeLaneEventRepository(laneEvents),
    usageRepo: () => new FakeUsageRepository(usageRecords),
  };
}
