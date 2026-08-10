import React from 'react';
import { Box, Text } from 'ink';
import type { BoardMetrics, LaneMetricSeries, MetricSeries } from '../../application/projections/board.js';
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

/** Render projection-supplied experiment figures; no statistics are calculated here. */
function CohortRows({ metrics }: { readonly metrics: BoardMetrics }): React.ReactElement | null {
  const comparison = metrics.cohorts;
  if (!comparison || comparison.cohorts.length === 0) { return null; }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{`EXPERIMENT COHORTS · ${comparison.dimension}`}</Text>
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
 */
export function FlowPanel({ metrics, columns }: { readonly metrics: BoardMetrics; readonly columns?: number }): React.ReactElement {
  const dimensions = useTerminalDimensions();
  const width = columns ?? dimensions.columns;
  const narrow = width < FLOW_NARROW_COLUMNS;
  const flow = metrics.cumulativeFlowByState.series.at(-1);
  const throughput = metrics.weeklyThroughput.series.at(-1)?.value;
  const bounceRatePoint = metrics.reviewBounceRate.series.at(-1);
  // Provenance population is deliberately not displayed beside individual
  // statistics: it is not their observation count.
  const sampleSize = metrics.provenance?.sampleSize ?? 0;
  const healthState = metrics.health?.state ?? 'no-telemetry';
  // Lifecycle time and agent execution time are different quantities and are
  // never labelled with each other's words. Projections cached before the two
  // were split carry no runtime series at all.
  const lifecycleCycleTime = metrics.medianStateTimes?.series.at(-1)?.value;
  const agentRuntime = metrics.medianAgentRuntime?.series.at(-1)?.value;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">FLOW{narrow ? ' · textual' : ''}</Text>
      <Text color={healthState === 'unavailable' ? 'red' : healthState === 'partial' ? 'yellow' : 'gray'}>{`Statistics: ${healthState} · population n=${sampleSize}`}</Text>
      <Box flexDirection={narrow ? 'column' : 'row'}>
        <Box flexDirection="column" marginRight={narrow ? 0 : 4}>
          <Text bold>CUMULATIVE FLOW</Text>
          <Text>{flow ? Object.entries(flow.counts).map(([lane, count]) => `${lane} ${count}`).join(' · ') : 'unavailable'}</Text>
          <Text dimColor>{history('Cumulative flow', metrics.cumulativeFlowByState.missingHistoryFallback)}</Text>
          <Text dimColor>{legend(flow)}</Text>
          <Text>{`Weekly completions: ${display(throughput)}${coverage(metrics.weeklyThroughput.series.at(-1))}`}</Text>
          <Text dimColor>{history('Weekly completions', metrics.weeklyThroughput.missingHistoryFallback)}</Text>
          <Text>{`Lifecycle review-bounce rate: ${display(bounceRatePoint?.value)}${coverage(bounceRatePoint)}`}</Text>
          <Text dimColor>{history('Lifecycle review-bounce rate', metrics.reviewBounceRate.missingHistoryFallback)}</Text>
          <Text>{`Median lifecycle cycle time: ${display(lifecycleCycleTime, ' min')}${coverage(metrics.medianStateTimes.series.at(-1))}`}</Text>
          <Text dimColor>{history('Median lifecycle cycle time', metrics.medianStateTimes?.missingHistoryFallback ?? 'null')}</Text>
          <Text>{`Median agent runtime: ${display(agentRuntime, ' min')}${coverage(metrics.medianAgentRuntime?.series.at(-1))}`}</Text>
          <Text dimColor>{history('Median agent runtime', metrics.medianAgentRuntime?.missingHistoryFallback ?? 'null')}</Text>
        </Box>
        <Box flexDirection="column" marginRight={narrow ? 0 : 4}>
          <LaneRows label="Median cycle time" metric={metrics.medianCycleTimeByState} suffix=" min" />
          <LaneRows label="Median lane age" metric={metrics.medianAgeByLane} suffix=" min" />
        </Box>
        <Box flexDirection="column">
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
