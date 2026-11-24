import type { OperationalHistoryEntry } from '../ports/operation-history.js';
import type { HumanReviewWithdrawal, PolicyLoadResult, ReviewStartDecision, ReviewStartOutcome } from '../ports/verification-policy.js';
import type { PolicyAction, PolicyRoundPlan } from '../verification-policy/policy-artifact.js';
import { HUMAN_REVIEW_WITHDRAWAL_EVENT, REVIEW_START_DECISION_EVENT } from '../verification-policy/review-start-decision.js';
import { REVIEW_START_OUTCOME_EVENT } from '../verification-policy/review-start-outcome.js';
import type { BoardLaneEventEntry } from '../ports/operation-history.js';
import { REVIEW_ACTION_STARTED_EVENT, type ReviewActionStarted } from '../ports/review-action-history.js';
import type { ObservationDiagnostic } from './verification-diagnostic.js';
import { compareCodeUnits } from '../../domain/comparators.js';

export type FlowConfiguredPolicy =
  | { readonly kind: 'artifact'; readonly artifactSha256: string; readonly roundPlan: PolicyRoundPlan;
    readonly fallbackReason: null }
  | { readonly kind: 'fixed'; readonly artifactSha256: null; readonly roundPlan: null;
    readonly fallbackReason: Extract<PolicyLoadResult, { kind: 'fixed' }>['reason'] | 'unavailable' };

export interface FlowVerificationRequest {
  readonly action: PolicyAction;
  readonly startKey: string;
  readonly gateRunId: string | null;
  readonly startedAt: string;
  readonly outcomeAt: string | null;
  readonly passed: boolean | null;
  readonly sameRevisionRerun: boolean | null;
}

export type FlowHumanJoinState = 'ready' | 'later' | 'pending' | 'withdrawn' | 'timing-unavailable';
export type FlowPolicyExecution = 'pilot' | 'fallback' | 'shadow' | 'unobserved';

/** One same-change retained policy round. Nothing here is inferred from current configuration. */
export interface FlowVerificationRound {
  readonly id: string;
  readonly changeIdentity: string;
  /** Shared workflow authority for all retained starts; null never establishes a gate-batch join. */
  readonly operationId: string | null;
  readonly artifactSha256: string | null;
  readonly round: number;
  readonly execution: FlowPolicyExecution;
  readonly requests: Readonly<Record<PolicyAction, FlowVerificationRequest | null>>;
  /** Every retained tests start in this round, including same-revision reruns, for gate-batch attribution. */
  readonly testRequests: readonly FlowVerificationRequest[];
  /** True only when all three starts preceded either automated settlement. Start order alone is insufficient. */
  readonly concurrent: boolean;
  readonly join: {
    readonly at: string;
    readonly passed: boolean;
    readonly failed: readonly Exclude<PolicyAction, 'human'>[];
  } | null;
  /** `approvedAt` is set only when a retained operator approval submission is followed by its committed integration approval transition; landing alone never sets it. */
  readonly human: { readonly state: FlowHumanJoinState; readonly answeredAt: string | null; readonly approvedAt: string | null };
  readonly withdrawalAt: string | null;
  readonly sameRevisionTestReruns: number;
}

interface ParsedRows {
  readonly starts: ReviewStartDecision[];
  readonly outcomes: Map<string, ReviewStartOutcome>;
  readonly withdrawals: HumanReviewWithdrawal[];
  readonly approvals: ReviewActionStarted[];
  readonly lifecycle: readonly BoardLaneEventEntry[];
  readonly diagnostics: ObservationDiagnostic[];
}

const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

function diagnostic(repositoryId: string, missionId: string, sourceId: string | null, message: string): ObservationDiagnostic {
  return { kind: 'provenance', state: 'absent', repositoryId, missionId, operationId: null, sourceId,
    stage: 'verification-round', message, recovery: 'inspect retained verification policy start, outcome and withdrawal rows' };
}

function readStart(record: Partial<ReviewStartDecision>, repositoryId: string,
  diagnostics: ObservationDiagnostic[]): ReviewStartDecision | null {
  if (record.schemaVersion !== 1) { return null; }
  const mission = typeof record.missionId === 'string' && record.missionId ? record.missionId : 'unknown';
  if (!record.idempotencyKey || !record.changeIdentity || !validTime(record.recordedAt)
    || !['tests', 'agent', 'human'].includes(String(record.actualAction))) {
    diagnostics.push(diagnostic(repositoryId, mission, record.idempotencyKey ?? null,
      'Incomplete verification start row excluded from FLOW'));
    return null;
  }
  return record.repositoryId === repositoryId ? record as ReviewStartDecision : null;
}

