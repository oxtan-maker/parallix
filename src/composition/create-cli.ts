#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fmt from '../application/presentation/cli-format.js';
import { packageRoot } from '../adapters/filesystem/package-root.js';
import packageJson from '../../package.json' with { type: 'json' };
import { ensureStandaloneGitRepo, hasGitRepository } from '../adapters/config/product-config.js';
import { loadStateMap } from '../adapters/config/state-map.js';
import activeWorkflow from '../adapters/cli/commands/active.js';
import { createActiveCommand } from '../interfaces/cli/active.js';
import { recoverMissionCommand } from '../interfaces/cli/recover.js';
import { ensureFirstRunAgentConfig } from '../adapters/agents/first-run-config.js';
import { findTaskFile, getTaskStatus } from '../adapters/backlog/backlog.js';
import { cleanupMissionWorktree } from '../adapters/cli/commands/integrate-post.js';
import { findLandedSquashOnBaseBranch } from '../adapters/cli/commands/landed-squash.js';
import { landedMissionIntake } from '../adapters/cli/commands/recover-landed-intake.js';
import type { BoardProgressSink } from '../application/controller/board-command.js';
import configWorkflow from '../adapters/cli/commands/config.js';
import { createConfigCommand } from '../interfaces/cli/config.js';
import diffWorkflow from '../adapters/cli/commands/diff.js';
import { createDiffCommand } from '../interfaces/cli/diff.js';
import { createDraftWorkflowAdapter } from '../adapters/cli/commands/draft.js';
import { createHandoffPorts, validateDeclaredGates } from '../adapters/cli/commands/handoff.js';
import integrate from '../adapters/cli/commands/integrate.js';
import { DraftCommandUseCase } from '../application/draft-command-use-case.js';
import { IntegrateCommandUseCase } from '../application/integrate-command-use-case.js';
import { ReviewCommandUseCase } from '../application/review-command-use-case.js';
import { StatsCommandUseCase } from '../application/stats-command-use-case.js';
import { HandoffCommandUseCase } from '../application/handoff-command-use-case.js';
import { StatusCommandUseCase } from '../application/status-command-use-case.js';
import { createGithubPublishStatusUseCase } from './github-publish-status.js';
import { createDraftCommand } from '../interfaces/cli/draft.js';
import type { HandoffMissionServicesPort } from '../application/ports/handoff-workflow.js';
import { createIntegrateCommand } from '../interfaces/cli/integrate.js';
import { createLeadCommand, leadFinishesParkedApproval, leadInvocation } from '../interfaces/cli/lead.js';
import { recordApproval } from '../adapters/review/review-round.js';
import { currentWorkPublication, type CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import type { AttentionAction } from '../application/projections/board.js';
import { createCancelCommand } from '../interfaces/cli/cancel.js';
import { FRESH_SESSION_MARKER_PORT, observationFromAttention } from '../application/recovery-supervisor.js';
import type { AttentionObservation, SupervisorPort } from '../application/recovery-supervisor.js';
import { claimRecoveryLock } from '../adapters/filesystem/recovery-claim.js';
import { pollingPause } from '../adapters/process/polling-pause.js';
import { ConcreteCurrentWorkReadAdapter } from '../adapters/backlog/concrete-current-work-read-adapter.js';
import { CURRENT_WORK_TTL_MS, reconcileCurrentWork } from '../application/projections/current-work.js';
import { processLivenessProbe } from '../adapters/process/process-liveness.js';
import { missionId, type Mission } from '../domain/mission.js';
import { conventionalWorktreePath, resolveWorktree } from '../adapters/git/worktree.js';
import { git } from '../adapters/git/git.js';
import * as agents from '../adapters/agents/agents.js';
import { recordStageStatsSafe, stageLaunchSinceMs } from '../adapters/review/review-agent-fallback.js';
import { resolveAgentModel } from '../adapters/config/product-config.js';
import { createImportLegacyCommand } from '../interfaces/cli/import-legacy.js';
import { importLegacyMissions } from '../adapters/backlog/legacy-mission-import.js';
import { auditLegacyFiles } from '../adapters/backlog/legacy-mission-audit.js';
import { createReviewCommand } from '../interfaces/cli/review.js';

import { createStatusCommand } from '../interfaces/cli/status.js';
import { createResolveCommand, createVerdictCommand, type ReviewVerbPorts } from '../interfaces/cli/review-verbs.js';
import { createRevokeReviewCommand } from '../interfaces/cli/revoke-review.js';
import { RevokeReviewDecisionUseCase } from '../application/revoke-review-decision-use-case.js';
import { createGitChangeIdentity } from '../adapters/git/change-identity.js';
import { dismissProviderApproval, postComment } from '../adapters/review/review-adapter.js';
import { readToken } from '../adapters/forgejo/forgejo.js';
import { PARALLIX_FORGEJO_USER } from '../adapters/review/setup-review-repository.js';
import { integrationRepairPrComment, latestIntegrationRepair } from '../application/integration-repair-review.js';
import { readReviewState } from '../adapters/review/review-state.js';
import {
  createAssignCommand,
  createCheckpointCommand,
  createGateCommand,
  createCriterionCommand,
  createDependsCommand,
  createNelCommand,
  createGoalCommand,
  createReproCommand,
  createScopeCommand,
  createClassificationCommand,
  type MissionWriteServices,
} from '../interfaces/cli/mission-writes.js';
import { createGithubPublishStatusCommand } from '../interfaces/cli/github-publish-status.js';
import startupPreflight from '../adapters/cli/startup-preflight.js';
import rebase from '../adapters/cli/commands/rebase.js';
import { createRebaseCommand } from '../interfaces/cli/rebase.js';
import resolveConflictWorkflow from '../adapters/cli/commands/resolve-conflict.js';
import { createResolveConflictCommand } from '../interfaces/cli/resolve-conflict.js';
import { createReviewWorkflowAdapter } from '../adapters/review/review-commands.js';
import { setupWizard } from '../adapters/review/setup-review.js';
import { createSetupCommand } from '../interfaces/cli/setup.js';
import setupReview from '../adapters/cli/commands/setup-review.js';
import { createStatsCommand, createStatsWorkflowAdapter } from '../adapters/cli/commands/stats.js';
import {
  createStatusGitAdapter,
  createStatusPrAdapter,
  createStatusAgentAdapter,
  createStatusStaleWorktreesAdapter,
} from '../adapters/cli/commands/status-adapter.js';
import verifyWorkflow from '../adapters/verification/verification.js';
import { createVerifyCommand } from '../interfaces/cli/verify.js';
import { runWebCommand } from '../interfaces/cli/web.js';
import { loadWebAssets, resolveWebAssetRoot } from '../adapters/web/asset-store.js';
import { deriveAliases, type Command, type MainOptions } from '../interfaces/cli/runtime.js';
import { createProductionApplicationServices } from './application-services.js';
import { createStatusBoardFor, statusMissionTitle } from './status-board.js';
import { bindReviewPersistence, reviewLoopBindings } from './review-persistence.js';
import { SqliteSessionMarkerAdapter } from '../adapters/sqlite/session-marker-adapter.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { startReviewLoop } from '../adapters/review/review-loop.js';
import { inferSlug } from '../adapters/filesystem/mission-paths.js';

function resolveRuntimePath(): string {
  return fileURLToPath(import.meta.url);
}

function performHandoffWithMissionServices(missionServicesFn: HandoffMissionServicesPort) {
  return (slug: string, options: Record<string, unknown>) => new HandoffCommandUseCase({
    ...createHandoffPorts(), missionServices: missionServicesFn,
  }).performHandoff(slug, { ...options, missionServicesFn });
}

const runtimePath = resolveRuntimePath();
const runtimeDir = path.dirname(runtimePath);
const packageDir = packageRoot(runtimeDir);

process.setSourceMapsEnabled(true);

interface ParsedArgs {
  target: string;
  command: string;
  args: string[];
}

interface VersionInfo {
  name: string;
  version: string;
  pxPath: string;
  packageRoot: string;
  node: string;
}

interface ReviewEventParsed {
  slug: string;
  type: string | null;
  actor: string | null;
  content: string;
  disposition: string | null;
  timestamp: string | null;
  skipGit: boolean;
}

interface RunOptions {
  log?: typeof fmt.log.plain;
  error?: typeof fmt.log.plainError;
  baseCwd?: string;
}

function createCommandRegistry(rootDir: string): Record<string, Command> {
  const active = createActiveCommand((request, options) => activeWorkflow([...request.args], options));
  const config = createConfigCommand((request, options) => configWorkflow([...request.args], options));
  const diff = createDiffCommand((request, options) => diffWorkflow([...request.args], options));
  const resolveConflict = createResolveConflictCommand((request, options) => resolveConflictWorkflow([...request.args], options));
  const setup = createSetupCommand((request, options) => setupWizard([...request.args], options));
  const verify = createVerifyCommand((request, options) => verifyWorkflow([...request.args], options));
  const withGraph = async (
    invoke: (_services: Awaited<ReturnType<typeof createProductionApplicationServices>>) => unknown,
    options: Parameters<typeof createProductionApplicationServices>[2] = {},
  ) => {
    const services = await createProductionApplicationServices(rootDir, undefined, options);
    try { return await invoke(services); } finally { await services.operatorState.close(); }
  };
  const withMissionFactories = async (invoke: (_missionServicesFn: Function) => unknown) => {
    const opened: Awaited<ReturnType<typeof createProductionApplicationServices>>[] = [];
    const missionServicesFn = async (requestedRoot: string) => {
      const services = await createProductionApplicationServices(requestedRoot);
      opened.push(services);
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      return services.mission;
    };
    try { return await invoke(missionServicesFn); } finally {
      await Promise.all(opened.map(services => services.operatorState.close()));
    }
  };
  // Collapses the common `withMissionFactories(msf => withGraph(services => ...))`
  // two-arrow nesting into one level so command handlers stay under the
  // cognitive/nesting complexity limits without duplicating the wiring.
  const withMissionAndGraph = (
    run: (_missionServicesFn: Function, _services: Awaited<ReturnType<typeof createProductionApplicationServices>>) => unknown,
  ) => withMissionFactories(missionServicesFn => withGraph(services => run(missionServicesFn, services)));
  // Collapses the `execute` override's `withGraph`→`withMissionAndGraph` two-arrow
  // nesting into a single named helper so the integrate handler stays under the
  // nesting complexity limit.
  const runIntegrated = (innerArgs: string[], innerOptions: Record<string, unknown>) =>
    withMissionAndGraph((missionServicesFn, services) => integrate(innerArgs, {
      ...innerOptions,
      // In-process CLI and board workflows must return through their owners:
      // process.exit skips current-work cleanup and caller verification.
      exitFn: typeof innerOptions.exitFn === 'function' ? innerOptions.exitFn as (_code: number) => void : ((code: number) => {
        if (code !== 0) { throw new Error(`Integration exited with status ${code}`); }
      }),
      missionServicesFn,
      reReviewFn: (slug: string) => reReviewRepairedRevision(slug, services, innerOptions.nestedWork),
    }));
  // An integration-gate repair that changed the approved revision is reviewed
  // again through exactly what `px review <slug> --start` runs. Approved means
  // the review came back with a new approved round and moved the mission to
  // integration; the superseded round stays in the history.
  const reReviewRepairedRevision = async (slug: string, services: Awaited<ReturnType<typeof createProductionApplicationServices>>, nestedWork?: unknown) => {
    if (!services.mission) { throw new Error('mission services are unavailable'); }
    const before = await services.mission.store.load(missionId(slug));
    const roundBefore = before.kind === 'found' ? before.mission.review?.rounds.at(-1) : null;
    await registry.review([slug, '--continue'], {
      integrationOwnsReview: true,
      // The re-review runs inside `px integrate`: it publishes under that
      // operation and hands the board back to it when it ends (TASK-2620).
      nestedWork,
      exit: (code?: number) => { if (code) { throw new Error(`px review ${slug} --continue exited with status ${code}`); } },
    });
    const after = await services.mission.store.load(missionId(slug));
    if (after.kind !== 'found' || after.mission.status !== 'integration' || !after.mission.review) { return false; }
    const rounds = after.mission.review.rounds;
    const current = rounds[rounds.length - 1];
    const approved = current.decision?.kind === 'approved' && !current.decision.revocation
      && (!roundBefore?.decision || current.number > roundBefore.number);
    if (approved) { announceIntegrationRepair(slug, after.mission); }
    return approved;
  };
  // The human reads the pull request before integrating again, so it states
  // what failed last time, the repair range and the re-review outcome. Posted
  // as the dedicated parallix login; a disabled provider skips it.
  const announceIntegrationRepair = (slug: string, mission: Mission) => {
    const facts = latestIntegrationRepair(mission);
    const token = facts ? readToken(PARALLIX_FORGEJO_USER, rootDir) : null;
    if (!facts || !token) { return; }
    const posted = postComment(`mission/${slug}`, token, integrationRepairPrComment(facts), { rootDir, forgejoUser: PARALLIX_FORGEJO_USER });
    if (posted && !posted.ok) { fmt.log.warn(`Could not post the integration repair summary on ${slug}'s pull request: ${posted.error ?? 'unknown error'}`); }
  };
  // `active` needs to create its ExecuteMissionService only after it has
  // installed its progress renderer. Supplying a pre-built service loses the
  // lifecycle progress events (including the actual execute-agent family).
  // BoardCommandController is the canonical dispatcher (TASK-2332.05);
  // both CLI and TUI use the same controller dispatch path.
  const withActiveService = async (args: string[], options: Record<string, unknown> = {}) => {
    const activeServices: { value: Awaited<ReturnType<typeof createProductionApplicationServices>> | null } = { value: null };
    try {
      return await active(args, {
        ...options,
        // SC4: refuse to activate a mission whose payload already landed.
        payloadLandedFn: (s: string) => findLandedSquashOnBaseBranch(rootDir, s) !== null,
        // The headline names the Mission exactly as `px status` does.
        missionTitleFn: (s: string) => withGraph(services => statusMissionTitle(services, s, rootDir)),
        controllerFactory: async (requestedRoot: string, progress: BoardProgressSink) => {
          activeServices.value = await createProductionApplicationServices(requestedRoot, progress);
          const controller = activeServices.value.presentationCapabilities?.commandController;
          if (!controller) { throw new Error('active command requires BoardCommandController from presentation capabilities'); }
          return controller;
        },
      });
    } finally {
      await activeServices.value?.operatorState.close();
    }
  };
  // Human-only stand-down of the current approval, for an unfounded approval
  // (operator judgement) and for one the branch moved away from (TASK-2555).
  const revokeReview: Command = (args) => withGraph(services => {
    if (!services.mission) { throw new Error('mission services are unavailable'); }
    return createRevokeReviewCommand(
      new RevokeReviewDecisionUseCase(services.mission.store, services.mission.lifecycle, {
        async dismissApproval(mission, round, reason) {
          const decision = mission.review?.rounds.find((entry) => entry.number === round)?.decision;
          if (decision?.kind !== 'approved') { throw new Error('matching approval is not recorded'); }
          dismissProviderApproval(`mission/${mission.id}`, decision.decidedAt, reason, { rootDir });
        },
      }, createGitChangeIdentity(rootDir)),
      (explicit) => inferSlug(explicit),
    )(args);
  });
  const registry: Record<string, Command> = {
    active: withActiveService,
    recover: (args) => withGraph(services => {
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      return recoverMissionCommand(args, {
        taskStatus: (slug) => {
          const task = findTaskFile(slug, rootDir);
          return task ? getTaskStatus(task) : null;
        },
        // Authoritative payload containment: `px integrate` lands with
        // `git merge --squash`, so a landed mission branch tip is *not*
        // reachable from `main`. Detect the squash commit by subject in the
        // primary branch log instead of branch ancestry (TASK-2492). A branch
        // with no committed payload produces no squash commit, so it is never
        // misreported as landed and never deleted (F2). See landed-squash.findLandedSquashOnBaseBranch.
        alreadyMerged: async (slug) => findLandedSquashOnBaseBranch(rootDir, slug) !== null,
        // Absent-aggregate recovery only: local Git evidence that the payload
        // was squash-landed on the mission's recorded base branch (TASK-2516).
        landedIntake: async (slug) => landedMissionIntake(slug, rootDir),
        cleanup: (slug) => cleanupMissionWorktree(slug, { rootDir }),
        store: services.mission.store,
      });
    }),
    config,
    // Typed Mission write verbs: one command per domain part, no JSON blob.
    goal: (args) => withGraph(services => createGoalCommand(missionWrites(services))(args)),
    repro: (args) => withGraph(services => createReproCommand(missionWrites(services))(args)),
    classification: (args) => withGraph(services => createClassificationCommand(missionWrites(services))(args)),
    scope: (args) => withGraph(services => createScopeCommand(missionWrites(services))(args)),
    gate: (args) => withGraph(services => createGateCommand(missionWrites(services), (command) => {
      const result = validateDeclaredGates([command], rootDir, { checkFiles: false });
      return result.ok ? null : result.error;
    })(args)),
    criterion: (args) => withGraph(services => createCriterionCommand(missionWrites(services))(args)),
    depends: (args) => withGraph(services => createDependsCommand(missionWrites(services))(args)),
    nel: (args) => withGraph(services => createNelCommand(missionWrites(services))(args)),
    checkpoint: (args) => withGraph(services => createCheckpointCommand(missionWrites(services).checkpoints, (explicit) => inferSlug(explicit))(args)),
    assign: (args) => withGraph(services => createAssignCommand(missionWrites(services), false)(args)),
    verdict: (args) => withGraph(services => createVerdictCommand(reviewVerbPorts(services))(args)),
    resolve: (args) => withGraph(services => createResolveCommand(reviewVerbPorts(services))(args)),
    // Deliberately outside `px review`: the review loop and its agent prompts
    // cannot dispatch this human-only corrective command.
    'revoke-review': revokeReview,
    revoke: revokeReview,
    unassign: (args) => withGraph(services => createAssignCommand(missionWrites(services), true)(args)),
    diff,
    draft: (args, options) => withMissionAndGraph((missionServicesFn, services) => {
      // Create adapter with missionServicesFn injected via withMissionFactories
        const adapter = createDraftWorkflowAdapter({ missionServicesFn });
        const useCase = new DraftCommandUseCase(adapter, services.currentWork);
        const cmd = createDraftCommand(useCase);
        return cmd(args, { ...options, missionServicesFn });
    }),
    integrate: (args, options) => withGraph(services =>
      createIntegrateCommand(new IntegrateCommandUseCase({
        execute: runIntegrated,
      }, services.currentWork, () => inferSlug(undefined)))(args, options)),
    // The destructive command runs through the same guarded controller the TUI
    // and the web board dispatch: one database path, three surfaces.
    cancel: (args) => withGraph(services => {
      const controller = services.presentationCapabilities?.commandController;
      if (!controller) { throw new Error('cancel requires BoardCommandController from presentation capabilities'); }
      return createCancelCommand(controller)(args);
    }),
    // `px import-legacy` is the explicit, operator-triggered one-way migration
    // from the legacy Backlog Markdown tree into the existing Mission
    // aggregate. It is the only caller of the importer: no normal command
    // reaches it, and it is never a runtime fallback reader.
    'import-legacy': (args) => withGraph(services => {
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      const mission = services.mission;
      return createImportLegacyCommand(
        ({ dryRun, reconcileCheckpoints, existingOnly }) => importLegacyMissions(
          {
            repositoryId: mission.repositoryId,
            store: mission.store,
            intake: mission.intake,
            dependencies: mission.brief,
          },
          { rootDir, dryRun, reconcileCheckpoints, existingOnly },
        ),
      )(args);
    }),
    'audit-legacy': (args) => withGraph(async services => {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
        throw new Error('Usage: px audit-legacy [--json]');
      }
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      const report = await auditLegacyFiles(rootDir, services.mission.repositoryId, services.mission.store);
      console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : JSON.stringify({ verdict: report.verdict, counters: report.counters }, null, 2));
      if (report.verdict !== 'GO') { throw new Error('Legacy audit NO-GO'); }
    }),
    'verify-env': startupPreflight,
    rebase: createRebaseCommand((args, options) => withMissionFactories(missionServicesFn => rebase(args, { ...options, missionServicesFn }))),
    'resolve-conflict': resolveConflict,
    review: (args, options) => withMissionAndGraph(async (missionServicesFn, services) => {
        if (!services.mission) { throw new Error('mission services are unavailable'); }
        const reviewerSessionPort = services.operatorState.db
          ? new SqliteSessionMarkerAdapter(services.operatorState.db as SqliteDatabaseAdapter, services.mission.repositoryId)
          : null;
        const persistence = bindReviewPersistence(
          services.mission.store,
          services.mission.lifecycle,
          reviewerSessionPort,
        );
        const adapter = createReviewWorkflowAdapter({
          ...options,
          // SC4: refuse to review a mission whose payload already landed.
          payloadLandedFn: (s: string) => findLandedSquashOnBaseBranch(rootDir, s) !== null,
          missionServicesFn,
          requireReviewAggregate: true,
          readReviewStateFn: persistence.readReviewState,
          writeReviewStateFn: persistence.writeReviewState,
          resetReviewStateFn: persistence.resetReviewState,
          createEventFn: persistence.createEvent,
          readAllEventsFn: persistence.readAllEvents,
          backfillReviewFn: persistence.backfillReview,
          reconcileInterruptedHandoffFn: persistence.reconcileInterruptedHandoff,
          // `px review --submit-review request-changes` records a reviewer
          // decision, so it needs the same authority the loop paths use.
          missionStore: services.mission.store,
          lifecycleService: services.mission.lifecycle,
          startReviewLoopFn: (slug: string, loopOptions: Record<string, unknown>) => startReviewLoop(slug, {
            ...loopOptions,
            performHandoffFn: performHandoffWithMissionServices(missionServicesFn as HandoffMissionServicesPort),
            ...reviewLoopBindings(services.mission!.store, services.mission!.lifecycle, reviewerSessionPort),
          } as any),
        } as any);
        const result = await createReviewCommand(new ReviewCommandUseCase(adapter, services.currentWork))(args, options);
        // TASK-2620: `px review --continue` never chains into `px integrate`.
        // On approval of a repaired revision the mission stays in the integration
        // lane for the human to read the fresh PR and integrate; no path
        // auto-restarts integration or merges.
        return result;
    }),
    setup,
    'setup-review': setupReview,
    stats: (args, options) => withGraph(services => {
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      return createStatsCommand(new StatsCommandUseCase(createStatsWorkflowAdapter(services.mission.store)))(args, options);
    }),
    'github-publish-status': (args, options) => {
      const useCase = createGithubPublishStatusUseCase();
      return createGithubPublishStatusCommand(useCase)(args, options);
    },
    status: (args, options) => withGraph(services => {
      const board = createStatusBoardFor(services);
      const gitPort = createStatusGitAdapter();
      const prPort = createStatusPrAdapter({ rootDir });
      const agentPort = createStatusAgentAdapter({
        rootDir,
        blocklistRepo: services.operatorState.repositories?.agentBlocklist ?? null,
      });
      const staleWorktrees = createStatusStaleWorktreesAdapter();
      const useCase = new StatusCommandUseCase(board, gitPort, prPort, agentPort, staleWorktrees);
      const cmd = createStatusCommand(useCase);
      return cmd(args, options);
    }),
    verify,
    web: (args: string[]) => runWebCommand(args, {
      // Packaged browser assets are loaded per invocation so a missing or
      // stale build/web fails the `web` command, not unrelated commands.
      assets: loadWebAssets(resolveWebAssetRoot(packageDir)),
      // Live board data (TASK-2432): the production board service's progress
      // sink becomes the host's SSE sink, and its BoardProjectionBuilder
      // becomes the host's injected build port. The command stays read-only:
      // nothing here dispatches a mutation.
      createBoardSource: async (progress) => {
        const services = await createProductionApplicationServices(rootDir, progress);
        const capabilities = services.presentationCapabilities;
        const builder = capabilities?.boardProjection;
        if (!builder) {
          await services.operatorState.close();
          throw new Error('board projection is unavailable for px web');
        }
        return {
          buildProjection: () => builder.build(),
          // The same guarded BoardCommandController instance the TUI dispatches
          // through (built by composition from the production execute ports,
          // Mission services, current-work port, and Mission store). The web
          // endpoint adds a route, never a second dispatch path; the controller's
          // progress sink is this host's SSE sink.
          commandDispatcher: capabilities.commandController,
          close: () => services.operatorState.close(),
        };
      },
    }),
    ui: async (...args: any[]) => {
      const { runUiCommand } = await import('../interfaces/tui/ui-command.js');
      const services = await createProductionApplicationServices(rootDir);
      const capabilities = services.presentationCapabilities?.tui;
      if (!capabilities) { throw new Error('operator-state capabilities are unavailable'); }
      return runUiCommand(capabilities, ...args);
    },
  };
  // One fleet recovery supervisor run (ADR 0059). Registered after the literal
  // because it presses a board action by calling the very same registry entry a
  // human would run: it acquires no authority of its own, and there is no second
  // dispatch path to keep in step. `integrate` is not among the actions it can
  // press — landing stays the human decision.
  // Forwarded commands outlive the pass that started them. Lead settles them
  // before its graph closes: a borrowed `active` graph shares that SQLite
  // handle, and an in-process caller must not see `lead` return while its
  // forwarded review is still running.
  registry.lead = (args: string[]) => withGraph(async services => {
    const forwards = new Set<Promise<unknown>>();
    try { return await createLeadCommand(buildLeadPort(services, forwards))(args); } finally { await Promise.allSettled(forwards); }
  });
  return registry;

  function buildLeadPort(
    services: Awaited<ReturnType<typeof createProductionApplicationServices>>,
    forwards: Set<Promise<unknown>>,
  ): SupervisorPort {
    const builder = services.presentationCapabilities?.boardProjection;
    if (!builder) { throw new Error('board projection is unavailable for px lead'); }
    const currentWork = services.currentWork;
    const headSha = (mission: string): string | null => {
      const worktree = resolveWorktree(mission, {});
      if (!worktree) { return null; }
      try { return git(['-C', worktree, 'rev-parse', 'HEAD'], { stdio: 'pipe' }).stdout.trim() || null; }
      catch { return null; }
    };
    // The board's own "needs your attention" queue, rebuilt from the
    // authorities every time it is asked for: the supervisor acts on what is
    // true now, never on a snapshot it kept (ADR 0053).
    const queue = async (headFor?: string): Promise<AttentionObservation[]> => (await builder.build()).attentionQueue
      .map(item => {
        const mission = String(item.missionId);
        return observationFromAttention(item, !headFor || mission === headFor ? headSha(mission) : null);
      });
    // A pressed command runs inside this long-lived process. Its default exit
    // is `process.exit`, which would end the whole supervisor on the first
    // failure; turning it into a throw makes it a failed step instead.
    const exitAsError = (code: number): never => { throw new Error(`command exited with status ${code}`); };
    // `px active` and `px review --continue` own long agent loops. Start one
    // and return to the fleet loop immediately; the current-work fact prevents
    // the next poll from treating that mission as idle and starting it again.
    const startForward = async (mission: string, action: AttentionAction, work: () => Promise<unknown>) => {
      const publication = currentWorkPublication({
        slug: mission,
        operationId: `lead-${Date.now()}`,
        phase: action.kind === 'active:execute' ? 'execute' : 'review',
        summary: `lead running ${action.display}`,
      });
      if (publication) { await currentWork.running(publication); }
      fmt.log.info(`[lead] Started ${action.display}; continuing to supervise the fleet.`);
      const forward: Promise<unknown> = Promise.resolve().then(work)
        .catch((error) => fmt.log.fail(`[lead] ${action.display} stopped: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => { finishPublication(publication, currentWork); forwards.delete(forward); });
      forwards.add(forward);
    };
    // Finishing a publication is fire-and-forget: the board update may reject
    // after the process is gone, and that is not a step the fleet can act on.
    const finishPublication = (
      publication: ReturnType<typeof currentWorkPublication>,
      currentWork: CurrentWorkPort,
    ): void => { if (publication) { void currentWork.ended(publication).catch(() => {}); } }
    const port: SupervisorPort = {
      attention: queue,
      // The operator database holds every sibling worktree's missions; this
      // checkout's task files only hold what its branch has seen. Lead is
      // started from any worktree, so the store answers first.
      missionExists: async (mission) => (await services.mission?.store.load(missionId(mission)))?.kind === 'found'
        || findTaskFile(mission, rootDir) !== null,
      // Liveness comes straight from the current-work authority for the one
      // mission being acted on. Rebuilding the whole board to answer it made a
      // pass cost one projection per question (ADR 0053: the board is a read
      // model, not the only way to read a fact).
      liveness: async (mission) => {
        const history = services.operatorState.repositories?.operationalHistory;
        // Fail closed. An unreadable current-work authority is not evidence
        // that nobody is working; refusing the step is the only safe answer,
        // and the supervisor records it like any other failed step.
        if (!history) { throw new Error(`Current work for ${mission} is unreadable: the operator database is unavailable`); }
        const events = await new ConcreteCurrentWorkReadAdapter(history)
          .loadMissionCurrentWork(missionId(mission));
        const facts = reconcileCurrentWork(events, {
          nowMs: Date.now(),
          ttlMs: CURRENT_WORK_TTL_MS,
          isProcessAlive: processLivenessProbe,
        }).get(missionId(mission));
        const work = facts?.currentWork ?? null;
        return {
          working: work !== null && work.freshness !== 'stale',
          detail: work ? `${work.phase} — ${work.summary} (${work.freshness}, ${work.updatedAt})` : null,
        };
      },
      runAction: async (mission, action, observation) => {
        if (observation) {
          const detail = observation.reason.kind === 'none' ? 'none' : observation.reason.detail;
          fmt.log.info(`[lead] Found stuck mission ${fmt.slug(mission)} in state ${observation.lane}; fixing by ${action.display} (${observation.reason.kind}: ${detail})`);
        }
        // An approved round still parked in review lost its review → integration
        // transition. Finishing it moves the lane only; merging stays human.
        // Lead never decides a review: an undecided round goes to
        // `review --continue`, whose configured reviewer decides (TASK-2620).
        if (action.kind === 'review:submit' && services.mission
          && leadFinishesParkedApproval(await services.mission.store.load(missionId(mission)))) {
          const finished = await recordApproval(mission, { comment: null, decidedAt: new Date().toISOString() }, {
            missionStore: services.mission.store,
            lifecycleService: services.mission.lifecycle,
          });
          if (finished.outcome === 'recorded') { return; }
        }
        const invocation = leadInvocation(action.kind, mission);
        if (!invocation) { throw new Error(`px lead does not run ${action.kind}`); }
        // `active` is the lead's recovery action. Reuse the controller already
        // rooted in the target worktree. Do not close this borrowed graph: it
        // shares the lead process's cached SQLite handle, which the outer graph
        // owns until shutdown.
        if (invocation.command === 'active') {
          const missionWorktree = resolveWorktree(mission, {});
          if (!missionWorktree) { throw new Error(`No worktree resolved for ${mission}`); }
          const targetServices = await createProductionApplicationServices(missionWorktree);
          const controller = targetServices.presentationCapabilities?.commandController;
          if (!controller) { throw new Error(`No active controller available for ${mission}`); }
          await startForward(mission, action, () => active(invocation.args, {
            controller,
            missionTitleFn: (s: string) => statusMissionTitle(targetServices, s, missionWorktree),
            rootDir: missionWorktree,
            exitFn: exitAsError,
            exit: exitAsError,
          }));
          return;
        }
        const commandRun = registry[invocation.command];
        if (!commandRun) { throw new Error(`No runnable px command for ${action.kind}`); }
        const missionWorktree = resolveWorktree(mission, {});
        if (!missionWorktree) { throw new Error(`No worktree resolved for ${mission}`); }
        // Run a forwarded command through the public CLI entry point so its
        // target is explicit. Calling the cached registry directly inherits
        // the process directory of `px lead`; that is wrong when lead is
        // supervising a sibling worktree and forces callers to mutate cwd.
        await startForward(mission, action, () => run(
          [invocation.command, ...invocation.args],
          { baseCwd: missionWorktree, log: fmt.log.plain, error: fmt.log.plainError },
        ));
      },
      claimRecovery: async (mission) => claimRecoveryLock(mission),
      wait: pollingPause,
      // A fresh agent context in the existing mission worktree. It is not the
      // failed session resumed, and it is not an ADR 0048 repair bounce: the
      // supervisor supplies context, and the agent diagnoses. Recovery is
      // published as current work so the mission shows as being recovered.
      launchRecovery: async (request) => {
        fmt.log.info(`[lead] Starting fresh recovery agent for ${fmt.slug(request.missionId)} with a general diagnostic prompt`);
        let publication: ReturnType<typeof currentWorkPublication> = null;
        try {
          const missionWorktree = resolveWorktree(request.missionId, {});
          const expectedWorktree = conventionalWorktreePath(request.missionId);
          const worktree = missionWorktree ?? expectedWorktree;
          if (!fs.existsSync(worktree)) { throw new Error(`No workspace exists for ${request.missionId}`); }
          const prompt = missionWorktree ? request.instruction : `${request.instruction}\n\n`
            + `The expected mission workspace ${expectedWorktree} does not currently resolve to the mission branch. `
            + 'Diagnose and repair its git worktree state while preserving unrelated changes.';
          if (!missionWorktree) {
            fmt.log.warn(`[lead] Expected workspace ${fmt.path(worktree)} is not attached to mission/${request.missionId}; the recovery agent will diagnose it inside the existing sandbox`);
          }
          fmt.log.info(`[lead] Recovery prompt for ${fmt.slug(request.missionId)}:\n---\n${prompt}\n---`);
          const assigned = await services.mission?.store.load(missionId(request.missionId));
          const assignedAgent = assigned?.kind === 'found' ? assigned.mission.assignee ?? undefined : undefined;
          publication = currentWorkPublication({
            slug: request.missionId,
            operationId: `recovery-${Date.now()}`,
            phase: 'recovery',
            summary: `recovery agent working ${request.missionId} after ${request.attemptedOperation}`,
          });
          if (publication) { await currentWork.running(publication); }
          const launched = await agents.startAgent('execute', {
            prompt,
            worktree,
            agent: assignedAgent,
            slug: request.missionId,
            role: 'implementer',
            // Without this the launcher would resume the implementer session
            // that got stuck. Recovery is a new context by definition.
            sessionMarkerPort: FRESH_SESSION_MARKER_PORT,
          }) as { agent?: string; result?: Record<string, any> } | null;
          const agent = launched?.agent;
          // A recovery agent spends tokens like any other launch. Recording it
          // on the mission's execute stage is what keeps the mission's usage
          // from under-reporting the work the supervisor caused.
          if (agent) {
            await recordStageStatsSafe('active', {
              stage: 'recovery',
              slug: request.missionId,
              rootDir: worktree,
              worktree,
              implementer: agent,
              result: launched?.result,
              sinceMs: stageLaunchSinceMs(launched?.result),
              model: resolveAgentModel(agent, worktree),
            });
          }
          fmt.log.info(`[lead] Recovery agent ${agent ?? 'with no reported family'} finished for ${fmt.slug(request.missionId)}; rechecking the board`);
          return `${agent ?? 'agent with no reported family'} ran in ${worktree}`;
        } catch (error) {
          fmt.log.fail(`[lead] Recovery agent for ${fmt.slug(request.missionId)} failed: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        } finally {
          if (publication) { await currentWork.ended(publication); }
        }
      },
    };
    return port;
  }
}

