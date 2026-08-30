import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';
import type { BoardCommandDispatcher, BoardProgressSink } from '../application/controller/board-command.js';
import { BoardCommandController } from '../application/controller/board-controller.js';
import type { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionProjectionQuery } from '../application/projections/mission-query.js';
import type { RepositoryId } from '../domain/repository.js';
import { resolveKnownAgentFamilies } from '../interfaces/tui/agent-config-resolver.js';
import type {
  AgentBlocklistRepository,
} from '../application/ports/agent-blocklist.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { SessionMarkerRepository } from '../application/ports/mission-store.js';
import type { UsageRepository } from '../application/ports/mission-measurements.js';
import type { MissionNelRecorder, MissionStore, MissionTransitionStore } from '../application/domain-ports.js';
import { MissionCheckpointService } from '../application/mission-checkpoint-service.js';
import { MissionHandoffService } from '../application/mission-handoff-service.js';
import { MissionIntakeService } from '../application/mission-intake-service.js';
import { DraftCommandUseCase } from '../application/draft-command-use-case.js';
import type { DraftWorkflowPort } from '../application/ports/cli-workflows.js';
import type { BoardMissionServices } from '../application/controller/board-controller.js';
import type { CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import { createDraftWorkflowAdapter, ensureWorktree } from '../adapters/cli/commands/draft.js';
import { readAgentConfig } from '../adapters/agents/agent-config.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { composeTuiCapabilities } from './board-projection.js';

export interface ProductionBoardRepositories {
  readonly agentBlocklist: AgentBlocklistRepository;
  readonly operationalHistory: OperationalHistoryRepository;
  readonly boardLaneEvents: BoardLaneEventRepository;
  readonly usage: UsageRepository;
  /** Optional: attributes running missions to the family that launched them. */
  readonly sessionMarkers?: SessionMarkerRepository | null;
}

/** Shared presentation capabilities from one production composition graph. */
export interface ProductionCapabilities {
  readonly tui: TuiCapabilities;
  readonly boardProjection: BoardProjectionBuilder;
  readonly missionDetails: MissionProjectionQuery;
  readonly executePorts: ExecuteMissionPorts;
  /** Single dispatcher instance shared by CLI and TUI. */
  readonly commandController: BoardCommandDispatcher;
}

/**
 * Composition overrides. The draft workflow port is the only production
 * effect behind the draft capability, so it is the only overridable seam: a
 * test graph swaps in a mocked port and the real adapter never opens git or
 * launches an agent.
 */
export interface ProductionCompositionOverrides {
  readonly draftWorkflow?: DraftWorkflowPort;
  /** Test-only adapter seams; production always supplies the safe exit boundary. */
  readonly draftAdapterDeps?: Record<string, unknown>;
}

/**
 * The board's trusted draft service: the application-owned use case over the
 * adapter's workflow port, with a throwing exit function (the board path must
 * never `process.exit`), progress-sink logging instead of console output, and
 * the composition's own intake service and canonical repository id. The board
 * reaches the workflow through `executeForSlug` only — never argv, options,
 * paths, environment values, or agent-launch options.
 */
function createBoardDraftService(deps: {
  readonly intake: MissionIntakeService;
  readonly repositoryId: RepositoryId;
  readonly currentWork: CurrentWorkPort;
  readonly progress?: BoardProgressSink;
  readonly workflow?: DraftWorkflowPort;
  readonly workflowDeps?: Record<string, unknown>;
}): DraftCommandUseCase {
  let sequence = 0;
  const emit = (phase: 'draft-log' | 'draft-error', message: string): void => {
    deps.progress?.({
      operationId: 'board-draft',
      sequence: sequence++,
      phase,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  const exitFn = (code?: number): never => { throw new Error(`draft workflow aborted (exit ${code ?? 0})`); };
  const gitFn = deps.workflowDeps?.gitFn;
  const workflow: DraftWorkflowPort = deps.workflow ?? createDraftWorkflowAdapter({
    ...deps.workflowDeps,
    exitFn,
    logFn: (message: string): void => { emit('draft-log', message); },
    errorFn: (message: string): void => { emit('draft-error', message); },
    // These legacy helpers default to process.exit. Keep that CLI behavior,
    // but route the board adapter through its throwing boundary instead.
    ensureWorktreeFn: (mainRepo: string, targetWorktree: string, branchName: string, options: Record<string, unknown> = {}) =>
      ensureWorktree(mainRepo, targetWorktree, branchName, { ...options, ...(gitFn ? { gitFn: gitFn as never } : {}), exitFn }),
    readAgentConfigOrExitFn: () => readAgentConfig(),
    missionServicesFn: async (_root: string) => ({
      intake: deps.intake,
      repositoryId: deps.repositoryId,
    }),
  });
  return new DraftCommandUseCase(workflow, deps.currentWork);
}

/**
 * Compose board reads and active dispatch once, then hand the exact TUI
 * capability object to every presentation consumer in this CLI process.
 */
export function composeProductionCapabilities(
  rootDir: string,
  owningRepositoryId: RepositoryId,
  repositories: ProductionBoardRepositories,
  executePorts: ExecuteMissionPorts,
  missionStore: (MissionStore & MissionTransitionStore & MissionNelRecorder) | null,
  currentWork: CurrentWorkPort,
  progress?: BoardProgressSink,
  database?: SqliteDatabaseAdapter | null,
  overrides: ProductionCompositionOverrides = {},
): ProductionCapabilities {
  let missionServices: BoardMissionServices = {};
  if (missionStore) {
    const intake = new MissionIntakeService(missionStore);
    missionServices = {
      intake,
      checkpoints: new MissionCheckpointService(missionStore),
      handoff: new MissionHandoffService(missionStore, missionStore),
      // Only with Mission authority: a null store means no draft service, so
      // draft:create reports a typed unavailable result and the read-only
      // graph opens no database or git handle.
      draft: createBoardDraftService({
        intake,
        repositoryId: owningRepositoryId,
        currentWork,
        progress,
        workflow: overrides.draftWorkflow,
        workflowDeps: overrides.draftAdapterDeps,
      }),
    };
  }
  // Single dispatcher instance shared by CLI and TUI (TASK-2332.05)
  const controller = new BoardCommandController(executePorts, progress, missionServices, currentWork, missionStore);
  const tui = composeTuiCapabilities({
    rootDir,
    missionStore,
    database,
    repositoryId: owningRepositoryId,
    blocklistRepo: repositories.agentBlocklist,
    historyRepo: repositories.operationalHistory,
    laneEventRepo: repositories.boardLaneEvents,
    usageRepo: repositories.usage,
    knownAgentFamilies: resolveKnownAgentFamilies(rootDir),
    sessionMarkers: repositories.sessionMarkers ?? null,
  }, executePorts, currentWork, controller, missionServices);
  return {
    tui,
    boardProjection: tui.boardProjection,
    missionDetails: tui.missionDetails,
    executePorts,
    commandController: controller,
  };
}