function readOutcome(record: Partial<ReviewStartOutcome>, repositoryId: string,
  outcomes: Map<string, ReviewStartOutcome>, quarantined: Set<string>, diagnostics: ObservationDiagnostic[]): void {
  if (record.schemaVersion !== 1) { return; }
  // Outcome rows are read across repositories; one that names another repository's start is not this repository's evidence.
  if (record.repositoryId !== undefined && record.repositoryId !== repositoryId) { return; }
  const mission = typeof record.missionId === 'string' && record.missionId ? record.missionId : 'unknown';
  if (!record.startKey || !validTime(record.recordedAt)) {
    diagnostics.push(diagnostic(repositoryId, mission, record.startKey ?? null,
      'Incomplete verification outcome row excluded from FLOW'));
  } else if (outcomes.has(record.startKey) || quarantined.has(record.startKey)) {
    // Which duplicate is right cannot be told from row order, so no row of this key is operative.
    outcomes.delete(record.startKey);
    quarantined.add(record.startKey);
    diagnostics.push(diagnostic(repositoryId, mission, record.startKey,
      'Contradictory duplicate verification outcome excluded from FLOW; the start stays unobserved'));
  } else { outcomes.set(record.startKey, record as ReviewStartOutcome); }
}

/** An outcome belongs to the start it names only when mission, change and action agree. */
function dropMismatchedOutcomes(starts: readonly ReviewStartDecision[], outcomes: Map<string, ReviewStartOutcome>,
  repositoryId: string, diagnostics: ObservationDiagnostic[]): void {
  for (const start of starts) {
    const outcome = outcomes.get(start.idempotencyKey);
    if (outcome && (outcome.missionId !== start.missionId || outcome.changeIdentity !== start.changeIdentity
      || outcome.actualAction !== start.actualAction)) {
      outcomes.delete(start.idempotencyKey);
      diagnostics.push(diagnostic(repositoryId, start.missionId, start.idempotencyKey,
        'Verification outcome names another mission, change or action than its start and is excluded from FLOW'));
    }
  }
}

function readWithdrawal(record: Partial<HumanReviewWithdrawal>, repositoryId: string,
  diagnostics: ObservationDiagnostic[]): HumanReviewWithdrawal | null {
  if (record.schemaVersion !== 1) { return null; }
  const mission = typeof record.missionId === 'string' && record.missionId ? record.missionId : 'unknown';
  if (!record.idempotencyKey || !record.changeIdentity || !validTime(record.recordedAt)
    || !Number.isSafeInteger(record.round) || !record.repositoryId) {
    diagnostics.push(diagnostic(repositoryId, mission, record.idempotencyKey ?? null,
      'Incomplete or repository-unscoped human withdrawal row excluded from FLOW'));
    return null;
  }
  return record.repositoryId === repositoryId ? record as HumanReviewWithdrawal : null;
}

/** An operator approval submission through px integrate; review-loop human starts use another correlation and never qualify. */
function readApproval(row: OperationalHistoryEntry, repositoryId: string): ReviewActionStarted | null {
  try {
    const record = JSON.parse(row.eventData) as Partial<ReviewActionStarted>;
    return record.repositoryId === repositoryId && record.action === 'human' && typeof record.missionId === 'string'
      && typeof record.changeIdentity === 'string' && typeof record.correlation === 'string'
      && record.correlation.startsWith('integrate-shortcut:') && validTime(record.recordedAt)
      ? record as ReviewActionStarted : null;
  } catch { return null; }
}

