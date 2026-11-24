import test from 'node:test';
import assert from 'node:assert/strict';
import type { IdempotentOperationalHistoryRepository, OperationalHistoryEntry } from '../../../../src/application/ports/operation-history.js';
import type { ReviewOutcomeFacts, ReviewStartDecision, ReviewStartDecisionInput, ReviewStartFailure,
  ReviewStartOutcome, ReviewStartPolicyPorts } from '../../../../src/application/ports/verification-policy.js';
import { OperationalHistoryService } from '../../../../src/application/services/operational-history-service.js';
import { reviewStartDecision } from '../../../../src/application/verification-policy/review-start-decision.js';
import { REVIEW_START_OUTCOME_EVENT, settleReviewStartOutcomes, settleTestsStartOutcome,
  settledReviewStartOutcome } from '../../../../src/application/verification-policy/review-start-outcome.js';
import { changeRevision, reviewFindingId, type Review, type ReviewRound, type ReviewerDecision } from '../../../../src/domain/review.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';

const MISSION = missionId('task-2867.06');

function input(overrides: Partial<ReviewStartDecisionInput> = {}): ReviewStartDecisionInput {
  return { missionId: MISSION, repositoryId: repositoryId('repository-1'), changeIdentity: 'patch-1',
    artifactSha256: 'hash', recommendedAction: 'agent',
    predictedPassProbability: { agent: 0.5, human: 0.5, tests: 0.5 }, actualAction: 'agent', operatorOverride: false,
    verdictCorrelation: 'review:1:agent:claude-verdict', agentRunId: 'run-1', gateRunId: null, operationId: null,
    failureReason: null, ...overrides };
}

function start(overrides: Partial<ReviewStartDecisionInput> = {}, sequence = 1): ReviewStartDecision {
  const decision = reviewStartDecision(input(overrides), sequence, null);
  return { ...decision, recordedAt: '2026-10-01T00:00:30Z' };
}

/** The shared fixture's round 1 is a reviewer request-changes (one finding) started 00:00:00, decided 00:01:00. */
function review(): Review { return repeatReview(); }
function withDecision(base: Review, round: number, decision: ReviewerDecision | null): Review {
  const decide = (item: ReviewRound): ReviewRound => (item.number === round ? { ...item, decision } : item);
  const [first, ...rest] = base.rounds;
  return { ...base, rounds: [decide(first), ...rest.map(decide)] };
}
function facts(overrides: Partial<ReviewOutcomeFacts> = {}): ReviewOutcomeFacts {
  return { review: review(), runs: [{ runId: 'run-1', startedAt: '2026-10-01T00:00:05Z', endedAt: '2026-10-01T00:00:50Z' }], ...overrides };
}

function historyRepository() {
  const entries: OperationalHistoryEntry[] = [];
  const keys = new Set<string>();
  const repository = {
    findAll: async () => entries,
    findByType: async type => entries.filter(entry => entry.eventType === type),
    findByTypeForMission: async (type, mission) => entries.filter(entry => entry.eventType === type
      && (JSON.parse(entry.eventData) as { missionId?: string }).missionId === mission),
    append: async entry => { entries.push(entry); },
    appendIdempotent: async (entry, key) => { if (keys.has(key)) { return false; } keys.add(key); entries.push(entry); return true; },
    clear: async () => { entries.length = 0; keys.clear(); },
  } satisfies IdempotentOperationalHistoryRepository;
  return { entries, repository };
}

function outcomes(entries: readonly OperationalHistoryEntry[]): ReviewStartOutcome[] {
  return entries.filter(entry => entry.eventType === REVIEW_START_OUTCOME_EVENT)
    .map(entry => JSON.parse(entry.eventData) as ReviewStartOutcome);
}

const approval = (overrides: Partial<Extract<ReviewerDecision, { kind: 'approved' }>> = {}): ReviewerDecision => ({
  kind: 'approved', decidedAt: '2026-10-01T00:04:00Z', comment: null, source: { kind: 'local' }, ...overrides });

test('per-run duration comes from the run record and stays null without a recorded end (TASK-2867.06)', () => {
  assert.equal(settledReviewStartOutcome(start(), facts())?.runDurationMs, 45_000);
  const unfinished = facts({ runs: [{ runId: 'run-1', startedAt: '2026-10-01T00:00:05Z', endedAt: null }] });
  assert.equal(settledReviewStartOutcome(start(), unfinished)?.runDurationMs, null, 'a run that never finished has no duration');
  assert.equal(settledReviewStartOutcome(start(), facts({ runs: [] }))?.runDurationMs, null, 'no run record is unknown, not zero');
  assert.equal(settledReviewStartOutcome(start({ agentRunId: null }), facts())?.runDurationMs, null, 'no run id is unknown');
  const reversed = facts({ runs: [{ runId: 'run-1', startedAt: '2026-10-01T00:00:50Z', endedAt: '2026-10-01T00:00:05Z' }] });
  assert.equal(settledReviewStartOutcome(start(), reversed)?.runDurationMs, null, 'an impossible window is unknown, not negative');
});

