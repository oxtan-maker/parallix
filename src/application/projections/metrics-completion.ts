import type { MissionOutcome } from '../../domain/usage.js';
import type { DecisionWindow } from '../../domain/decision-window.js';
import { decisionWindowContains } from '../../domain/decision-window.js';
import type { MetricSeries } from './board.js';

function median(values: readonly number[]): number | null {
  if (values.length === 0) { return null; }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

/** Outcomes whose lifecycle completed inside the window. */
export function outcomesCompletedInWindow(
  outcomes: readonly MissionOutcome[],
  window: DecisionWindow | undefined,
): readonly MissionOutcome[] {
  return window === undefined
    ? outcomes
    : outcomes.filter((outcome) => decisionWindowContains(window, outcome.closedAt));
}

/**
 * Compute the median lifecycle cycle time of completed missions.
 *
 * `MissionOutcome.cycleTimeMinutes` is the mission's wall-clock lifetime,
 * derived from its lane events. It is not the agents' execution time — that is
 * `medianAgentRuntime`, which reads `outcome.runs`.
 *
 * When a decision `window` is supplied, only missions that completed inside it
 * are measured, so the reported median and `observationCount` describe the
 * weekly decision population rather than every mission ever completed.
 *
 * missingHistoryFallback: 'null' — returns null when no outcomes are available.
 */
export function medianStateTimes(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
  window?: DecisionWindow,
): MetricSeries {
  const ordered = [...outcomesCompletedInWindow(outcomes, window)]
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const values: number[] = [];
  let index = 0;
  return {
    // instants is readonly string[] (ISO-8601); default order == chronological, left implicit per SC6.
    series: [...instants].sort((left, right) => left.localeCompare(right)).map((through) => {
      while (index < ordered.length && ordered[index]!.closedAt <= through) {
        const value = ordered[index++]!.cycleTimeMinutes;
        const insertion = values.findIndex((existing) => existing > value);
        values.splice(insertion === -1 ? values.length : insertion, 0, value);
      }
      if (values.length === 0) { return { at: through, value: null, observationCount: 0 }; }
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];
      return { at: through, value: median, observationCount: values.length };
    }),
    missingHistoryFallback: 'null',
  };
}

// ---------------------------------------------------------------------------
// Median agent runtime — execution minutes from the runs on each outcome
// ---------------------------------------------------------------------------

/** Total measured execution minutes an outcome's agents spent. */
export function agentRuntimeMinutes(outcome: MissionOutcome): number | null {
  const measured = outcome.runs
    .map((run) => run.durationMinutes)
    .filter((duration): duration is { readonly kind: 'measured'; readonly value: number } => duration.kind === 'measured');
  return measured.length === 0 ? null : measured.reduce((sum, duration) => sum + duration.value, 0);
}

/**
 * Compute the median agent runtime of completed missions — how long the agents
 * actually ran, with queueing and review waits excluded. Its counterpart is
 * `medianStateTimes`, which measures the lifecycle those runs sit inside.
 *
 * A decision `window` selects the missions, never the individual runs: a
 * mission completed today keeps the runtime of a run it made eight days ago,
 * because that work is part of the outcome the window selected.
 *
 * missingHistoryFallback: 'null' — returns null when no outcome has a measured
 * run duration, so an unmeasured mission never reads as zero minutes of work.
 */
export function medianAgentRuntime(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
  window?: DecisionWindow,
): MetricSeries {
  const selected = outcomesCompletedInWindow(outcomes, window);
  return {
    series: instants.map((through) => {
      const measured = selected
        .filter((outcome) => outcome.closedAt <= through)
        .map((outcome) => agentRuntimeMinutes(outcome))
        .filter((minutes): minutes is number => minutes !== null);
      return { at: through, value: median(measured), observationCount: measured.length };
    }),
    missingHistoryFallback: 'null',
  };
}

// ---------------------------------------------------------------------------
// Cumulative flow — state distribution over time
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Throughput — completed missions per period
// ---------------------------------------------------------------------------

/**
 * Compute throughput (completed missions) over time.
 *
 * missingHistoryFallback: 'skip' — when no outcomes are available,
 * returns empty series (cannot estimate throughput from zero data).
 */
export function throughputSeries(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
): MetricSeries {
  if (outcomes.length === 0) {
    return { series: [], missingHistoryFallback: 'skip' };
  }
  return {
    series: instants.map((at) => {
      const completed = outcomes.filter((outcome) => outcome.closedAt <= at).length;
      return { at, value: completed, observationCount: completed };
    }),
    missingHistoryFallback: 'skip',
  };
}

