import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { DEFAULT_CONFIGURATION } from '../application/ports/configuration.js';
import type { VerificationStatisticsReadPort } from '../application/ports/verification-statistics.js';
import { verificationStatistics, VERIFICATION_HISTORY_EVENT_TYPES, type VerificationStatisticsInput } from '../application/projections/verification-statistics.js';
import type { PolicyModelValues } from '../application/projections/verification-model-statistics.js';
import { loadEffectiveConfig } from '../adapters/config/product-config.js';
import { createPolicyArtifactLoader } from '../adapters/config/verification-policy.js';
import { initOperatorState } from '../adapters/sqlite/adapter-factory.js';
import { SqliteOperationalHistoryRepository } from '../adapters/sqlite/operational-history-repository.js';
import { SqliteWorkflowOperationStore, workflowOperationCollectionDefects } from '../adapters/sqlite/workflow-operation-store.js';
import { SqliteBoardLaneEventRepository } from '../adapters/sqlite/board-lane-event-repository.js';
import { retainedRepositoryRunRecords } from '../adapters/filesystem/run-history-store.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { snapshotWorktreeTopology } from '../adapters/git/worktree.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';
import type { MissionTerminalCapability } from '../application/ports/mission-terminal.js';
import type { ReboundRepairHistoryEntry } from '../application/ports/operation-history.js';
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

/** The configured policy artifact's saving inputs; unknown (null) when no artifact is configured or it cannot be read. */
function configuredPolicyValues(root: string): PolicyModelValues | null {
  try {
    const loaded = createPolicyArtifactLoader(root, loadEffectiveConfig(root).verificationPolicy)();
    return loaded.mode === 'shadow' ? loaded.artifact.predicted : null;
  } catch { return null; }
}

/** All consumers read the same repository-scoped facts and pure calculation. */
export function createVerificationStatisticsReader(root: string, configuration?: ParallixConfiguration,
  sharedRepairs?: () => Promise<readonly ReboundRepairHistoryEntry[]>): VerificationStatisticsReadPort {
  return verificationStatisticsReader(async (_requestedMissions, flowRunMissions) => {
    const { db } = await initOperatorState({ configuration });
    const repositoryId = resolveCanonicalRepositoryId(root);
    const historyRepo = new SqliteOperationalHistoryRepository(db);
    // The projection reads only these event families; a retained repair transcript is megabytes of audit text per
    // row and reaches the projection through `reboundRepairs`, so the payload read stays scoped to what it observes.
    const [history, operationHistory, lifecycle, reboundRepairs] = await Promise.all([
      historyRepo.findByTypes(VERIFICATION_HISTORY_EVENT_TYPES),
      new SqliteWorkflowOperationStore(db, repositoryId).readHistorical(),
      new SqliteBoardLaneEventRepository(db).findByRepositoryId(repositoryId),
      sharedRepairs ? sharedRepairs() : historyRepo.findReboundRepairs(),
    ]);
    const operations = operationHistory.operations;
    // One worktree listing serves every Mission; resolving each Mission through its own Git calls made this read scale with history.
    const topology = snapshotWorktreeTopology({ cwd: root });
    const flowMissions = flowRunMissions ?? new Set([...operations.map(value => value.missionId), ...lifecycle.map(value => value.missionId)]);
    return { repositoryId, history, operations, lifecycle, reboundRepairs,
      runs: retainedRepositoryRunRecords(root), policyValues: configuredPolicyValues(root),
      flowRuns: retainedFlowRunRecords(createMissionTerminalCapability(root, configuration ?? DEFAULT_CONFIGURATION, mission => topology.resolveWorktree(mission)), flowMissions),
      repositoryDiagnostics: workflowOperationCollectionDefects(operationHistory.unreadableRowCount) };
  });
}

/** Compose with the consumer's authoritative repositories when already available. */
export function verificationStatisticsReader(
  readInput: (_missions?: ReadonlySet<string>, _flowRunMissions?: ReadonlySet<string>) => Promise<VerificationStatisticsInput>,
): VerificationStatisticsReadPort {
  return {
    async read(missions, windows) { return verificationStatistics({ ...await readInput(missions, missions), modelWindows: windows }, missions); },
    async readRepository(flowMissions) { return verificationStatistics(await readInput(undefined, flowMissions), undefined, flowMissions); },
  };
}
