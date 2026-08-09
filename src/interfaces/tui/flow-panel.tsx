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

function legend(flow: BoardMetrics['cumulativeFlowByState']['series'][number] | undefined): string {
  if (!flow) { return 'Legend: unavailable'; }
  return `Legend: ${Object.keys(flow.counts).map((lane) => `${lane} ■`).join(' · ')}`;
}

function LaneRows({ label, metric, sampleSize, suffix = '' }: { label: string; metric: LaneMetricSeries; sampleSize: number; suffix?: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      {metric.series.map((entry) => <Text key={entry.lane}>{`${entry.lane}: ${display(entry.value, suffix)} (n=${sampleSize})`}</Text>)}
      <Text dimColor>{history(label, metric.missingHistoryFallback)}</Text>
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
  const loopRate = metrics.reviewLoopRate.series.at(-1)?.value;
  // Older cached projections can lack the new provenance contract; render a
  // neutral zero sample rather than making the board unavailable.
  const sampleSize = metrics.provenance?.sampleSize ?? 0;
  const healthState = metrics.health?.state ?? 'no-telemetry';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">FLOW{narrow ? ' · textual' : ''}</Text>
      <Text color={healthState === 'unavailable' ? 'red' : healthState === 'partial' ? 'yellow' : 'gray'}>{`Statistics: ${healthState} · n=${sampleSize}`}</Text>
      <Box flexDirection={narrow ? 'column' : 'row'}>
        <Box flexDirection="column" marginRight={narrow ? 0 : 4}>
          <Text bold>CUMULATIVE FLOW</Text>
          <Text>{flow ? Object.entries(flow.counts).map(([lane, count]) => `${lane} ${count}`).join(' · ') : 'unavailable'}</Text>
          <Text dimColor>{history('Cumulative flow', metrics.cumulativeFlowByState.missingHistoryFallback)}</Text>
          <Text dimColor>{legend(flow)}</Text>
          <Text>{`Weekly completions: ${display(throughput)} (n=${sampleSize})`}</Text>
          <Text dimColor>{history('Weekly completions', metrics.weeklyThroughput.missingHistoryFallback)}</Text>
          <Text>{`Review-to-active loop rate: ${display(loopRate)} (n=${sampleSize})`}</Text>
          <Text dimColor>{history('Review-to-active loop rate', metrics.reviewLoopRate.missingHistoryFallback)}</Text>
        </Box>
        <Box flexDirection="column" marginRight={narrow ? 0 : 4}>
          <LaneRows label="Median cycle time" metric={metrics.medianCycleTimeByState} sampleSize={sampleSize} suffix=" min" />
          <LaneRows label="Median lane age" metric={metrics.medianAgeByLane} sampleSize={sampleSize} suffix=" min" />
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
    </Box>
  );
}
