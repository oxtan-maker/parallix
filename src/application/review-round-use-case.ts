import { parseReviewPhase } from '../domain/review-phase-policy.js';
import type { MissionStore } from './domain-ports.js';
import { missionId } from '../domain/mission.js';
import { agentFamily } from '../domain/agents.js';
import { changeRevision, ConfiguredReviewerEligibility, startReview } from '../domain/review.js';

import type { ReviewRoundEntryPort, StartReviewRound } from './ports/review-round.js';
import { DEFAULT_MAX_ATTEMPTS, runReviewLoop } from './review-loop/review-loop.js';

/** Infer first review preparation or continuation from the authoritative Review. */
export class ReviewRoundUseCase {
  constructor(private readonly _entry: ReviewRoundEntryPort, private readonly _runLoop: typeof runReviewLoop = runReviewLoop) {}

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
    await this._runLoop(round, await this._entry.mechanisms(round));
  }
}

/** The complete review preparation record an operator must supply to repair an interrupted transition. */
export interface InterruptedReviewPreparationInputs {
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly reviewer: string;
  readonly implementer: string;
  readonly revision: string;
  readonly eligibleReviewers: readonly string[];
  /** The recovery invocation's durable round-one start time. */
  readonly startedAt: string;
}

export type InterruptedReviewPreparationReconciliationResult =
  | { outcome: 'reconciled'; eligibleReviewers: readonly string[] }
  | { outcome: 'already-present'; eligibleReviewers: readonly string[] }
  | { outcome: 'failed'; diagnostic: string };

function hasValidReviewAggregate(review: unknown): boolean {
  if (!review || typeof review !== 'object') { return false; }
  const rounds = (review as { rounds?: unknown }).rounds;
  if (!Array.isArray(rounds) || rounds.length === 0) { return false; }
  return rounds.every((round) => {
    if (!round || typeof round !== 'object') { return false; }
    const candidate = round as { number?: unknown; reviewer?: unknown; implementer?: unknown; startedAt?: unknown; phase?: unknown; subject?: { change?: unknown; revision?: unknown } };
    return parseReviewPhase(candidate.phase) !== null && Number.isInteger(candidate.number)
      && typeof candidate.reviewer === 'string' && candidate.reviewer.trim() !== ''
      && typeof candidate.implementer === 'string' && candidate.implementer.trim() !== ''
      && typeof candidate.startedAt === 'string' && candidate.startedAt.trim() !== ''
      && Boolean(candidate.subject?.change)
      && typeof candidate.subject?.revision === 'string' && candidate.subject.revision.trim() !== '';
  });
}

function requiredReconciliationText(inputs: InterruptedReviewPreparationInputs, field: keyof InterruptedReviewPreparationInputs): string {
  const value = inputs[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Interrupted-review preparation reconciliation requires canonical ${field}`);
  }
  return value.trim();
}

/**
 * Create the sole missing round-one Review aggregate for an interrupted review preparation.
 *
 * This deliberately accepts only the review preparation record, never loop state or
 * reviewer artifacts. Existing aggregates are left byte-for-byte untouched.
 */
export async function reconcileInterruptedReviewPreparation(
  slug: string,
  inputs: InterruptedReviewPreparationInputs,
  store: MissionStore | null,
): Promise<InterruptedReviewPreparationReconciliationResult> {
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }

  try {
    const sourceBranch = requiredReconciliationText(inputs, 'sourceBranch');
    const targetBranch = requiredReconciliationText(inputs, 'targetBranch');
    const reviewer = agentFamily(requiredReconciliationText(inputs, 'reviewer'));
    const implementer = agentFamily(requiredReconciliationText(inputs, 'implementer'));
    const revision = changeRevision(requiredReconciliationText(inputs, 'revision'));
    const startedAt = requiredReconciliationText(inputs, 'startedAt');
    if (!Array.isArray(inputs.eligibleReviewers) || inputs.eligibleReviewers.length === 0) {
      throw new Error("Interrupted-review preparation reconciliation requires non-empty canonical eligibleReviewers");
    }
    const eligibleReviewers = inputs.eligibleReviewers.map((value) => agentFamily(String(value).trim()));
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: eligibleReviewers, strategy: 'random' });

    const result = await store.load(missionId(slug));
    if (result.kind !== 'found') {
      return { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database; restore it before reconciliation` };
    }
    if (result.mission.status !== 'review') {
      return { outcome: 'failed', diagnostic: `Mission ${slug} is ${result.mission.status}, not review; reconciliation only repairs an interrupted review preparation` };
    }
    if (result.mission.review) {
      if (!hasValidReviewAggregate(result.mission.review)) {
        return { outcome: 'failed', diagnostic: `Mission ${slug} has malformed Review data; repair it before reconciliation` };
      }
      return { outcome: 'already-present', eligibleReviewers };
    }

    const review = startReview({
      change: { kind: 'local-branch', sourceBranch, targetBranch },
      revision,
    }, reviewer, implementer, startedAt, eligibility);
    await store.save({ ...result.mission, review }, result.version);
    return { outcome: 'reconciled', eligibleReviewers };
  } catch (error) {
    return { outcome: 'failed', diagnostic: error instanceof Error ? error.message : "Interrupted-review preparation reconciliation failed" };
  }
}