/**
 * Bind the review verbs to the existing recorders. Composition owns the adapter
 * imports so the interface module stays free of them.
 */
function reviewVerbPorts(services: { mission?: { store: unknown; lifecycle: unknown } | null }): ReviewVerbPorts {
  const missionStore = (services.mission?.store ?? null) as never;
  const lifecycleService = (services.mission?.lifecycle ?? null) as never;
  const persistence = bindReviewPersistence(missionStore, lifecycleService);
  return {
    resolveSlug: (explicit) => inferSlug(explicit),
    resolveWorktree: (slug) => resolveWorktree(slug),
    readReviewState: async (slug, worktree) => {
      const state = await Promise.resolve(readReviewState(slug, worktree, missionStore));
      return state ? { round: state.round, phase: state.phase } : null;
    },
    consumeReviewerOutput: (slug, reviewer, output, worktree, expectedVersion) =>
      persistence.consumeReviewerArtifacts(slug, reviewer, { worktree, output, expectedVersion } as never),
    consumeImplementerOutput: (slug, implementer, output, worktree, expectedVersion) =>
      persistence.consumeImplementerArtifacts(slug, implementer, { worktree, output, expectedVersion } as never),
  };
}

/** Mission write services, or a clear error when the operator DB is unavailable. */
function missionWrites(services: { mission?: Omit<MissionWriteServices, 'resolveSlug'> | null }): MissionWriteServices {
  if (!services.mission) { throw new Error('mission services are unavailable'); }
  // Composition owns the adapter dependency; the interface module stays clean.
  return { ...services.mission, resolveSlug: (explicit) => inferSlug(explicit) };
}

