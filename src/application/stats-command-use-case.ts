import type { StatsMissionFlow, StatsWorkflowPort } from './ports/cli-workflows.js';
import { statisticsMissionKey, type StatisticsRow } from './services/statistics-service.js';
import { reportingWindowContains } from '../domain/decision-window.js';
import { requestedStatsWindows, selectStatsReport, type StatsReportSelection } from './services/statistics-report-selection.js';

export interface StatsCommandRequest {
  readonly mode: 'weekly' | 'range' | 'mission';
  readonly mission?: string;
  readonly from?: string;
  readonly to?: string;
  readonly today?: string | Date;
}

export interface StatsCommandResult<Row extends StatisticsRow = StatisticsRow> {
  readonly verification?: import('./projections/verification-statistics.js').VerificationStatistics | null;
  readonly mode: StatsCommandRequest['mode'];
  readonly rows: readonly Row[];
  readonly missionKey?: string;
  readonly selection?: StatsReportSelection<Row>;
  readonly classifierStatistics?: import('./review-classification/statistics.js').ClassifierStatisticsInput | null;
  readonly missionFlow?: readonly StatsMissionFlow[] | null;
}

/** Reporting workflow; its port is bound to concrete stores by composition. */
export class StatsCommandUseCase<Row extends StatisticsRow = StatisticsRow> {
  constructor(private readonly _workflow: StatsWorkflowPort<Row>) {}

  async execute(request: StatsCommandRequest): Promise<StatsCommandResult<Row>> {
    const rows = await this._workflow.loadMeasurements();
    if (request.mode === 'mission') {
      const verification = await this._workflow.loadVerificationStatistics?.({ missions: new Set([request.mission ?? '']) }) ?? null;
      const mission = request.mission || '';
      return {
        mode: 'mission',
        verification,
        rows: rows.filter(row => statisticsMissionKey(row) === statisticsMissionKey({ repo: row.repo, mission })),
        missionKey: statisticsMissionKey({ repo: '', mission }),
      };
    }
    // Every verification measurement covers the report's windows only; naming them up front lets one read serve both
    // the per-Mission FLOW observation and the verification section.
    const requested = requestedStatsWindows({ ...request, mode: request.mode });
    const windows = [requested.current, ...(requested.previous ? [requested.previous] : [])];
    const missionFlow = await this._workflow.loadMissionFlow(windows);
    const classifierStatistics = await this._workflow.loadClassifierStatistics?.() ?? null;
    const missions = new Set((missionFlow ?? []).filter(outcome => windows.some(window => reportingWindowContains(window, outcome.closedAt))).map(outcome => outcome.mission));
    const verification = await this._workflow.loadVerificationStatistics?.({ missions, windows }) ?? null;
    return { mode: request.mode, rows, missionFlow, classifierStatistics, verification, selection: selectStatsReport(rows, missionFlow, { ...request, mode: request.mode }) };
  }
}
