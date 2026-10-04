import * as fs from 'fs';
import * as fmt from '../../application/presentation/cli-format.js';
import { run } from '../git/git.js';
import { findMissionDir, findCheckpoints, resolveWorktree, inferSlug, missionBranchName } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus, getTaskImplementer } from '../backlog/backlog.js';
import { getPrStatus } from './review-adapter.js';
import { missionId } from '../../domain/mission.js';
import { readReviewState, reconcileInterruptedHandoff } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { startAgent } from '../agents/agents.js';
import { startReviewLoop, recordStageStatsSafe } from './review-loop.js';
import type { ReviewWorkflowContext, ReviewWorkflowPort } from '../../application/ports/review-workflow.js';
import { ReviewRoundUseCase } from '../../application/review-round-use-case.js';
import type { ReviewRoundWorkflowPort, StartReviewRound } from '../../application/ports/review-round-workflow.js';
import { StaticReviewUseCase } from '../../application/static-review-use-case.js';
import type { StaticReviewWorkflowPort } from '../../application/ports/static-review-workflow.js';
import { flagValue, readTextFlag } from './review-cli-flags.js';
import { createEvent } from './review-events.js';
import { backfillReviewHandler, continueReviewClearsIntervention, continueReviewInvalidatesBlocker, closeMissionPr, commentRound, createEventHandler, formatStaticReviewSuccess, importLegacyHandler, performStaticReview, postStaticReviewComment, pushRound, readComments, reconcileInterruptedHandoffHandler, resumeIntervenedReview, showReviewStatus, submitForReview, submitReviewRound, verifyReview } from './review-commands.js';

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

export class ReviewWorkflowAdapter implements ReviewWorkflowPort {
  constructor(private readonly _defaults: {
    inferSlugFn?: typeof inferSlug; log?: (_msg: string) => void; error?: (_msg: string) => void; exit?: (_code: number) => never;
    verifyReviewFn?: typeof verifyReview; submitForReviewFn?: typeof submitForReview; pushRoundFn?: typeof pushRound; readCommentsFn?: typeof readComments; commentRoundFn?: typeof commentRound; submitReviewRoundFn?: typeof submitReviewRound; closeMissionPrFn?: typeof closeMissionPr; startReviewLoopFn?: typeof startReviewLoop; recordStageStatsSafeFn?: typeof recordStageStatsSafe; startAgentFn?: typeof startAgent; resolveTaskFileFn?: typeof resolveTaskFile; getTaskStatusFn?: typeof getTaskStatus; getTaskImplementerFn?: typeof getTaskImplementer; getPrStatusFn?: typeof getPrStatus; readReviewStateFn?: typeof readReviewState; performStaticReviewFn?: typeof performStaticReview; postStaticReviewCommentFn?: typeof postStaticReviewComment; resolveWorktreeFn?: typeof resolveWorktree; reconcileInterruptedHandoffFn?: typeof reconcileInterruptedHandoff;
    requireReviewAggregate?: boolean; missionStore?: MissionStore | null; run?: typeof run; missionPath?: string; continueReviewClearsInterventionFn?: typeof continueReviewClearsIntervention; createEventFn?: typeof createEvent; onAgentLaunched?: (_agent: string, _phase: 'review' | 'review-response') => Promise<void> | void; onAutonomousStop?: (_reason: string) => Promise<void> | void; payloadLandedFn?: (_slug: string) => boolean | Promise<boolean>; reviewRoundUseCaseFactory?: (_port: ReviewRoundWorkflowPort) => ReviewRoundUseCase;
  } = {}) {}