function readRows(history: readonly OperationalHistoryEntry[], repositoryId: string,
  lifecycle: readonly BoardLaneEventEntry[]): ParsedRows {
  const starts: ReviewStartDecision[] = [];
  const outcomes = new Map<string, ReviewStartOutcome>();
  const withdrawals: HumanReviewWithdrawal[] = [];
  const approvals: ReviewActionStarted[] = [];
  const quarantined = new Set<string>();
  const diagnostics: ObservationDiagnostic[] = [];
  for (const row of history) {
    if (row.eventType === REVIEW_ACTION_STARTED_EVENT) {
      const approval = readApproval(row, repositoryId);
      if (approval) { approvals.push(approval); }
      continue;
    }
    if (![REVIEW_START_DECISION_EVENT, REVIEW_START_OUTCOME_EVENT, HUMAN_REVIEW_WITHDRAWAL_EVENT].includes(row.eventType)) { continue; }
    let value: unknown;
    try { value = JSON.parse(row.eventData); }
    catch {
      diagnostics.push(diagnostic(repositoryId, 'unknown', null, `Unreadable ${row.eventType} row excluded from FLOW`));
      continue;
    }
    const record = value as Partial<ReviewStartDecision & ReviewStartOutcome & HumanReviewWithdrawal>;
    if (row.eventType === REVIEW_START_DECISION_EVENT) {
      const start = readStart(record, repositoryId, diagnostics);
      if (start) { starts.push(start); }
      continue;
    }
    if (row.eventType === REVIEW_START_OUTCOME_EVENT) {
      readOutcome(record, repositoryId, outcomes, quarantined, diagnostics);
      continue;
    }
    const withdrawal = readWithdrawal(record, repositoryId, diagnostics);
    if (withdrawal) { withdrawals.push(withdrawal); }
  }
  starts.sort((left, right) => left.actionSequence - right.actionSequence
    || left.recordedAt.localeCompare(right.recordedAt) || left.idempotencyKey.localeCompare(right.idempotencyKey));
  dropMismatchedOutcomes(starts, outcomes, repositoryId, diagnostics);
  return { starts, outcomes, withdrawals, approvals,
    lifecycle: lifecycle.filter(event => event.repositoryId === repositoryId), diagnostics };
}

function roundNumber(start: ReviewStartDecision): number | null {
  const match = /^review:(\d+):/.exec(start.verdictCorrelation);
  return match ? Number(match[1]) : null;
}

function request(start: ReviewStartDecision | undefined, outcomes: ReadonlyMap<string, ReviewStartOutcome>): FlowVerificationRequest | null {
  if (!start) { return null; }
  const outcome = outcomes.get(start.idempotencyKey);
  return { action: start.actualAction, startKey: start.idempotencyKey, gateRunId: start.gateRunId,
    startedAt: start.recordedAt,
    outcomeAt: outcome?.recordedAt ?? null, passed: typeof outcome?.passed === 'boolean' ? outcome.passed : null,
    sameRevisionRerun: typeof start.sameRevisionRerun === 'boolean' ? start.sameRevisionRerun : null };
}

interface LegacyPolicyModes {
  readonly configuredMode?: unknown;
  readonly effectiveMode?: unknown;
}

function legacyExecution(starts: readonly ReviewStartDecision[]): FlowPolicyExecution | null {
  const legacy = starts.map(start => start as ReviewStartDecision & LegacyPolicyModes);
  if (!legacy.some(start => start.configuredMode !== undefined || start.effectiveMode !== undefined)) { return null; }
  if (legacy.some(start => start.configuredMode === 'shadow')) { return 'shadow'; }
  if (legacy.some(start => start.configuredMode === 'pilot' && start.effectiveMode === 'fixed')) { return 'fallback'; }
  if (legacy.every(start => start.configuredMode === 'pilot' && start.effectiveMode === 'pilot')) { return 'pilot'; }
  return 'unobserved';
}

/** One shared durable operation and one non-null artifact pin across the retained starts. */
function sharesOperationAndPin(starts: readonly ReviewStartDecision[]): boolean {
  return starts.every(start => start.operationId !== null && start.artifactSha256 !== null)
    && new Set(starts.map(start => start.operationId)).size === 1
    && new Set(starts.map(start => start.artifactSha256)).size === 1;
}

/**
 * `concurrency` is the retained ordering evidence for a pinned round: true when all three starts precede the first
 * automated outcome, false when all three starts are retained and settlement shows otherwise, and null when a missing
 * tests start or a missing automated outcome leaves the fan-out unobservable. Missing rows never imply a fixed fallback.
 */
function execution(starts: readonly ReviewStartDecision[], concurrency: boolean | null): FlowPolicyExecution {
  const retainedMode = legacyExecution(starts);
  if (retainedMode !== null) { return retainedMode; }
  const operations = new Set(starts.map(start => start.operationId));
  if (starts.some(start => start.operationId === null) || operations.size !== 1) { return 'unobserved'; }
  if (sharesOperationAndPin(starts)) {
    if (concurrency === null) { return 'unobserved'; }
    return concurrency ? 'pilot' : 'fallback';
  }
  if (starts.every(start => start.artifactSha256 === null) && starts.some(start => start.failureReason !== null)) {
    return 'fallback';
  }
  return 'unobserved';
}