function createRuntimeOptions(rootDir: string): Pick<MainOptions, 'commandFns' | 'ensureStandaloneGitRepoFn' | 'loadAliasesFn' | 'product'> {
  return {
    commandFns: createCommandRegistry(rootDir),
    ensureStandaloneGitRepoFn: ensureStandaloneGitRepo,
    loadAliasesFn: options => deriveAliases(loadStateMap(options as any)),
    product: { name: packageJson.name, version: packageJson.version },
  };
}

export function parseArgs(argv: string[], baseCwd = process.cwd()): ParsedArgs {
  const args = [...argv];
  if (args[0] === '--version' || args[0] === '-v') {
    return { target: path.resolve(baseCwd), command: 'version', args: [] };
  }

  const command = args.shift();
  // No command provided: return empty string so the caller can print usage.
  // This satisfies architecture invariant's "non-TTY bare px prints help" requirement.
  if (!command) {
    return { target: path.resolve(baseCwd), command: '', args: [] };
  }

  return { target: path.resolve(baseCwd), command, args };
}

// Emits a shell function named `px` that wraps the globally installed `px`
// runner and switches the caller's terminal into the next mission worktree
// when the runtime prints a transition signal. A shell function always runs in
// the current shell, so it can `cd` the caller (an npm `bin` subprocess cannot).
// Install with:  eval "$(px shell-init bash)"   (or zsh) in your shell rc.
export function shellInit(shell = 'bash'): string {
  const normalized = String(shell || 'bash').toLowerCase();
  if (normalized !== 'bash' && normalized !== 'zsh') {
    throw new Error(`Unsupported shell for shell-init: ${shell} (supported: bash, zsh)`);
  }
  // zsh exposes pipe statuses via the lowercase 1-indexed `pipestatus` array;
  // bash uses the uppercase 0-indexed `PIPESTATUS`.
  const exitCapture = normalized === 'zsh'
    ? '_px_exit=${pipestatus[1]}'
    : '_px_exit=${PIPESTATUS[0]}';

  return [
    '# px shell integration. Add to your shell rc:',
    `#   eval "$(px shell-init ${normalized})"`,
    '# Defines a `px` shell function that runs the globally installed `px` and',
    '# changes your terminal into the next mission worktree on transitions.',
    'px() {',
    '  local _px_log _px_exit _px_signal _px_target _px_current',
    '  _px_log="$(mktemp)" || return 1',
    '  command px "$@" 2>&1 | tee "$_px_log"',
    `  ${exitCapture}`,
    '  _px_signal="$(grep "\\\\[INFO\\\\] Next: cd " "$_px_log" | tail -n 1 | sed "s/.*\\\\[INFO\\\\] Next: cd //")"',
    '  if [ -z "$_px_signal" ]; then',
    '    _px_signal="$(grep "\\\\[INFO\\\\] Working directory: " "$_px_log" | tail -n 1 | sed "s/.*\\\\[INFO\\\\] Working directory: //")"',
    '  fi',
    '  rm -f "$_px_log"',
    '  if [ -n "$_px_signal" ]; then',
    '    _px_target="${_px_signal#"${_px_signal%%[![:space:]]*}"}"',
    '    _px_target="${_px_target%"${_px_target##*[![:space:]]}"}"',
    '    if [ -d "$_px_target" ]; then',
    '      _px_current="$(pwd -P 2>/dev/null)"',
    '      if [ "$_px_current" != "$(cd "$_px_target" && pwd -P)" ]; then',
    '        cd "$_px_target" && echo "[px] Switched terminal context to: $(pwd)"',
    '      fi',
    '    fi',
    '  fi',
    '  return $_px_exit',
    '}',
    '',
  ].join('\n');
}

