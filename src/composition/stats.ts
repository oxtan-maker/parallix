import { createHumanReviewEpisodeReader, createMissionCohortMetadataReader, createReboundRepairReader, createWorkflowReturnReader, type LaneMove } from '../adapters/review/review-statistics-evidence.js';
import type { ReboundRepairHistoryEntry } from '../application/ports/operation-history.js';
import { createClassifierStatisticsReader } from './classifier-statistics.js';
import fs from 'node:fs';
import type { MissionStore } from '../application/domain-ports.js';
import type { StatsMissionFlow } from '../application/ports/cli-workflows.js';
import type { StatsReadBinding } from '../adapters/cli/commands/stats.js';
import type { StatsCohortsOptions } from '../adapters/cli/commands/stats-cohorts.js';
import { resolveOperatorRepositories, statsCohorts } from '../adapters/cli/commands/stats-cohorts.js';
import { createStatsWorkflowAdapter, renderWeeklyStatsReport, renderRangeStatsReport, renderMissionPhaseReport } from '../adapters/cli/commands/stats.js';
import { ConcreteMetricsReadAdapter } from '../application/projections/metrics-read-adapter.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { StatsCommandUseCase } from '../application/stats-command-use-case.js';
import { createStatsCommand } from '../interfaces/cli/stats.js';
import { repositoryId } from '../domain/repository.js';
import { createVerificationStatisticsReader } from './verification-statistics.js';
import { reportingWindowContains, type ReportingWindow } from '../domain/decision-window.js';
import type { VerificationStatistics } from '../application/projections/verification-statistics.js';

export interface StatsCompositionOptions extends StatsCohortsOptions {
  readonly store?: StatsReadBinding['store'];
  readonly dbPath?: string;
  readonly missionStore?: MissionStore;
  readonly readMissionFlow?: StatsReadBinding['readMissionFlow'];
  readonly verificationStatistics?: import('../application/ports/verification-statistics.js').VerificationStatisticsReadPort;
}

type VerificationRead = Promise<VerificationStatistics>;

/**
 * The verification reads of one stats run. The per-Mission FLOW observation and the report's verification section
 * read the same Missions over the same windows, so each scope is read once.
 */
function statsVerificationReads(options: StatsCompositionOptions) {
  const repairs = sharedReboundRepairs(options);
  const reader = options.verificationStatistics
    ?? createVerificationStatisticsReader(options.rootDir ?? process.cwd(), options.configuration, repairs);
  const reads = new Map<string, VerificationRead>();
  return {
    repairs,
    missions: (missions: ReadonlySet<string>, windows?: readonly ReportingWindow[]): VerificationRead => {
      const key = JSON.stringify([[...missions].sort((a, b) => a.localeCompare(b)), (windows ?? []).map(window => [window.start.toISOString(), window.end.toISOString()])]);
      const cached = reads.get(key) ?? reader.read(missions, windows);
      reads.set(key, cached);
      return cached;
    },
  };
}
type StatsVerificationReads = ReturnType<typeof statsVerificationReads>;

/**
 * One compact rebound-repair read serves the verification projection and the cohort readers of a stats run; the
 * retained repair transcript itself is megabytes of audit text per row and never joins either payload read.
 */
function sharedReboundRepairs(options: StatsCompositionOptions) {
  let read: Promise<readonly ReboundRepairHistoryEntry[]> | null = null;
  return () => {
    read ??= (async () => {
      const history = options.historyRepo ?? (await resolveOperatorRepositories(options.configuration)).historyRepo;
      return await history?.findReboundRepairs?.() ?? [];
    })();
    return read;
  };
}

/**
 * One collapsed lane-history pass serves every Mission of the run. `findAll` collapses duplicate transitions over
 * the same repository- and Mission-scoped signature, so grouping its rows by Mission answers exactly what a
 * Mission-scoped read returns.
 */
type LaneMoveRow = LaneMove & { readonly missionId: string };
function laneMovesPerMission(lane: { findAll(): Promise<readonly LaneMoveRow[]> }) {
  let grouped: Promise<ReadonlyMap<string, readonly LaneMoveRow[]>> | null = null;
  return { findByMissionId: (missionId: string): Promise<readonly LaneMove[]> => (
    grouped ??= lane.findAll().then(rows => {
      const byMission = new Map<string, LaneMoveRow[]>();
      for (const row of rows) { byMission.set(row.missionId, [...(byMission.get(row.missionId) ?? []), row]); }
      return byMission;
    })).then(byMission => byMission.get(missionId) ?? []) };
}

