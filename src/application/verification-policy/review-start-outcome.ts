import type { ReviewDecisionRevocation } from '../../domain/review-decision-source.js';
import type { Review, ReviewRound, ReviewerDecision } from '../../domain/review.js';
import { isEffectiveReviewerResult } from '../../domain/reviewer-result.js';
import { reviewerRequirementRevision } from '../../domain/reviewer-policy.js';
import type { MissionId } from '../../domain/mission.js';
import type { ReviewOutcomeFacts, ReviewRebuttalOutcome, ReviewStartDecision, ReviewStartFailure,
  ReviewStartOutcome, ReviewStartOutcomeInput, ReviewStartPolicyPorts, ReviewVerdictSource } from '../ports/verification-policy.js';

export const REVIEW_START_OUTCOME_EVENT = 'verification.review-start-outcome';

/** One outcome per start: replaying the settlement of a start never adds a second row. */
export function reviewStartOutcomeKey(startKey: string): string { return `review-outcome:${startKey}`; }

export function reviewStartOutcome(input: ReviewStartOutcomeInput): ReviewStartOutcome {
  return { ...input, schemaVersion: 1, idempotencyKey: reviewStartOutcomeKey(input.startKey), recordedAt: new Date().toISOString() };
}

/** Elapsed milliseconds between two stored instants; null unless both parse and are in order. */
function elapsedMs(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) { return null; }
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

/** The review round a start's verdict correlation names (`review:<round>:...`); null when it names none. */
function correlatedRound(review: Review | null, start: ReviewStartDecision): ReviewRound | null {
  const number = /^review:(\d+):/.exec(start.verdictCorrelation)?.[1];
  return number === undefined ? null : review?.rounds.find(round => round.number === Number(number)) ?? null;
}

export function verdictSourceOf(decision: ReviewerDecision | null): ReviewVerdictSource | null {
  if (!decision) { return null; }
  if (decision.classifier !== undefined) { return 'classifier'; }
  if (decision.kind === 'approved') { return decision.source.kind; }
  return decision.source?.kind === 'operator' ? 'operator' : 'reviewer';
}

/**
 * The operator decision that ended this human handoff: the earliest operator changes-requested or
 * operator revocation after it began and before the next recorded action started. A decision after
 * the next action belongs to a later handoff, so a handoff resumed without one stays unknown.
 */
function humanDecisionAfter(review: Review | null, handoffAt: string, nextStartAt: string | null): { readonly decidedAt: string; readonly decision: ReviewerDecision | null } | null {
  const begun = Date.parse(handoffAt);
  const until = nextStartAt === null ? Number.POSITIVE_INFINITY : Date.parse(nextStartAt);
  const found: { decidedAt: string; decision: ReviewerDecision | null }[] = [];
  for (const round of review?.rounds ?? []) {
    const decision = round.decision;
    if (decision?.kind === 'changes-requested' && decision.source?.kind === 'operator') {
      found.push({ decidedAt: decision.decidedAt, decision });
    }
    const revocation: ReviewDecisionRevocation | undefined = decision?.kind === 'approved' ? decision.revocation : undefined;
    if (revocation?.cause?.kind === 'operator') { found.push({ decidedAt: revocation.revokedAt, decision: null }); }
  }
  return found.filter(item => Date.parse(item.decidedAt) >= begun && !(Date.parse(item.decidedAt) > until))
    .sort((left, right) => Date.parse(left.decidedAt) - Date.parse(right.decidedAt))[0] ?? null;
}

/** A withdrawn approval is no renewed verdict: only a decision still standing counts. */
function renewedVerdictOf(decision: ReviewerDecision | null): 'approved' | 'changes-requested' | null {
  if (decision === null || (decision.kind === 'approved' && decision.revocation !== undefined)) { return null; }
  return decision.kind;
}

