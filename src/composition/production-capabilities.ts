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
import { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import { DraftCommandUseCase } from '../application/draft-command-use-case.js';
import { IntegrateCommandUseCase } from '../application/integrate-command-use-case.js';
import type { DraftWorkflowPort } from '../application/ports/cli-workflows.js';
import type { BoardMissionServices } from '../application/controller/board-controller.js';
import type { CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import { createDraftWorkflowAdapter, ensureWorktree } from '../adapters/cli/commands/draft.js';
import { readAgentConfig } from '../adapters/agents/agent-config.js';
import { performHandoff } from '../adapters/cli/commands/handoff.js';
import { startReviewLoop } from '../adapters/review/review-loop.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { composeTuiCapabilities } from './board-projection.js';
import { reviewLoopBindings } from './review-persistence.js';
import { applyImplementerCommand, beginNextReviewRound, changeRevision, ConfiguredReviewerEligibility, currentReviewRound, reviewStatus } from '../domain/review.js';
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
  /**
   * Test-only seam for the review loop the board's handoff resume launches.
   * Production always uses the real loop; a test supplies a recorder so the
   * resume branch can be driven without spawning agents.
   */
  readonly handoffReviewLoop?: typeof startReviewLoop;
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

/** The browser hands off exactly as the CLI does: it supplies identity only. */
function createBoardHandoffWorkflow(
  store: MissionStore & MissionTransitionStore & MissionNelRecorder,
  reviewLoop: typeof startReviewLoop = startReviewLoop,
) {
  const lifecycle = new MissionLifecycleService(store);
  const missionServices = {
    store,
    lifecycle,
    checkpoints: new MissionCheckpointService(store),
    handoff: new MissionHandoffService(store, store),
  };
  const handoff = (slug: string, options: Record<string, unknown> = {}) =>
    performHandoff(slug, { recoverGateFailure: true, ...options, missionServicesFn: async () => missionServices });
  const reviewHandoff = async (slug: string, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    await handoff(slug, options) as unknown as Record<string, unknown>;
  return {
    async executeForSlug(slug: string): Promise<void> {
      const existing = await store.load(slug as never);
      if (existing.kind === 'found' && existing.mission.review?.rounds?.length) {
        // Handoff already established the review identity. A later board handoff
        // is a resume signal, not a second submission (which would replay the
        // lane-event key and violate the lifecycle idempotency contract).
        if (existing.mission.status === 'active') {
          const previous = existing.mission.review;
          const decision = currentReviewRound(previous).decision;
          const findings = decision !== null && decision.kind === 'changes-requested' ? decision.findings : [];
          const resolved = reviewStatus(previous) === 'awaiting-implementation'
            ? applyImplementerCommand(previous, { type: 'submit-resolution', respondedAt: new Date().toISOString(), resultingRevision: changeRevision(`handoff-${Date.now()}`), resolutions: findings.map((finding) => ({ findingId: finding.id, kind: 'fixed', evidence: 'Resolved in the handed-off revision.' })) })
            : previous;
          const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [currentReviewRound(resolved).reviewer], strategy: 'random' });
          const review = reviewStatus(resolved) === 'ready-for-next-round'
            ? beginNextReviewRound(resolved, currentReviewRound(resolved).reviewer, existing.mission.assignee ?? agentFamily('codex'), new Date().toISOString(), reviewerEligibility)
            : resolved;
          if (review === previous) { throw new Error('Review is not ready to resume.'); }
          await store.save({ ...existing.mission, review }, existing.version);
          const transition = await lifecycle.transition({
            operationId: `handoff-resume-${slug}`,
            missionId: slug as never,
            capabilities: new Set(['mission:transition']),
            command: { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility },
            actor: currentReviewRound(review).reviewer,
            occurredAt: new Date().toISOString(),
            idempotencyKey: `handoff-resume-${slug}-${review.rounds.length}`,
          });
          if (transition.status !== 'completed') { throw new Error(transition.error?.message ?? 'Review resume transition failed.'); }
        }
        await reviewLoop(slug, {
          isContinue: true,
          maxAttempts: existing.mission.review.rounds.length + 1,
          ...reviewLoopBindings(store, lifecycle),
          missionStore: store,
        });
        return;
      }
      const result = await handoff(slug);
      if (!result.ok) { throw new Error(result.error ?? 'handoff workflow aborted'); }
      await reviewLoop(slug, {
        performHandoffFn: reviewHandoff,
        ...reviewLoopBindings(store, lifecycle),
        missionStore: store,
      });
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
  progress?: BoardProgressSink,
  database?: SqliteDatabaseAdapter | null,
  overrides: ProductionCompositionOverrides = {},
  integrate?: Pick<IntegrateCommandUseCase, 'executeForSlug'>,
): ProductionCapabilities {
  let missionServices: BoardMissionServices = {};
  if (missionStore) {
    const intake = new MissionIntakeService(missionStore);
    missionServices = {
      intake,
      checkpoints: new MissionCheckpointService(missionStore),
      handoff: new MissionHandoffService(missionStore, missionStore),
      handoffWorkflow: createBoardHandoffWorkflow(missionStore, overrides.handoffReviewLoop),
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
      integrate,
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
