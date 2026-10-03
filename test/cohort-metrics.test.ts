// Historical regression provenance: TASK-2347.09.
/**
 * Cohort behavior for the metrics slice (TASK-2622.13 consolidation).
 *
 * Merged from the historical regression identities
 * `test/task-2347.09-cohort-metrics.test.ts` (pure `compareCohorts` projection,
 * TASK-2347.09 SC3) and `test/task-2347.09-cohort-presentation.test.ts`
 * (`px stats cohorts` CLI + board read-model rendering, TASK-2347.09 SC5/SC6).
 * Both exercise cohort behavior over the same seeded completed-mission history;
 * they now share `test/fixtures/cohort-events.ts` (explicit completion clock)
 * and live in one stable, behavior-owned suite. Historical task IDs are kept in
 * case names as regression provenance (AC#7).
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { COHORT_REPORT_COLUMNS, LOW_SAMPLE_MARKER, renderCohortComparison } from '../src/adapters/cli/commands/cohort-report.js';
import { statsCohorts, parseCohortArgs } from '../src/adapters/cli/commands/stats-cohorts.js';
import { createStatsCommand, createStatsWorkflowAdapter } from '../src/adapters/cli/commands/stats.js';
import type { UsageRecord } from '../src/application/ports/mission-measurements.js';
import { LOW_SAMPLE_THRESHOLD, UNASSIGNED_COHORT, compareCohorts, groupIntoCohorts, percentile75, type CohortMetrics, type CohortComparison, reviewPassagesByMission } from '../src/application/projections/cohorts.js';
import { missionCohortMetadata } from '../src/application/projections/metrics-read-adapter.js';
import { StatsCommandUseCase } from '../src/application/stats-command-use-case.js';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionTransition } from '../src/domain/mission-workflow.js';
import type { Mission } from '../src/domain/mission.js';
import { missionId, missionLabels, type MissionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import type { AgentRunMeasurement, MissionOutcome } from '../src/domain/usage.js';
import { cohortEventHistory, COHORT_SEEDS } from './fixtures/cohort-events.js';
import { metricsAdapter, laneEvent } from './fixtures/metrics-adapter.js';
import { missionOutcome } from './fixtures/mission-outcome.js';

// ── Cohort metrics ──


// Render-only `px stats` command: the cohorts path never consults the Mission
// authority, so a store placeholder satisfies the required wiring (SC13).
const statsCommand = createStatsCommand(
  new StatsCommandUseCase(createStatsWorkflowAdapter({} as never)),
);

interface Seed {
  readonly slug: string;
  readonly label: string;
  readonly cycleTimeMinutes: number;
  /** Consecutive stays in `active`; more than one means the mission bounced. */
  readonly activeSegments: readonly number[];
  readonly reviewSegments: readonly number[];
  readonly reviewFixRounds: number;
  readonly tokens: number | null;
  readonly costUsd: number;
  readonly runtimeMinutes: number;
  readonly netEngineeringLines: number;
}

const METRIC_SEEDS: readonly Seed[] = [
  // ai_sdlc — active dwell 10/20/30/40/50, review dwell 5/15/25/35/45
  { slug: 'task-0001', label: 'ai_sdlc', cycleTimeMinutes: 100, activeSegments: [6, 4], reviewSegments: [3, 2], reviewFixRounds: 1, tokens: 1000, costUsd: 1, runtimeMinutes: 10, netEngineeringLines: 10 },
  { slug: 'task-0002', label: 'ai_sdlc', cycleTimeMinutes: 200, activeSegments: [12, 8], reviewSegments: [10, 5], reviewFixRounds: 1, tokens: 2000, costUsd: 2, runtimeMinutes: 20, netEngineeringLines: 20 },
  { slug: 'task-0003', label: 'ai_sdlc', cycleTimeMinutes: 300, activeSegments: [30], reviewSegments: [25], reviewFixRounds: 0, tokens: 3000, costUsd: 3, runtimeMinutes: 30, netEngineeringLines: 30 },
  { slug: 'task-0004', label: 'ai_sdlc', cycleTimeMinutes: 400, activeSegments: [40], reviewSegments: [35], reviewFixRounds: 0, tokens: 4000, costUsd: 4, runtimeMinutes: 40, netEngineeringLines: 40 },
  { slug: 'task-0005', label: 'ai_sdlc', cycleTimeMinutes: 500, activeSegments: [50], reviewSegments: [45], reviewFixRounds: 0, tokens: 5000, costUsd: 5, runtimeMinutes: 50, netEngineeringLines: 50 },
  // user_value — one mission never reported its tokens
  { slug: 'task-0006', label: 'user_value', cycleTimeMinutes: 60, activeSegments: [100], reviewSegments: [60], reviewFixRounds: 2, tokens: 100, costUsd: 0.5, runtimeMinutes: 5, netEngineeringLines: 100 },
  { slug: 'task-0007', label: 'user_value', cycleTimeMinutes: 120, activeSegments: [200], reviewSegments: [70], reviewFixRounds: 2, tokens: null, costUsd: 1.5, runtimeMinutes: 10, netEngineeringLines: 200 },
  { slug: 'task-0008', label: 'user_value', cycleTimeMinutes: 900, activeSegments: [300], reviewSegments: [80], reviewFixRounds: 2, tokens: 300, costUsd: 2.5, runtimeMinutes: 15, netEngineeringLines: 300 },
];

