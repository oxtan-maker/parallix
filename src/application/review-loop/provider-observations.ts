import type { ProviderPollRequest, ProviderReviewObservation, ProviderPoll, ProviderReviewChanges } from '../ports/review-round.js';
import { missionId } from '../../domain/mission.js';
import { currentReviewRound, type ReviewRound as StoredRound } from '../../domain/review.js';
import type { LoopContext, ReviewRound } from './round.js';

/** Existing protocol submissions already own their decision or response. */
async function observedRound(context: LoopContext): Promise<StoredRound | null> {
  const store = context.ports.missionStore;
  if (!store) { return null; }
  const loaded = await store.load(missionId(context.slug));
  if (loaded.kind !== 'found' || !loaded.mission.review) { throw new Error('Provider observation requires a recorded review'); }
  const round = currentReviewRound(loaded.mission.review);
  if (round.number !== context.state.round || round.startedAt !== context.state.startedAt) {
    throw new Error('Provider observation is stale; reload the current round');
  }
  return round;
}

/** Record provider findings before launching implementation or mirroring its lane. */
export async function recordProviderChanges(context: LoopContext, scratch: ReviewRound, outcome: unknown, observed?: ProviderReviewChanges): Promise<void> {
  const { ports, state, identities } = context;
  if (!ports.provider || context.dryRun) { return; }
  if (await settleRecordedChanges(context, scratch)) { return; }
  const observation = observed ?? await ports.provider.readRequestedChanges(identities.reviewer, state.startedAt);
  if (!observation || observation.disposition !== outcome) { throw new Error('Provider change request does not match the observed outcome'); }
  await ports.state.recordRequestedChanges(state, observation);
  scratch.blockingFindings = [...observation.findings];
}

/** A saved decision is complete only after its review → active boundary settles. */
export async function settleRecordedChanges(context: LoopContext, scratch: ReviewRound): Promise<boolean> {
  const round = await observedRound(context);
  if (round?.decision?.kind !== 'changes-requested') { return false; }
  await context.ports.state.recordRequestedChanges(context.state, { disposition: 'REQUEST_CHANGES', findings: round.decision.findings,
    comment: round.decision.comment ?? '', revision: round.decision.revision ?? null, decidedAt: round.decision.decidedAt });
  scratch.blockingFindings = [...round.decision.findings];
  return true;
}

/** Persist the response before resetting the phase or opening the next round. */
export async function recordProviderResolution(context: LoopContext, outcome: string, sinceIso: string): Promise<void> {
  const { ports, state, identities } = context;
  if (!ports.provider || context.dryRun) { return; }
  const round = await observedRound(context);
  if (round?.response) { return; }
  const observation = await ports.provider.readResolution(identities.implementer, sinceIso);
  if (!observation || observation.disposition !== outcome) { throw new Error('Provider resolution does not match the observed disposition'); }
  const items = outcome === 'PUSHBACK_ALL' && round?.decision?.kind === 'changes-requested'
    ? round.decision.findings.map(finding => ({ kind: 'pushed_back' as const, findingId: finding.id }))
    : observation.itemDispositions;
  await ports.state.recordResolution(state, { ...observation, itemDispositions: items });
}

/** Translate only polled evidence; artifact submissions already use their owners. */
export async function pollProviderReview(context: LoopContext, round: ReviewRound, request: ProviderPollRequest): Promise<unknown> {
  const observation = await context.ports.provider!.pollReview(context.identities.reviewer, context.state.startedAt, request);
  return await observeProviderReview(context, round, observation);
}

export async function observeProviderReview(context: LoopContext, round: ReviewRound, observation: ProviderPoll | ProviderReviewObservation): Promise<unknown> {
  const fact = observation && typeof observation === 'object' && 'disposition' in observation
    ? observation : null;
  if (fact?.disposition === 'APPROVED') { round.providerApproval = fact; }
  const outcome = fact?.disposition ?? observation;
  if (typeof outcome === 'string' && outcome && outcome !== 'APPROVED') { await recordProviderChanges(context, round, outcome, fact?.disposition === 'APPROVED' ? undefined : fact ?? undefined); }
  return outcome;
}
