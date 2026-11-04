import { reviewStatistics, type ReviewStatistics } from './review-statistics.js';
import { selectBugTrend, type BugTrendPeriod } from './statistics-bug-trend.js';
import type { StatsMissionFlow } from '../ports/cli-workflows.js';
import { weeklyDecisionWindows, reportingWindowContains, type ReportingWindow } from '../../domain/decision-window.js';
import { createRangeWindow } from './statistics-row.js';
import { statisticsMissionKey, statisticsRowInWindow, type StatisticsRow } from './statistics-service.js';
import { flowStatistics, type FlowStatistics } from '../projections/flow-statistics.js';

export interface StatsReportWindow<Row extends StatisticsRow = StatisticsRow> {
  readonly window: ReportingWindow & { readonly label: string };
  readonly windowedRows: readonly Row[];
  readonly completedRows: readonly Row[];
  readonly completedMissions: readonly Row[];
  readonly completedReviewStatistics: ReadonlyMap<string, ReviewStatistics>;
  readonly completedMissionOwners: ReadonlyMap<string, string | null>;
  readonly flow: { readonly total: number; readonly userValue: number; readonly aiSdlc: number; readonly unclassified: number } | null;
}

export interface StatsReportSelection<Row extends StatisticsRow = StatisticsRow> {
  readonly bugTrend: readonly BugTrendPeriod[] | null;
  readonly current: StatsReportWindow<Row>;
  readonly previous?: StatsReportWindow<Row>;
  readonly flowStatistics?: FlowStatistics;
}

/** Select lifecycle completions by canonical delivery day, telemetry spend by measurement day. */
export function selectStatsReport<Row extends StatisticsRow>(
  rows: readonly Row[],
  missionFlow: readonly StatsMissionFlow[] | null,
  request: { readonly mode: 'weekly' | 'range'; readonly today?: string | Date; readonly from?: string; readonly to?: string; readonly timeZone?: string },
): StatsReportSelection<Row> {
  const decisionWindows = request.mode === 'weekly' ? weeklyDecisionWindows(request.today ?? new Date(), request.timeZone) : null;
  const windows = decisionWindows ?? { current: createRangeWindow({ from: request.from, to: request.to, timeZone: request.timeZone }), previous: undefined };
  const select = (window: StatsReportWindow<Row>['window']): StatsReportWindow<Row> => {
    const outcomes = (missionFlow ?? []).filter(outcome => reportingWindowContains(window, outcome.closedAt));
    const completedMissionKeys = new Set(outcomes.map(statisticsMissionKey));
    const completedMissionOwners = new Map(outcomes.map(outcome => [
      statisticsMissionKey(outcome), outcome.implementer ?? null,
    ]));
    const completedRows = rows.filter(row => completedMissionKeys.has(statisticsMissionKey(row)));
    const completedReviewStatistics = new Map(outcomes.map(outcome => {
      const key = statisticsMissionKey(outcome);
      return [key, outcome.reviewStatistics ?? reviewStatistics(null)] as const;
    }));
    const seen = new Set<string>();
    const completedMissions = completedRows.filter(row => {
      const key = statisticsMissionKey(row);
      if (seen.has(key)) { return false; }
      seen.add(key);
      return true;
    });
    return {
      window, windowedRows: rows.filter(row => statisticsRowInWindow(row, window)),
      completedRows, completedMissions, completedMissionOwners, completedReviewStatistics,
      flow: missionFlow === null ? null : {
        total: outcomes.length,
        userValue: outcomes.filter(outcome => outcome.labels.includes('user_value')).length,
        aiSdlc: outcomes.filter(outcome => outcome.labels.includes('ai_sdlc')).length,
        unclassified: outcomes.filter(outcome => !outcome.labels.some(label => ['user_value', 'ai_sdlc'].includes(label))).length,
      },
    };
  };
  const periods = [windows.current, ...(windows.previous ? [windows.previous] : [])];
  const sharedFlow = decisionWindows && missionFlow !== null && missionFlow.some(outcome => outcome.flowObservation)
    ? flowStatistics(missionFlow.map(outcome => ({
    repositoryId: outcome.repo, missionId: outcome.mission, closedAt: outcome.closedAt,
    diagramNodeIds: outcome.flowObservation?.diagramNodeIds ?? [],
    diagramEdgeIds: outcome.flowObservation?.diagramEdgeIds ?? [], ownership: outcome.flowObservation?.ownership ?? [],
    actualAgentLaunches: outcome.flowObservation?.actualAgentLaunches ?? null,
    agentLaunches: outcome.flowObservation?.agentLaunches ?? [],
    observedDisqualifiers: outcome.flowObservation?.observedDisqualifiers ?? null,
    reviewStatistics: outcome.reviewStatistics ?? reviewStatistics(null),
    })), decisionWindows) : undefined;
  return {
    bugTrend: missionFlow === null ? null : periods.flatMap(window => selectBugTrend(missionFlow, window.start, window.end, window.timeZone) ?? []),
    current: select(windows.current), previous: windows.previous ? select(windows.previous) : undefined,
    ...(sharedFlow ? { flowStatistics: sharedFlow } : {}),
  };
}
