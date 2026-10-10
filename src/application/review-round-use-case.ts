import type { ReviewRoundEntryPort, StartReviewRound } from './ports/review-round.js';
import { DEFAULT_MAX_ATTEMPTS, runReviewLoop } from './review-loop/review-loop.js';

/** Application-owned entry for starting or continuing autonomous reviews. */
export class ReviewRoundUseCase {
  constructor(private readonly _entry: ReviewRoundEntryPort) {}

  async start(request: Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> & { readonly maxAttempts: number }): Promise<void> {
    // --start owns first-review creation: a known Mission needs no existing
    // Review. The loop performs handoff, runs verification and its repair
    // paths, then launches the reviewer and continues to a review outcome.
    const round = await this._entry.loadRound(request.slug);
    const knownMission = await this._entry.isKnownMission(request.slug);
    if (!round && !knownMission) {
      this._entry.missingReviewAggregate(request.slug);
      return;
    }
    await this.run({ ...request, isContinue: false });
  }

  async continue(request: Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> & { readonly rawMaxAttempts: string | null }): Promise<void> {
    // --continue resumes recorded review work; --start creates it. This guard
    // must not become a prerequisite for starting a known Mission's review.
    const persisted = await this._entry.loadRound(request.slug);
    if (!persisted) {
      this._entry.missingReviewAggregate(request.slug);
      return;
    }
    // Clearing the explicit stop is necessarily before invalidating its blocker
    // and before any relaunch. Keeping this order here makes it independent of
    // the CLI adapter that received the command.
    await this._entry.clearHumanIntervention(request.slug);
    if (!request.dryRun) { await this._entry.invalidateResolvedBlocker(request.slug); }
    const parsed = request.rawMaxAttempts === null ? null : Number.parseInt(request.rawMaxAttempts, 10);
    if (request.rawMaxAttempts !== null && (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1)) {
      this._entry.invalidMaxAttempts(request.rawMaxAttempts);
      return;
    }
    const resumedLimit = persisted.round + DEFAULT_MAX_ATTEMPTS - 1;
    const requestedAttempts = parsed ?? DEFAULT_MAX_ATTEMPTS;
    await this.run({
      ...request,
      maxAttempts: request.rawMaxAttempts === null ? Math.max(resumedLimit, DEFAULT_MAX_ATTEMPTS) : Math.max(requestedAttempts, persisted.round),
      isContinue: true,
    });
  }

  private async run(request: StartReviewRound): Promise<void> {
    const { slug, implementer, reviewer, focus, maxAttempts, dryRun, reset, isContinue, verbose } = request;
    await runReviewLoop({ slug, implementer, reviewer, focus, maxAttempts, dryRun, reset, isContinue, verbose }, await this._entry.mechanisms(request));
  }
}
