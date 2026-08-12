import { missionId, type MissionId, type MissionStatus } from '../../src/domain/mission.js';
import { repositoryId } from '../../src/domain/repository.js';
import type { MissionCommand, MissionTransition } from '../../src/domain/mission-workflow.js';
import type { AgentRunMeasurement, MissionOutcome } from '../../src/domain/usage.js';
import { agentFamily } from '../../src/domain/agents.js';

// ---------------------------------------------------------------------------
// TASK-2363 — the contaminated-history fixture.
//
// Every expected value in the tests that use this fixture is hand-computed from
// the literal lists below. No production median, window, or cohort helper is
// used to derive an expectation: the point of the regression is that the
// production path reproduces an independently known number.
// ---------------------------------------------------------------------------

export const FIXTURE_REPOSITORY = repositoryId('fixture-repo');

/** The projection clock. `today` is 2026-08-11. */
export const NOW = '2026-08-11T12:00:00.000Z';

/** current window: today-6 → today, inclusive. */
export const CURRENT_WINDOW_LABEL = '2026-08-05 → 2026-08-11';
/** previous window: today-13 → today-7, inclusive. */
export const PREVIOUS_WINDOW_LABEL = '2026-07-29 → 2026-08-04';

/**
 * Cycle times of the missions completed inside the current window, in the order
 * they are seeded. 31 values; sorted, the 16th is the median.
 *
 * sorted: 10 12 14 16 18 20 22 24 26 28 30 32 34 36 38 [40] 42 44 46 48 50 52
 *         54 56 58 60 62 64 66 68 70
 * median = 40, n = 31
 */
export const CURRENT_CYCLE_MINUTES: readonly number[] = Array.from(
  { length: 31 },
  (_unused, index) => 10 + index * 2,
);
export const EXPECTED_CURRENT_CYCLE_N = 31;
export const EXPECTED_CURRENT_CYCLE_MEDIAN = 40;

/**
 * Cycle times of the missions completed inside the previous window. 28 values,
 * an even count, so the median is the mean of the 14th and 15th.
 *
 * sorted: 100 103 106 ... ; value(i) = 100 + 3i for i in 0..27
 * 14th = value(13) = 139, 15th = value(14) = 142 → median = 140.5
 */
export const PREVIOUS_CYCLE_MINUTES: readonly number[] = Array.from(
  { length: 28 },
  (_unused, index) => 100 + index * 3,
);
export const EXPECTED_PREVIOUS_CYCLE_N = 28;
export const EXPECTED_PREVIOUS_CYCLE_MEDIAN = 140.5;

/**
 * 240 completed missions from May, all far outside both decision windows, with
 * deliberately extreme cycle times in 800–1200 min. Including them would move
 * the current median from 40 to roughly 1000 and n from 31 to 271.
 */
export const OLD_HISTORY_COUNT = 240;
export const OLD_CYCLE_MINUTES: readonly number[] = Array.from(
  { length: OLD_HISTORY_COUNT },
  (_unused, index) => 800 + (index % 401),
);

/** Agent runtime of current-window missions; only the first 11 measured it. */
export const CURRENT_RUNTIME_MINUTES: readonly number[] = [
  5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25,
];
export const EXPECTED_CURRENT_RUNTIME_N = 11;
export const EXPECTED_CURRENT_RUNTIME_MEDIAN = 15; // 6th of 11 sorted values

function measuredRun(minutes: number): AgentRunMeasurement {
  return {
    recordedOn: '2026-08-06',
    stage: 'default',
    role: 'implementer',
    agent: agentFamily('claude'),
    runtime: {
      provider: { kind: 'measured', value: 'anthropic' },
      model: { kind: 'measured', value: 'claude-opus-5' },
    },
    durationMinutes: { kind: 'measured', value: minutes },
    tokens: {
      input: { kind: 'unavailable', reason: 'fixture' },
      output: { kind: 'unavailable', reason: 'fixture' },
      cached: { kind: 'unavailable', reason: 'fixture' },
      context: { kind: 'unavailable', reason: 'fixture' },
    },
    toolCalls: { kind: 'unavailable', reason: 'fixture' },
    providerUsage: {
      beforePercent: { kind: 'unavailable', reason: 'fixture' },
      afterPercent: { kind: 'unavailable', reason: 'fixture' },
      deltaPercent: { kind: 'unavailable', reason: 'fixture' },
    },
    costUsd: { kind: 'unavailable', reason: 'fixture' },
  };
}

export interface SeededOutcome {
  readonly outcome: MissionOutcome;
  readonly transitions: readonly MissionTransition[];
}

/**
 * One completed mission: intake → active → review → done, so its lane dwell and
 * its review passage are both real recorded lifecycle, not derived numbers.
 */
