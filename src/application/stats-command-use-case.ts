import type { StatsWorkflowPort } from './ports/cli-workflows.js';
import {
  statisticsMissionKey,
  statisticsRowInWindow,
  summarizeCompletedMissionWindow,
  type StatisticsRow,
} from './services/statistics-service.js';
import { weeklyDecisionWindows } from './services/decision-window.js';

export interface StatsCommandRequest {
  readonly mode: 'weekly' | 'range' | 'mission';
  readonly mission?: string;
  readonly from?: string;
  readonly to?: string;
  readonly today?: string | Date;
  readonly backfill?: boolean;
  readonly lookupForgejo?: boolean;
  readonly options?: Record<string, unknown>;
}

export interface StatsCommandResult<Row extends StatisticsRow = StatisticsRow> {
  readonly mode: StatsCommandRequest['mode'];
  readonly rows: readonly Row[];
  readonly missionKey?: string;
  readonly windowedRows?: readonly Row[];
  readonly completedMissions?: readonly Row[];
  readonly backfilled?: boolean;
  readonly forgejoWarning?: string;
}

function rangeWindow(from?: string, to?: string) {
  return {
    start: new Date(`${from || '0000-01-01'}T00:00:00Z`),
    end: new Date(`${to || '9999-12-31'}T00:00:00Z`),
  };
}

/** CLI-independent stats workflow. Rendering and process exit remain adapter concerns. */
export class StatsCommandUseCase<Row extends StatisticsRow = StatisticsRow> {
  constructor(private readonly _workflow: StatsWorkflowPort<Row>) {}

  execute(request: StatsCommandRequest): StatsCommandResult<Row> {
    const options = request.options || {};
    if (request.backfill && this._workflow.backfill) { this._workflow.backfill(options); }
    const rows = this._workflow.loadMeasurements(options);

    let forgejoWarning: string | undefined;
    if (request.lookupForgejo && request.mission && this._workflow.lookupForgejo) {
      try { this._workflow.lookupForgejo(request.mission, options); } catch (error: any) {
        forgejoWarning = error instanceof Error ? error.message : String(error);
      }
    }

    if (request.mode === 'mission') {
      const mission = request.mission || '';
      return {
        mode: 'mission',
        rows: rows.filter((row) => statisticsMissionKey(row) === statisticsMissionKey({ repo: row.repo, mission })),
        missionKey: statisticsMissionKey({ repo: '', mission }),
        backfilled: Boolean(request.backfill),
        forgejoWarning,
      };
    }

    const window = request.mode === 'range'
      ? rangeWindow(request.from, request.to)
      : weeklyDecisionWindows(request.today ?? new Date()).current;
    const summary = summarizeCompletedMissionWindow(rows, window);
    return {
      mode: request.mode,
      rows,
      windowedRows: rows.filter((row) => statisticsRowInWindow(row, window)),
      completedMissions: summary.missions,
      backfilled: Boolean(request.backfill),
      forgejoWarning,
    };
  }
}