export function versionInfo(): VersionInfo {
  return {
    name: packageJson.name,
    version: packageJson.version,
    pxPath: runtimePath,
    packageRoot: packageDir,
    node: process.version,
  };
}

export function formatVersionInfo(info: VersionInfo = versionInfo()): string {
  return [
    `${info.name} ${info.version}`,
    `px: ${info.pxPath}`,
    `package: ${info.packageRoot}`,
    `node: ${info.node}`,
  ].join('\n');
}

export function parseReviewEventArgs(args: string[]): ReviewEventParsed {
  const slug = args[0];
  if (!slug) {
    throw new Error('Usage: review-event <slug> --type <event-type> --actor <actor> --content <text> [--disposition <disposition>] [--timestamp <stamp>] [--skip-git]');
  }

  const parsed: ReviewEventParsed = {
    slug,
    type: null,
    actor: null,
    content: '',
    disposition: null,
    timestamp: null,
    skipGit: false,
  };

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--skip-git') {
      parsed.skipGit = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected review-event argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = args[i + 1];
    if (!value) {
      throw new Error(`${arg} requires a value`);
    }
    i += 1;

    if (key === 'type') {parsed.type = value;}
    else if (key === 'actor') {parsed.actor = value;}
    else if (key === 'content') {parsed.content = value;}
    else if (key === 'disposition') {parsed.disposition = value;}
    else if (key === 'timestamp') {parsed.timestamp = value;}
    else {throw new Error(`Unknown review-event option: ${arg}`);}
  }

  if (!parsed.type) {
    throw new Error('review-event requires --type');
  }

  return parsed;
}

