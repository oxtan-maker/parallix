import { REVIEW_USAGE, reviewExplicitSlug } from '../../domain/review-cli-options.js';
import type { ReviewStateInstanceReader } from './review-state.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { run } from '../git/git.js';
import { getPrStatus, isProviderEnabled } from './review-adapter.js';
import { resolveWorktree, inferSlug, missionBranchName } from '../filesystem/mission-utils.js';
import { missionId } from '../../domain/mission.js';
import { readReviewState } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { ReviewMutationWorkflowContext, ReviewReadOnlyWorkflowContext, ReviewWorkflowContext, ReviewWorkflowPort } from '../../application/ports/review-workflow.js';
import { ReviewRoundUseCase, reconcileInterruptedReviewPreparation } from '../../application/review-round-use-case.js';
import type { ReviewLoopPorts, ReviewRoundEntryPort, StartReviewRound } from '../../application/ports/review-round.js';
import { flagValue, readTextFlag, type ReadUtf8File } from './review-cli-flags.js';
import { createEvent } from './review-events.js';
import type { ReviewLoopBindings } from './review-loop.js';
import { continueReviewClearsIntervention, continueReviewInvalidatesBlocker, closeMissionPr, commentRound, pushRound, readComments, reconcileInterruptedReviewPreparationHandler, showReviewStatus, submitForReview, submitReviewRound, verifyReview } from './review-commands.js';
import { reviewOperation, reviewOperationRequiresMutationContext } from '../../domain/review-command-policy.js';
import { liveMissionExecutionContext, type MissionExecutionContextResolution } from '../../application/ports/mission-execution-context.js';
import { resolveMissionExecutionContext } from '../git/mission-execution-context.js';

/** Command dispatch awaits completion and forwards failures; receipts are owned by each command. */
type ReviewCommandObserver<Handler extends (...args: never[]) => unknown> = (...args: Parameters<Handler>) => unknown;

/** Per-invocation output and current-work observers the review loop reports to. */
export type ReviewLoopObservers = Pick<ReviewLoopBindings, 'log' | 'error' | 'exit' | 'onAgentLaunched' | 'onAutonomousStop'>;

/** The prerequisite reports failure through its exit observer or rejection. */
type ReviewInterventionClearer = (...args: Parameters<typeof continueReviewClearsIntervention>) => Promise<unknown>;

function resolveMutationContext(slug: string, options: {
  configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
  rootDir?: string;
  resolveExecutionContextFn?: (_slug: string, _root: string) => MissionExecutionContextResolution;
}): MissionExecutionContextResolution {
  const root = options.rootDir || process.cwd();
  if (options.resolveExecutionContextFn) { return options.resolveExecutionContextFn(slug, root); }
  if (options.configuration) { return resolveMissionExecutionContext(slug, root, options.configuration); }
  return { ok: false, reason: `Mission ${slug}: mutation configuration is unavailable; composition must resolve the execution context.` };
}

export class ReviewWorkflowAdapter implements ReviewWorkflowPort {
  constructor(private readonly _defaults: {
    configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
    rootDir?: string;
    resolveExecutionContextFn?: (_slug: string, _root: string) => MissionExecutionContextResolution;
    readFileSync?: ReadUtf8File;
    inferSlugFn?: typeof inferSlug; log?: (_msg: string) => void; error?: (_msg: string) => void; exit?: (_code: number) => void;
    verifyReviewFn?: ReviewCommandObserver<typeof verifyReview>; submitForReviewFn?: ReviewCommandObserver<typeof submitForReview>; pushRoundFn?: ReviewCommandObserver<typeof pushRound>; readCommentsFn?: ReviewCommandObserver<typeof readComments>; commentRoundFn?: ReviewCommandObserver<typeof commentRound>; submitReviewRoundFn?: ReviewCommandObserver<typeof submitReviewRound>; closeMissionPrFn?: ReviewCommandObserver<typeof closeMissionPr>; readReviewStateFn?: ReviewStateInstanceReader; resolveWorktreeFn?: typeof resolveWorktree; reconcileInterruptedReviewPreparationFn?: typeof reconcileInterruptedReviewPreparation;
    getPrStatusFn?: typeof getPrStatus; isReviewProviderEnabledFn?: typeof isProviderEnabled;
    operatorResume?: import('../../application/ports/review-round.js').ReviewOperatorResumePort;
    readReviewLiveness?: import('../../application/projections/review-liveness.js').ReviewLivenessReader;
    missionServicesFn?: NonNullable<Parameters<typeof submitForReview>[2]>['missionServicesFn'];
    writeReviewStateFn?: typeof import('./review-state.js').writeReviewState;
    resetReviewStateFn?: typeof import('./review-state.js').resetReviewState;
    readAllEventsFn?: typeof import('./review-events.js').readAllEvents;
    lifecycleService?: import('../../application/mission-lifecycle-service.js').MissionLifecycleService | null;
    requireReviewAggregate?: boolean; missionStore?: MissionStore | null; run?: typeof run; missionPath?: string; continueReviewClearsInterventionFn?: ReviewInterventionClearer; createEventFn?: typeof createEvent; payloadLandedFn?: (_slug: string) => boolean | Promise<boolean>;
    /** The composition root binds the review-loop mechanisms for each request. */
    reviewLoopMechanisms?: (_request: StartReviewRound, _observers: ReviewLoopObservers) => Promise<ReviewLoopPorts> | ReviewLoopPorts;
  } = {}) {}

