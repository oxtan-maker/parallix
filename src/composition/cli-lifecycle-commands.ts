import { bindReviewOperatorResume } from './review-operator-resume.js';
import { commandInvocation } from './command-invocation.js';
import { createReviewClassification, createIntegrationApprovalRestoration } from './review-classification.js';

import type { ParallixConfiguration } from '../application/ports/configuration.js';

import * as fmt from '../application/presentation/cli-format.js';

import { recoverMissionCommand } from '../interfaces/cli/recover.js';

import { findTaskFile, getTaskStatus } from '../adapters/backlog/backlog.js';
import { cleanupMissionWorktree } from '../adapters/cli/commands/integrate-post.js';
import { findLandedSquashOnBaseBranch } from '../adapters/cli/commands/landed-squash.js';
import { landedMissionIntake } from '../adapters/cli/commands/recover-landed-intake.js';
import type { BoardProgressSink } from '../application/controller/board-command.js';

import { createDraftWorkflowAdapter } from '../adapters/cli/commands/draft.js';
import { createHandoffPorts } from '../adapters/cli/commands/handoff.js';
import integrate from '../adapters/cli/commands/integrate.js';
import { DraftCommandUseCase } from '../application/draft-command-use-case.js';
import { IntegrateCommandUseCase } from '../application/integrate-command-use-case.js';
import { ReviewCommandUseCase } from '../application/review-command-use-case.js';
import { HandoffCommandUseCase } from '../application/handoff-command-use-case.js';

import { createDraftCommand } from '../interfaces/cli/draft.js';
import type { HandoffMissionServicesPort } from '../application/ports/handoff-workflow.js';
import { createIntegrateCommand } from '../interfaces/cli/integrate.js';

import { createCancelCommand } from '../interfaces/cli/cancel.js';

import { missionId, type Mission } from '../domain/mission.js';
import { resolveWorktree } from '../adapters/git/worktree.js';

import { createReviewCommand } from '../interfaces/cli/review.js';

import { postComment } from '../adapters/review/review-adapter.js';
import { readToken } from '../adapters/forgejo/forgejo.js';
import { PARALLIX_FORGEJO_USER } from '../adapters/review/setup-review-repository.js';
import { integrationRepairPrComment, latestIntegrationRepair } from '../application/integration-repair-review.js';

import rebase from '../adapters/cli/commands/rebase.js';
import { createRebaseCommand } from '../interfaces/cli/rebase.js';

import { createReviewWorkflowAdapter } from '../adapters/review/review-commands.js';

import { type Command } from '../interfaces/cli/runtime.js';
import { createProductionApplicationServices } from './application-services.js';
import { statusMissionTitle } from './status-board.js';
import { bindReviewPersistence, reviewLoopBindings } from './review-persistence.js';
import { SqliteSessionMarkerAdapter } from '../adapters/sqlite/session-marker-adapter.js';
import { createReviewLoopPorts } from '../adapters/review/review-loop.js';
import type { ReviewLoopObservers } from '../adapters/review/review-workflow-adapter.js';
import type { StartReviewRound } from '../application/ports/review-round.js';
import { inferSlug } from '../adapters/filesystem/mission-paths.js';
import type { CliCommandContext } from './cli-service-scope.js';

export function createLifecycleCommands(context: CliCommandContext): Record<string, Command> {
  const { rootDir, configuration, scope } = context;
  const { withGraph, withMissionFactories, withMissionAndGraph } = scope;
  const withActiveService = createActiveService(context);
  const runIntegrated = createIntegrationRunner(context);
  return {
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
    draft: (args, options) => withMissionAndGraph((missionServicesFn, services) => {
      // Create adapter with missionServicesFn injected via withMissionFactories
      const adapter = createDraftWorkflowAdapter({ missionServicesFn, configuration });
      const useCase = new DraftCommandUseCase(adapter, services.currentWork);
      const cmd = createDraftCommand(useCase);
      return cmd(args, { ...options, missionServicesFn });
    }),
    integrate: (args, options) => withGraph(services =>
      createIntegrateCommand(new IntegrateCommandUseCase({
        execute: runIntegrated,
      }, services.currentWork, () => inferSlug(undefined)))(args, options)),
    cancel: (args) => withGraph(services => {
      const controller = services.presentationCapabilities?.commandController;
      if (!controller) { throw new Error('cancel requires BoardCommandController from presentation capabilities'); }
      return createCancelCommand(controller)(args);
    }),
    rebase: createRebaseCommand((args, options) => withMissionFactories(missionServicesFn => rebase(args, { ...options, missionServicesFn }))),
    review: (args, options) => withMissionAndGraph(async (missionServicesFn, services) => {
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      const mission = services.mission;
      const reviewerSessionPort = services.operatorState.db
        ? new SqliteSessionMarkerAdapter(services.operatorState.db, mission.repositoryId)
        : null;
      const persistence = bindReviewPersistence(
        mission.store,
        mission.lifecycle,
        reviewerSessionPort,
      );
      const adapter = createReviewWorkflowAdapter({
        operatorResume: bindReviewOperatorResume(services.mission.store, context.operatorReview ?? false, options ?? {}),
        configuration,
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
        missionStore: mission.store,
        lifecycleService: mission.lifecycle,
        // The composition root binds the review-loop mechanisms; the
        // application review loop decides how they are sequenced.
        reviewLoopMechanisms: (request: StartReviewRound, observers: ReviewLoopObservers) => createReviewLoopPorts(request.slug, request, {
          ...observers,
          configuration,
          classification: createReviewClassification(request.slug, resolveWorktree(request.slug) ?? rootDir, configuration.decision, configuration), restoration: createIntegrationApprovalRestoration(resolveWorktree(request.slug) ?? rootDir, configuration),
          performHandoffFn: performHandoffWithMissionServices(missionServicesFn, configuration),
          ...reviewLoopBindings(mission.store, mission.lifecycle, reviewerSessionPort),
        }),
      });
      const result = await createReviewCommand(new ReviewCommandUseCase(adapter, services.currentWork))(args, options);
      // TASK-2620: `px review --continue` never chains into `px integrate`.
      // On approval of a repaired revision the mission stays in the integration
      // lane for the human to read the fresh PR and integrate; no path
      // auto-restarts integration or merges.
      return result;
    })
  };
}

