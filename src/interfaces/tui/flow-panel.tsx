import React from 'react';
import { Box, Text } from 'ink';
import type {
  BoardMetrics,
  DecisionMetric,
  DecisionWindowMetrics,
  LaneMetricSeries,
  MetricSeries,
} from '../../application/projections/board.js';
import { useTerminalDimensions } from './board-layout.js';

/** FLOW switches to one label/value row per datum below this width. */
export const FLOW_NARROW_COLUMNS = 80;

function display(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? 'unavailable' : `${value}${suffix}`;
}

function history(label: string, fallback: MetricSeries['missingHistoryFallback']): string {
  return `${label} history: ${fallback}`;
}

function coverage(point: { readonly observationCount?: number } | undefined): string {
  return ` (n=${point?.observationCount ?? 0})`;
}

/** A projection-supplied figure beside the observations it was computed from. */
function figure(metric: DecisionMetric | undefined, suffix = ''): string {
  return `${display(metric?.value, suffix)}${coverage(metric)}`;
}

/** A projection-supplied rate, shown to two decimals so a column stays readable. */
function rateFigure(metric: DecisionMetric | undefined): string {
  const value = metric?.value;
  return `${value === null || value === undefined ? 'unavailable' : value.toFixed(2)}${coverage(metric)}`;
}

function legend(flow: BoardMetrics['cumulativeFlowByState']['series'][number] | undefined): string {
  if (!flow) { return 'Legend: unavailable'; }
  return `Legend: ${Object.keys(flow.counts).map((lane) => `${lane} ■`).join(' · ')}`;
}

function LaneRows({ label, metric, suffix = '' }: { label: string; metric: LaneMetricSeries; suffix?: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      {metric.series.map((entry) => <Text key={entry.lane}>{`${entry.lane}: ${display(entry.value, suffix)}${coverage(entry)}`}</Text>)}
      <Text dimColor>{history(label, metric.missingHistoryFallback)}</Text>
    </Box>
  );
}

/**
 * The weekly decision comparison: how the missions completed in the last seven
 * days behaved, beside the seven days before them.
 *
 * Every number here is read straight off `metrics.decisionWindow`. No filtering,
 * no median, no date arithmetic, no cohort membership is computed in this file —
 * the projection decides what the figures are, this only lays them out.
 */
function DecisionWindowRows({ metrics, narrow }: { readonly metrics: BoardMetrics; readonly narrow: boolean }): React.ReactElement {
  const comparison = metrics.decisionWindow;
  if (!comparison) {
    return (
      <Box flexDirection="column">
        <Text bold>DECISION WINDOW · completed missions</Text>
        <Text dimColor>Decision window unavailable: this projection predates rolling-window statistics.</Text>
      </Box>
    );
  }
  const rows: readonly (readonly [string, string, string])[] = [
    ['Completed missions', `n=${comparison.current.completedMissions}`, `n=${comparison.previous.completedMissions}`],
    ['Lifecycle cycle median', figure(comparison.current.cycleTime, ' min'), figure(comparison.previous.cycleTime, ' min')],
    ['Agent runtime median', figure(comparison.current.agentRuntime, ' min'), figure(comparison.previous.agentRuntime, ' min')],
    ['Active dwell median', figure(comparison.current.activeDwell, ' min'), figure(comparison.previous.activeDwell, ' min')],
    ['Review dwell median', figure(comparison.current.reviewDwell, ' min'), figure(comparison.previous.reviewDwell, ' min')],
    ['Integration dwell median', figure(comparison.current.integrationDwell, ' min'), figure(comparison.previous.integrationDwell, ' min')],
    ['Review bounce rate', rateFigure(comparison.current.reviewBounce), rateFigure(comparison.previous.reviewBounce)],
  ];
  return (
    <Box flexDirection="column">
      <Text bold>DECISION WINDOW · completed missions</Text>
      <Text>{`current ${comparison.current.label}`}</Text>
      <Text dimColor>{`previous ${comparison.previous.label}`}</Text>
      {rows.map(([label, current, previous]) => (
        <Text key={label}>
          {narrow
            ? `${label}: ${current} · previous ${previous}`
            : `${label.padEnd(25)}${current.padEnd(20)}${previous}`}
        </Text>
      ))}
    </Box>
  );
}

