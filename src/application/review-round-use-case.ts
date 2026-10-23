import type { ReviewRoundEntryPort, StartReviewRound } from './ports/review-round.js';
import { DEFAULT_MAX_ATTEMPTS, runReviewLoop } from './review-loop/review-loop.js';

/** Infer first handoff or continuation from the authoritative Review. */
export class ReviewRoundUseCase {
  constructor(private readonly _entry: ReviewRoundEntryPort) {}

  async enter(request: Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> & { readonly rawMaxAttempts: string | null }): Promise<void> {
    const parsed = request.rawMaxAttempts === null ? DEFAULT_MAX_ATTEMPTS : Number(request.rawMaxAttempts);
    if (!Number.isInteger(parsed) || parsed < 1) {
      this._entry.invalidMaxAttempts(request.rawMaxAttempts ?? '');
      return;
    }
    const persisted = await this._entry.loadRound(request.slug);
    if (!persisted && !await this._entry.isKnownMission(request.slug)) {
      this._entry.missingReviewAggregate(request.slug);
      return;
    }
    // Only a direct operator can acknowledge a correction or clear a stop.
    if (!request.dryRun && this._entry.operatorResume) {
      await this._entry.operatorResume.acknowledge(request.slug);
      if (persisted) {
        await this._entry.clearHumanIntervention(request.slug);
        await this._entry.invalidateResolvedBlocker(request.slug);
      }
    }
    const resumedLimit = persisted ? persisted.round + DEFAULT_MAX_ATTEMPTS - 1 : DEFAULT_MAX_ATTEMPTS;
    const maxAttempts = request.rawMaxAttempts === null ? Math.max(resumedLimit, DEFAULT_MAX_ATTEMPTS) : Math.max(parsed, persisted?.round ?? 1);
    const round = { ...request, maxAttempts, isContinue: Boolean(persisted) };
    await runReviewLoop(round, await this._entry.mechanisms(round));
  }
}