async function runBareCommand(parsed: ParsedArgs, log: typeof fmt.log.plain, error: typeof fmt.log.plainError): Promise<number> {
  const { main } = await import('../interfaces/cli/runtime.js');
  let exitCode = 0;
  await main([], {
    ...createRuntimeOptions(parsed.target),
    cwdFn: () => parsed.target,
    exitFn: ((code?: number) => { exitCode = typeof code === 'number' ? code : 0; }) as (_code?: number) => never,
    logFn: log,
    errorFn: error,
  });
  return exitCode;
}

async function runReviewEventCommand(parsed: ParsedArgs, log: typeof fmt.log.plain, error: typeof fmt.log.plainError): Promise<number> {
  const eventArgs = parseReviewEventArgs(parsed.args);
  const services = await createProductionApplicationServices(parsed.target);
  try {
    if (!services.mission) { throw new Error('mission services are unavailable'); }
    const result = await bindReviewPersistence(services.mission.store, services.mission.lifecycle).createEvent(
      eventArgs.slug,
      eventArgs.type || '',
      { actor: eventArgs.actor || '', content: eventArgs.content, disposition: eventArgs.disposition || undefined, timestamp: eventArgs.timestamp || undefined },
      { worktree: parsed.target, skipGit: eventArgs.skipGit, log, error },
    );
    if (result.ok && result.path) { log(fmt.status('PASS', `Review event path: ${path.relative(parsed.target, result.path)}`)); }
    return result.ok ? 0 : 1;
  } finally {
    await services.operatorState.close();
  }
}