const EPOCH = Date.parse('2026-08-01T00:00:00Z');

function at(minutes: number): string {
  return new Date(EPOCH + minutes * 60_000).toISOString();
}

/**
 * Replay one mission through the board: it enters `active`, alternates into
 * `review` once per segment pair, and closes. A second active segment is
 * reached only through a `review → active` transition, so the seed's segment
 * count is also its bounce count plus one.
 */
function transitionsFor(seed: Seed): readonly MissionTransition[] {
  const id = missionId(seed.slug);
  const transitions: MissionTransition[] = [
    { missionId: id, from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: at(0) },
  ];
  let clock = 0;
  seed.activeSegments.forEach((activeMinutes, index) => {
    clock += activeMinutes;
    transitions.push({ missionId: id, from: 'active', to: 'review', trigger: 'submit-for-review', actor: 'codex', occurredAt: at(clock) });
    clock += seed.reviewSegments[index]!;
    const last = index === seed.activeSegments.length - 1;
    transitions.push(last
      ? { missionId: id, from: 'review', to: 'integration', trigger: 'approve', actor: 'codex', occurredAt: at(clock) }
      : { missionId: id, from: 'review', to: 'active', trigger: 'request-changes', actor: 'codex', occurredAt: at(clock) });
  });
  return transitions;
}

function run(minutes: number): AgentRunMeasurement {
  return {
    recordedOn: '2026-08-01',
    stage: 'execute',
    role: 'implementer',
    agent: agentFamily('codex'),
    runtime: { provider: { kind: 'measured', value: 'openai' }, model: { kind: 'measured', value: 'gpt-5' } },
    durationMinutes: { kind: 'measured', value: minutes },
    tokens: {
      input: { kind: 'measured', value: 0 },
      output: { kind: 'measured', value: 0 },
      cached: { kind: 'unavailable', reason: 'not sampled' },
      context: { kind: 'unavailable', reason: 'not sampled' },
    },
    toolCalls: { kind: 'measured', value: 1 },
    providerUsage: {
      beforePercent: { kind: 'unavailable', reason: 'not sampled' },
      afterPercent: { kind: 'unavailable', reason: 'not sampled' },
      deltaPercent: { kind: 'unavailable', reason: 'not sampled' },
    },
    costUsd: { kind: 'measured', value: 0 },
  };
}

function outcomeFor(seed: Seed): MissionOutcome {
  return missionOutcome({
    missionId: missionId(seed.slug),
    closedAt: at(seed.cycleTimeMinutes),
    cycleTimeMinutes: seed.cycleTimeMinutes,
    reviewFixRounds: seed.reviewFixRounds,
    labels: missionLabels([seed.label]),
    implementer: agentFamily('codex'),
    modelsInvolved: [{ recordedOn: '2026-08-01', stage: 'execute', role: 'implementer', agent: agentFamily('codex'), provider: 'openai', model: 'gpt-5' }],
    totalInputAndOutputTokens: seed.tokens,
    totalCostUsd: seed.costUsd,
    totalToolCalls: 1,
    runs: [run(seed.runtimeMinutes)],
  });
}

const OUTCOMES = METRIC_SEEDS.map(outcomeFor);
const TRANSITIONS = METRIC_SEEDS.flatMap(transitionsFor);
const NEL = new Map<MissionId, number | null>(
  METRIC_SEEDS.map((seed) => [missionId(seed.slug), seed.netEngineeringLines]),
);