function answerTime(human: ReviewStartDecision, outcome: ReviewStartOutcome | undefined): string | null {
  if (!outcome || typeof outcome.humanWaitMs !== 'number' || !Number.isFinite(outcome.humanWaitMs) || outcome.humanWaitMs < 0) { return null; }
  return new Date(Date.parse(human.recordedAt) + outcome.humanWaitMs).toISOString();
}

function humanState(answeredAt: string | null, joinAt: string | null, withdrawnAt: string | null,
  humanOutcome: ReviewStartOutcome | undefined, approvedAt: string | null): FlowVerificationRound['human'] {
  if (withdrawnAt && joinAt) { return { state: 'withdrawn', answeredAt: null, approvedAt: null }; }
  if (humanOutcome?.passed === false) {
    if (answeredAt && joinAt) { return { state: answeredAt <= joinAt ? 'ready' : 'later', answeredAt, approvedAt: null }; }
    return { state: 'timing-unavailable', answeredAt, approvedAt: null };
  }
  // The writer records no approval outcome; the committed approval transition is the only retained answer and it follows the join.
  if (approvedAt) { return { state: 'later', answeredAt: approvedAt, approvedAt }; }
  if (!humanOutcome) { return { state: 'pending', answeredAt: null, approvedAt: null }; }
  if (answeredAt && joinAt) { return { state: answeredAt <= joinAt ? 'ready' : 'later', answeredAt, approvedAt: null }; }
  return { state: 'timing-unavailable', answeredAt, approvedAt: null };
}

/**
 * The agent leg of a round from every reviewer start it retained, whatever order they were written in. Any recorded
 * failure fails the leg; a start without a stored outcome keeps it pending; a start whose outcome decided nothing
 * (a replaced reviewer) is not a verdict.
 */
function agentLeg(agents: readonly ReviewStartDecision[],
  outcomes: ReadonlyMap<string, ReviewStartOutcome>): FlowVerificationRequest | null {
  const first = agents[0];
  if (!first) { return null; }
  const settled = agents.flatMap(start => outcomes.get(start.idempotencyKey) ?? []);
  const failed = settled.filter(outcome => outcome.passed === false);
  const pending = settled.length < agents.length;
  const passed = failed.length > 0 ? false : pending || !settled.some(outcome => outcome.passed === true) ? null : true;
  const decisive = passed === false ? failed : settled;
  return { ...request(first, outcomes)!, startedAt: agents.map(start => start.recordedAt).sort(compareCodeUnits)[0]!, passed,
    outcomeAt: passed === null ? null : decisive.map(outcome => outcome.recordedAt).sort(compareCodeUnits).at(passed === false ? 0 : -1)! };
}

function automatedSettlement(agent: FlowVerificationRequest | null, agentOutcomes: readonly ReviewStartOutcome[],
  tests: ReviewStartOutcome | undefined) {
  const joined = agent?.passed !== null && agent?.passed !== undefined && agent.outcomeAt !== null
    && typeof tests?.passed === 'boolean';
  const at = joined ? [agent.outcomeAt!, tests.recordedAt].sort(compareCodeUnits).at(-1)! : null;
  const first = [...agentOutcomes, ...(tests ? [tests] : [])].map(outcome => outcome.recordedAt).sort(compareCodeUnits)[0] ?? null;
  const failed = joined ? [...(agent.passed === false ? ['agent' as const] : []), ...(tests.passed === false ? ['tests' as const] : [])] : [];
  return { at, first, failed };
}

/**
 * The committed operator approval that answered this round. The `px integrate` attempt row is written before the
 * provider call and replayed on retry, so it alone proves an attempt, never an approval. The completion is the
 * Mission's integration approval transition for the same review round the attempt names: the attempt correlation
 * carries the approval round and the lifecycle command key is `approve:<mission>:round-<n>`, so a failed attempt
 * followed by a later round's reviewer approval stays unobserved. The two row families use different change
 * identities (commit versus patch), so identity equality is never the join; the round window bounds the rest.
 */