function ensureWorkflowAgentConfig(command: string, target: string) {
  if (!['draft', 'active', 'review'].includes(command) || !hasGitRepository(target)) { return; }
  try { ensureFirstRunAgentConfig({ rootDir: target, worktree: target }); } catch { /* Best-effort first-run detection. */ }
}

async function runTargetCommand(parsed: ParsedArgs, log: typeof fmt.log.plain, error: typeof fmt.log.plainError): Promise<number> {
  const previousCwd = process.cwd();
  try {
    const [startupPreflightModule, workflow] = await Promise.all([
      import('../adapters/cli/startup-preflight.js'),
      import('../interfaces/cli/runtime.js'),
    ]);
    process.chdir(parsed.target);
    if (parsed.command === 'review-event') { return await runReviewEventCommand(parsed, log, error); }
    if (parsed.command === 'verify-env') {
      return startupPreflightModule.default([], { command: 'verify-env', returnResult: true, log, error })?.pass ? 0 : 1;
    }
    ensureWorkflowAgentConfig(parsed.command || '', parsed.target);
    let exitCode = 0;
    await workflow.main([parsed.command, ...parsed.args], {
      ...createRuntimeOptions(parsed.target),
      cwdFn: () => parsed.target,
      exitFn: ((code?: number) => { exitCode = typeof code === 'number' ? code : 0; }) as (_code?: number) => never,
      logFn: log,
      errorFn: error,
    });
    return exitCode;
  } catch (err) {
    error(fmt.status('FAIL', (err as Error).message));
    return 1;
  } finally {
    // Integration can remove the worktree from which this CLI was invoked.
    // Its landing workflow already selects the surviving base checkout.
    if (fs.existsSync(previousCwd)) { process.chdir(previousCwd); }
  }
}