function labelComparison() {
  return compareCohorts({
    outcomes: OUTCOMES,
    transitions: TRANSITIONS,
    dimension: 'label',
    netEngineeringLines: NEL,
  });
}

function cohort(key: string): CohortMetrics {
  const found = labelComparison().cohorts.find((entry) => entry.key === key);
  assert.ok(found, `expected a cohort for ${key}`);
  return found;
}

test('SC3: the ai_sdlc cohort reports every figure with its sample size', () => {
  const metrics = cohort('ai_sdlc');
  assert.equal(metrics.n, 5, 'five seeded ai_sdlc missions');
  // Cycle times 100/200/300/400/500 — median 300, nearest-rank p75 index 4 → 400.
  assert.equal(metrics.medianCycleTimeMinutes, 300);
  assert.equal(metrics.p75CycleTimeMinutes, 400);
  // Active dwell 10/20/30/40/50 (bounced missions sum both stays) — median 30.
  assert.equal(metrics.medianActiveDwellMinutes, 30);
  // Review dwell 5/15/25/35/45 — median 25.
  assert.equal(metrics.medianReviewDwellMinutes, 25);
  // Two of five missions bounced once each.
  assert.equal(metrics.reviewBounceRate, 2 / 5);
  // Fix rounds 1/1/0/0/0 — median 0.
  assert.equal(metrics.medianReviewFixRounds, 0);
  // Tokens 1000..5000 — mean 3000. Cost 1..5 — mean 3. Runtime 10..50 — mean 30.
  assert.equal(metrics.tokensPerMission, 3000);
  assert.equal(metrics.costUsdPerMission, 3);
  assert.equal(metrics.agentRuntimeMinutesPerMission, 30);
  // NEL 10/20/30/40/50 — mean 30.
  assert.equal(metrics.netEngineeringLinesPerMission, 30);
  assert.deepEqual(metrics.observationCounts, {
    cycleTime: 5, activeDwell: 5, reviewDwell: 5, reviewBounce: 5,
    reviewFixRounds: 5, tokens: 5, runtime: 5, cost: 5, netEngineeringLines: 5,
  });
});

test('SC3: the user_value cohort is computed from its own three missions', () => {
  const metrics = cohort('user_value');
  assert.equal(metrics.n, 3);
  // Cycle times 60/120/900 — median 120, nearest-rank p75 index 3 → 900.
  assert.equal(metrics.medianCycleTimeMinutes, 120);
  assert.equal(metrics.p75CycleTimeMinutes, 900);
  assert.equal(metrics.medianActiveDwellMinutes, 200);
  assert.equal(metrics.medianReviewDwellMinutes, 70);
  // All three entered review, none bounced: a measured zero, not "unknown".
  assert.equal(metrics.reviewBounceRate, 0);
  assert.equal(metrics.medianReviewFixRounds, 2);
  // task-0007 reported no tokens, so the mean is over the two that did: 200.
  assert.equal(metrics.tokensPerMission, 200);
  assert.equal(metrics.costUsdPerMission, 1.5);
  assert.equal(metrics.agentRuntimeMinutesPerMission, 10);
  assert.equal(metrics.netEngineeringLinesPerMission, 200);
  // Population is 3, but task-0007 has no tokens. The count must follow the
  // two observations used by tokensPerMission rather than cohort population.
  assert.deepEqual(metrics.observationCounts, {
    cycleTime: 3, activeDwell: 3, reviewDwell: 3, reviewBounce: 3,
    reviewFixRounds: 3, tokens: 2, runtime: 3, cost: 3, netEngineeringLines: 3,
  });
});

test('SC3: the two label cohorts partition the eight seeded missions', () => {
  const comparison = labelComparison();
  assert.deepEqual(comparison.cohorts.map((entry) => entry.key), ['ai_sdlc', 'user_value']);
  assert.equal(comparison.cohorts.reduce((sum, entry) => sum + entry.n, 0), METRIC_SEEDS.length);
  assert.equal(comparison.dimension, 'label');
  assert.equal(comparison.lowSampleThreshold, LOW_SAMPLE_THRESHOLD);
});