/** Whether the round a start belongs to can still gain its decision, so a rebuttal verdict still unknown may yet be known. */
function awaitsDecision(start: ReviewStartDecision, facts: ReviewOutcomeFacts): boolean {
  const round = correlatedRound(facts.review, start);
  return round !== null && round.decision === null && !(facts.review?.rounds.some(item => item.number > round.number) ?? false);
}

/**
 * The rebuttal this review answered: the previous round's response disputed findings, and this round
 * judged the revision that response produced. The response revision is the checkout head when the
 * implementer answered, so a bookkeeping-only commit moves it; `fixedFindings` lets a reader tell a
 * pure rebuttal from a mixed response. The verdict is the settled round decision (any negative
 * reviewer result makes it negative), never one reviewer's publication. A round on any other
 * revision (a rebound, a repair commit) answered no rebuttal.
 */
function rebuttalAnswered(review: Review | null, round: ReviewRound | null): ReviewRebuttalOutcome | null {
  const previous = review?.rounds.find(candidate => candidate.number === (round?.number ?? 0) - 1);
  const response = previous?.response;
  if (!round || !response || round.subject.revision !== response.resultingRevision) { return null; }
  const disputedFindings = response.resolutions.filter(item => item.kind === 'disputed').length;
  if (disputedFindings === 0) { return null; }
  return { disputedFindings, fixedFindings: response.resolutions.length - disputedFindings,
    renewedVerdict: renewedVerdictOf(round.decision) };
}

const AGENT_CORRELATION = /^review:(\d+):agent:(.+)-verdict$/;

/** The reviewer an agent start launched, from its verdict correlation; null when it names none. */
export function reviewerOfStart(correlation: string): string | null {
  return AGENT_CORRELATION.exec(correlation)?.[2] ?? null;
}

type Verdict = { readonly kind: 'approved' | 'changes-requested'; readonly findings: number;
  readonly decidedAt: string; readonly source: ReviewVerdictSource };

/**
 * The verdict this reviewer start produced. Under two independent reviewers each
 * start has its own stored publication, matched by run id or, before the run was
 * attributed, by reviewer; a start with no publication of its own (a replaced
 * reviewer) decided nothing. A round without publications falls back to its single
 * decision, owned by the last agent start of the round.
 */
function agentVerdict(start: ReviewStartDecision, round: ReviewRound | null,
  later: readonly ReviewStartDecision[], all: readonly ReviewStartDecision[]): Verdict | null {
  if (!round) { return null; }
  const reviewer = reviewerOfStart(start.verdictCorrelation);
  if (round.reviewerResults && round.reviewerResults.length > 0) {
    // A publication that is not an effective judgment (unknown decision, missing output, failed run,
    // revoked) is no verdict of this attempt, whatever it was matched to.
    // A reviewer relaunched to recover missing output is no new start, so its publication carries a run id
    // no start names: it belongs to the reviewer's only start of the round.
    const claimed = new Set(all.filter(item => item !== start).map(item => item.agentRunId));
    const onlyStartOfReviewer = all.filter(item => item !== start && item.actualAction === 'agent'
      && roundOfStart(item) === roundOfStart(start) && reviewerOfStart(item.verdictCorrelation) === reviewer).length === 0;
    // A publication that judged another revision than the one the round's reviewer requirement governs is stale
    // evidence, as review authority holds. That revision is the policy's, which may be later than the round's start.
    const governed = reviewerRequirementRevision(round);
    // Only effective judgments count, and the first one stands as in review authority: a later retry or a later
    // failed publication neither replaces nor erases it.
    const judged = round.reviewerResults.filter(result => result.revision === governed && isEffectiveReviewerResult(result));
    const own = judged.find(result => start.agentRunId !== null && result.runId === start.agentRunId)
      ?? judged.find(result => result.reviewerId === reviewer && onlyStartOfReviewer
        && (!result.runId || !claimed.has(result.runId)));
    if (!own || own.decision === 'unknown') { return null; }
    return { kind: own.decision, decidedAt: own.publishedAt, source: 'reviewer',
      findings: own.decision === 'changes-requested' ? own.findings.length : 0 };
  }
  const roundNumber = String(round.number);
  const replaced = later.some(item => item.actualAction === 'agent' && item.verdictCorrelation.startsWith(`review:${roundNumber}:`));
  const decision = replaced ? null : round.decision;
  if (!decision) { return null; }
  return { kind: decision.kind, decidedAt: decision.decidedAt, source: verdictSourceOf(decision)!,
    findings: decision.kind === 'changes-requested' ? decision.findings.length : 0 };
}