  async preflight(args: string[], suppliedOptions: Record<string, unknown> = {}): Promise<ReviewWorkflowContext | null> {
    const options = { ...this._defaults, ...suppliedOptions } as typeof this._defaults; const slug = (options.inferSlugFn || inferSlug)(args.find(arg => !arg.startsWith('--')));
    if (!slug) { (options.error || fmt.log.plainError)('Usage: px review [<slug>] [--verify] [--submit] [--push] [--force] [--start|--continue [--implementer <a>] [--reviewer <a>] [--focus <f>] [--max-attempts <n>]] [--reconcile-review --branch <branch> --target <branch> --reviewer <agent> --implementer <agent> --revision <revision> --eligible-reviewer <agent>] [--no-gate] [--status] [--comments] [--comment "<msg>"|--comment-file <path>] [--submit-review <outcome> [--message "<summary>"|--message-file <path>] [--close] [--create-event --type <classification> [--input-file <path>] [--actor <name>] [--round <n>] [--phase <phase>] [--mission <path>]] [--import-legacy [--tmp-dir <dir>]] [--backfill-review [--dry-run]] [--resume --actor <name>]'); (options.exit || process.exit)(1); return null; }
    if (await options.payloadLandedFn?.(slug)) { (options.error || fmt.log.plainError)(fmt.status('FAIL', `Mission ${slug} payload already landed on the base branch. Close it out with: px integrate ${slug} --recover-landed`)); (options.exit || process.exit)(1); return null; }
    return { slug, args, options };
  }
  async verify(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; (o.verifyReviewFn || verifyReview)(context.slug, context.args.includes('--no-gate'), { ...o, missionPath: flagValue(context.args, '--mission') || undefined }); }
  async submit(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.submitForReviewFn || submitForReview)(context.slug, context.args.includes('--no-gate'), o); }
  async push(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.pushRoundFn || pushRound)(context.slug, { ...o, force: context.args.includes('--force') }); }
  async start(context: ReviewWorkflowContext): Promise<void> {
    const raw = flagValue(context.args, '--max-attempts');
    const maxAttempts = raw === null ? 5 : Number.parseInt(raw, 10);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) { this.invalidMaxAttempts(raw ?? ''); return; }
    await this.roundUseCase(context).start({ ...this.roundRequest(context), maxAttempts });
  }
  async continue(context: ReviewWorkflowContext): Promise<void> { await this.roundUseCase(context).continue({ ...this.roundRequest(context), rawMaxAttempts: flagValue(context.args, '--max-attempts') }); }
  async resume(context: ReviewWorkflowContext): Promise<void> { await resumeIntervenedReview(context.slug, context.args, context.options); }
  private roundRequest(context: ReviewWorkflowContext): Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> {
    const poll = flagValue(context.args, '--poll-timeout-seconds');
    return { slug: context.slug, implementer: flagValue(context.args, '--implementer') ?? undefined, reviewer: flagValue(context.args, '--reviewer') ?? undefined, focus: flagValue(context.args, '--focus') ?? 'all', dryRun: context.args.includes('--dry-run'), reset: context.args.includes('--reset'), verbose: context.args.includes('--verbose'), pollTimeoutSeconds: poll ? Number.parseInt(poll, 10) : null, missionPath: flagValue(context.args, '--mission') ?? undefined };
  }
  private invalidMaxAttempts(raw: string): void { const o = this._defaults; (o.error || fmt.log.plainError)(fmt.status('FAIL', `--max-attempts requires a positive integer (got "${raw}").`)); (o.exit || process.exit)(1); }
  private roundUseCase(context: ReviewWorkflowContext): ReviewRoundUseCase {
    const o = context.options as typeof this._defaults; const worktree = o.resolveWorktreeFn || resolveWorktree;
    const port: ReviewRoundWorkflowPort = {
      loadRound: async slug => await Promise.resolve((o.readReviewStateFn || readReviewState)(slug, worktree(slug) || process.cwd(), o.missionStore)),
      isKnownMission: async slug => !o.requireReviewAggregate || await isKnownMission(slug, o.missionStore),
      clearHumanIntervention: async slug => { await (o.continueReviewClearsInterventionFn ?? continueReviewClearsIntervention)(slug, context.args, { log: o.log, error: o.error, exit: o.exit, resolveWorktreeFn: o.resolveWorktreeFn, missionStore: o.missionStore, createEventFn: o.createEventFn, runFn: o.run }); },
      invalidateResolvedBlocker: async slug => { if (o.missionStore) { await continueReviewInvalidatesBlocker(slug, context.args, { ...o, runFn: o.run }); } },
      runRound: async request => { await (o.startReviewLoopFn ?? startReviewLoop)(request.slug, { ...request, recordStageStatsSafeFn: o.recordStageStatsSafeFn ?? recordStageStatsSafe, onAgentLaunched: o.onAgentLaunched, onAutonomousStop: o.onAutonomousStop, exit: o.exit || process.exit }); },
      invalidMaxAttempts: raw => this.invalidMaxAttempts(raw),
      missingReviewAggregate: slug => { (o.error || fmt.log.plainError)(fmt.status('FAIL', `Mission ${slug} has no valid Review aggregate. Stop before reviewer launch and run px review ${slug} --reconcile-review --branch <branch> --target <branch> --reviewer <agent> --implementer <agent> --revision <revision> --eligible-reviewer <agent>.`)); (o.exit || process.exit)(1); },
    };
    return o.reviewRoundUseCaseFactory?.(port) ?? new ReviewRoundUseCase(port);
  }
  async comment(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; const message = readTextFlag(context.args, '--comment', '--comment-file', 'comment', o); if (!message) { (o.error || fmt.log.plainError)(fmt.status('FAIL', '--comment requires text via --comment "<text>" or --comment-file <path>.')); (o.exit || process.exit)(1); return; } await (o.commentRoundFn || commentRound)(context.slug, message, o); }
  async readComments(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.readCommentsFn || readComments)(context.slug, o); }
  async submitReview(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; const outcome = flagValue(context.args, '--submit-review'); if (!outcome) { (o.error || fmt.log.plainError)(fmt.status('FAIL', '--submit-review requires an outcome: px review <slug> --submit-review <approve|request-changes|comment> [--message "<summary>"|--message-file <path>]')); (o.exit || process.exit)(1); return; } await (o.submitReviewRoundFn || submitReviewRound)(context.slug, outcome, readTextFlag(context.args, '--message', '--message-file', 'review message', o) || '', o); }
  async close(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; await (o.closeMissionPrFn || closeMissionPr)(context.slug, o); }
  async createEvent(context: ReviewWorkflowContext): Promise<void> { createEventHandler(context.slug, context.args, context.options); }
  async importLegacy(context: ReviewWorkflowContext): Promise<void> { importLegacyHandler(context.slug, context.args, context.options); }
  async backfillReview(context: ReviewWorkflowContext): Promise<void> { await backfillReviewHandler(context.slug, context.args, context.options); }
  async reconcileReview(context: ReviewWorkflowContext): Promise<void> { await reconcileInterruptedHandoffHandler(context.slug, context.args, context.options); }
  async status(context: ReviewWorkflowContext): Promise<void> { const o = context.options as typeof this._defaults; if (context.args.includes('--status')) { await showReviewStatus(context.slug, { ...o, readReviewStateFn: o.readReviewStateFn || readReviewState }); return; } const log = o.log || fmt.log.plain; const worktree = o.resolveWorktreeFn || resolveWorktree; const pr = (o.getPrStatusFn || getPrStatus)(missionBranchName(context.slug, process.cwd()), process.cwd()); log(fmt.status('INFO', `Review status for mission: ${fmt.slug(context.slug)}`)); if ((pr as Record<string, unknown>).exists) {log((pr as Record<string, unknown>).raw as string);} else { log(fmt.status('INFO', 'No active PR found for this mission.')); await this.staticReview(context, worktree); } const persisted = await Promise.resolve((o.readReviewStateFn || readReviewState)(context.slug)); if (persisted) {log(fmt.status('INFO', `Persisted reviewer state: reviewer=${fmt.agent(persisted.reviewer ?? '')} implementer=${fmt.agent(persisted.implementer ?? '')} round=${persisted.round}`));} }
  private async staticReview(context: ReviewWorkflowContext, worktreeFn: typeof resolveWorktree): Promise<void> {
    const o = context.options as typeof this._defaults; const log = o.log || fmt.log.plain; const error = o.error || fmt.log.plainError; const worktree = worktreeFn(context.slug) || process.cwd();
    const port: StaticReviewWorkflowPort = {
      review: slug => (o.performStaticReviewFn || performStaticReview)(slug, { log, findMissionDir, findCheckpoints, readFileSync: fs.readFileSync, run: o.run || run, resolveWorktree: worktreeFn, rootDir: worktree, missionPath: flagValue(context.args, '--mission') || undefined }),
      resolveImplementer: slug => { const resolution = (o.resolveTaskFileFn || resolveTaskFile)(slug, worktree); return resolution?.taskFile ? (o.getTaskImplementerFn || getTaskImplementer)(resolution.taskFile) : null; },
      implementerUnresolved: (slug, findings) => log(fmt.status('WARN', `Static review found ${findings.length} finding(s) but the implementer could not be resolved for ${fmt.slug(slug)} — not re-launching the implementer and not starting the review loop.`)),
      relaunchImplementer: async (slug, implementer, findings) => { log(`\nStatic review found ${findings.length} finding(s). Re-launching implementer (${fmt.agent(implementer)}) with a targeted fix prompt...`); await (o.startAgentFn || startAgent)('active', { prompt: `Static review of your mission branch found the following issue(s). Fix them and commit, then stop:\n${findings.map(f => `- ${f}`).join('\n')}`, worktree, agent: implementer, slug }); },
      reportClean: () => log(fmt.status('INFO', 'Static review passed — no findings. Mission branch is clean.')),
      hasOpenPr: slug => { const pr = (o.getPrStatusFn || getPrStatus)(missionBranchName(slug, process.cwd()), process.cwd()) as Record<string, unknown>; return Boolean(pr.exists) && pr.state === 'open'; },
      submitForReview: async slug => { log(fmt.status('INFO', 'No open PR found — submitting for review before finalizing static review...')); await (o.submitForReviewFn || submitForReview)(slug, true, o); },
      postSuccess: async slug => { await (o.postStaticReviewCommentFn || postStaticReviewComment)(slug, formatStaticReviewSuccess(slug), { ...o, rootDir: worktree, log, error }); },
    };
    await new StaticReviewUseCase(port).run(context.slug);
  }
}

export function createReviewWorkflowAdapter(options: ConstructorParameters<typeof ReviewWorkflowAdapter>[0] = {}) { return new ReviewWorkflowAdapter(options); }
