import type { StatsProjection, StatsReconstructionChange } from './ports.js';
import type { StatsRecoveryEvidence } from './stats-recovery-evidence.js';

export type RecoveryValueClass = 'direct-observation' | 'reconstructed-fact' | 'estimate' | 'unavailable';

export interface RecoveryDistribution {
  readonly classification: RecoveryValueClass;
  readonly population: number;
  readonly observationCount: number;
  readonly denominator: number;
  readonly coverage: number | null;
  readonly minimum: number | null;
  readonly median: number | null;
  readonly p90: number | null;
  readonly maximum: number | null;
  readonly meanEstimate: number | null;
  readonly meanClassification: 'estimate';
  readonly uncertainty: { readonly method: string; readonly lower: number; readonly upper: number; readonly confidence: string } | null;
  readonly unit: 'returns' | 'milliseconds';
}

export interface RecoveryCohortCoverage {
  readonly metric: 'returnsPerMission' | 'repairAttemptDuration' | 'sourceEvidence';
  readonly dimension: 'period' | 'model' | 'stage' | 'cause';
  readonly value: string;
  readonly population: number;
  readonly observationCount: number;
  readonly denominator: number;
  readonly coverage: number | null;
}

export interface StatsRecoveryAnalysis {
  readonly schema: 'parallix.stats-recovery-analysis.v1';
  readonly repository: string | null;
  readonly dateRange: { readonly from: string | null; readonly to: string | null };
  readonly populations: {
    readonly collectedRecords: number;
    readonly linkedMissions: number;
    readonly returnEligibleMissions: number;
    readonly recordedRepairAttempts: number;
  };
  readonly metrics: {
    readonly returnsPerMission: RecoveryDistribution;
    readonly repairAttemptDuration: RecoveryDistribution;
    readonly prToReviewTurnaround: RecoveryDistribution;
  };
  readonly cohorts: readonly RecoveryCohortCoverage[];
  readonly unavailable: readonly { readonly metric: string; readonly classification: 'unavailable'; readonly reason: string }[];
  readonly interpretation: {
    readonly assumptions: readonly string[];
    readonly missingness: readonly string[];
    readonly selectionBias: readonly string[];
    readonly comparability: string;
    readonly representativeness: string;
  };
}

/** Build the analysis export from the final projection; it never changes return counting. */
export function analyzeStatsRecovery(projection: StatsProjection): StatsRecoveryAnalysis {
  const evidence = projection.recovery?.evidence ?? [];
  const changes = projection.changes ?? [];
  const returns = changes.flatMap(change => change.after === null ? [] : [change.after]);
  const repairs = evidence.filter(item => item.kind === 'repair-attempt');
  const repairDurations = repairs.flatMap(item => finiteNonNegative(item.raw.durationMs));
  const turnarounds = prReviewTurnarounds(evidence);
  const dates = evidence.map(item => item.observedAt).sort((left, right) => left.localeCompare(right));
  const repositories = [...new Set(evidence.map(item => item.links.repositoryId))];
  const linkedMissions = new Set(evidence.map(item => item.links.missionId).filter(Boolean)).size;
  const cohorts = [
    ...returnCohorts(changes, projection),
    ...evidenceCohorts(evidence, 'sourceEvidence', 'period', item => item.observedAt.slice(0, 7)),
    ...durationCohorts(repairs, 'model', item => textAt(item.raw, 'model') ?? textAt(item.raw, 'agent')),
    ...durationCohorts(repairs, 'stage', item => textAt(item.raw, 'stage') ?? textAt(item.raw, 'phase')),
    ...returnCauseCohorts(changes),
  ];
  const incompleteSources = projection.recovery?.failures.length ?? 0;
  const missingReturnMissions = changes.filter(item => item.after === null).length;
  const missingRepairDurations = repairs.length - repairDurations.length;
  return {
    schema: 'parallix.stats-recovery-analysis.v1', repository: repositories.length === 1 ? repositories[0] : null,
    dateRange: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    populations: { collectedRecords: evidence.length, linkedMissions, returnEligibleMissions: changes.length,
      recordedRepairAttempts: repairs.length },
    metrics: {
      returnsPerMission: distribution(returns, changes.length, 'returns', 'reconstructed-fact'),
      repairAttemptDuration: distribution(repairDurations, repairs.length, 'milliseconds', 'direct-observation'),
      prToReviewTurnaround: distribution(turnarounds.values, turnarounds.denominator, 'milliseconds', 'reconstructed-fact'),
    },
    cohorts: cohorts.sort((a, b) => a.metric.localeCompare(b.metric)
      || a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value)),
    unavailable: unavailableMetrics(),
    interpretation: {
      assumptions: [
        'Return values come only from the final all-cause return owner; review publications and round-count arithmetic are excluded.',
        'rebound.repair durationMs is one recorded repair attempt, not complete mission repair time.',
        'PR-to-review turnaround is elapsed wall time between recorded provider timestamps, not agent execution or CPU.',
      ],
      missingness: [
        `${missingReturnMissions}/${changes.length} return-eligible missions have unavailable return evidence.`,
        `${missingRepairDurations}/${repairs.length} recorded repair attempts have no usable durationMs.`,
        `${incompleteSources} collection source failures remain unresolved.`,
      ],
      selectionBias: [
        'Historical retention and provider availability determine inclusion; older or deleted evidence is less likely to be observed.',
        'Model, stage and cause cohorts include only records carrying that attribution and may not have comparable coverage.',
      ],
      comparability: cohortComparability(cohorts),
      representativeness: 'Observed-cohort estimates describe retained evidence only; no representativeness claim or correction multiplier is applied.',
    },
  };
}

