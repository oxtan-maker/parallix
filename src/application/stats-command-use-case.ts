import type { StatsMissionFlow, StatsWorkflowPort } from './ports/cli-workflows.js';
import { statisticsMissionKey, type StatisticsRow } from './services/statistics-service.js';
import { selectStatsReport, type StatsReportSelection } from './services/statistics-report-selection.js';

export interface StatsCommandRequest {
  readonly mode: 'weekly' | 'range' | 'mission';
  readonly mission?: string;
  readonly from?: string;
  readonly to?: string;
  readonly today?: string | Date;
}

export interface StatsCommandResult<Row extends StatisticsRow = StatisticsRow> {
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
      const mission = request.mission || '';
      return {
        mode: 'mission',
        rows: rows.filter(row => statisticsMissionKey(row) === statisticsMissionKey({ repo: row.repo, mission })),
        missionKey: statisticsMissionKey({ repo: '', mission }),
      };
    }
    const missionFlow = await this._workflow.loadMissionFlow();
    const classifierStatistics = await this._workflow.loadClassifierStatistics?.() ?? null;
    return { mode: request.mode, rows, missionFlow, classifierStatistics, selection: selectStatsReport(rows, missionFlow, { ...request, mode: request.mode }) };
  }
}