function agentOutcome(start: ReviewStartDecision, review: Review | null, facts: ReviewOutcomeFacts,
  later: readonly ReviewStartDecision[], all: readonly ReviewStartDecision[]) {
  const round = correlatedRound(review, start);
  const verdict = agentVerdict(start, round, later, all);
  const run = start.agentRunId === null ? undefined : facts.runs.find(item => item.runId === start.agentRunId);
  return {
    runDurationMs: elapsedMs(run?.startedAt, run?.endedAt),
    reviewMs: elapsedMs(round?.startedAt, verdict?.decidedAt),
    humanWaitMs: null,
    findingCount: verdict?.findings ?? null,
    verdictSource: verdict?.source ?? null,
    passed: verdict ? verdict.kind === 'approved' : null,
    rebuttal: rebuttalAnswered(review, round),
  };
}

function humanOutcome(start: ReviewStartDecision, review: Review | null, later: readonly ReviewStartDecision[]) {
  const decided = humanDecisionAfter(review, start.recordedAt, later[0]?.recordedAt ?? null);
  const decision = decided?.decision ?? null;
  return {
    runDurationMs: null, reviewMs: null,
    humanWaitMs: elapsedMs(start.recordedAt, decided?.decidedAt),
    findingCount: decision?.kind === 'changes-requested' ? decision.findings.length : null,
    verdictSource: decided ? 'operator' as const : null,
    passed: decided ? false : null, // only operator rejections are decisions; approval by merge stays unobserved
    rebuttal: null,
  };
}

/** How one agent or human review start ended, from stored records only; tests runs keep their duration in verification.attempt. */
export function settledReviewStartOutcome(start: ReviewStartDecision, facts: ReviewOutcomeFacts,
  later: readonly ReviewStartDecision[] = [], all: readonly ReviewStartDecision[] = [start, ...later]): ReviewStartOutcomeInput | null {
  if (start.actualAction === 'tests') { return null; }
  const observed = start.actualAction === 'agent' ? agentOutcome(start, facts.review, facts, later, all) : humanOutcome(start, facts.review, later);
  return { startKey: start.idempotencyKey, missionId: start.missionId, changeIdentity: start.changeIdentity,
    actualAction: start.actualAction, ...observed };
}

function roundOfStart(start: ReviewStartDecision): number | null {
  const round = /^review:(\d+):/.exec(start.verdictCorrelation)?.[1];
  return round === undefined ? null : Number(round);
}

/**
 * Whether a start with no stored verdict can no longer gain one, so its nulls are
 * final. A live co-reviewer of the same round is not over just because a peer started
 * after it: an agent start is over once its own run has ended, the same reviewer
 * started again, or a later round began. A human handoff is over once any later
 * action started.
 */
function startEnded(start: ReviewStartDecision, facts: ReviewOutcomeFacts, later: readonly ReviewStartDecision[]): boolean {
  if (start.actualAction !== 'agent') { return later.length > 0; }
  const round = roundOfStart(start);
  const reviewer = reviewerOfStart(start.verdictCorrelation);
  if (later.some(item => item.actualAction === 'agent' && reviewerOfStart(item.verdictCorrelation) === reviewer
    && roundOfStart(item) === round)) { return true; }
  if (later.some(item => (roundOfStart(item) ?? 0) > (round ?? 0))) { return true; }
  return facts.runs.some(run => run.runId === start.agentRunId && run.endedAt !== null);
}

