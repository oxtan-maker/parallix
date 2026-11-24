import type { FlowMissionFacts } from '../../src/application/projections/flow-statistics.js';
import type { FlowGateRun } from '../../src/application/projections/flow-mission-facts.js';

export function measuredGate(id: string, phase: 'review' | 'integration', result: FlowGateRun['result'],
  operationId: string | null, requestedAt: string, finishedAt: string | null): FlowGateRun {
  return { id, phase, result, operationId, requestedAt, finishedAt };
}

/** Retained verification-policy rows and FLOW facts shared by the owning FLOW projection suites. */
export function flowFact(overrides: Partial<FlowMissionFacts> & Pick<FlowMissionFacts, 'missionId' | 'reviewStatistics'>): FlowMissionFacts {
  return { repositoryId: 'repo', closedAt: '2026-11-03T12:00:00Z', implementer: 'codex',
    laneDwellMs: null, diagramNodeIds: [], diagramEdgeIds: [], ownership: [], window: null,
    gateRuns: [], rebaseRuns: [], rebaseStages: [
      { stage: 'direct-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not requested', outcomes: [] },
      { stage: 'pre-review-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not configured', outcomes: [] },
      { stage: 'integration-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not configured', outcomes: [] },
    ], diagnostics: [], lead: { queued: 0, recoveries: 0, escalations: 0 },
    actualAgentLaunches: 1, agentLaunches: [], observedDisqualifiers: [], ...overrides };
}

export const FLOW_POLICY_PLAN = {
  rule: 'all-then-last' as const, repairMode: 'joint' as const,
  stages: [
    { request: ['agent', 'tests', 'human'] as const, waitFor: ['agent', 'tests'] as const,
      repair: ['agent', 'tests'] as const, withdrawOnFailure: ['human'] as const },
    { request: [] as const, waitFor: ['human'] as const, repair: ['human'] as const, withdrawOnFailure: [] as const },
  ],
};

export function policyStart(mission: string, action: 'human' | 'tests' | 'agent', sequence: number, recordedAt: string,
  options: { readonly execution?: 'pilot' | 'fallback';
    readonly artifact?: string; readonly rerun?: boolean; readonly round?: number } = {}) {
  const round = options.round ?? 1, identity = `${mission}-change`;
  const fallback = options.execution === 'fallback', artifact = fallback ? options.artifact ?? null : options.artifact ?? 'artifact-old';
  return { schemaVersion: 1, idempotencyKey: `${mission}:${round}:${action}:${sequence}`, missionId: mission, repositoryId: 'repo',
    changeIdentity: identity, artifactSha256: artifact,
    recommendedAction: action, predictedPassProbability: { tests: 0.8, agent: 0.8, human: 0.8 }, actualAction: action,
    operatorOverride: false, verdictCorrelation: action === 'tests' ? `${mission}-gate`
      : `review:${round}:${action === 'agent' ? 'agent:codex-verdict' : 'human-verdict'}`,
    agentRunId: action === 'agent' ? `${mission}-agent` : null, gateRunId: action === 'tests' ? `${mission}-gate` : null,
    operationId: `${mission}-operation`, actionSequence: sequence, sameRevisionRerun: options.rerun ?? false,
    failureReason: fallback ? artifact ? { kind: 'history-unavailable' as const, message: 'history unavailable' }
      : { kind: 'artifact-missing' as const, message: 'policy artifact is missing' } : null, recordedAt };
}

export function policyOutcome(start: ReturnType<typeof policyStart>, recordedAt: string, passed: boolean | null,
  humanWaitMs: number | null = null) {
  return { schemaVersion: 1, idempotencyKey: `outcome:${start.idempotencyKey}`, startKey: start.idempotencyKey,
    missionId: start.missionId, changeIdentity: start.changeIdentity, actualAction: start.actualAction,
    runDurationMs: null, reviewMs: null, humanWaitMs, findingCount: passed === false ? 1 : null,
    verdictSource: start.actualAction === 'human' ? 'operator' : start.actualAction === 'agent' ? 'reviewer' : null,
    passed, rebuttal: null, recordedAt };
}

export function policyHistory(eventType: string, value: object) {
  return { eventType, eventData: JSON.stringify(value), createdAt: String((value as { recordedAt: string }).recordedAt) };
}

export function completed(mission: string) {
  return { repositoryId: 'repo', missionId: mission, fromStatus: 'integration', toStatus: 'done', trigger: 'integrate',
    agent: 'codex', occurredAt: '2026-11-03T12:00:00Z', idempotencyKey: `${mission}-done` };
}

export function retainedRound(mission: string, humanAnswerMinutes: number | null,
  automated: readonly [boolean, boolean] = [true, true], options: { readonly execution?: 'pilot' | 'fallback'; readonly withdraw?: boolean;
    readonly humanOutcomeWithoutTiming?: boolean; readonly artifact?: string; readonly concurrent?: boolean } = {}) {
  const human = policyStart(mission, 'human', 1, '2026-11-03T10:00:00Z', options);
  const tests = policyStart(mission, 'tests', 2, options.concurrent === false ? '2026-11-03T10:07:00Z' : '2026-11-03T10:01:00Z', options);
  const agent = policyStart(mission, 'agent', 3, '2026-11-03T10:02:00Z', options);
  const rows = [
    policyHistory('verification.review-start-decision', human),
    policyHistory('verification.review-start-decision', tests),
    policyHistory('verification.review-start-decision', agent),
    policyHistory('verification.review-start-outcome', policyOutcome(tests, options.concurrent === false ? '2026-11-03T10:08:00Z' : '2026-11-03T10:05:00Z', automated[0])),
    policyHistory('verification.review-start-outcome', policyOutcome(agent, '2026-11-03T10:06:00Z', automated[1])),
    ...(humanAnswerMinutes === null && !options.humanOutcomeWithoutTiming ? [] : [policyHistory('verification.review-start-outcome',
      policyOutcome(human, '2026-11-03T10:11:00Z', humanAnswerMinutes === null ? null : false, humanAnswerMinutes === null ? null : humanAnswerMinutes * 60_000))]),
  ];
  if (options.withdraw) {
    rows.push(policyHistory('verification.human-review-withdrawal', { schemaVersion: 1,
      idempotencyKey: `${mission}-withdrawal`, missionId: mission, repositoryId: 'repo',
      changeIdentity: human.changeIdentity, round: 1,
      reason: 'automated-failure', recordedAt: '2026-11-03T10:07:00Z' }));
  }
  return rows;
}

/**
 * The px integrate approval attempt. Its change identity is the commit sha, a different identity space from the
 * patch identity on policy decisions, so the projection must never join the two by identity.
 */
export function approvalSubmission(mission: string, recordedAt: string, approvalRound = 1) {
  return policyHistory('review.action-started', { schemaVersion: 1, repositoryId: 'repo', missionId: mission,
    changeIdentity: '74144a9e1606e1dbc9c2021e3884c3b20f6acce7', action: 'human', correlation: `integrate-shortcut:${approvalRound}:head:head`,
    actionSequence: 9, configuredLimit: 40, failureReason: null, idempotencyKey: `${mission}-approval`, recordedAt });
}

/** The committed approval: the lane transition that completes the human approval of one review round. */
export function approvalTransition(mission: string, occurredAt: string, approvalRound = 1) {
  return { repositoryId: 'repo', missionId: mission, fromStatus: 'review', toStatus: 'integration', trigger: 'approve',
    agent: 'codex', occurredAt, idempotencyKey: `approve:${mission}:round-${approvalRound}` };
}