/** Composition owns the metrics graph; the application receives a bound read. */
export function createStatsMissionFlowReader(options: StatsCompositionOptions,
  reads: StatsVerificationReads = statsVerificationReads(options)): (_windows?: readonly ReportingWindow[]) => Promise<readonly StatsMissionFlow[] | null> {
  return async windows => {
    try {
      const repos = options.laneEventRepo && options.usageRepo
        ? { laneEventRepo: options.laneEventRepo, usageRepo: options.usageRepo, historyRepo: options.historyRepo }
        : await resolveOperatorRepositories(options.configuration);
      const repo = options.repositoryId ?? resolveCanonicalRepositoryId(options.rootDir ?? process.cwd());
      const cohortMetadata = options.cohortMetadata ?? (async () => {
        const missions = options.missionStore?.loadByRepository ? await options.missionStore.loadByRepository(repo)
          : await (async () => {
            const { initOperatorState } = await import('../adapters/sqlite/adapter-factory.js');
            const { SqliteMissionStore } = await import('../adapters/sqlite/mission-store.js');
            const { db } = await initOperatorState({ configuration: options.configuration });
            return new SqliteMissionStore(db).loadByRepository(repo);
          })();
        // The repair facts come from the compact batched read the board already owns; reading each Mission's
        // retained repair transcript separately repeats megabytes of audit text for the same rows.
        const moves = laneMovesPerMission(repos.laneEventRepo);
        return createMissionCohortMetadataReader(options.rootDir ?? process.cwd(),
          createWorkflowReturnReader(moves, repos.historyRepo, createReboundRepairReader({ findReboundRepairs: reads.repairs })),
          createHumanReviewEpisodeReader(moves))(missions);
      });
      const metadata = await cohortMetadata();
      const reader = new ConcreteMetricsReadAdapter({ ...repos, repositoryId: repositoryId(String(repo)), cohortMetadata: async () => metadata });
      const outcomes = await reader.readOutcomes();
      // A windowed report observes only the Missions its windows completed; nothing older is read.
      const observed = new Set(outcomes.filter(outcome => !windows || windows.some(window => reportingWindowContains(window, outcome.closedAt)))
        .map(outcome => String(outcome.missionId)));
      const verification = await reads.missions(observed, windows).catch(() => null) ?? null;
      return outcomes.map(outcome => ({
        repo: String(repo), mission: String(outcome.missionId), createdAt: outcome.createdAt, closedAt: outcome.closedAt,
        labels: outcome.labels, implementer: outcome.implementer,
        reviewStatistics: metadata.get(outcome.missionId)?.reviewStatistics,
        ...(verification?.flowMissions.find(item => item.missionId === outcome.missionId)
          ? { flowObservation: verification.flowMissions.find(item => item.missionId === outcome.missionId)! } : {}),
      }));
    } catch { return null; }
  };
}

/** CLI arguments/presentation and bound storage capabilities are assembled here. */
export function createStatisticsCommand(options: StatsCompositionOptions = {}) {
  const reads = statsVerificationReads(options);
  const useCase = new StatsCommandUseCase({ ...createStatsWorkflowAdapter({
    configuration: options.configuration, rootDir: options.rootDir, store: options.store, dbPath: options.dbPath,
    readMissionFlow: options.readMissionFlow ?? createStatsMissionFlowReader(options, reads),
  }), loadVerificationStatistics: ({ missions, windows }) => reads.missions(missions, windows).catch(() => null), loadClassifierStatistics: async () => {
    try { return await (await createClassifierStatisticsReader(options.rootDir ?? process.cwd(), options.configuration)).read(); }
    catch { return null; }
  } });
  return createStatsCommand(useCase, {
    renderWeekly: (rows, report) => renderWeeklyStatsReport(rows, report),
    renderRange: (rows, report) => renderRangeStatsReport(rows, report),
    renderMission: (rows, mission, report) => renderMissionPhaseReport(rows, mission, report),
    writeReport: (file, report) => fs.writeFileSync(file, report, 'utf8'),
    cohorts: (args, output) => statsCohorts(args, { ...options, ...output }),
  });
}
