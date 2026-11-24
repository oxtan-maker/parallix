import * as fmt from '../../application/presentation/cli-format.js';
import { failureReason, type FailureReason } from '../../domain/failure-reason.js';
import type { ReviewPhase } from '../../domain/review-phase-policy.js';
import { createEvent, VALID_EVENT_TYPES, type CreateEventOptions, type CreateEventParams, type CreateEventResult } from './review-events.js';
import { reviewPublicationReference, type ReviewEventDraft, type ReviewPublicationState } from './review-publication.js';
import type { LiveMissionExecutionContext } from '../../application/ports/mission-execution-context.js';

type RepoEventFn = (_slug: string, _type: string, _params: CreateEventParams, _options: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;

export function publicationContextError(
  enabled: boolean,
  context: { store: unknown; revision: string | undefined; round: number | undefined },
): string | null {
  if (!enabled) { return null; }
  return context.store && context.revision && context.round !== undefined
    ? null : 'Provider publication requires the Mission store, review round, and exact revision.';
}

export function artifactPublicationRevision(
  enabled: boolean,
  options: { store: unknown; explicit?: string; worktree: string; head: (_worktree: string) => string },
): { ok: true; revision: string } | { ok: false; error: string } {
  if (enabled && !options.store) { return { ok: false, error: 'Provider publication requires the Mission store.' }; }
  try {
    const governed = options.head(options.worktree);
    if (!governed) { return { ok: false, error: 'Could not resolve publication revision: worktree HEAD is empty.' }; }
    return { ok: true, revision: governed };
  } catch (error) {
    // Isolated/provider-disabled compatibility callers may have no Git checkout.
    // Production worktrees always resolve HEAD and therefore never trust a
    // caller-reported revision over the governed checkout.
    if (!enabled) { return { ok: true, revision: options.explicit ?? '' }; }
    return { ok: false, error: `Could not resolve publication revision: ${(error as Error).message}` };
  }
}

export function reviewerPublicationEventDrafts(params: {
  slug: string; reviewer: string; round: number; phase: ReviewPhase;
  reviewFindings: string; reviewOutcome: string; reviewVerdict: string;
  providerEnabled: boolean; revision: string; publicationState: ReviewPublicationState; attempt?: string;
}): readonly ReviewEventDraft[] {
  const reference = (eventType: 'reviewer_findings' | 'reviewer_outcome', target: 'comment' | 'review') => params.providerEnabled
    ? reviewPublicationReference({ slug: params.slug, round: params.round, actor: params.reviewer, revision: params.revision,
      ...(params.attempt ? { attempt: params.attempt } : {}), eventType, target }, params.publicationState)
    : null;
  return [{
    eventType: VALID_EVENT_TYPES.REVIEWER_FINDINGS,
    roundNumber: params.round, phase: params.phase, actor: params.reviewer,
    content: params.reviewFindings, disposition: null, verdict: null,
    itemDispositions: null, blockedReason: null,
    followUpReference: reference('reviewer_findings', 'comment'),
  }, {
    eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME,
    roundNumber: params.round, phase: params.phase, actor: params.reviewer,
    content: params.reviewOutcome, disposition: null, verdict: params.reviewVerdict,
    itemDispositions: null, blockedReason: null,
    followUpReference: reference('reviewer_outcome', 'review'),
  }];
}

export async function persistReviewerPublicationEvents(params: {
  slug: string; reviewer: string; round: number | undefined; phase: ReviewPhase | undefined;
  reviewFindings: string; reviewOutcome: string; reviewVerdict: string;
  attempt?: string; createEventFn?: RepoEventFn; missionStore?: import('../../application/domain-ports.js').MissionStore | null;
  executionContext: LiveMissionExecutionContext; log: (_message: string) => void; error: (_message: string) => void;
  verbose: boolean; providerEnabled: boolean; revision: string; publicationState: ReviewPublicationState;
}): Promise<{ ok: true } | { ok: false; failureReason?: FailureReason; diagnostic: string }> {
  const createEventFn = params.createEventFn ?? createEvent;
  const drafts = reviewerPublicationEventDrafts({ ...params, round: params.round!, phase: params.phase! });
  const [findingsDraft, outcomeDraft] = drafts;
  const findings = await createEventFn(params.slug, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: findingsDraft!.content, round: findingsDraft!.roundNumber ?? undefined, phase: params.phase, actor: findingsDraft!.actor ?? undefined,
    ...(findingsDraft!.followUpReference ? { followUpReference: findingsDraft!.followUpReference } : {}),
  }, { executionContext: params.executionContext, missionStore: params.missionStore, skipGit: true, log: params.log, error: params.error });
  const findingsFailure = eventFailure(findings, 'findings', params.error);
  if (findingsFailure) { return findingsFailure; }
  const outcome = await createEventFn(params.slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: outcomeDraft!.content, round: outcomeDraft!.roundNumber ?? undefined, phase: params.phase, actor: outcomeDraft!.actor ?? undefined, verdict: outcomeDraft!.verdict ?? undefined,
    ...(outcomeDraft!.followUpReference ? { followUpReference: outcomeDraft!.followUpReference } : {}),
  }, { executionContext: params.executionContext, missionStore: params.missionStore, skipGit: true, log: params.log, error: params.error });
  const outcomeFailure = eventFailure(outcome, 'outcome', params.error);
  if (outcomeFailure) { return outcomeFailure; }
  if (params.verbose) {
    params.log(fmt.status('INFO', `Persisted reviewer artifacts to repo store: ${findings.path}, ${outcome.path}`));
  }
  return { ok: true };
}

function eventFailure(
  result: CreateEventResult,
  label: string,
  error: (_message: string) => void,
): { ok: false; failureReason: FailureReason; diagnostic: string } | null {
  if (result.ok) { return null; }
  error(fmt.status('FAIL', `Failed to persist reviewer ${label} to repo store: ${result.error}`));
  return {
    ok: false,
    failureReason: failureReason('infrastructure', 'review-preparation'),
    diagnostic: `Reviewer artifact persist failed (${label}): ${result.error}`,
  };
}