function distribution(values: readonly number[], denominator: number, unit: RecoveryDistribution['unit'],
  classification: RecoveryValueClass): RecoveryDistribution {
  const ordered = [...values].sort((a, b) => a - b);
  const n = ordered.length;
  const mean = n ? ordered.reduce((sum, value) => sum + value, 0) / n : null;
  return { classification, population: denominator, observationCount: n, denominator,
    coverage: denominator ? n / denominator : null, minimum: ordered[0] ?? null,
    median: quantile(ordered, 0.5), p90: quantile(ordered, 0.9), maximum: ordered.at(-1) ?? null,
    meanEstimate: mean, meanClassification: 'estimate',
    uncertainty: mean === null ? null : meanUncertainty(ordered, mean), unit };
}

function meanUncertainty(values: readonly number[], mean: number): RecoveryDistribution['uncertainty'] {
  if (values.length < 2) {
    return { method: 'observed range (single observation)', lower: mean, upper: mean, confidence: 'descriptive only' };
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return { method: 'normal 95% interval for observed-cohort mean', lower: Math.max(0, mean - margin),
    upper: mean + margin, confidence: 'sampling uncertainty only; retention bias is not corrected' };
}

function quantile(values: readonly number[], probability: number): number | null {
  if (!values.length) { return null; }
  const index = (values.length - 1) * probability;
  const lower = Math.floor(index);
  const weight = index - lower;
  return values[lower] + ((values[lower + 1] ?? values[lower]) - values[lower]) * weight;
}

function finiteNonNegative(value: unknown): number[] {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [value] : [];
}

function prReviewTurnarounds(evidence: readonly StatsRecoveryEvidence[]): { values: number[]; denominator: number } {
  const created = new Map<number, number>();
  for (const item of evidence) {
    if (item.source === 'forgejo-pr' && item.links.pullRequest !== null) {
      created.set(item.links.pullRequest, Date.parse(item.observedAt));
    }
  }
  const reviews = evidence.filter(item => item.source === 'forgejo-review' && item.links.pullRequest !== null);
  return { denominator: reviews.length, values: reviews.flatMap(item => {
    const start = created.get(item.links.pullRequest!);
    const elapsed = start === undefined ? Number.NaN : Date.parse(item.observedAt) - start;
    return Number.isFinite(elapsed) && elapsed >= 0 ? [elapsed] : [];
  }) };
}

function returnCohorts(changes: readonly StatsReconstructionChange[], projection: StatsProjection): RecoveryCohortCoverage[] {
  const rows = projection.rows.filter(row => changes.some(change => change.mission === row.mission));
  const output: RecoveryCohortCoverage[] = [];
  for (const [dimension, select] of [
    ['period', (row: typeof rows[number]) => row.date?.slice(0, 7)],
    ['model', (row: typeof rows[number]) => row.model],
    ['stage', (row: typeof rows[number]) => row.stage ?? 'default'],
  ] as const) {
    const values = [...new Set(rows.map(select).filter((value): value is string => Boolean(value)))];
    for (const value of values) {
      const missions = new Set(rows.filter(row => select(row) === value).map(row => row.mission));
      const observed = changes.filter(change => missions.has(change.mission) && change.after !== null).length;
      output.push(coverage('returnsPerMission', dimension, value, missions.size, observed));
    }
  }
  return output;
}

function evidenceCohorts(evidence: readonly StatsRecoveryEvidence[], metric: RecoveryCohortCoverage['metric'],
  dimension: RecoveryCohortCoverage['dimension'],
  select: (_item: StatsRecoveryEvidence) => string | null | undefined): RecoveryCohortCoverage[] {
  const values = [...new Set(evidence.map(select).filter((value): value is string => Boolean(value)))];
  return values.map(value => {
    const population = evidence.filter(item => select(item) === value).length;
    return coverage(metric, dimension, value, population, population);
  });
}

function durationCohorts(evidence: readonly StatsRecoveryEvidence[], dimension: 'model' | 'stage',
  select: (_item: StatsRecoveryEvidence) => string | null | undefined): RecoveryCohortCoverage[] {
  const group = (item: StatsRecoveryEvidence) => select(item) ?? 'unattributed';
  const values = [...new Set(evidence.map(group))];
  return values.map(value => {
    const population = evidence.filter(item => group(item) === value);
    const observed = population.filter(item => finiteNonNegative(item.raw.durationMs).length > 0).length;
    return coverage('repairAttemptDuration', dimension, value, population.length, observed);
  });
}

function returnCauseCohorts(changes: readonly StatsReconstructionChange[]): RecoveryCohortCoverage[] {
  const returns = changes.flatMap(change => change.returns);
  const causes = [...new Set(returns.map(item => item.origin.cause ?? 'unavailable'))];
  return causes.map(cause => {
    const population = returns.filter(item => (item.origin.cause ?? 'unavailable') === cause);
    const observed = population.filter(item => item.origin.cause !== null && item.origin.cause !== undefined).length;
    return coverage('returnsPerMission', 'cause', cause, population.length, observed);
  });
}

function coverage(metric: RecoveryCohortCoverage['metric'], dimension: RecoveryCohortCoverage['dimension'], value: string, denominator: number,
  observationCount: number): RecoveryCohortCoverage {
  return { metric, dimension, value, population: denominator, observationCount, denominator,
    coverage: denominator ? observationCount / denominator : null };
}

function textAt(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') { return null; }
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === 'string' && nested.trim() ? nested.trim() : null;
}

function cohortComparability(cohorts: readonly RecoveryCohortCoverage[]): string {
  const partial = cohorts.filter(item => item.coverage !== 1);
  return partial.length === 0
    ? 'Reported cohorts have complete coverage for the records eligible for each displayed cohort; source-retention bias still applies.'
    : `${partial.length}/${cohorts.length} displayed cohorts have partial eligible-record coverage and must not be compared as complete populations.`;
}

function unavailableMetrics(): StatsRecoveryAnalysis['unavailable'] {
  const reason = 'Historical source boundaries were not recorded; reconstruction would fabricate telemetry.';
  return ['CPU', 'per-gate execution intervals', 'source intervals', 'gate DAGs', 'verification gate attempts'].map(metric => ({
    metric, classification: 'unavailable' as const, reason,
  }));
}
