import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COHORT_REPORT_COLUMNS,
  LOW_SAMPLE_MARKER,
  renderCohortComparison,
} from '../src/adapters/cli/commands/cohort-report.js';
import { statsCohorts, parseCohortArgs } from '../src/adapters/cli/commands/stats-cohorts.js';
import stats from '../src/adapters/cli/commands/stats.js';
import {
  LOW_SAMPLE_THRESHOLD,
  compareCohorts,
  type CohortComparison,
} from '../src/application/projections/cohorts.js';
import type { UsageRecord } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry } from '../src/application/ports/operation-history.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionOutcome } from './fixtures/mission-outcome.js';
import { FakeLaneEventRepository, FakeUsageRepository, laneEvent, metricsAdapter } from './fixtures/metrics-adapter.js';

// ---------------------------------------------------------------------------
// task-2347.09 SC5/SC6 — no cohort figure is shown without its sample size
//
// Six completed missions: three labelled `ai_sdlc` and three `user_value`.
// Both cohorts sit under the five-mission threshold, so the report has to say
// so rather than presenting either as a comparable result.
// ---------------------------------------------------------------------------

const REPO = repositoryId('parallix');

const SEEDS = [
  { slug: 'task-2347.09-p1', label: 'ai_sdlc', minutes: 60 },
  { slug: 'task-2347.09-p2', label: 'ai_sdlc', minutes: 120 },
  { slug: 'task-2347.09-p3', label: 'ai_sdlc', minutes: 180 },
  { slug: 'task-2347.09-p4', label: 'user_value', minutes: 240 },
  { slug: 'task-2347.09-p5', label: 'user_value', minutes: 300 },
  { slug: 'task-2347.09-p6', label: 'user_value', minutes: 360 },
] as const;

const LANE_EVENTS: readonly BoardLaneEventEntry[] = SEEDS.flatMap((seed) => [
  laneEvent(REPO, seed.slug, 'backlog', 'active', 'activate', '2026-08-01T09:00:00Z'),
  laneEvent(REPO, seed.slug, 'active', 'review', 'submit-for-review', '2026-08-01T10:00:00Z'),
  laneEvent(REPO, seed.slug, 'review', 'integration', 'approve', '2026-08-01T11:00:00Z'),
  laneEvent(REPO, seed.slug, 'integration', 'done', 'integrate', '2026-08-01T12:00:00Z'),
]);

const USAGE_RECORDS: readonly UsageRecord[] = SEEDS.map((seed) => ({
  date: '2026-08-01',
  repo: REPO,
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

function comparisonOf(threshold = LOW_SAMPLE_THRESHOLD): CohortComparison {
  return compareCohorts({
    outcomes: SEEDS.map((seed) => missionOutcome({
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
    laneEventRepo: new FakeLaneEventRepository(LANE_EVENTS),
    usageRepo: new FakeUsageRepository(USAGE_RECORDS),
    repositoryId: REPO,
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
    laneEventRepo: new FakeLaneEventRepository(LANE_EVENTS),
    usageRepo: new FakeUsageRepository(USAGE_RECORDS),
    repositoryId: REPO,
    cohortMetadata: async () => new Map(SEEDS.map((seed) => [
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
  const metrics = await metricsAdapter(REPO, LANE_EVENTS, USAGE_RECORDS, () => '2026-08-01T13:00:00Z')
    .buildMetrics(new Map(SEEDS.map((seed) => [missionId(seed.slug), 'done' as const])));
  assert.ok(metrics.cohorts, 'BoardMetrics must carry the cohort comparison');
  assert.equal(metrics.cohorts.dimension, 'label');
  assert.deepEqual(
    metrics.cohorts.cohorts.map((cohort) => [cohort.key, cohort.n, cohort.lowSample]),
    [['ai_sdlc', 3, true], ['user_value', 3, true]],
  );
});

test('px stats routes the cohorts subcommand without touching the weekly or range paths', async () => {
  const lines: string[] = [];
  await stats(['cohorts', '--help'], {
    log: (message: string) => { lines.push(String(message)); return null; },
    error: (message: string) => { lines.push(String(message)); return null; },
    exit: () => null,
  });
  const output = lines.join('\n');
  assert.match(output, /Usage: px stats cohorts/);
  assert.doesNotMatch(output, /Loaded \d+ measurements/, 'the cohorts path must not run the weekly database read');
});
