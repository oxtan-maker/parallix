import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { DEFAULT_CONFIGURATION } from '../application/ports/configuration.js';
import type { VerificationStatisticsReadPort } from '../application/ports/verification-statistics.js';
import { verificationStatistics, type VerificationStatisticsInput } from '../application/projections/verification-statistics.js';
import { initOperatorState } from '../adapters/sqlite/adapter-factory.js';
import { SqliteOperationalHistoryRepository } from '../adapters/sqlite/operational-history-repository.js';
import { SqliteWorkflowOperationStore, workflowOperationCollectionDefects } from '../adapters/sqlite/workflow-operation-store.js';
import { SqliteBoardLaneEventRepository } from '../adapters/sqlite/board-lane-event-repository.js';
import { retainedRepositoryRunRecords } from '../adapters/filesystem/run-history-store.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { snapshotWorktreeTopology } from '../adapters/git/worktree.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';
import type { MissionTerminalCapability } from '../application/ports/mission-terminal.js';
import type { RunRecord } from '../application/run-history-types.js';

/**
 * The per-Mission retained runs behind the FLOW projection: the compatibility
 * resolver attributes each Mission's canonical, legacy-named and worktree-local
 * records, and one run id is counted once across the Mission population.
 * Both verification compositions share this owner; the repository-wide
 * observation population is the single-pass `retainedRepositoryRunRecords` read.
 */
export function retainedFlowRunRecords(terminal: MissionTerminalCapability, missions: Iterable<string>): RunRecord[] {
  const seen = new Set<string>();
  return [...missions].flatMap(mission => {
    const history = terminal.history(mission);
    return history.ok ? history.runs.flatMap(run => seen.has(run.record.runId) ? [] : (seen.add(run.record.runId), [run.record])) : [];
  });
}

/** All consumers read the same repository-scoped facts and pure calculation. */
export function createVerificationStatisticsReader(root: string, configuration?: ParallixConfiguration): VerificationStatisticsReadPort {
  return verificationStatisticsReader(async (_requestedMissions, flowRunMissions) => {
    const { db } = await initOperatorState({ configuration });
    const repositoryId = resolveCanonicalRepositoryId(root);
    const historyRepo = new SqliteOperationalHistoryRepository(db);
    const [history, operationHistory, lifecycle, reboundRepairs] = await Promise.all([
      historyRepo.findAll(), new SqliteWorkflowOperationStore(db, repositoryId).readHistorical(),
      new SqliteBoardLaneEventRepository(db).findByRepositoryId(repositoryId), historyRepo.findReboundRepairs(),
    ]);
    const operations = operationHistory.operations;
    // One worktree listing serves every Mission; resolving each Mission through its own Git calls made this read scale with history.
    const topology = snapshotWorktreeTopology({ cwd: root });
    const flowMissions = flowRunMissions ?? new Set([...operations.map(value => value.missionId), ...lifecycle.map(value => value.missionId)]);
    return { repositoryId, history, operations, lifecycle, reboundRepairs,
      runs: retainedRepositoryRunRecords(root),
      flowRuns: retainedFlowRunRecords(createMissionTerminalCapability(root, configuration ?? DEFAULT_CONFIGURATION, mission => topology.resolveWorktree(mission)), flowMissions),
      repositoryDiagnostics: workflowOperationCollectionDefects(operationHistory.unreadableRowCount) };
  });
}

/** Compose with the consumer's authoritative repositories when already available. */
export function verificationStatisticsReader(
  readInput: (_missions?: ReadonlySet<string>, _flowRunMissions?: ReadonlySet<string>) => Promise<VerificationStatisticsInput>,
): VerificationStatisticsReadPort {
  return {
    async read(missions) { return verificationStatistics(await readInput(missions, missions), missions); },
    async readRepository(flowMissions) {
      return verificationStatistics(await readInput(undefined, flowMissions), undefined, flowMissions);
    },
  };
}