/** Render projection-supplied experiment figures; no statistics are calculated here. */
function CohortRows({ metrics }: { readonly metrics: BoardMetrics }): React.ReactElement | null {
  const comparison = metrics.cohorts;
  if (!comparison || comparison.cohorts.length === 0) { return null; }
  const window: DecisionWindowMetrics | undefined = metrics.decisionWindow?.current;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{`EXPERIMENT COHORTS · ${comparison.dimension}${window ? ` · ${window.label}` : ''}`}</Text>
      {comparison.cohorts.map((cohort) => (
        <Box key={cohort.key} flexDirection="column">
          <Text>{`${cohort.key}${cohort.lowSample ? ' · low-sample' : ''} · population n=${cohort.n}`}</Text>
          <Text dimColor>{`cycle median ${display(cohort.medianCycleTimeMinutes, ' min')} (n=${cohort.observationCounts.cycleTime}) · p75 ${display(cohort.p75CycleTimeMinutes, ' min')} (n=${cohort.observationCounts.cycleTime})`}</Text>
          <Text dimColor>{`active ${display(cohort.medianActiveDwellMinutes, ' min')} (n=${cohort.observationCounts.activeDwell}) · review ${display(cohort.medianReviewDwellMinutes, ' min')} (n=${cohort.observationCounts.reviewDwell}) · bounces ${display(cohort.reviewBounceRate)} (n=${cohort.observationCounts.reviewBounce})`}</Text>
          <Text dimColor>{`fix rounds ${display(cohort.medianReviewFixRounds)} (n=${cohort.observationCounts.reviewFixRounds}) · runtime ${display(cohort.agentRuntimeMinutesPerMission, ' min')} (n=${cohort.observationCounts.runtime}) · tokens ${display(cohort.tokensPerMission)} (n=${cohort.observationCounts.tokens})`}</Text>
          <Text dimColor>{`cost ${display(cohort.costUsdPerMission, ' USD')} (n=${cohort.observationCounts.cost}) · NEL ${display(cohort.netEngineeringLinesPerMission)} (n=${cohort.observationCounts.netEngineeringLines})`}</Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Read-only FLOW presentation. Values, fallbacks, and the narrative are
 * supplied by BoardMetrics; this component only selects a terminal layout and
 * formats the supplied values for Ink.
 *
 * The panel is split into two kinds of statistic, because they answer different
 * questions and must not be read as one number:
 *
 *   DECISION WINDOW — the missions completed in the last rolling seven days,
 *                     compared with the seven before them.
 *   CURRENT FLOW    — what the board looks like right now: lane occupancy, lane
 *                     age, the bottleneck, agent availability. Deliberately not
 *                     windowed.
 */
export function FlowPanel({ metrics, columns }: { readonly metrics: BoardMetrics; readonly columns?: number }): React.ReactElement {
  const dimensions = useTerminalDimensions();
  const width = columns ?? dimensions.columns;
  const narrow = width < FLOW_NARROW_COLUMNS;
  const flow = metrics.cumulativeFlowByState.series.at(-1);
  const bounceRatePoint = metrics.reviewBounceRate.series.at(-1);
  // Provenance population is deliberately not displayed beside individual
  // statistics: it is the all-history telemetry the projection was derived from,
  // not the observation count of any figure and not the decision sample.
  const sampleSize = metrics.provenance?.sampleSize ?? 0;
  const healthState = metrics.health?.state ?? 'no-telemetry';
  const windowLabel = metrics.decisionWindow?.current.label;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">{`FLOW${narrow ? ' · textual' : ''}${windowLabel ? ` · decision window ${windowLabel}` : ''}`}</Text>
      <Text color={healthState === 'unavailable' ? 'red' : healthState === 'partial' ? 'yellow' : 'gray'}>{`Statistics: ${healthState} · population n=${sampleSize} (all recorded history, not the decision sample)`}</Text>
      <Box flexDirection={narrow ? 'column' : 'row'}>
        <Box flexDirection="column" marginRight={narrow ? 0 : 4}>
          <DecisionWindowRows metrics={metrics} narrow={narrow} />
          <Text>{`Lifecycle review-bounce rate: ${display(bounceRatePoint?.value)}${coverage(bounceRatePoint)}`}</Text>
          <Text dimColor>{history('Lifecycle review-bounce rate', metrics.reviewBounceRate.missingHistoryFallback)}</Text>
        </Box>
        <Box flexDirection="column" marginRight={narrow ? 0 : 4}>
          <LaneRows label="Median cycle time" metric={metrics.medianCycleTimeByState} suffix=" min" />
          <Text bold color="cyan">CURRENT FLOW · state now</Text>
          <LaneRows label="Median lane age" metric={metrics.medianAgeByLane} suffix=" min" />
        </Box>
        <Box flexDirection="column">
          <Text bold>CUMULATIVE FLOW</Text>
          <Text>{flow ? Object.entries(flow.counts).map(([lane, count]) => `${lane} ${count}`).join(' · ') : 'unavailable'}</Text>
          <Text dimColor>{history('Cumulative flow', metrics.cumulativeFlowByState.missingHistoryFallback)}</Text>
          <Text dimColor>{legend(flow)}</Text>
          <Text bold>READ</Text>
          <Text color="yellow">{metrics.bottleneck.sentence}</Text>
          <Text bold>Agents</Text>
          {metrics.agentAvailability.length === 0
            ? <Text>unavailable</Text>
            : metrics.agentAvailability.map((agent) => (
              <Text key={agent.family}>{`${agent.family} ${agent.available ? 'available' : 'unavailable'}`}</Text>
            ))}
        </Box>
      </Box>
      <CohortRows metrics={metrics} />
    </Box>
  );
}