function approvalAfterJoin(parsed: ParsedRows, human: ReviewStartDecision, joinAt: string | null,
  nextRoundAt: string | null): string | null {
  if (!joinAt) { return null; }
  const inRound = (at: string) => at >= joinAt && (nextRoundAt === null || at < nextRoundAt);
  const commits = parsed.approvals.filter(item => item.missionId === human.missionId && inRound(item.recordedAt))
    .flatMap(attempt => {
      const approvalRound = /^integrate-shortcut:(\d+):/.exec(attempt.correlation)?.[1];
      // The attempt answers exactly the review round this human request belongs to.
      if (approvalRound === undefined || Number(approvalRound) !== roundNumber(human)) { return []; }
      const key = `approve:${human.missionId}:round-${approvalRound}`;
      return parsed.lifecycle.filter(event => event.missionId === human.missionId && event.toStatus === 'integration'
        && event.trigger === 'approve' && event.idempotencyKey === key && event.occurredAt >= attempt.recordedAt
        && (nextRoundAt === null || event.occurredAt < nextRoundAt)).map(event => event.occurredAt);
    });
  return commits.sort(compareCodeUnits)[0] ?? null;
}

/** True when every start precedes the first automated outcome; null when a leg or any outcome is not retained. */
function observedConcurrency(starts: readonly ReviewStartDecision[], allLegsStarted: boolean, firstOutcomeAt: string | null): boolean | null {
  if (!allLegsStarted || firstOutcomeAt === null) { return null; }
  return starts.map(start => start.recordedAt).sort(compareCodeUnits).at(-1)! <= firstOutcomeAt;
}

interface RoundEvidence {
  readonly starts: readonly ReviewStartDecision[];
  readonly human: ReviewStartDecision;
  readonly agents: readonly ReviewStartDecision[];
  readonly tests: ReviewStartDecision | undefined;
  readonly nextRoundAt: string | null;
}

function buildRound(evidence: RoundEvidence, parsed: ParsedRows): FlowVerificationRound {
  const { starts, human, agents, tests, nextRoundAt } = evidence;
  const { outcomes, withdrawals } = parsed;
  const humanOutcome = outcomes.get(human.idempotencyKey);
  const agentOutcomes = agents.flatMap(start => outcomes.get(start.idempotencyKey) ?? []);
  const testsOutcome = tests ? outcomes.get(tests.idempotencyKey) : undefined;
  const agentRequest = agentLeg(agents, outcomes);
  const automated = automatedSettlement(agentRequest, agentOutcomes, testsOutcome);
  const selectedStarts = [human, ...agents, ...(tests ? [tests] : [])];
  const concurrency = observedConcurrency(selectedStarts, agents.length > 0 && tests !== undefined, automated.first);
  const concurrent = concurrency === true;
  const round = roundNumber(human)!;
  const withdrawal = withdrawals.find(item => item.missionId === human.missionId
    && item.changeIdentity === human.changeIdentity && item.round === round);
  const requestMap = { tests: request(tests, outcomes), agent: agentRequest, human: request(human, outcomes) };
  const testRequests = starts.filter(start => start.actualAction === 'tests')
    .flatMap(start => request(start, outcomes) ?? []);
  return { id: `${human.missionId}:${human.changeIdentity}:${round}`, changeIdentity: human.changeIdentity!,
    operationId: human.operationId, round,
    artifactSha256: selectedStarts.every(start => start.artifactSha256 === human.artifactSha256)
      ? human.artifactSha256 : null,
    execution: execution(selectedStarts, concurrency), requests: requestMap, testRequests, concurrent,
    join: automated.at ? { at: automated.at, passed: automated.failed.length === 0, failed: automated.failed } : null,
    human: humanState(answerTime(human, humanOutcome), automated.at, withdrawal?.recordedAt ?? null, humanOutcome,
      withdrawal ? null : approvalAfterJoin(parsed, human, automated.at, nextRoundAt)),
    withdrawalAt: withdrawal?.recordedAt ?? null,
    sameRevisionTestReruns: starts.filter(start => start.actualAction === 'tests' && start.sameRevisionRerun === true).length };
}

function roundStartTime(starts: readonly ReviewStartDecision[]): string {
  return starts.map(start => start.recordedAt).sort(compareCodeUnits)[0]!;
}

function testsForRound(starts: readonly ReviewStartDecision[], roundStarts: readonly ReviewStartDecision[],
  nextRoundAt: string | null): ReviewStartDecision[] {
  const beganAt = roundStartTime(roundStarts);
  return starts.filter(start => start.actualAction === 'tests'
    && start.recordedAt >= beganAt && (nextRoundAt === null || start.recordedAt < nextRoundAt))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)
      || left.actionSequence - right.actionSequence);
}