function createActiveService(context: CliCommandContext): Command {
  const { rootDir, scope, active } = context;
  const { openServices, withGraph } = scope;
  const withActiveService = async (args: string[], options: Record<string, unknown> = {}) => {
    const activeServices: { value: Awaited<ReturnType<typeof createProductionApplicationServices>> | null } = { value: null };
    try {
      return await active(args, {
        ...options,
        operatorInvocation: true,
        // SC4: refuse to activate a mission whose payload already landed.
        payloadLandedFn: (s: string) => findLandedSquashOnBaseBranch(rootDir, s) !== null,
        // The headline names the Mission exactly as `px status` does.
        missionTitleFn: (s: string) => withGraph(services => statusMissionTitle(services, s, rootDir)),
        controllerFactory: async (requestedRoot: string, progress: BoardProgressSink) => {
          activeServices.value = await openServices(requestedRoot, progress);
          const controller = activeServices.value.presentationCapabilities?.commandController;
          if (!controller) { throw new Error('active command requires BoardCommandController from presentation capabilities'); }
          return controller;
        },
      });
    } finally {
      await activeServices.value?.operatorState.close();
    }
  };
  return withActiveService;
}

function createIntegrationRunner(context: CliCommandContext) {
  const { rootDir, scope } = context;
  const { withMissionAndGraph } = scope;
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
  const reReviewRepairedRevision = async (slug: string, services: Awaited<ReturnType<typeof createProductionApplicationServices>>, nestedWork?: unknown) => {
    if (!services.mission) { throw new Error('mission services are unavailable'); }
    const before = await services.mission.store.load(missionId(slug));
    const roundBefore = before.kind === 'found' ? before.mission.review?.rounds.at(-1) : null;
    const status = await commandInvocation(exit => context.commands().review([slug, '--continue'], {
      integrationOwnsReview: true,
      // The re-review runs inside `px integrate`: it publishes under that
      // operation and hands the board back to it when it ends (TASK-2620).
      nestedWork,
      exit,
    }));
    if (status !== 0) { return false; }
    const after = await services.mission.store.load(missionId(slug));
    if (after.kind !== 'found' || after.mission.status !== 'integration' || !after.mission.review) { return false; }
    const rounds = after.mission.review.rounds;
    const current = rounds[rounds.length - 1];
    const approved = current.decision?.kind === 'approved' && !current.decision.revocation
      && (!roundBefore?.decision || current.number > roundBefore.number);
    if (approved) { announceIntegrationRepair(slug, after.mission); }
    return approved;
  };
  const announceIntegrationRepair = (slug: string, mission: Mission) => {
    const facts = latestIntegrationRepair(mission);
    const token = facts ? readToken(PARALLIX_FORGEJO_USER, rootDir) : null;
    if (!facts || !token) { return; }
    const posted = postComment(`mission/${slug}`, token, integrationRepairPrComment(facts), { rootDir, forgejoUser: PARALLIX_FORGEJO_USER });
    if (posted && !posted.ok) { fmt.log.warn(`Could not post the integration repair summary on ${slug}'s pull request: ${posted.error ?? 'unknown error'}`); }
  };
  return runIntegrated;
}
function performHandoffWithMissionServices(missionServicesFn: HandoffMissionServicesPort, configuration: ParallixConfiguration) {
  return (slug: string, options: Record<string, unknown>) => new HandoffCommandUseCase({
    ...createHandoffPorts(configuration), missionServices: missionServicesFn,
  }).performHandoff(slug, { ...options, missionServicesFn });
}