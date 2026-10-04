import type { ReviewRoundWorkflowPort, StartReviewRound } from './ports/review-round-workflow.js';

const DEFAULT_MAX_ATTEMPTS = 5;

/** Application-owned ordering for starting or continuing autonomous reviews. */
export class ReviewRoundUseCase {
  constructor(private readonly _workflow: ReviewRoundWorkflowPort) {}

  async start(request: Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> & { readonly maxAttempts: number }): Promise<void> {
    const round = await this._workflow.loadRound(request.slug);
    const knownMission = await this._workflow.isKnownMission(request.slug);
    if (!round && !knownMission) {
      this._workflow.missingReviewAggregate(request.slug);
      return;
    }
    await this._workflow.runRound({ ...request, isContinue: false });
  }

  async continue(request: Omit<StartReviewRound, 'maxAttempts' | 'isContinue'> & { readonly rawMaxAttempts: string | null }): Promise<void> {
    // Clearing the explicit stop is necessarily before invalidating its blocker
    // and before any relaunch. Keeping this order here makes it independent of
    // the CLI adapter that received the command.
    await this._workflow.clearHumanIntervention(request.slug);
    if (!request.dryRun) { await this._workflow.invalidateResolvedBlocker(request.slug); }
    const persisted = await this._workflow.loadRound(request.slug);
    if (!persisted && !(await this._workflow.isKnownMission(request.slug))) {
      this._workflow.missingReviewAggregate(request.slug);
      return;
    }
    const parsed = request.rawMaxAttempts === null ? null : Number.parseInt(request.rawMaxAttempts, 10);
    if (request.rawMaxAttempts !== null && (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1)) {
      this._workflow.invalidMaxAttempts(request.rawMaxAttempts);
      return;
    }
    const resumedLimit = (persisted?.round ?? 1) + DEFAULT_MAX_ATTEMPTS - 1;
    const requestedAttempts = parsed ?? DEFAULT_MAX_ATTEMPTS;
    await this._workflow.runRound({
      ...request,
      maxAttempts: request.rawMaxAttempts === null ? Math.max(resumedLimit, DEFAULT_MAX_ATTEMPTS) : Math.max(requestedAttempts, persisted?.round ?? 1),
      isContinue: true,
    });
  }
}
