import fs from 'node:fs';
import type { MissionStore } from '../application/domain-ports.js';
import type { StatsMissionFlow } from '../application/ports/cli-workflows.js';
import type { StatsReadBinding } from '../adapters/cli/commands/stats.js';
import type { StatsCohortsOptions } from '../adapters/cli/commands/stats-cohorts.js';
import { resolveOperatorRepositories, statsCohorts } from '../adapters/cli/commands/stats-cohorts.js';
import { createStatsWorkflowAdapter, renderWeeklyStatsReport, renderRangeStatsReport, renderMissionPhaseReport } from '../adapters/cli/commands/stats.js';
import { ConcreteMetricsReadAdapter, missionCohortMetadata } from '../application/projections/metrics-read-adapter.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { StatsCommandUseCase } from '../application/stats-command-use-case.js';
import { createStatsCommand } from '../interfaces/cli/stats.js';
import { repositoryId } from '../domain/repository.js';

export interface StatsCompositionOptions extends StatsCohortsOptions {
  readonly store?: StatsReadBinding['store'];
  readonly dbPath?: string;
  readonly missionStore?: MissionStore;
  readonly readMissionFlow?: StatsReadBinding['readMissionFlow'];
}

/** Composition owns the metrics graph; the application receives a bound read. */
export function createStatsMissionFlowReader(options: StatsCompositionOptions): () => Promise<readonly StatsMissionFlow[] | null> {
  return async () => {
    try {
      const repos = options.laneEventRepo && options.usageRepo
        ? { laneEventRepo: options.laneEventRepo, usageRepo: options.usageRepo }
        : await resolveOperatorRepositories();
      const repo = options.repositoryId ?? resolveCanonicalRepositoryId(options.rootDir ?? process.cwd());
      const cohortMetadata = options.cohortMetadata ?? (async () => {
        if (options.missionStore?.loadByRepository) { return missionCohortMetadata(await options.missionStore.loadByRepository(repo)); }
        const { initOperatorState } = await import('../adapters/sqlite/adapter-factory.js');
        const { SqliteMissionStore } = await import('../adapters/sqlite/mission-store.js');
        const { db } = await initOperatorState();
        return missionCohortMetadata(await new SqliteMissionStore(db).loadByRepository(repo));
      });
      const reader = new ConcreteMetricsReadAdapter({ ...repos, repositoryId: repositoryId(String(repo)), cohortMetadata });
      const outcomes = await reader.readOutcomes();
      return outcomes.map(outcome => ({
        repo: String(repo), mission: String(outcome.missionId), closedAt: outcome.closedAt,
        labels: outcome.labels, implementer: outcome.implementer,
      }));
    } catch { return null; }
  };
}

/** CLI arguments/presentation and bound storage capabilities are assembled here. */
export function createStatisticsCommand(options: StatsCompositionOptions = {}) {
  const useCase = new StatsCommandUseCase(createStatsWorkflowAdapter({
    rootDir: options.rootDir, store: options.store, dbPath: options.dbPath,
    readMissionFlow: options.readMissionFlow ?? createStatsMissionFlowReader(options),
  }));
  return createStatsCommand(useCase, {
    renderWeekly: (rows, report) => renderWeeklyStatsReport(rows, report),
    renderRange: (rows, report) => renderRangeStatsReport(rows, report),
    renderMission: (rows, mission, report) => renderMissionPhaseReport(rows, mission, report),
    writeReport: (file, report) => fs.writeFileSync(file, report, 'utf8'),
    cohorts: (args, output) => statsCohorts(args, { ...options, ...output }),
  });
}
