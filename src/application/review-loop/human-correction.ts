import { missionId } from '../../domain/mission.js';
import { currentReviewRound, reviewFindingId } from '../../domain/review.js';
import type { HumanReviewFeedback } from '../ports/review-round.js';
import type { LoopContext, ReviewRound } from './round.js';

/** Commit the obligations and lane before consuming any provider record. */
export async function recordHumanCorrection(context: LoopContext, scratch: ReviewRound, feedback: HumanReviewFeedback): Promise<'recorded' | 'stop'> {
  const { ports, state } = context;
  try {
    if (state.phase === 'reviewing' && !await ports.state.openRound(state)) { context.exit(1); return 'stop'; }
    await ports.state.recordRequestedChanges(state, {
      disposition: 'REQUEST_CHANGES', comment: scratch.humanFeedback,
      source: { kind: 'operator', author: feedback.author },
      findings: feedback.findings.map(f => ({ ...f, id: reviewFindingId(f.id), location: null })),
      revision: null, decidedAt: new Date().toISOString(),
    });
    // A resumed fixing round may also owe the original reviewer's findings.
    await loadRecordedFindings(context, scratch, feedback);
    await ports.humanFeedback.acknowledge(state, feedback);
    return 'recorded';
  } catch (error) {
    ports.output.error(`Operator correction remains pending: ${error instanceof Error ? error.message : String(error)}. Retry with px review ${context.slug}.`);
    context.exit(1);
    return 'stop';
  }
}

async function loadRecordedFindings(context: LoopContext, scratch: ReviewRound, feedback: HumanReviewFeedback): Promise<void> {
  if (!context.ports.missionStore) { return; }
  const saved = await context.ports.missionStore.load(missionId(context.slug));
  if (saved.kind !== 'found' || !saved.mission.review) { throw new Error('Recorded review is unavailable'); }
  const round = currentReviewRound(saved.mission.review);
  const decision = round.decision;
  if (round.number !== context.state.round || round.startedAt !== context.state.startedAt
    || saved.mission.status !== 'active' || decision?.kind !== 'changes-requested' || !feedback.findings.every(f =>
      decision.findings.some(stored => stored.id === f.id && stored.summary === f.summary))) {
    throw new Error('The recorded decision does not contain the operator correction in the active round');
  }
  scratch.blockingFindings = [...decision.findings];
}