export async function run(argv = process.argv.slice(2), options: RunOptions = {}): Promise<number> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const baseCwd = options.baseCwd || process.cwd();

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, baseCwd);
  } catch (err) {
    error(fmt.status('FAIL', (err as Error).message));
    return 1;
  }

  // shell-init prints a shell snippet and never touches a target repository, so
  // it runs before the target-path check.
  if (parsed.command === 'shell-init') {
    try {
      log(shellInit(parsed.args[0]));
      return 0;
    } catch (err) {
      error(fmt.status('FAIL', (err as Error).message));
      return 1;
    }
  }

  // Delegate bare invocation to the dispatcher. It keeps historical usage
  // output for non-TTY/CI/opt-out paths and selects the same lazy `ui` entry
  // point as explicit `px ui` for an interactive terminal.
  if (!parsed.command) {
    return await runBareCommand(parsed, log, error);
  }

  if (!fs.existsSync(parsed.target) || !fs.statSync(parsed.target).isDirectory()) {
    error(fmt.status('FAIL', `Target repository path not found: ${parsed.target}`));
    return 1;
  }

  if (parsed.command === 'version') {
    log(formatVersionInfo());
    return 0;
  }

  return await runTargetCommand(parsed, log, error);
}

const _arg1 = typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : undefined;
// The ESM source entry imports this compatibility module.  Only the legacy
// root source file is directly executable; the canonical entry owns startup.
const _esmMain = _arg1 && _arg1.endsWith('/px.ts') && !_arg1.endsWith('/src/entry/px.ts');
if (_esmMain) {
  run().then(code => {
    if (code !== 0) { process.exit(code); }
    process.exitCode ||= code;
  }, error => {
    console.error(error);
    process.exit(1);
  });
}
