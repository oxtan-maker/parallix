import { REVIEW_USAGE, reviewExplicitSlug } from '../../domain/review-cli-options.js';
import type { ReviewStateInstanceReader } from './review-state.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { run } from '../git/git.js';
import { getPrStatus, isProviderEnabled } from './review-adapter.js';
import { resolveWorktree, inferSlug, missionBranchName } from '../filesystem/mission-utils.js';
import { missionId } from '../../domain/mission.js';
import { readReviewState, reconcileInterruptedHandoff } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { ReviewWorkflowContext, ReviewWorkflowPort } from '../../application/ports/review-workflow.js';
import { ReviewRoundUseCase } from '../../application/review-round-use-case.js';
import type { ReviewLoopPorts, ReviewRoundEntryPort, StartReviewRound } from '../../application/ports/review-round.js';
import { flagValue, readTextFlag, type ReadUtf8File } from './review-cli-flags.js';
import { createEvent } from './review-events.js';
import type { ReviewLoopBindings } from './review-loop.js';
import { backfillReviewHandler, continueReviewClearsIntervention, continueReviewInvalidatesBlocker, closeMissionPr, commentRound, pushRound, readComments, reconcileInterruptedHandoffHandler, showReviewStatus, submitForReview, submitReviewRound, verifyReview } from './review-commands.js';

/** Command dispatch awaits completion and forwards failures; receipts are owned by each command. */
type ReviewCommandObserver<Handler extends (...args: never[]) => unknown> = (...args: Parameters<Handler>) => unknown;

/**
 * Whether a slug identifies a known Mission.
 *
 * The Mission store is the single authority here: a mission persisted in the
 * operator database is known regardless of whether the retired
 * `missions/<slug>` directory still exists. A store read failure fails closed:
 * the retired directory is not an identity authority.
 *
 * @param {string} slug
 * @param {MissionStore|null|undefined} store
 */
async function isKnownMission(slug: string, store: MissionStore | null | undefined): Promise<boolean> {
  if (!store) { return false; }
  try {
    return (await store.load(missionId(slug))).kind === 'found';
  } catch {
    return false;
  }
}

/** Per-invocation output and current-work observers the review loop reports to. */
export type ReviewLoopObservers = Pick<ReviewLoopBindings, 'log' | 'error' | 'exit' | 'onAgentLaunched' | 'onAutonomousStop'>;

/** The prerequisite reports failure through its exit observer or rejection. */
type ReviewInterventionClearer = (...args: Parameters<typeof continueReviewClearsIntervention>) => Promise<unknown>;

export class ReviewWorkflowAdapter implements ReviewWorkflowPort {
  constructor(private readonly _defaults: {
    configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
    readFileSync?: ReadUtf8File;
    inferSlugFn?: typeof inferSlug; log?: (_msg: string) => void; error?: (_msg: string) => void; exit?: (_code: number) => void;
    verifyReviewFn?: ReviewCommandObserver<typeof verifyReview>; submitForReviewFn?: ReviewCommandObserver<typeof submitForReview>; pushRoundFn?: ReviewCommandObserver<typeof pushRound>; readCommentsFn?: ReviewCommandObserver<typeof readComments>; commentRoundFn?: ReviewCommandObserver<typeof commentRound>; submitReviewRoundFn?: ReviewCommandObserver<typeof submitReviewRound>; closeMissionPrFn?: ReviewCommandObserver<typeof closeMissionPr>; readReviewStateFn?: ReviewStateInstanceReader; resolveWorktreeFn?: typeof resolveWorktree; reconcileInterruptedHandoffFn?: typeof reconcileInterruptedHandoff;
    getPrStatusFn?: typeof getPrStatus; isReviewProviderEnabledFn?: typeof isProviderEnabled;
    operatorResume?: import('../../application/ports/review-round.js').ReviewOperatorResumePort;
    missionServicesFn?: NonNullable<Parameters<typeof submitForReview>[2]>['missionServicesFn'];
    writeReviewStateFn?: typeof import('./review-state.js').writeReviewState;
    resetReviewStateFn?: typeof import('./review-state.js').resetReviewState;
    readAllEventsFn?: typeof import('./review-events.js').readAllEvents;
    backfillReviewFn?: typeof import('./review-state.js').backfillReviewFromLegacyState;
    lifecycleService?: import('../../application/mission-lifecycle-service.js').MissionLifecycleService | null;
    requireReviewAggregate?: boolean; missionStore?: MissionStore | null; run?: typeof run; missionPath?: string; continueReviewClearsInterventionFn?: ReviewInterventionClearer; createEventFn?: typeof createEvent; payloadLandedFn?: (_slug: string) => boolean | Promise<boolean>;
    /** The composition root binds the review-loop mechanisms for each request. */
    reviewLoopMechanisms?: (_request: StartReviewRound, _observers: ReviewLoopObservers) => Promise<ReviewLoopPorts> | ReviewLoopPorts;
  } = {}) {}

