import test from 'node:test';
import assert from 'node:assert/strict';

import { compareCohorts, reviewPassagesByMission } from '../src/application/projections/cohorts.js';
import type { UsageRecord } from '../src/application/ports/mission-measurements.js';
import type { MissionTransition } from '../src/domain/mission-workflow.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { laneEvent, metricsAdapter } from './fixtures/metrics-adapter.js';

// ---------------------------------------------------------------------------
// task-2347.09 SC4 — the review bounce rate is a lane fact
//
// Three missions all enter review. Two of them are sent back with a
// `review → active` transition; the third is approved on the first pass. The
// bounce rate is therefore 2/3.
//
// `pr_fix_rounds` is seeded to contradict that on purpose: the two bouncing
// missions report 0 rounds and the clean one reports 5. Any implementation that
// reads fix rounds instead of lane history produces 5/3, not 2/3, so the two
// sources cannot be mistaken for each other.
// ---------------------------------------------------------------------------

const REPO = repositoryId('parallix');
const BOUNCED_A = 'task-2347.09-bounce-a';
const BOUNCED_B = 'task-2347.09-bounce-b';
const CLEAN = 'task-2347.09-clean';

const LANE_EVENTS = [
  // Bounced once, then approved.
  laneEvent(REPO, BOUNCED_A, 'backlog', 'active', 'activate', '2026-08-01T09:00:00Z'),
  laneEvent(REPO, BOUNCED_A, 'active', 'review', 'submit-for-review', '2026-08-01T10:00:00Z'),
  laneEvent(REPO, BOUNCED_A, 'review', 'active', 'request-changes', '2026-08-01T11:00:00Z'),
  laneEvent(REPO, BOUNCED_A, 'active', 'review', 'submit-for-review', '2026-08-01T12:00:00Z'),
  laneEvent(REPO, BOUNCED_A, 'review', 'integration', 'approve', '2026-08-01T13:00:00Z'),
  laneEvent(REPO, BOUNCED_A, 'integration', 'done', 'integrate', '2026-08-01T14:00:00Z'),
  // Bounced once, then approved.
  laneEvent(REPO, BOUNCED_B, 'backlog', 'active', 'activate', '2026-08-01T09:00:00Z'),
  laneEvent(REPO, BOUNCED_B, 'active', 'review', 'submit-for-review', '2026-08-01T10:30:00Z'),
  laneEvent(REPO, BOUNCED_B, 'review', 'active', 'request-changes', '2026-08-01T11:30:00Z'),
  laneEvent(REPO, BOUNCED_B, 'active', 'review', 'submit-for-review', '2026-08-01T12:30:00Z'),
  laneEvent(REPO, BOUNCED_B, 'review', 'integration', 'approve', '2026-08-01T13:30:00Z'),
  laneEvent(REPO, BOUNCED_B, 'integration', 'done', 'integrate', '2026-08-01T14:30:00Z'),
  // Entered review once and was approved on the first pass.
  laneEvent(REPO, CLEAN, 'backlog', 'active', 'activate', '2026-08-01T09:00:00Z'),
  laneEvent(REPO, CLEAN, 'active', 'review', 'submit-for-review', '2026-08-01T10:00:00Z'),
  laneEvent(REPO, CLEAN, 'review', 'integration', 'approve', '2026-08-01T11:00:00Z'),
  laneEvent(REPO, CLEAN, 'integration', 'done', 'integrate', '2026-08-01T12:00:00Z'),
];

/** The transitions the board records, mirroring the lane events above. */
const TRANSITIONS: readonly MissionTransition[] = LANE_EVENTS.map((entry) => ({
  missionId: missionId(entry.missionId),
  from: (entry.fromStatus ?? entry.toStatus) as MissionTransition['from'],
  to: entry.toStatus as MissionTransition['to'],
  trigger: entry.trigger as MissionTransition['trigger'],
  actor: entry.agent,
  occurredAt: entry.occurredAt,
}));

/** Fix rounds deliberately disagree with the lane history. */
function usageRecord(mission: string, prFixRounds: number): UsageRecord {
  return {
    date: '2026-08-01',
    repo: REPO,
    mission,
    classification: 'ai_sdlc',
    implementer_agent: 'codex',
    stage: 'execute',
    provider: 'openai',
    model: 'gpt-5',
    input_tokens: 100,
    output_tokens: 50,
    tool_calls: 4,
    duration_minutes: 30,
    cost_usd: 1,
    pr_fix_rounds: prFixRounds,
  };
}

const USAGE_RECORDS: readonly UsageRecord[] = [
  usageRecord(BOUNCED_A, 0),
  usageRecord(BOUNCED_B, 0),
  usageRecord(CLEAN, 5),
];

async function labelCohort() {
  const outcomes = await metricsAdapter(REPO, LANE_EVENTS, USAGE_RECORDS).readOutcomes();
  assert.equal(outcomes.length, 3, 'all three missions must project as completed outcomes');
  const comparison = compareCohorts({ outcomes, transitions: TRANSITIONS, dimension: 'label' });
  const cohort = comparison.cohorts.find((entry) => entry.key === 'ai_sdlc');
  assert.ok(cohort, 'expected an ai_sdlc cohort');
  return cohort;
}

test('SC4: review bounce rate is 2/3 when 2 of 3 missions bounce out of review', async () => {
  const cohort = await labelCohort();
  assert.equal(cohort.n, 3);
  assert.ok(
    Math.abs((cohort.reviewBounceRate ?? 0) - 2 / 3) < 1e-9,
    `expected a bounce rate of 0.667, got ${cohort.reviewBounceRate}`,
  );
});

test('SC4: the bounce rate ignores pr_fix_rounds, which disagrees with lane history', async () => {
  const cohort = await labelCohort();
  // The seeded rounds are 0, 0 and 5 — a fix-round rate would be 5/3 ≈ 1.667.
  assert.equal(cohort.medianReviewFixRounds, 0, 'median of 0, 0 and 5 fix rounds');
  assert.notEqual(cohort.reviewBounceRate, 5 / 3);
  assert.ok(
    (cohort.reviewBounceRate ?? 0) < 1,
    'a rate derived from fix rounds would exceed 1 here; a lane-derived one cannot with one bounce each',
  );
});

test('SC4: review passages count entries and bounces per mission from lane transitions', () => {
  const passages = reviewPassagesByMission(TRANSITIONS);
  assert.deepEqual(passages.get(missionId(BOUNCED_A)), { enteredReview: true, bounces: 1 });
  assert.deepEqual(passages.get(missionId(BOUNCED_B)), { enteredReview: true, bounces: 1 });
  assert.deepEqual(passages.get(missionId(CLEAN)), { enteredReview: true, bounces: 0 });
});

test('SC4: a mission that never entered review is excluded from the rate denominator', () => {
  const abandoned = missionId('task-2347.09-never-reviewed');
  const passages = reviewPassagesByMission([
    ...TRANSITIONS,
    { missionId: abandoned, from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-08-01T09:00:00Z' },
  ]);
  assert.deepEqual(passages.get(abandoned), { enteredReview: false, bounces: 0 });
});