test('human wait is measured from the handoff to the operator decision and review time from the round (TASK-2867.06)', () => {
  assert.equal(settledReviewStartOutcome(start(), facts())?.reviewMs, 60_000, 'agent review time is round start to decision');
  const operator = withDecision(review(), 1, { kind: 'changes-requested', decidedAt: '2026-10-01T01:00:30Z', comment: null,
    source: { kind: 'operator', author: 'magnus' }, findings: [{ id: reviewFindingId('F1'), summary: 's', location: null }] });
  const human = start({ actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:1:human-verdict' });
  const settled = settledReviewStartOutcome(human, facts({ review: operator }));
  assert.equal(settled?.humanWaitMs, 3_600_000, 'handoff recorded 00:00:30, operator decided 01:00:30');
  assert.equal(settled?.reviewMs, null, 'a human start has no agent review time');
  assert.equal(settled?.passed, false, 'an operator rejection after the handoff is an observed not-passed (TASK-2867.07)');
});

test('the matched pass outcome is observed for agent verdicts and unknown when unobservable (TASK-2867.07)', () => {
  const human = start({ actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:1:human-verdict' });
  assert.equal(settledReviewStartOutcome(start(), facts())?.passed, false, 'a changes-requested verdict is not a pass');
  assert.equal(settledReviewStartOutcome(start(), facts({ review: withDecision(review(), 1, approval()) }))?.passed, true);
  assert.equal(settledReviewStartOutcome(start(), facts({ review: withDecision(review(), 1, null) }))?.passed, null, 'no verdict is unknown');
  assert.equal(settledReviewStartOutcome(human, facts())?.passed, null, 'approval by merge leaves no decision, never an inferred pass');
});

test('an unobservable human wait is null, never zero or an estimate (TASK-2867.06)', () => {
  const human = start({ actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:1:human-verdict' });
  const noDecision = settledReviewStartOutcome(human, facts());
  assert.equal(noDecision?.humanWaitMs, null, 'approval by merge leaves no operator decision to time');
  assert.equal(noDecision?.findingCount, null);
  assert.equal(noDecision?.verdictSource, null);
  const invalidStart = { ...human, recordedAt: 'not-a-time' };
  const operator = withDecision(review(), 1, { kind: 'changes-requested', decidedAt: '2026-10-01T01:00:30Z', comment: null,
    source: { kind: 'operator', author: 'magnus' }, findings: [{ id: reviewFindingId('F1'), summary: 's', location: null }] });
  assert.equal(settledReviewStartOutcome(invalidStart, facts({ review: operator }))?.humanWaitMs, null, 'no valid start time is unknown');
  assert.equal(settledReviewStartOutcome(start(), facts({ review: withDecision(review(), 1, null) }))?.reviewMs, null,
    'an undecided round has no review time');
});

test('same-revision re-run is recorded on the start row and unknown without a change identity (TASK-2867.06)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  await service.recordReviewStartDecision(input({ agentRunId: 'run-1', verdictCorrelation: 'review:1:agent:claude-verdict' }));
  await service.recordReviewStartDecision(input({ agentRunId: 'run-2', verdictCorrelation: 'review:2:agent:claude-verdict' }));
  await service.recordReviewStartDecision(input({ actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:2:human-verdict' }));
  await service.recordReviewStartDecision(input({ changeIdentity: null, agentRunId: 'run-3', verdictCorrelation: 'review:3:agent:claude-verdict' }));
  await service.recordReviewStartDecision(input({ changeIdentity: 'patch-2', agentRunId: 'run-4', verdictCorrelation: 'review:4:agent:claude-verdict' }));
  await service.recordReviewStartDecision(input({ agentRunId: 'run-5', verdictCorrelation: 'review:2:agent:custom-verdict' }));
  assert.deepEqual(entries.map(entry => (JSON.parse(entry.eventData) as ReviewStartDecision).sameRevisionRerun),
    [false, true, false, null, false, false],
    'first start, same reviewer again, first human start, unknown identity, new change, an independent co-reviewer of the same change is no re-run');
});

test('findings per attempt counts the stored findings and is null without a decision (TASK-2867.06)', () => {
  assert.equal(settledReviewStartOutcome(start(), facts())?.findingCount, 1);
  assert.equal(settledReviewStartOutcome(start(), facts({ review: withDecision(review(), 1, approval()) }))?.findingCount, 0,
    'an observed approval has no findings');
  assert.equal(settledReviewStartOutcome(start(), facts({ review: withDecision(review(), 1, null) }))?.findingCount, null,
    'no decision is unknown, not an empty list');
  assert.equal(settledReviewStartOutcome(start({ verdictCorrelation: 'review:9:agent:claude-verdict' }), facts())?.findingCount, null,
    'a start whose round is not stored is unknown');
  assert.equal(settledReviewStartOutcome(start({ verdictCorrelation: 'unparsable' }), facts())?.findingCount, null);
});

test('verdict source names who decided and is null when no decision is stored (TASK-2867.06)', () => {
  const source = (decision: ReviewerDecision | null) => settledReviewStartOutcome(start(),
    facts({ review: withDecision(review(), 1, decision) }))?.verdictSource;
  assert.equal(source(null), null, 'no decision has no source');
  assert.equal(source(approval()), 'local');
  assert.equal(source(approval({ source: { kind: 'provider', provider: 'forgejo' } })), 'provider');
  assert.equal(source({ kind: 'changes-requested', decidedAt: '2026-10-01T00:01:00Z', comment: null, findings: [] }), 'reviewer');
  assert.equal(source({ kind: 'changes-requested', decidedAt: '2026-10-01T00:01:00Z', comment: null, findings: [],
    source: { kind: 'operator', author: 'magnus' } }), 'operator');
});

test('a replaced reviewer of the same round is not credited with the verdict of the reviewer that finished it (TASK-2867.06)', () => {
  const replaced = start({ agentRunId: 'run-0', verdictCorrelation: 'review:1:agent:qwen-verdict' });
  const finisher = start({ verdictCorrelation: 'review:1:agent:claude-verdict' }, 2);
  assert.equal(settledReviewStartOutcome(finisher, facts())?.verdictSource, 'reviewer', 'the last start of the round owns its verdict');
  const settled = settledReviewStartOutcome(replaced, facts(), [finisher]);
  assert.deepEqual([settled?.reviewMs, settled?.findingCount, settled?.verdictSource, settled?.rebuttal], [null, null, null, null]);
});

test('two independent reviewers of one round each keep their own findings, verdict source and review time (TASK-2867.06)', () => {
  const base = review();
  const publication = (reviewerId: string, runId: string | null, decision: 'approved' | 'changes-requested', publishedAt: string, findings: number) => ({
    publicationId: `p-${reviewerId}`, runId, reviewerId, agentFamily: agentFamily(reviewerId), revision: base.rounds[0]!.subject.revision, decision,
    findings: Array.from({ length: findings }, (_, index) => ({ id: reviewFindingId(`F${index + 1}`), summary: 's', location: null })),
    outcome: 'completed' as const, status: 0, publishedAt });
  const round = { ...base.rounds[0]!, reviewerResults: [
    publication('custom', 'run-custom', 'changes-requested', '2026-10-01T00:00:40Z', 2),
    publication('claude', null, 'approved', '2026-10-01T00:00:50Z', 0)] };
  const both = { ...base, rounds: [round, base.rounds[1]!] } as Review;
  const custom = start({ agentRunId: 'run-custom', verdictCorrelation: 'review:1:agent:custom-verdict' });
  const claude = start({ agentRunId: 'run-claude', verdictCorrelation: 'review:1:agent:claude-verdict' }, 2);
  const first = settledReviewStartOutcome(custom, facts({ review: both }), [claude]);
  const second = settledReviewStartOutcome(claude, facts({ review: both }));
  assert.deepEqual([first?.findingCount, first?.verdictSource, first?.reviewMs], [2, 'reviewer', 40_000],
    'the earlier co-reviewer keeps its own publication although a later start exists in the round');
  assert.deepEqual([second?.findingCount, second?.verdictSource, second?.reviewMs], [0, 'reviewer', 50_000],
    'a publication not yet attributed to a run is matched by reviewer');
  const replaced = start({ agentRunId: 'run-qwen', verdictCorrelation: 'review:1:agent:qwen-verdict' });
  assert.deepEqual([settledReviewStartOutcome(replaced, facts({ review: both }), [claude])?.findingCount,
    settledReviewStartOutcome(replaced, facts({ review: both }), [claude])?.verdictSource], [null, null],
  'a reviewer with no publication of its own decided nothing');
});

test('a publication that is no effective judgment leaves the verdict source and review time unknown (TASK-2867.06)', () => {
  const base = review();
  const published = (overrides: Record<string, unknown>) => ({ ...base, rounds: [{ ...base.rounds[0]!, reviewerResults: [{
    publicationId: 'p', runId: 'run-1', reviewerId: 'claude', agentFamily: agentFamily('claude'), revision: base.rounds[0]!.subject.revision,
    decision: 'approved' as const, findings: [], outcome: 'completed' as const, status: 0, publishedAt: '2026-10-01T00:00:40Z', ...overrides }] }, base.rounds[1]!] }) as Review;
  const settled = (overrides: Record<string, unknown>) => settledReviewStartOutcome(start(), facts({ review: published(overrides) }));
  assert.deepEqual([settled({})?.verdictSource, settled({})?.reviewMs, settled({})?.findingCount], ['reviewer', 40_000, 0], 'an effective publication is a verdict');
  for (const [label, overrides] of [['unknown decision', { decision: 'unknown' }], ['missing output', { outcome: 'missing-output' }],
    ['failed run', { status: 1 }], ['revoked', { revokedAt: '2026-10-01T00:05:00Z' }]] as const) {
    const outcome = settled(overrides);
    assert.deepEqual([outcome?.verdictSource, outcome?.reviewMs, outcome?.findingCount, outcome?.rebuttal], [null, null, null, null], label);
  }
});

test('a human handoff resumed without an operator decision does not inherit a later handoff decision (TASK-2867.06)', () => {
  const operatorAt = (decidedAt: string) => withDecision(review(), 1, { kind: 'changes-requested', decidedAt, comment: null,
    source: { kind: 'operator', author: 'magnus' }, findings: [{ id: reviewFindingId('F1'), summary: 's', location: null }] });
  const human = start({ actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:1:human-verdict' });
  const next = { ...start({ actualAction: 'tests', agentRunId: null, gateRunId: 'gate-1', verdictCorrelation: 'gate-1' }, 2), recordedAt: '2026-10-01T01:00:00Z' };
  assert.equal(settledReviewStartOutcome(human, facts({ review: operatorAt('2026-10-05T00:00:30Z') }), [next])?.humanWaitMs, null,
    'the operator decided four days after the next action started: not this handoff');
  assert.equal(settledReviewStartOutcome(human, facts({ review: operatorAt('2026-10-01T00:30:30Z') }), [next])?.humanWaitMs, 1_800_000,
    'a decision before the next action is this handoff');
  assert.equal(settledReviewStartOutcome(human, facts({ review: operatorAt('2026-10-05T00:00:30Z') }))?.humanWaitMs, 345_600_000,
    'with no later action the decision is the handoff end');
});

test('rebuttal outcome records the renewed verdict on the same revision and is null without one (TASK-2867.06)', () => {
  const base = review();
  const bookkeeping = changeRevision('c'.repeat(40));
  const response = (resolutions: readonly { findingId: ReturnType<typeof reviewFindingId>; kind: 'disputed' | 'fixed' }[]) => ({
    kind: 'resolved' as const, respondedAt: '2026-10-01T00:02:00Z', resultingRevision: bookkeeping,
    resolutions: resolutions.map(item => item.kind === 'disputed' ? { ...item, rationale: 'not a defect' } : { ...item, evidence: 'fixed' }) });
  const disputed = { ...base, rounds: [{ ...base.rounds[0]!, response: response([{ findingId: reviewFindingId('F1'), kind: 'disputed' }]) },
    { ...base.rounds[1]!, subject: { ...base.rounds[0]!.subject, revision: bookkeeping } }] } as Review;
  const second = start({ verdictCorrelation: 'review:2:agent:claude-verdict', agentRunId: 'run-2' }, 2);
  assert.deepEqual(settledReviewStartOutcome(second, facts({ review: disputed }))?.rebuttal,
    { disputedFindings: 1, fixedFindings: 0, renewedVerdict: null }, 'the review that followed has no decision yet');
  assert.deepEqual(settledReviewStartOutcome(second, facts({ review: withDecision(disputed, 2, approval()) }))?.rebuttal,
    { disputedFindings: 1, fixedFindings: 0, renewedVerdict: 'approved' },
    'a head moved by bookkeeping alone, as stored data records it, still answers the rebuttal');
  const mixed = { ...disputed, rounds: [{ ...disputed.rounds[0]!, response: response([
    { findingId: reviewFindingId('F1'), kind: 'disputed' }, { findingId: reviewFindingId('F2'), kind: 'fixed' }]) }, disputed.rounds[1]!] } as Review;
  assert.deepEqual(settledReviewStartOutcome(second, facts({ review: withDecision(mixed, 2, approval()) }))?.rebuttal,
    { disputedFindings: 1, fixedFindings: 1, renewedVerdict: 'approved' }, 'a mixed response is told apart from a pure rebuttal');
  assert.equal(settledReviewStartOutcome(second, facts())?.rebuttal, null, 'a response that disputed nothing is not a rebuttal');
  const rebound = { ...disputed, rounds: [disputed.rounds[0]!, base.rounds[1]!] } as Review;
  assert.equal(settledReviewStartOutcome(second, facts({ review: withDecision(rebound, 2, approval()) }))?.rebuttal, null,
    'a follow-up round on a different revision than the response produced is no renewed verdict of that rebuttal');
  assert.equal(settledReviewStartOutcome(start(), facts({ review: disputed }))?.rebuttal, null, 'the first round answers no rebuttal');
});

test('two independent reviewers of a rebuttal both record the settled round decision, not their own publication (TASK-2867.06)', () => {
  const base = review();
  const next = changeRevision('c'.repeat(40));
  const publication = (reviewerId: string, runId: string, decision: 'approved' | 'changes-requested') => ({
    publicationId: `p-${reviewerId}`, runId, reviewerId, agentFamily: agentFamily(reviewerId), revision: next, decision,
    findings: decision === 'approved' ? [] : [{ id: reviewFindingId('F1'), summary: 's', location: null }],
    outcome: 'completed' as const, status: 0, publishedAt: '2026-10-01T00:04:00Z' });
  const split = { ...base, rounds: [{ ...base.rounds[0]!, response: { kind: 'resolved' as const, respondedAt: '2026-10-01T00:02:00Z', resultingRevision: next,
    resolutions: [{ findingId: reviewFindingId('F1'), kind: 'disputed' as const, rationale: 'not a defect' }] } },
  { ...base.rounds[1]!, subject: { ...base.rounds[0]!.subject, revision: next }, reviewerResults: [
    publication('custom', 'run-custom', 'approved'), publication('claude', 'run-claude', 'changes-requested')],
  decision: { kind: 'changes-requested' as const, decidedAt: '2026-10-01T00:04:00Z', comment: null, findings: [] } }] } as Review;
  const custom = start({ agentRunId: 'run-custom', verdictCorrelation: 'review:2:agent:custom-verdict' }, 2);
  const claude = start({ agentRunId: 'run-claude', verdictCorrelation: 'review:2:agent:claude-verdict' }, 3);
  for (const attempt of [custom, claude]) {
    assert.equal(settledReviewStartOutcome(attempt, facts({ review: split }))?.rebuttal?.renewedVerdict, 'changes-requested',
      'any negative reviewer result is the round verdict, so no attempt records an approval after the rebuttal');
  }
  assert.equal(settledReviewStartOutcome(custom, facts({ review: split }))?.verdictSource, 'reviewer');
});

test('a rebuttal verdict is not frozen unknown while its round can still be decided, and a withdrawn approval is no verdict (TASK-2867.06)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const base = review();
  const next = changeRevision('c'.repeat(40));
  const publication = (reviewerId: string, runId: string, decision: 'approved' | 'changes-requested') => ({
    publicationId: `p-${reviewerId}`, runId, reviewerId, agentFamily: agentFamily(reviewerId), revision: next, decision,
    findings: decision === 'approved' ? [] : [{ id: reviewFindingId('F1'), summary: 's', location: null }],
    outcome: 'completed' as const, status: 0, publishedAt: '2026-10-01T00:04:00Z' });
  const roundTwo = (decision: ReviewerDecision | null) => ({ ...base, rounds: [{ ...base.rounds[0]!, response: { kind: 'resolved' as const,
    respondedAt: '2026-10-01T00:02:00Z', resultingRevision: next,
    resolutions: [{ findingId: reviewFindingId('F1'), kind: 'disputed' as const, rationale: 'not a defect' }] } },
  { ...base.rounds[1]!, subject: { ...base.rounds[0]!.subject, revision: next }, decision,
    reviewerResults: [publication('custom', 'run-custom', 'approved')] }] }) as Review;
  let current: ReviewOutcomeFacts = { review: roundTwo(null), runs: [{ runId: 'run-custom', startedAt: '2026-10-01T00:03:00Z', endedAt: '2026-10-01T00:04:00Z' }] };
  const ports = { writer: service, readOutcomeFacts: async () => current, diagnostic: () => {} } as unknown as ReviewStartPolicyPorts;
  await service.recordReviewStartDecision(input({ agentRunId: 'run-custom', verdictCorrelation: 'review:2:agent:custom-verdict' }));
  await service.recordReviewStartDecision(input({ agentRunId: 'run-claude', verdictCorrelation: 'review:2:agent:claude-verdict' }));
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.equal(outcomes(entries).length, 0, 'the first reviewer approved but the round awaits its peer: no row freezes renewedVerdict to null');
  current = { ...current, review: roundTwo({ kind: 'changes-requested', decidedAt: '2026-10-01T00:05:00Z', comment: null, findings: [] }) };
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.equal(outcomes(entries)[0]?.rebuttal?.renewedVerdict, 'changes-requested', 'the settled round decision is recorded once it exists');
  const revoked = settledReviewStartOutcome(start({ agentRunId: 'run-custom', verdictCorrelation: 'review:2:agent:custom-verdict' }, 1),
    facts({ review: roundTwo({ kind: 'approved', decidedAt: '2026-10-01T00:05:00Z', comment: null, source: { kind: 'local' }, revocation: { revokedAt: '2026-10-01T00:06:00Z', revokedBy: 'workflow', reason: 'mission-change-differs',
      cause: { kind: 'review-repair' } } }) }));
  assert.equal(revoked?.rebuttal?.renewedVerdict, null, 'an approval later withdrawn is no renewed verdict');
});

test('a publication that judged another revision than the round leaves findings, verdict source and review time unknown (TASK-2867.06)', () => {
  const base = review();
  const stale = { ...base, rounds: [{ ...base.rounds[0]!, reviewerResults: [{ publicationId: 'p', runId: 'run-1', reviewerId: 'claude',
    agentFamily: agentFamily('claude'), revision: changeRevision('f'.repeat(40)), decision: 'changes-requested' as const,
    findings: [{ id: reviewFindingId('F1'), summary: 's', location: null }], outcome: 'completed' as const, status: 0,
    publishedAt: '2026-10-01T00:00:40Z' }] }, base.rounds[1]!] } as Review;
  const outcome = settledReviewStartOutcome(start(), facts({ review: stale }));
  assert.deepEqual([outcome?.findingCount, outcome?.verdictSource, outcome?.reviewMs], [null, null, null],
    'a completed publication for revision f is no verdict of the round on revision a');
});

test('a publication of the revision the reviewer requirement governs keeps its verdict although the round started on an earlier head (TASK-2867.06)', () => {
  const base = review();
  const launched = changeRevision('b'.repeat(40));
  const publication = (revision: ReturnType<typeof changeRevision>) => ({ publicationId: 'p', runId: 'run-1', reviewerId: 'claude',
    agentFamily: agentFamily('claude'), revision, decision: 'changes-requested' as const,
    findings: [{ id: reviewFindingId('F1'), summary: 's', location: null }], outcome: 'completed' as const, status: 0,
    publishedAt: '2026-10-01T00:00:40Z' });
  const round = (revision: ReturnType<typeof changeRevision>) => ({ ...base, rounds: [{ ...base.rounds[0]!,
    reviewerPolicy: { revision: launched, mode: 'one-independent' as const, requiredApprovals: 1, selected: [agentFamily('claude')],
      independentAvailable: 1, unavailable: [], fallbackReason: null },
    reviewerResults: [publication(revision)] }, base.rounds[1]!] }) as Review;
  const governed = settledReviewStartOutcome(start(), facts({ review: round(launched) }));
  assert.deepEqual([governed?.findingCount, governed?.verdictSource, governed?.reviewMs], [1, 'reviewer', 40_000],
    'the head moved between round start and reviewer launch: the publication judged the governed revision');
  const stale = settledReviewStartOutcome(start(), facts({ review: round(base.rounds[0]!.subject.revision) }));
  assert.deepEqual([stale?.findingCount, stale?.verdictSource], [null, null],
    'a publication of the round start revision judged neither the governed revision nor anything current');
});

test('a later retry or failed publication neither replaces nor erases the first effective verdict of a reviewer (TASK-2867.06)', () => {
  const base = review();
  const revision = base.rounds[0]!.subject.revision;
  const publication = (id: string, decision: 'approved' | 'changes-requested', overrides: Record<string, unknown> = {}) => ({
    publicationId: id, runId: 'run-1', reviewerId: 'claude', agentFamily: agentFamily('claude'), revision, decision,
    findings: decision === 'approved' ? [] : [{ id: reviewFindingId('F1'), summary: 's', location: null }],
    outcome: 'completed' as const, status: 0, publishedAt: '2026-10-01T00:00:40Z', ...overrides });
  const round = (...results: ReturnType<typeof publication>[]) => ({ ...base, rounds: [{ ...base.rounds[0]!, reviewerResults: results }, base.rounds[1]!] }) as Review;
  const contradicted = settledReviewStartOutcome(start(), facts({ review: round(publication('first', 'approved'),
    publication('retry', 'changes-requested', { publishedAt: '2026-10-01T00:00:50Z' })) }));
  assert.deepEqual([contradicted?.findingCount, contradicted?.reviewMs], [0, 40_000], 'the first effective publication stands, as in review authority');
  const erased = settledReviewStartOutcome(start(), facts({ review: round(publication('first', 'approved'),
    publication('late', 'approved', { outcome: 'missing-output', status: 1, publishedAt: '2026-10-01T00:00:55Z' })) }));
  assert.deepEqual([erased?.findingCount, erased?.verdictSource], [0, 'reviewer'], 'a later failed publication does not erase the real verdict');
  const earlierFailed = settledReviewStartOutcome(start(), facts({ review: round(publication('failed', 'approved', { outcome: 'missing-output', status: 1 }),
    publication('retry', 'changes-requested', { publishedAt: '2026-10-01T00:00:50Z' })) }));
  assert.equal(earlierFailed?.findingCount, 1, 'an invalid earlier publication is skipped for the first effective one');
});

test('a reviewer relaunched to recover output keeps its publication under its only start of the round (TASK-2867.06)', () => {
  const base = review();
  const recovered = { ...base, rounds: [{ ...base.rounds[0]!, reviewerResults: [{ publicationId: 'p', runId: 'run-recovery', reviewerId: 'claude',
    agentFamily: agentFamily('claude'), revision: base.rounds[0]!.subject.revision, decision: 'changes-requested' as const,
    findings: [{ id: reviewFindingId('F1'), summary: 's', location: null }], outcome: 'completed' as const, status: 0,
    publishedAt: '2026-10-01T00:00:40Z' }] }, base.rounds[1]!] } as Review;
  const only = start({ agentRunId: 'run-1', verdictCorrelation: 'review:1:agent:claude-verdict' });
  assert.equal(settledReviewStartOutcome(only, facts({ review: recovered }), [], [only])?.findingCount, 1,
    'the recovery run id names no start, so the publication is the only start\'s');
  const retry = start({ agentRunId: 'run-3', verdictCorrelation: 'review:1:agent:claude-verdict' }, 2);
  assert.equal(settledReviewStartOutcome(only, facts({ review: recovered }), [retry], [only, retry])?.findingCount, null,
    'with two starts of the same reviewer the unattributed publication cannot be assigned');
});

test('settling stores one outcome per decided or superseded start and replays add nothing (TASK-2867.06)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  await service.recordReviewStartDecision(input());
  const failures: ReviewStartFailure[] = [];
  const ports = { writer: service, readOutcomeFacts: async () => facts(), diagnostic: (failure: ReviewStartFailure) => { failures.push(failure); } } as unknown as ReviewStartPolicyPorts;
  await settleReviewStartOutcomes(MISSION, ports, 250);
  await settleReviewStartOutcomes(MISSION, ports, 250);
  await settleReviewStartOutcomes(MISSION, { ...ports, writer: new OperationalHistoryService(repository) }, 250);
  assert.equal(outcomes(entries).length, 1, 'replay, restart and a second writer add no second row');
  assert.deepEqual(failures, []);
  assert.equal(outcomes(entries)[0]?.findingCount, 1);
});

test('a still-running start waits for its verdict and a superseded one settles with nulls (TASK-2867.06)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const running = facts({ review: withDecision(review(), 1, null), runs: [] });
  const ports = { writer: service, readOutcomeFacts: async () => running, diagnostic: () => {} } as unknown as ReviewStartPolicyPorts;
  await service.recordReviewStartDecision(input());
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.equal(outcomes(entries).length, 0, 'no verdict and no later start: nothing is settled yet');
  await service.recordReviewStartDecision(input({ agentRunId: 'run-2', verdictCorrelation: 'review:2:agent:claude-verdict' }));
  await settleReviewStartOutcomes(MISSION, ports, 250);
  const [settled] = outcomes(entries);
  assert.equal(outcomes(entries).length, 1);
  assert.deepEqual([settled?.runDurationMs, settled?.reviewMs, settled?.findingCount, settled?.verdictSource, settled?.rebuttal],
    [null, null, null, null, null], 'a superseded start with no stored verdict keeps every value unknown');
});

test('a live co-reviewer is settled only once its own verdict or run end is stored, never frozen to nulls by its peer starting (TASK-2867.06)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const base = review();
  const open = { ...base, rounds: [{ ...base.rounds[0]!, decision: null }, base.rounds[1]!] } as Review;
  const publication = (reviewerId: string, runId: string, findings: number) => ({
    publicationId: `p-${reviewerId}`, runId, reviewerId, agentFamily: agentFamily(reviewerId), revision: base.rounds[0]!.subject.revision,
    decision: 'changes-requested' as const, outcome: 'completed' as const, status: 0, publishedAt: '2026-10-01T00:01:40Z',
    findings: Array.from({ length: findings }, (_, index) => ({ id: reviewFindingId(`F${index + 1}`), summary: 's', location: null })) });
  let current: ReviewOutcomeFacts = { review: open, runs: [
    { runId: 'run-custom', startedAt: '2026-10-01T00:00:05Z', endedAt: null }, { runId: 'run-claude', startedAt: '2026-10-01T00:00:06Z', endedAt: null }] };
  const ports = { writer: service, readOutcomeFacts: async () => current, diagnostic: () => {} } as unknown as ReviewStartPolicyPorts;
  await service.recordReviewStartDecision(input({ agentRunId: 'run-custom', verdictCorrelation: 'review:1:agent:custom-verdict' }));
  await service.recordReviewStartDecision(input({ agentRunId: 'run-claude', verdictCorrelation: 'review:1:agent:claude-verdict' }));
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.equal(outcomes(entries).length, 0, 'both reviewers are still running: the earlier start is not frozen to nulls');
  current = { review: { ...open, rounds: [{ ...open.rounds[0]!, reviewerResults: [publication('custom', 'run-custom', 2)] }, open.rounds[1]!] } as Review,
    runs: [{ runId: 'run-custom', startedAt: '2026-10-01T00:00:05Z', endedAt: '2026-10-01T00:01:40Z' },
      { runId: 'run-claude', startedAt: '2026-10-01T00:00:06Z', endedAt: null }] };
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.deepEqual(outcomes(entries).map(row => [row.startKey.endsWith(':1'), row.findingCount, row.runDurationMs, row.verdictSource]),
    [[true, 2, 95_000, 'reviewer']], 'the first reviewer settles with its own values once it published');
  current = { review: { ...open, rounds: [{ ...open.rounds[0]!, reviewerResults: [publication('custom', 'run-custom', 2)] }, open.rounds[1]!] } as Review,
    runs: [...current.runs.slice(0, 1), { runId: 'run-claude', startedAt: '2026-10-01T00:00:06Z', endedAt: '2026-10-01T00:01:41Z' }] };
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.deepEqual(outcomes(entries).map(row => [row.findingCount, row.verdictSource]), [[2, 'reviewer'], [null, null]],
    'a reviewer whose run ended with no publication of its own decided nothing');
});

test('a failing outcome read or write is reported through the diagnostic channel and never throws (TASK-2867.06)', async () => {
  const failures: ReviewStartFailure[] = [];
  const diagnostic = (failure: ReviewStartFailure) => { failures.push(failure); };
  const broken = { writer: { settleReviewStartOutcomes: async () => { throw new Error('database unavailable'); } },
    readOutcomeFacts: async () => facts(), diagnostic } as unknown as ReviewStartPolicyPorts;
  await settleReviewStartOutcomes(MISSION, broken, 250);
  const unreadable = { writer: { settleReviewStartOutcomes: async () => 0 },
    readOutcomeFacts: async () => { throw new Error('run history unreadable'); }, diagnostic } as unknown as ReviewStartPolicyPorts;
  await settleReviewStartOutcomes(MISSION, unreadable, 250);
  const slow = { writer: { settleReviewStartOutcomes: async () => 0 }, readOutcomeFacts: () => new Promise<never>(() => {}),
    diagnostic } as unknown as ReviewStartPolicyPorts;
  await settleReviewStartOutcomes(MISSION, slow, 5);
  await settleReviewStartOutcomes(MISSION, { ...broken, diagnostic: () => { throw new Error('diagnostic output failed'); } }, 250);
  assert.deepEqual(failures.map(failure => failure.kind), ['writer-failure', 'writer-failure', 'observation-timeout']);
});

test('tests actions settle no review outcome (TASK-2867.06)', () => {
  const tests = start({ actualAction: 'tests', agentRunId: null, gateRunId: 'gate-1', verdictCorrelation: 'gate-1' });
  assert.equal(settledReviewStartOutcome(tests, facts()), null, 'their duration stays in the verification.attempt measurements');
});

test('a tests start settles the verdict of its own gate run, once, and never another start (TASK-2867.07)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const failures: ReviewStartFailure[] = [];
  const ports = { writer: service, readOutcomeFacts: async () => facts(), diagnostic: (failure: ReviewStartFailure) => { failures.push(failure); } } as unknown as ReviewStartPolicyPorts;
  const tests = (gateRunId: string, changeIdentity: string) => input({ actualAction: 'tests', agentRunId: null, gateRunId, verdictCorrelation: gateRunId, changeIdentity });
  await service.recordReviewStartDecision(tests('gate-1', 'patch-1'));
  await service.recordReviewStartDecision(tests('gate-2', 'patch-2'));
  await settleTestsStartOutcome(MISSION, 'gate-1', false, ports, 250);
  await settleTestsStartOutcome(MISSION, 'gate-1', true, ports, 250);
  await settleTestsStartOutcome(MISSION, 'gate-unknown', true, ports, 250);
  const rows = outcomes(entries);
  assert.deepEqual(rows.map(row => [row.actualAction, row.passed]), [['tests', false]], 'one row for the matched start; a replay or an unknown run adds none');
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.equal(outcomes(entries).length, 1, 'the review settlement leaves tests starts alone');
  assert.deepEqual(failures, []);
});

test('a start of another repository with the same Mission slug is never settled from these facts (PX-0066 round 23 F1)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const ports = { repositoryId: repositoryId('repository-1'), writer: service, readOutcomeFacts: async () => facts(),
    diagnostic: () => {} } as unknown as ReviewStartPolicyPorts;
  await service.recordReviewStartDecision(input({ agentRunId: 'run-1' }));
  await service.recordReviewStartDecision(input({ repositoryId: repositoryId('repository-2'), agentRunId: 'run-other',
    verdictCorrelation: 'review:1:agent:codex-verdict' }));
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.deepEqual(outcomes(entries).map(row => row.repositoryId), [repositoryId('repository-1')],
    'only this repository start is settled, and its row names its owner');
});

test('another repository start never bounds or ends a local start while its outcome settles (PX-0066 round 25 F2)', async () => {
  const human = start({ actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:1:human-verdict' });
  const foreign = { ...start({ repositoryId: repositoryId('repository-2'), actualAction: 'human', agentRunId: null,
    verdictCorrelation: 'review:1:human-verdict' }, 2), recordedAt: '2026-10-01T00:00:40Z' };
  const decided = withDecision(review(), 1, { kind: 'changes-requested', source: { kind: 'operator', author: 'operator' },
    decidedAt: '2026-10-01T00:02:00Z', comment: null, findings: [] });
  const written: (ReviewStartOutcome | { startKey: string; humanWaitMs: number | null; verdictSource: string | null; passed?: boolean | null } | null)[] = [];
  const writer = { settleReviewStartOutcomes: async (_mission: unknown, build: (a: ReviewStartDecision, b: readonly ReviewStartDecision[], c: readonly ReviewStartDecision[]) => unknown) => {
    const all = [human, foreign];
    all.forEach((item, index) => written.push(build(item, all.slice(index + 1), all) as never));
    return 0;
  } };
  const ports = { repositoryId: repositoryId('repository-1'), writer, readOutcomeFacts: async () => facts({ review: decided }),
    diagnostic: () => {} } as unknown as ReviewStartPolicyPorts;
  await settleReviewStartOutcomes(MISSION, ports, 250);
  assert.equal(written[1], null, 'the foreign start is never settled here');
  assert.deepEqual([written[0]?.humanWaitMs, written[0]?.verdictSource, written[0]?.passed], [90_000, 'operator', false],
    'the local operator rejection keeps its wait although a foreign start followed the handoff');
});
