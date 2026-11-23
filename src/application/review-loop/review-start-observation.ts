import type { LoopContext, ReviewRound } from './round.js';
import { missionId } from '../../domain/mission.js';
import { startReviewAction } from './action-limit.js';

function takeSelectionFailure(context: LoopContext) {
  const failure = context.selectionFailure ?? null;
  context.selectionFailure = null;
  return failure;
}

/** Observe an actual agent launch after the round-open boundary committed. */
export async function observeAgentReviewStart(context: LoopContext, round: ReviewRound,
  reviewer: string, runId: string | null): Promise<void> {
  if (context.dryRun || !context.ports.reviewStarts) { return; }
  const revision = round.verifiedRevision ?? context.ports.preReview.head();
  if (!revision) { return; }
  await context.ports.reviewStarts.observe({ missionId: missionId(context.slug), actualAction: 'agent', revision,
    verdictCorrelation: `review:${round.attempt}:agent:${reviewer}-verdict`, agentRunId: runId,
    operatorInvocation: context.operatorInvocation,
    selectionFailure: takeSelectionFailure(context) });
}

/** Observe the already-committed integration handoff; restart replays the same key. */
export async function observeHumanReviewStart(context: LoopContext, round?: ReviewRound): Promise<boolean> {
  if (context.dryRun) { return true; }
  const revision = round?.verifiedRevision ?? context.ports.preReview.head();
  if (!revision) { return true; }
  if (!await startReviewAction(context, 'human', `review:${round?.attempt ?? context.state.round}:human-verdict`, revision)) { return false; }
  if (!context.ports.reviewStarts) { return true; }
  await context.ports.reviewStarts.observe({ missionId: missionId(context.slug), actualAction: 'human', revision,
    verdictCorrelation: `review:${round?.attempt ?? context.state.round}:human-verdict`, agentRunId: null,
    operatorInvocation: context.operatorInvocation,
    selectionFailure: takeSelectionFailure(context) });
  return true;
}