test('nearest-rank p75 returns an observed value, never an interpolated one', () => {
  assert.equal(percentile75([]), null);
  assert.equal(percentile75([7]), 7);
  assert.equal(percentile75([1, 2, 3, 4]), 3);
  assert.equal(percentile75([100, 200, 300, 400, 500]), 400);
});

test('a mission with two labels joins both cohorts instead of being dropped', () => {
  const both = missionOutcome({
    missionId: missionId('task-0009'),
    labels: missionLabels(['ai_sdlc', 'user_value']),
  });
  const groups = groupIntoCohorts([both], 'label');
  assert.deepEqual([...groups.keys()].sort(), ['ai_sdlc', 'user_value']);
});

test('a mission with no value for the dimension lands in the unassigned cohort', () => {
  const unlabelled = missionOutcome({ missionId: missionId('task-0010') });
  const groups = groupIntoCohorts([unlabelled], 'label');
  assert.deepEqual([...groups.keys()], [UNASSIGNED_COHORT]);
  const byImplementer = groupIntoCohorts([unlabelled], 'implementer');
  assert.deepEqual([...byImplementer.keys()], [UNASSIGNED_COHORT]);
});

test('cohorts can be grouped by model, provider, and closing date range', () => {
  const comparison = compareCohorts({ outcomes: OUTCOMES, transitions: TRANSITIONS, dimension: 'model' });
  assert.deepEqual(comparison.cohorts.map((entry) => [entry.key, entry.n]), [['gpt-5', 8]]);

  const byProvider = compareCohorts({ outcomes: OUTCOMES, transitions: TRANSITIONS, dimension: 'provider' });
  assert.deepEqual(byProvider.cohorts.map((entry) => [entry.key, entry.n]), [['openai', 8]]);

  // Missions close at their cycle-time offset from the epoch, so a window that
  // ends 150 minutes in collects the 100, 60 and 120-minute missions, and the
  // later window collects the remaining five.
  const byRange = compareCohorts({
    outcomes: OUTCOMES,
    transitions: TRANSITIONS,
    dimension: 'date-range',
    dateRanges: [
      { name: 'early', from: at(0), to: at(150) },
      { name: 'late', from: at(151), to: at(2000) },
    ],
  });
  assert.deepEqual(byRange.cohorts.map((entry) => [entry.key, entry.n]), [['late', 5], ['early', 3]]);
});









// Render-only `px stats` command: the cohorts path never consults the Mission
// authority, so a store placeholder satisfies the required wiring (SC13).











test('delivery credit belongs only to the recorded final implementer after a family switch', async () => {
  const canonical = missionCohortMetadata(COHORT_SEEDS.map(seed => ({
    id: missionId(seed.slug), labels: missionLabels(['canonical']), assignee: agentFamily('codex'),
    review: { rounds: [{ implementer: 'codex' }, { implementer: 'custom' }] },
  } as unknown as Mission)));
  const lines: string[] = [];
  await statsCohorts(['--by', 'implementer', '--min-sample', '1'], {
    log: message => { lines.push(message); }, error: message => { throw new Error(message); }, exit: () => null,
    laneEventRepo: history.laneRepo(), usageRepo: history.usageRepo(),
    repositoryId: REPO, cohortMetadata: async () => canonical,
  });
  assert.match(lines.join('\n'), /^custom\s+6\s/m);
  assert.doesNotMatch(lines.join('\n'), /^codex\s|^mixed\s/m);
});

// ---------------------------------------------------------------------------
// task-2347.09 SC5/SC6 — no cohort figure is shown without its sample size
//
// Six completed missions: three labelled `ai_sdlc` and three `user_value`.
// Both cohorts sit under the five-mission threshold, so the report has to say
// so rather than presenting either as a comparable result.
// ---------------------------------------------------------------------------

const history = cohortEventHistory();
const REPO = history.repositoryId;


function comparisonOf(threshold = LOW_SAMPLE_THRESHOLD): CohortComparison {
  return compareCohorts({
    outcomes: COHORT_SEEDS.map((seed) => missionOutcome({
      missionId: missionId(seed.slug),
      cycleTimeMinutes: seed.minutes,
      labels: missionLabels([seed.label]),
      implementer: agentFamily('codex'),
    })),
    transitions: [],
    dimension: 'label',
    lowSampleThreshold: threshold,
  });
}

