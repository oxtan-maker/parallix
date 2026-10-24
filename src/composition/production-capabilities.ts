import type { DraftAdapterDependencies } from '../adapters/cli/commands/draft-adapter-types.js';
import type { GitReader } from '../adapters/git/worktree.js';
import { randomUUID } from 'node:crypto';
import { authorizedOperationId } from '../application/ports/mission-write-authorization.js';
import { MissionEditService } from '../application/mission-edit-service.js';
import { createReviewClassification, createIntegrationApprovalRestoration } from './review-classification.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';
import type { BoardCommandDispatcher, BoardProgressSink } from '../application/controller/board-command.js';
import { BoardCommandController } from '../application/controller/board-controller.js';
import type { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionProjectionQuery } from '../application/projections/mission-query.js';
import type { RepositoryId } from '../domain/repository.js';
import { resolveKnownAgentFamilies } from '../adapters/agents/known-agent-families.js';
import type {
  AgentBlocklistRepository,
} from '../application/ports/agent-blocklist.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { SessionMarkerRepository } from '../application/ports/mission-store.js';
import type { UsageRepository } from '../application/ports/mission-measurements.js';
import type { MissionNelRecorder, MissionStore, MissionTransitionStore } from '../application/domain-ports.js';
import { MissionCheckpointService } from '../application/mission-checkpoint-service.js';
import { checkpointEvidenceReferences } from './application-services.js';
import { MissionHandoffService } from '../application/mission-handoff-service.js';
import { MissionIntakeService } from '../application/mission-intake-service.js';
import { MissionCreationService } from '../application/mission-creation-service.js';
import { allocateAdhocIdentity } from '../adapters/sqlite/adhoc-counter.js';
import { createRepositoryMissionCatalog } from './board-projection.js';
import { missionId } from '../domain/mission.js';
import { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import { DraftCommandUseCase } from '../application/draft-command-use-case.js';
import { MissionCancelService } from '../application/mission-cancel-service.js';
import { archiveTask } from '../adapters/backlog/task-transitions.js';
import { IntegrateCommandUseCase } from '../application/integrate-command-use-case.js';
import type { DraftWorkflowPort } from '../application/ports/cli-workflows.js';
import type { BoardMissionServices } from '../application/controller/board-controller.js';
import type { CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import { createDraftWorkflowAdapter, ensureWorktree } from '../adapters/cli/commands/draft.js';
import { readAgentConfig } from '../adapters/agents/agent-config.js';
import { missionBranchName } from '../adapters/filesystem/mission-paths.js';
import { conventionalWorktreePath, resolveWorktree } from '../adapters/git/worktree.js';
import { performHandoff } from '../adapters/cli/commands/handoff.js';
import { createReviewLoopPorts } from '../adapters/review/review-loop.js';
import { runReviewLoop } from '../application/review-loop/review-loop.js';
import { ReviewRoundUseCase } from '../application/review-round-use-case.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { composeTuiCapabilities } from './board-projection.js';
import { reviewLoopBindings } from './review-persistence.js';
import { agentFamily } from '../domain/agents.js';

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
  readonly boardProjection: Pick<BoardProjectionBuilder, 'build' | 'buildMissionCard'>;
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
type BoardDraftAdapterDependencies = DraftAdapterDependencies & { gitFn?: NonNullable<Parameters<typeof ensureWorktree>[3]>['gitFn'] };

export interface ProductionCompositionOverrides {
  readonly configuration: ParallixConfiguration;
  readonly draftWorkflow?: DraftWorkflowPort;
  /** Test-only adapter seams; production always supplies the safe exit boundary. */
  readonly draftAdapterDeps?: BoardDraftAdapterDependencies;
  /**
   * Test-only seam for the review loop the board's handoff resume launches.
   * Production always uses the real loop; a test supplies a recorder so the
   * resume branch can be driven without spawning agents.
   */
  readonly handoffReviewLoop?: typeof runReviewLoop;
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
  // A full transition-capable store so the draft service can advance the
  // aggregate to `ready` (record refinement) the way the CLI draft does.
  readonly store: MissionStore & MissionTransitionStore & MissionNelRecorder;
  readonly currentWork: CurrentWorkPort;
  readonly progress?: BoardProgressSink;
  readonly workflow?: DraftWorkflowPort;
  readonly workflowDeps?: BoardDraftAdapterDependencies;
  readonly configuration?: ParallixConfiguration;
}): DraftCommandUseCase {
  let sequence = 0;
  const fallbackOperationId = `board-draft:${randomUUID()}`;
  const emit = (phase: 'draft-log' | 'draft-error', message: string): void => {
    deps.progress?.({
      operationId: authorizedOperationId() ?? fallbackOperationId,
      sequence: sequence++,
      phase,
      message,
      timestamp: new Date().toISOString(),
    });
    if (!deps.progress) { console.log(message); }
  };
  const exitFn = (code?: number): never => { throw new Error(`draft workflow aborted (exit ${code ?? 0})`); };
  const gitFn = deps.workflowDeps?.gitFn;
  const workflow: DraftWorkflowPort = deps.workflow ?? createDraftWorkflowAdapter({
    ...deps.workflowDeps,
    // The board backend is a server: the directory it was started in carries no
    // mission intent. Anchor draft's launch context to the primary checkout so
    // a board served from a mission worktree resolves the same repository root,
    // base branch, and backlog task as one served from the main checkout.
    anchorLaunchDirToMainRepo: true,
    exitFn,
    logFn: (message: string): void => { emit('draft-log', message); },
    errorFn: (message: string): void => { emit('draft-error', message); },
    // These legacy helpers default to process.exit. Keep that CLI behavior,
    // but route the board adapter through its throwing boundary instead.
    ensureWorktreeFn: (mainRepo: string, targetWorktree: string, branchName: string, options: Record<string, unknown> = {}) =>
      ensureWorktree(mainRepo, targetWorktree, branchName, { ...options, ...(gitFn ? { gitFn } : {}), exitFn }),
    readAgentConfigOrExitFn: () => readAgentConfig(undefined, { configuration: deps.configuration }),
    // The board draft reaches the lifecycle the same way the CLI does: via the
    // mission services. Advancing the aggregate to `ready` (recording the
    // refinement) requires a transition-capable lifecycle, so build one from the
    // same store the CLI uses rather than leaving the board draft stuck at
    // `backlog`.
    missionServicesFn: async (_root: string) => ({
      intake: deps.intake,
      repositoryId: deps.repositoryId,
      // Expose the store so draft's preflight can probe for an already-recorded
      // DB-owned mission (a web-created px-XXXX with no Backlog file) and draft
      // under its existing identity instead of bailing "no Backlog task file".
      store: deps.store,
      lifecycle: new MissionLifecycleService(deps.store),
    }),
  });
  return new DraftCommandUseCase(workflow, deps.currentWork);
}

/**
 * The git cleanup a cancelled mission leaves behind, in the same construction
 * `px status` prints for a stale worktree. It is advisory text: cancellation
 * never runs git. An abandoned mission usually has no worktree left, so the
 * conventional path stands in when `git worktree list` no longer knows the slug.
 */
export function missionCleanupCommand(slug: string, rootDir: string, gitFn?: GitReader): string {
  const worktree = resolveWorktree(slug, { cwd: rootDir, gitFn: gitFn ?? null }) ?? conventionalWorktreePath(slug, rootDir);
  return `git worktree remove ${worktree} && git branch -D ${missionBranchName(slug, rootDir)}`;
}

/** The browser hands off exactly as the CLI does: it supplies identity only. */
function createBoardHandoffWorkflow(
  store: MissionStore & MissionTransitionStore & MissionNelRecorder,
  configuration: ParallixConfiguration,
  reviewLoop: typeof runReviewLoop = runReviewLoop,
) {
  const lifecycle = new MissionLifecycleService(store);
  const missionServices = {
    store,
    lifecycle,
    checkpoints: new MissionCheckpointService(store, checkpointEvidenceReferences()),
    handoff: new MissionHandoffService(store, store),
  };
  const reviewHandoff = async (slug: string, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    ({ ...await performHandoff(slug, { recoverGateFailure: true, ...options, configuration, missionServicesFn: async () => missionServices }) });
  return {
    /** First handoff and continuation both enter the round owner `px review` uses. */
    async executeForSlug(slug: string, agent?: ReturnType<typeof agentFamily>): Promise<void> {
      const worktree = resolveWorktree(slug) ?? process.cwd();
      // The browser host must never be exited by the loop; a stop is a failed dispatch.
      const exit = (code: number): never => { throw new Error(`review workflow stopped (exit ${code})`); };
      await new ReviewRoundUseCase({
        loadRound: async () => {
          const existing = await store.load(missionId(slug));
          const rounds = existing.kind === 'found' ? existing.mission.review?.rounds?.length ?? 0 : 0;
          return rounds > 0 ? { round: rounds } : null;
        },
        isKnownMission: async () => (await store.load(missionId(slug))).kind === 'found',
        clearHumanIntervention: async () => undefined,
        invalidateResolvedBlocker: async () => undefined,
        invalidMaxAttempts: () => undefined,
        missingReviewAggregate: () => { throw new Error(`Mission ${slug} is unknown or has no valid Review aggregate.`); },
        mechanisms: () => createReviewLoopPorts(slug, {}, { configuration, pinnedReviewer: agent, performHandoffFn: reviewHandoff, exit, ...reviewLoopBindings(store, lifecycle), classification: createReviewClassification(slug, worktree, configuration.decision, configuration), restoration: createIntegrationApprovalRestoration(worktree, configuration) }),
      }, reviewLoop).enter({ slug, reviewer: agent, focus: 'all', dryRun: false, reset: false, verbose: false, pollTimeoutSeconds: null, rawMaxAttempts: null });
    },
  };
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
  progress: BoardProgressSink | undefined,
  database: SqliteDatabaseAdapter | null | undefined,
  overrides: ProductionCompositionOverrides,
  integrate?: Pick<IntegrateCommandUseCase, 'executeForSlug'>,
): ProductionCapabilities {
  let missionServices: BoardMissionServices = {};
  if (missionStore) {
    const intake = new MissionIntakeService(missionStore);
    missionServices = {
      intake,
      editing: new MissionEditService(missionStore),
      creation: new MissionCreationService(
        intake,
        createRepositoryMissionCatalog({ rootDir, missionStore, repositoryId: owningRepositoryId }),
        { allocate: (repository) => missionId(allocateAdhocIdentity(repository, { dbPath: database?.getPath() }).slug) },
        owningRepositoryId,
        missionStore,
      ),
      checkpoints: new MissionCheckpointService(missionStore, checkpointEvidenceReferences()),
      handoff: new MissionHandoffService(missionStore, missionStore),
      handoffWorkflow: createBoardHandoffWorkflow(missionStore, overrides.configuration, overrides.handoffReviewLoop),
      // Only with Mission authority: a null store means no draft service, so
      // draft:create reports a typed unavailable result and the read-only
      // graph opens no database or git handle.
      draft: createBoardDraftService({
        configuration: overrides.configuration,
        intake,
        store: missionStore,
        repositoryId: owningRepositoryId,
        currentWork,
        progress,
        workflow: overrides.draftWorkflow,
        workflowDeps: { ...overrides.draftAdapterDeps, configuration: overrides.configuration },
      }),
      integrate,
      // Only with Mission authority, and only when the store can actually
      // perform the scoped delete.
      ...(missionStore.cancel
        ? {
          cancel: new MissionCancelService(
            missionStore as Required<Pick<MissionStore, 'cancel'>>,
            (slug) => missionCleanupCommand(slug, rootDir),
            (slug) => archiveTask(slug, rootDir),
          ),
        }
        : {}),
    };
  }
  // Single dispatcher instance shared by CLI and TUI (TASK-2332.05)
  const controller = new BoardCommandController(executePorts, progress, missionServices, currentWork, missionStore);
  const tui = composeTuiCapabilities({
    configuration: overrides.configuration,
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