export function completedMission(input: {
  readonly id: string;
  readonly createdAt: string;
  readonly closedAt: string;
  readonly cycleTimeMinutes: number;
  readonly runtimeMinutes?: number;
  readonly activeDwellMinutes?: number;
  readonly reviewDwellMinutes?: number;
  readonly bounces?: number;
  readonly labels?: readonly string[];
  readonly reviewFixRounds?: number | null;
}): SeededOutcome {
  const id = missionId(input.id) as MissionId;
  const created = Date.parse(input.createdAt);
  const activeAt = created + 60_000;
  const activeDwell = (input.activeDwellMinutes ?? 5) * 60_000;
  const reviewDwell = (input.reviewDwellMinutes ?? 3) * 60_000;
  const iso = (millis: number): string => new Date(millis).toISOString();

  const transitions: MissionTransition[] = [
    { missionId: id, from: null, to: 'backlog', trigger: 'intake' as MissionCommand['type'], actor: 'claude', occurredAt: input.createdAt },
    { missionId: id, from: 'backlog', to: 'active', trigger: 'activate', actor: 'claude', occurredAt: iso(activeAt) },
  ];
  let cursor = activeAt + activeDwell;
  transitions.push({ missionId: id, from: 'active', to: 'review', trigger: 'review' as MissionCommand['type'], actor: 'claude', occurredAt: iso(cursor) });
  for (let bounce = 0; bounce < (input.bounces ?? 0); bounce += 1) {
    cursor += reviewDwell;
    transitions.push({ missionId: id, from: 'review', to: 'active', trigger: 'activate', actor: 'claude', occurredAt: iso(cursor) });
    cursor += activeDwell;
    transitions.push({ missionId: id, from: 'active', to: 'review', trigger: 'review' as MissionCommand['type'], actor: 'claude', occurredAt: iso(cursor) });
  }
  transitions.push({ missionId: id, from: 'review', to: 'done', trigger: 'integrate', actor: 'claude', occurredAt: input.closedAt });

  return {
    outcome: {
      missionId: id,
      repositoryId: FIXTURE_REPOSITORY,
      createdAt: input.createdAt,
      closedAt: input.closedAt,
      cycleTimeMinutes: input.cycleTimeMinutes,
      reviewFixRounds: input.reviewFixRounds ?? null,
      labels: (input.labels ?? ['ai_sdlc']) as MissionOutcome['labels'],
      implementer: agentFamily('claude'),
      modelsInvolved: [],
      totalInputAndOutputTokens: null,
      totalCostUsd: null,
      totalToolCalls: null,
      runs: input.runtimeMinutes === undefined ? [] : [measuredRun(input.runtimeMinutes)],
    },
    transitions,
  };
}

export interface ContaminatedHistory {
  readonly outcomes: readonly MissionOutcome[];
  readonly transitions: readonly MissionTransition[];
  readonly initialStates: ReadonlyMap<MissionId, MissionStatus>;
}

/**
 * 240 old + 28 previous-window + 31 current-window completed missions.
 *
 * Cumulative statistics over this fixture report n = 299 and a median in the
 * hundreds; correctly windowed statistics report n = 31 and a median of 40.
 */
export function contaminatedHistory(): ContaminatedHistory {
  const seeded: SeededOutcome[] = [];

  OLD_CYCLE_MINUTES.forEach((minutes, index) => {
    const day = 1 + (index % 28);
    const created = `2026-05-${String(day).padStart(2, '0')}T00:00:00.000Z`;
    seeded.push(completedMission({
      id: `task-9${String(index).padStart(3, '0')}`,
      createdAt: created,
      closedAt: `2026-05-${String(day).padStart(2, '0')}T20:00:00.000Z`,
      cycleTimeMinutes: minutes,
      runtimeMinutes: 400,
      // Kept inside the 20-hour lifetime so `done` stays the mission's last
      // recorded transition; the extreme number under test is the cycle time.
      activeDwellMinutes: 60,
      reviewDwellMinutes: 30,
      bounces: 3,
    }));
  });

  PREVIOUS_CYCLE_MINUTES.forEach((minutes, index) => {
    const day = 29 + (index % 7); // 2026-07-29 .. 2026-08-04
    const month = day > 31 ? '08' : '07';
    const dayOfMonth = day > 31 ? day - 31 : day;
    const closedAt = `2026-${month}-${String(dayOfMonth).padStart(2, '0')}T10:00:00.000Z`;
    seeded.push(completedMission({
      id: `task-8${String(index).padStart(3, '0')}`,
      createdAt: `2026-07-20T08:00:00.000Z`,
      closedAt,
      cycleTimeMinutes: minutes,
      runtimeMinutes: 40,
      activeDwellMinutes: 50,
      reviewDwellMinutes: 30,
      bounces: 1,
    }));
  });

  CURRENT_CYCLE_MINUTES.forEach((minutes, index) => {
    const day = 5 + (index % 7); // 2026-08-05 .. 2026-08-11
    const closedAt = `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;
    seeded.push(completedMission({
      id: `task-7${String(index).padStart(3, '0')}`,
      createdAt: `2026-08-01T08:00:00.000Z`,
      closedAt,
      cycleTimeMinutes: minutes,
      runtimeMinutes: CURRENT_RUNTIME_MINUTES[index],
      activeDwellMinutes: 9,
      reviewDwellMinutes: 4,
      bounces: index < 5 ? 1 : 0,
    }));
  });

  const initialStates = new Map<MissionId, MissionStatus>(
    seeded.map((entry) => [entry.outcome.missionId, 'done' as MissionStatus]),
  );
  return {
    outcomes: seeded.map((entry) => entry.outcome),
    transitions: seeded.flatMap((entry) => entry.transitions),
    initialStates,
  };
}