async function runCohortsCommand(args: readonly string[]): Promise<{ output: string; exits: number[] }> {
  const lines: string[] = [];
  const exits: number[] = [];
  await statsCohorts(args, {
    log: (message: string) => { lines.push(String(message)); return null; },
    error: (message: string) => { lines.push(String(message)); return null; },
    exit: (code?: number) => { exits.push(code ?? 0); return null; },
    laneEventRepo: history.laneRepo(),
    usageRepo: history.usageRepo(),
    repositoryId: REPO,
    cohortMetadata: async () => new Map(COHORT_SEEDS.map(seed => [
      missionId(seed.slug), { labels: missionLabels([seed.label]), assignee: agentFamily('codex') },
    ])),
  });
  return { output: lines.join('\n'), exits };
}

test('SC5: every cohort row carries an n column', () => {
  const comparison = comparisonOf();
  const report = renderCohortComparison(comparison);
  const lines = report.split('\n');
  const headerIndex = lines.findIndex((line) => line.trimStart().startsWith('cohort'));
  assert.ok(headerIndex >= 0, 'the table must have a header row');

  const header = lines[headerIndex]!.split(/\s{2,}/).map((cell) => cell.trim());
  assert.equal(header[0], 'cohort');
  assert.equal(header[1], 'n', 'n must be the first column after the cohort name');
  assert.deepEqual(header, [...COHORT_REPORT_COLUMNS]);

  // Every cohort in the model appears as a row whose n cell is its sample size.
  for (const cohort of comparison.cohorts) {
    const row = lines.find((line) => line.startsWith(cohort.key));
    assert.ok(row, `expected a rendered row for ${cohort.key}`);
    const cells = row.split(/\s{2,}/).map((cell) => cell.trim());
    assert.equal(cells[1], String(cohort.n), `${cohort.key} must render n=${cohort.n}`);
  }
});

test('SC5: no rendered figure appears on a line without its sample size', () => {
  const report = renderCohortComparison(comparisonOf());
  const rows = report
    .split('\n')
    .filter((line) => comparisonOf().cohorts.some((cohort) => line.startsWith(cohort.key)));
  assert.equal(rows.length, 2, 'both cohorts must render');
  for (const row of rows) {
    const cells = row.split(/\s{2,}/).map((cell) => cell.trim());
    assert.match(cells[1] ?? '', /^\d+$/, `sample size missing from rendered row: ${row}`);
  }
});

test('SC6: a cohort of 3 missions is marked low-sample, not presented as comparable', () => {
  const comparison = comparisonOf();
  for (const cohort of comparison.cohorts) {
    assert.equal(cohort.n, 3);
    assert.equal(cohort.lowSample, true, `${cohort.key} has 3 < ${LOW_SAMPLE_THRESHOLD} missions`);
  }
  const report = renderCohortComparison(comparison);
  assert.match(report, new RegExp(`ai_sdlc \\(${LOW_SAMPLE_MARKER}\\)`));
  assert.match(report, new RegExp(`user_value \\(${LOW_SAMPLE_MARKER}\\)`));
  assert.match(report, /Low-sample \(n < 5\), not comparable results: ai_sdlc \(n=3\), user_value \(n=3\)\./);
});

test('SC6: raising the threshold past a cohort flips it to low-sample', () => {
  const belowThreshold = comparisonOf(3);
  assert.deepEqual(belowThreshold.cohorts.map((cohort) => cohort.lowSample), [false, false]);
  assert.match(renderCohortComparison(belowThreshold), /All cohorts have at least 3 completed missions\./);

  const aboveThreshold = comparisonOf(4);
  assert.deepEqual(aboveThreshold.cohorts.map((cohort) => cohort.lowSample), [true, true]);
});

test('an unmeasured figure renders as n/a rather than zero', () => {
  const report = renderCohortComparison(comparisonOf());
  // The seeded outcomes carry no runs, cost, tokens or NEL.
  assert.match(report, /n\/a/);
  const bounceColumn = COHORT_REPORT_COLUMNS.indexOf('bounce rate');
  const row = report.split('\n').find((line) => line.startsWith('ai_sdlc'))!;
  // No transitions were supplied, so nothing entered review: unknown, not 0.00.
  assert.equal(row.split(/\s{2,}/).map((cell) => cell.trim())[bounceColumn], 'n/a');
});