/**
 * Settle every start whose verdict is stored or which can no longer gain one;
 * a start still in flight waits and is settled by a later pass with its real values. A settlement is failure-isolated
 * and bounded: it can only report, never fail or hold the review loop that started
 * the action. A write that outlives the bound may still land; the idempotent key
 * keeps a later replay from duplicating it.
 */
export async function settleReviewStartOutcomes(missionId: MissionId, ports: ReviewStartPolicyPorts,
  deadlineMs: number): Promise<void> {
  await settleWithin(ports, deadlineMs, 'review-start outcome settlement', async () => {
    const facts = await ports.readOutcomeFacts(missionId);
    await ports.writer.settleReviewStartOutcomes(missionId, (start, later, all) => {
      // The Mission slug is not repository-unique, and these facts are this repository's: never settle a foreign start.
      if (ownedByOtherRepository(start, ports)) { return null; }
      // Another repository's later or concurrent starts neither end, replace nor bound this repository's starts.
      const own = (starts: readonly ReviewStartDecision[]) => starts.filter(item => !ownedByOtherRepository(item, ports));
      const ownLater = own(later);
      const outcome = settledReviewStartOutcome(start, facts, ownLater, own(all));
      if (outcome === null) { return null; }
      if (outcome.verdictSource === null && !startEnded(start, facts, ownLater)) { return null; }
      // The rebuttal verdict is the round's settled decision: wait for it rather than freeze an unknown.
      if (outcome.rebuttal !== null && awaitsDecision(start, facts)) { return null; }
      return { ...outcome, repositoryId: start.repositoryId };
    });
  });
}

function ownedByOtherRepository(start: ReviewStartDecision, ports: Pick<ReviewStartPolicyPorts, 'repositoryId'>): boolean {
  return ports.repositoryId !== undefined && start.repositoryId !== undefined && start.repositoryId !== ports.repositoryId;
}

/** An integration tests action has no review round: its outcome is the verdict of the gate run it started, matched by gate run id. */
function testsOutcome(start: ReviewStartDecision, passed: boolean): ReviewStartOutcomeInput {
  return { startKey: start.idempotencyKey, repositoryId: start.repositoryId, missionId: start.missionId,
    changeIdentity: start.changeIdentity, actualAction: 'tests', runDurationMs: null, reviewMs: null, humanWaitMs: null, findingCount: null, verdictSource: null, passed, rebuttal: null };
}

/**
 * Record how the integration gate run of a tests start ended. A cancelled run reached no verdict and records nothing, so
 * its start stays an unknown outcome. Failure-isolated and bounded like every other settlement.
 */
export async function settleTestsStartOutcome(missionId: MissionId, gateRunId: string, passed: boolean,
  ports: ReviewStartPolicyPorts, deadlineMs: number): Promise<void> {
  await settleWithin(ports, deadlineMs, 'tests outcome settlement', async () => {
    await ports.writer.settleReviewStartOutcomes(missionId, start =>
      start.actualAction === 'tests' && start.gateRunId === gateRunId && !ownedByOtherRepository(start, ports)
        ? testsOutcome(start, passed) : null);
  });
}

async function settleWithin(ports: Pick<ReviewStartPolicyPorts, 'diagnostic'>, deadlineMs: number, label: string,
  settle: () => Promise<void>): Promise<void> {
  const report = (failure: ReviewStartFailure) => { try { ports.diagnostic(failure); } catch { /* Diagnostics cannot steer the mission. */ } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timed-out'>(resolve => {
    timer = setTimeout(() => resolve('timed-out'), deadlineMs);
    timer.unref?.();
  });
  try {
    if (await Promise.race([settle().then(() => 'settled' as const), timeout]) === 'timed-out') {
      report({ kind: 'observation-timeout', message: `${label} exceeded ${deadlineMs} ms` });
    }
  } catch (error) {
    report({ kind: 'writer-failure', message: error instanceof Error ? error.message : String(error) });
  } finally { if (timer !== undefined) { clearTimeout(timer); } }
}