function numberedRoundStarts(starts: readonly ReviewStartDecision[]) {
  const numbered = starts.flatMap(start => {
    const round = roundNumber(start);
    return round === null || start.actualAction === 'tests' ? [] : [{ round, start }];
  });
  return [...Map.groupBy(numbered, value => value.round)].map(([round, values]) => ({ round,
    starts: values.map(value => value.start), at: roundStartTime(values.map(value => value.start)) }))
    .sort((left, right) => left.at.localeCompare(right.at) || left.round - right.round);
}

function unobservedReason(starts: readonly ReviewStartDecision[], tests: ReviewStartDecision | undefined,
  agents: readonly ReviewStartDecision[]): string {
  if (legacyExecution(starts) !== null || !sharesOperationAndPin(starts)) {
    return 'Verification execution is unobserved: retained starts lack one shared operation and artifact pin or fixed-policy failure evidence';
  }
  if (agents.length === 0) {
    return 'Pinned verification round has no retained agent start (classifier or lost observation); execution and concurrency are unobserved';
  }
  return tests === undefined
    ? 'Pinned verification round has no retained tests start; execution and concurrency are unobserved'
    : 'Pinned verification round has no automated outcome yet; execution and concurrency are unobserved';
}

/** Why one retained round is unobserved, unsettled or carries action-level failure evidence. */
function roundDiagnostics(parsed: ParsedRows, repositoryId: string, value: FlowVerificationRound, evidence: {
  readonly human: ReviewStartDecision; readonly agents: readonly ReviewStartDecision[];
  readonly tests: ReviewStartDecision | undefined; readonly starts: readonly ReviewStartDecision[];
}): ObservationDiagnostic[] {
  const { human, agents, tests, starts } = evidence;
  const report = (message: string) => diagnostic(repositoryId, human.missionId, human.idempotencyKey, message);
  const messages: string[] = [];
  if (value.execution === 'unobserved') { messages.push(unobservedReason(starts, tests, agents)); }
  const unsettled = agents.find(start => !parsed.outcomes.has(start.idempotencyKey));
  if (unsettled) {
    messages.push(`Reviewer start ${unsettled.idempotencyKey} has no retained outcome; the agent leg and automated join stay unsettled`);
  }
  const failureKinds = [...new Set(starts.flatMap(start => start.failureReason ? [start.failureReason.kind] : []))];
  if (value.execution === 'pilot' && failureKinds.length > 0) {
    messages.push(`Pilot verification round retained action-level policy failure evidence: ${failureKinds.join(', ')}`);
  }
  return messages.map(report);
}

/** Parse retained policy rows once, then expose Mission-scoped same-change rounds to the shared FLOW projection. */
export function observedFlowVerificationRounds(history: readonly OperationalHistoryEntry[], repositoryId: string,
  lifecycle: readonly BoardLaneEventEntry[] = []): {
  readonly byMission: ReadonlyMap<string, readonly FlowVerificationRound[]>;
  readonly diagnostics: readonly ObservationDiagnostic[];
} {
  const parsed = readRows(history, repositoryId, lifecycle);
  const byMission = new Map<string, FlowVerificationRound[]>();
  const grouped = Map.groupBy(parsed.starts, start => `${start.missionId}\0${start.changeIdentity ?? ''}`);
  for (const starts of grouped.values()) {
    const numbered = numberedRoundStarts(starts);
    for (const [index, group] of numbered.entries()) {
      const human = group.starts.find(start => start.actualAction === 'human');
      if (!human) { continue; }
      const agents = group.starts.filter(start => start.actualAction === 'agent');
      const nextRoundAt = numbered[index + 1]?.at ?? null;
      const testStarts = testsForRound(starts, group.starts, nextRoundAt);
      const tests = testStarts.find(start => start.sameRevisionRerun !== true) ?? testStarts[0];
      const roundStarts = [human, ...agents, ...testStarts];
      // A human handoff with no agent and no pinned concurrent tests is an ordinary sequential handoff, not a round.
      if (agents.length === 0 && !(tests && sharesOperationAndPin([human, ...testStarts]))) { continue; }
      const value = buildRound({ starts: roundStarts, human, agents, tests, nextRoundAt }, parsed);
      parsed.diagnostics.push(...roundDiagnostics(parsed, repositoryId, value, { human, agents, tests, starts: roundStarts }));
      const rounds = byMission.get(human.missionId) ?? [];
      rounds.push(value);
      byMission.set(human.missionId, rounds);
    }
  }
  return { byMission, diagnostics: parsed.diagnostics };
}