test('px stats cohorts renders the comparison with sample sizes from stored history', async () => {
  const { output, exits } = await runCohortsCommand([]);
  assert.deepEqual(exits, [], 'the report must not exit non-zero');
  assert.match(output, /Cohort comparison by label/);
  assert.match(output, new RegExp(`ai_sdlc \\(${LOW_SAMPLE_MARKER}\\)`));
  assert.match(output, new RegExp(`user_value \\(${LOW_SAMPLE_MARKER}\\)`));
  const rows = output.split('\n').filter((line) => line.startsWith('ai_sdlc') || line.startsWith('user_value'));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.split(/\s{2,}/).map((cell) => cell.trim())[1], '3');
  }
});

test('px stats cohorts groups by the requested dimension and honours --min-sample', async () => {
  const byImplementer = await runCohortsCommand(['--by', 'implementer', '--min-sample', '2']);
  assert.match(byImplementer.output, /Cohort comparison by implementer/);
  // All six missions were implemented by codex, so the single cohort has n=6.
  const row = byImplementer.output.split('\n').find((line) => line.startsWith('codex'))!;
  assert.equal(row.split(/\s{2,}/).map((cell) => cell.trim())[1], '6');
  assert.match(byImplementer.output, /All cohorts have at least 2 completed missions\./);
});

test('px stats cohorts uses canonical Mission labels and implementer instead of telemetry values', async () => {
  const lines: string[] = [];
  await statsCohorts(['--by', 'label', '--min-sample', '1'], {
    log: (message: string) => { lines.push(message); return null; },
    error: () => null,
    exit: () => null,
    laneEventRepo: history.laneRepo(),
    usageRepo: history.usageRepo(),
    repositoryId: REPO,
    cohortMetadata: async () => new Map(COHORT_SEEDS.map((seed) => [
      missionId(seed.slug),
      { labels: missionLabels(['canonical_experiment']), assignee: agentFamily('custom') },
    ])),
  });
  const report = lines.join('\n');
  assert.match(report, /canonical_experiment/);
  assert.doesNotMatch(report, /ai_sdlc|user_value/);
});

test('px stats cohorts rejects an unknown dimension instead of reporting a wrong one', async () => {
  const { output, exits } = await runCohortsCommand(['--by', 'phase-of-moon']);
  assert.deepEqual(exits, [1]);
  assert.match(output, /Unknown cohort dimension "phase-of-moon"/);
});

test('parseCohortArgs defaults to the label dimension and the standard threshold', () => {
  assert.deepEqual(parseCohortArgs([]), {
    dimension: 'label',
    lowSampleThreshold: LOW_SAMPLE_THRESHOLD,
    repositoryId: null,
    help: false,
  });
  assert.equal(parseCohortArgs(['--by', 'model']).dimension, 'model');
  assert.equal(parseCohortArgs(['--min-sample', '9']).lowSampleThreshold, 9);
  assert.throws(() => parseCohortArgs(['--min-sample', '0']), /expected a positive whole number/);
});

test('the board read model exposes the cohort comparison with sample sizes', async () => {
  // The seeds complete on 2026-08-01; the board's cohort comparison is a rolling
  // seven-day window, so the projection clock is pinned to that day.
  const metrics = await metricsAdapter(REPO, history.laneEvents, history.usageRecords, history.clock)
    .buildMetrics(new Map(COHORT_SEEDS.map((seed) => [missionId(seed.slug), 'done' as const])));
  assert.ok(metrics.cohorts, 'BoardMetrics must carry the cohort comparison');
  assert.equal(metrics.cohorts.dimension, 'label');
  assert.deepEqual(
    metrics.cohorts.cohorts.map((cohort) => [cohort.key, cohort.n, cohort.lowSample]),
    [['ai_sdlc', 3, true], ['user_value', 3, true]],
  );
});

test('px stats routes the cohorts subcommand without touching the weekly or range paths', async () => {
  const lines: string[] = [];
  await statsCommand(['cohorts', '--help'], {
    log: (message: string) => { lines.push(String(message)); return null; },
    error: (message: string) => { lines.push(String(message)); return null; },
    exit: () => null,
  });
  const output = lines.join('\n');
  assert.match(output, /Usage: px stats cohorts/);
  assert.doesNotMatch(output, /Loaded \d+ measurements/, 'the cohorts path must not run the weekly database read');
});

// ── Review bounce rate — TASK-2347.09 SC4 (was task-2347.09-bounce-rate.test.ts) ──
describe("Review bounce rate — SC4", () => {
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
});