  async preflight(args: string[], suppliedOptions: Record<string, unknown> = {}): Promise<ReviewWorkflowContext | null> {
    const options = { ...this._defaults, ...suppliedOptions, operatorResume: this._defaults.operatorResume } as typeof this._defaults; const slug = (options.inferSlugFn || inferSlug)(reviewExplicitSlug(args));
    if (!slug) { (options.error || fmt.log.plainError)(`Usage: ${REVIEW_USAGE}`); (options.exit || process.exit)(1); return null; }
    if (await options.payloadLandedFn?.(slug)) { (options.error || fmt.log.plainError)(fmt.status('FAIL', `Mission ${slug} payload already landed on the base branch. Close it out with: px integrate ${slug} --recover-landed`)); (options.exit || process.exit)(1); return null; }
    return { slug, args, options };
  }
  async verify(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.verifyReviewFn || verifyReview)(context.slug, context.args.includes('--no-gate'), { ...o }); }
  async submit(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.submitForReviewFn || submitForReview)(context.slug, context.args.includes('--no-gate'), o); }
  async push(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.pushRoundFn || pushRound)(context.slug, { ...o, force: context.args.includes('--force') }); }
  async enter(context: ReviewWorkflowContext): Promise<void> {
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
  private roundRequest(context: ReviewWorkflowContext): Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> {
    const poll = flagValue(context.args, '--poll-timeout-seconds');
    return { slug: context.slug, implementer: flagValue(context.args, '--implementer') ?? undefined, reviewer: flagValue(context.args, '--reviewer') ?? undefined, focus: flagValue(context.args, '--focus') ?? 'all', dryRun: context.args.includes('--dry-run'), reset: context.args.includes('--reset'), verbose: context.args.includes('--verbose'), pollTimeoutSeconds: poll ? Number.parseInt(poll, 10) : null };
  }
  private invalidMaxAttempts(raw: string): void { const o = this._defaults; (o.error || fmt.log.plainError)(fmt.status('FAIL', `--max-attempts requires a positive integer (got "${raw}").`)); (o.exit || process.exit)(1); }
  private roundUseCase(context: ReviewWorkflowContext, helperExit?: (_code: number) => never): ReviewRoundUseCase {
    const o = context.options as typeof this._defaults; const worktree = o.resolveWorktreeFn || resolveWorktree;
    const helperOptions = { ...o, exit: helperExit ?? o.exit, runFn: o.run };
    const port: ReviewRoundEntryPort = {
      operatorResume: o.operatorResume,
      loadRound: async slug => await Promise.resolve((o.readReviewStateFn || readReviewState)(slug, worktree(slug) || process.cwd(), o.missionStore)),
      isKnownMission: async slug => !o.requireReviewAggregate || await isKnownMission(slug, o.missionStore),
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
    };
    return new ReviewRoundUseCase(port);
  }
  async comment(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; const message = readTextFlag(context.args, '--comment', '--comment-file', 'comment', o); if (!message) { (o.error || fmt.log.plainError)(fmt.status('FAIL', '--comment requires text via --comment "<text>" or --comment-file <path>.')); (o.exit || process.exit)(1); return; } await (o.commentRoundFn || commentRound)(context.slug, message, o); }
  async readComments(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.readCommentsFn || readComments)(context.slug, o); }
  async submitReview(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; const outcome = flagValue(context.args, '--submit-review'); if (!outcome) { (o.error || fmt.log.plainError)(fmt.status('FAIL', '--submit-review requires an outcome: px review <slug> --submit-review <approve|request-changes|comment> [--message "<summary>"|--message-file <path>]')); (o.exit || process.exit)(1); return; } await (o.submitReviewRoundFn || submitReviewRound)(context.slug, outcome, readTextFlag(context.args, '--message', '--message-file', 'review message', o) || '', o); }
  async close(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.closeMissionPrFn || closeMissionPr)(context.slug, o); }
  async backfillReview(context: ReviewWorkflowContext): Promise<void> { await backfillReviewHandler(context.slug, context.args, context.options); }
  async reconcileReview(context: ReviewWorkflowContext): Promise<void> { await reconcileInterruptedHandoffHandler(context.slug, context.args, context.options); }
  async status(context: ReviewWorkflowContext): Promise<void> {
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