  async preflight(args: string[], suppliedOptions: Record<string, unknown> = {}): Promise<ReviewWorkflowContext | null> {
    const options = { ...this._defaults, ...suppliedOptions,
      configuration: this._defaults.configuration, rootDir: this._defaults.rootDir,
      resolveExecutionContextFn: this._defaults.resolveExecutionContextFn,
      operatorResume: this._defaults.operatorResume } as typeof this._defaults; const slug = (options.inferSlugFn || inferSlug)(reviewExplicitSlug(args));
    if (!slug) { (options.error || fmt.log.plainError)(`Usage: ${REVIEW_USAGE}`); (options.exit || process.exit)(1); return null; }
    if (await options.payloadLandedFn?.(slug)) { (options.error || fmt.log.plainError)(fmt.status('FAIL', `Mission ${slug} payload already landed on the base branch. Close it out with: px integrate ${slug} --recover-landed`)); (options.exit || process.exit)(1); return null; }
    if (!reviewOperationRequiresMutationContext(reviewOperation(args))) { return { kind: 'read-only', slug, args, options }; }
    const resolution = resolveMutationContext(slug, options);
    const live = liveMissionExecutionContext(slug, resolution);
    if (!live.ok) {
      (options.error || fmt.log.plainError)(fmt.status('FAIL', live.reason));
      (options.exit || process.exit)(1);
      return null;
    }
    const mutationOptions = { ...options, executionContext: live.context, rootDir: live.context.missionWorktree };
    return { kind: 'mutation', slug, args, options: mutationOptions, executionContext: live.context };
  }
  async verify(context: ReviewReadOnlyWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.verifyReviewFn || verifyReview)(context.slug, context.args.includes('--no-gate'), { ...o }); }
  async submit(context: ReviewMutationWorkflowContext): Promise<void> {
    const o = context.options as typeof this._defaults;
    await (o.submitForReviewFn || submitForReview)(context.slug, context.args.includes('--no-gate'), { ...o, executionContext: context.executionContext });
  }
  async push(context: ReviewMutationWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.pushRoundFn || pushRound)(context.slug, { ...o, executionContext: context.executionContext, implementer: flagValue(context.args, '--implementer') ?? undefined, force: context.args.includes('--force') }); }
  async enter(context: ReviewMutationWorkflowContext): Promise<void> {
    // Helpers historically relied on process.exit. Fence this invocation even
    // when a host's exit observer returns; keep cancellation inside the adapter.
    const stopped = new Error('review continuation stopped');
    const o = context.options as typeof this._defaults;
    const helperExit = (code: number): never => {
      (o.exit || process.exit)(code);
      throw stopped;
    };
    try {
      await this.roundUseCase(context, helperExit).enter({ ...this.roundRequest(context), rawMaxAttempts: flagValue(context.args, '--max-attempts') });
    } catch (error) {
      if (error !== stopped) { throw error; }
    }
  }
  private roundRequest(context: ReviewMutationWorkflowContext): Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> {
    const poll = flagValue(context.args, '--poll-timeout-seconds');
    return { slug: context.slug, implementer: flagValue(context.args, '--implementer') ?? undefined, reviewer: flagValue(context.args, '--reviewer') ?? undefined, focus: flagValue(context.args, '--focus') ?? 'all', dryRun: context.args.includes('--dry-run'), reset: context.args.includes('--reset'), verbose: context.args.includes('--verbose'), pollTimeoutSeconds: poll ? Number.parseInt(poll, 10) : null, executionContext: context.executionContext };
  }
  private invalidMaxAttempts(raw: string): void { const o = this._defaults; (o.error || fmt.log.plainError)(fmt.status('FAIL', `--max-attempts requires a positive integer (got "${raw}").`)); (o.exit || process.exit)(1); }
  private roundUseCase(context: ReviewMutationWorkflowContext, helperExit?: (_code: number) => never): ReviewRoundUseCase {
    const o = context.options as typeof this._defaults;
    const helperOptions = { ...o, exit: helperExit ?? o.exit, runFn: o.run };
    const port: ReviewRoundEntryPort = {
      operatorResume: o.operatorResume,
      loadRound: async slug => await Promise.resolve((o.readReviewStateFn || readReviewState)(slug, context.executionContext.missionWorktree, o.missionStore)),
      loadMission: async slug => {
        if (!o.requireReviewAggregate) { return { kind: 'found' as const }; }
        if (!o.missionStore) { return { kind: 'unavailable' as const, reason: 'Operator database is unavailable' }; }
        try {
          const loaded = await o.missionStore.load(missionId(slug));
          return loaded.kind === 'found' ? { kind: 'found' as const } : loaded;
        } catch (error) {
          return { kind: 'unavailable' as const, reason: error instanceof Error ? error.message : 'Operator database is unavailable' };
        }
      },
      clearHumanIntervention: async slug => { await (o.continueReviewClearsInterventionFn ?? continueReviewClearsIntervention)(slug, context.args, helperOptions); },
      invalidateResolvedBlocker: async slug => { if (o.missionStore) { await continueReviewInvalidatesBlocker(slug, context.args, helperOptions); } },
      mechanisms: request => {
        if (!o.reviewLoopMechanisms) { throw new Error('review loop mechanisms are not bound by the composition root'); }
        const observers = context.options as ReviewLoopObservers;
        return o.reviewLoopMechanisms(request, { log: observers.log, error: observers.error, exit: observers.exit || process.exit, onAgentLaunched: observers.onAgentLaunched, onAutonomousStop: observers.onAutonomousStop });
      },
      invalidMaxAttempts: raw => this.invalidMaxAttempts(raw),
      missingReviewAggregate: slug => {
        (o.error || fmt.log.plainError)(fmt.status('FAIL', `Mission ${slug} is unknown or has no valid Review aggregate; load a known Mission before review.`));
        (o.exit || process.exit)(1);
      },
      missionUnavailable: (slug, reason) => {
        (o.error || fmt.log.plainError)(fmt.status('FAIL', `Mission authority is unavailable for ${slug}: ${reason}`));
        (o.exit || process.exit)(1);
      },
      reviewRecoveryRefused: (slug, reason) => {
        (o.error || fmt.log.plainError)(fmt.status('FAIL', `Review recovery refused for ${slug}: ${reason}`));
        (o.exit || process.exit)(1);
      },
    };
    return new ReviewRoundUseCase(port);
  }
  async comment(context: ReviewMutationWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; const message = readTextFlag(context.args, '--comment', '--comment-file', 'comment', o); if (!message) { (o.error || fmt.log.plainError)(fmt.status('FAIL', '--comment requires text via --comment "<text>" or --comment-file <path>.')); (o.exit || process.exit)(1); return; } await (o.commentRoundFn || commentRound)(context.slug, message, { ...o, executionContext: context.executionContext }); }
  async readComments(context: ReviewReadOnlyWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.readCommentsFn || readComments)(context.slug, o); }
  async submitReview(context: ReviewMutationWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; const outcome = flagValue(context.args, '--submit-review'); if (!outcome) { (o.error || fmt.log.plainError)(fmt.status('FAIL', '--submit-review requires an outcome: px review <slug> --submit-review <approve|request-changes|comment> [--message "<summary>"|--message-file <path>]')); (o.exit || process.exit)(1); return; } await (o.submitReviewRoundFn || submitReviewRound)(context.slug, outcome, readTextFlag(context.args, '--message', '--message-file', 'review message', o) || '', { ...o, executionContext: context.executionContext }); }
  async close(context: ReviewMutationWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.closeMissionPrFn || closeMissionPr)(context.slug, { ...o, executionContext: context.executionContext }); }
  async reconcileReview(context: ReviewMutationWorkflowContext): Promise<void> { await reconcileInterruptedReviewPreparationHandler(context.slug, context.args, context.options); }
  async status(context: ReviewReadOnlyWorkflowContext): Promise<void> {
    const o = context.options as typeof this._defaults;
    await showReviewStatus(context.slug, { ...o, readReviewStateFn: o.readReviewStateFn || readReviewState });
    const rootDir = (o.resolveWorktreeFn || resolveWorktree)(context.slug) || process.cwd();
    if ((o.isReviewProviderEnabledFn || isProviderEnabled)(rootDir)) {
      const pr = (o.getPrStatusFn || getPrStatus)(missionBranchName(context.slug, rootDir), rootDir);
      (o.log || fmt.log.plain)(pr.raw);
    }
  }
}

export function createReviewWorkflowAdapter(options: ConstructorParameters<typeof ReviewWorkflowAdapter>[0] = {}) { return new ReviewWorkflowAdapter(options); }
