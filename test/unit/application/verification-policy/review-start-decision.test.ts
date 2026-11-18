import test from 'node:test';
import assert from 'node:assert/strict';
import type { IdempotentOperationalHistoryRepository, OperationalHistoryEntry } from '../../../../src/application/ports/operation-history.js';
import { OperationalHistoryService } from '../../../../src/application/services/operational-history-service.js';
import {
  REVIEW_START_DECISION_EVENT,
  observePolicyReviewStart,
  observePolicyTestsStart,
  observeReviewStartDecision,
  reviewStartDecision,
  reviewStartDecisionKey,
} from '../../../../src/application/verification-policy/review-start-decision.js';
import type { ReviewStartDecision, ReviewStartDecisionInput, ReviewStartFailure,
  ReviewStartPolicyPorts } from '../../../../src/application/ports/verification-policy.js';
import { missionId } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { parsePolicyArtifact } from '../../../../src/application/verification-policy/policy-artifact.js';
import { policyArtifactFixture } from './policy-artifact.fixture.js';

function decision(overrides: Partial<ReviewStartDecisionInput> = {}): ReviewStartDecisionInput {
  return {
    missionId: missionId('task-2859.09'),
    repositoryId: repositoryId('repository-1'),
    changeIdentity: 'patch-123',
    configuredMode: 'shadow',
    effectiveMode: 'shadow',
    artifactSha256: 'artifact-hash',
    recommendedAction: 'tests',
    predictedPassProbability: { agent: 0.7, human: 0.6, tests: 0.5 },
    actualAction: 'agent',
    operatorOverride: true,
    verdictCorrelation: 'review:round-2',
    agentRunId: 'run-reviewer',
    gateRunId: null,
    operationId: 'operation-9',
    failureReason: null,
    ...overrides,
  };
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
    appendIdempotent: async (entry, key) => {
      if (keys.has(key)) { return false; }
      keys.add(key); entries.push(entry); return true;
    },
    clear: async () => { entries.length = 0; keys.clear(); },
  } satisfies IdempotentOperationalHistoryRepository;
  return { entries, repository };
}

test('review-start decision keeps every identity and unknown explicit (TASK-2859.09)', () => {
  const record = reviewStartDecision(decision({
    artifactSha256: null,
    recommendedAction: null,
    predictedPassProbability: { agent: null, human: null, tests: null },
    agentRunId: null,
    operationId: null,
    failureReason: { kind: 'artifact-missing', message: 'configured artifact is absent' },
  }), 3);
  assert.deepEqual(record, {
    schemaVersion: 1,
    idempotencyKey: 'review-start:task-2859.09:patch-123:3',
    missionId: 'task-2859.09', repositoryId: 'repository-1', changeIdentity: 'patch-123',
    configuredMode: 'shadow', effectiveMode: 'shadow', artifactSha256: null,
    recommendedAction: null, predictedPassProbability: { agent: null, human: null, tests: null },
    actualAction: 'agent', operatorOverride: true, verdictCorrelation: 'review:round-2',
    agentRunId: null, gateRunId: null, operationId: null, actionSequence: 3,
    failureReason: { kind: 'artifact-missing', message: 'configured artifact is absent' },
    recordedAt: record.recordedAt,
  });
  assert.equal(Number.isNaN(Date.parse(record.recordedAt)), false);
});
test('review-start key is derived only from mission, change and sequence (TASK-2859.09)', () => {
  const input = decision();
  assert.equal(reviewStartDecisionKey({ ...input, actionSequence: 3 }), reviewStartDecisionKey({
    missionId: input.missionId, changeIdentity: input.changeIdentity, actionSequence: 3,
  }));
  assert.throws(() => reviewStartDecisionKey({ ...input, actionSequence: 0 }),
    /positive safe integer/);
});

test('OperationalHistoryService appends one review-start row across restart replay (TASK-2859.09)', async () => {
  const { entries, repository } = historyRepository();
  const firstProcess = new OperationalHistoryService(repository);
  const restartedProcess = new OperationalHistoryService(repository);
  const input = decision();
  assert.equal(await firstProcess.recordReviewStartDecision(input), true);
  assert.equal(await restartedProcess.recordReviewStartDecision(input), false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.eventType, REVIEW_START_DECISION_EVENT);
  const stored = JSON.parse(entries[0]!.eventData) as ReviewStartDecision;
  const expected = reviewStartDecision(input, 1);
  assert.deepEqual({ ...stored, recordedAt: undefined }, { ...expected, recordedAt: undefined });
  assert.equal(Number.isNaN(Date.parse(stored.recordedAt)), false);
});

test('OperationalHistoryService deduplicates agent replay without a run id (TASK-2859.10 F1)', async () => {
  const { entries, repository } = historyRepository();
  const input = decision({ agentRunId: null });
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(input), true);
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(input), false);
  assert.equal(entries.length, 1);
});

test('OperationalHistoryService sequences distinct same-round run identities (TASK-2859.09 F10)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const first = decision({ agentRunId: 'claude-run-1', verdictCorrelation: 'review:1:agent:claude-verdict' });
  const replacement = decision({ agentRunId: 'qwen-run-1', verdictCorrelation: 'review:1:agent:qwen-verdict' });
  assert.equal(await service.recordReviewStartDecision(first), true);
  assert.equal(await service.recordReviewStartDecision(replacement), true);
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(replacement), false);
  assert.deepEqual(entries.map(entry => {
    const row = JSON.parse(entry.eventData) as ReviewStartDecision;
    return [row.actionSequence, row.agentRunId, row.idempotencyKey];
  }), [
    [1, 'claude-run-1', 'review-start:task-2859.09:patch-123:1'],
    [2, 'qwen-run-1', 'review-start:task-2859.09:patch-123:2'],
  ]);
});

test('OperationalHistoryService deduplicates tests actions by gate run and shares the action sequence (TASK-2859.10)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const review = decision({ agentRunId: 'review-run', verdictCorrelation: 'review:1' });
  const tests = decision({ actualAction: 'tests', agentRunId: null, gateRunId: 'gate-run-1',
    verdictCorrelation: 'gate-run-1', operatorOverride: false });
  const rerun = { ...tests, gateRunId: 'gate-run-2', verdictCorrelation: 'gate-run-2' };
  assert.equal(await service.recordReviewStartDecision(review), true);
  assert.equal(await service.recordReviewStartDecision(tests), true);
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(tests), false);
  assert.equal(await service.recordReviewStartDecision(rerun), true);
  assert.deepEqual(entries.map(entry => {
    const row = JSON.parse(entry.eventData) as ReviewStartDecision;
    return [row.actionSequence, row.actualAction, row.gateRunId];
  }), [[1, 'agent', null], [2, 'tests', 'gate-run-1'], [3, 'tests', 'gate-run-2']]);
});

test('review-start observation isolates policy, writer and timeout failures (TASK-2859.09)', async () => {
  const failures: ReviewStartFailure[] = [];
  const reports = (failure: ReviewStartFailure) => { failures.push(failure); };
  const writer = { recordReviewStartDecision: async () => { throw new Error('database unavailable'); } };
  assert.equal(await observeReviewStartDecision(async () => { throw new Error('policy exploded'); }, writer, reports), 'failed');
  assert.equal(failures.shift()?.kind, 'policy-exception');
  assert.equal(await observeReviewStartDecision(async () => decision(), writer, reports), 'failed');
  assert.equal(failures.shift()?.kind, 'writer-failure');
  assert.equal(await observeReviewStartDecision(async () => await new Promise<never>(() => {}), writer, reports,
    { deadlineMs: 5 }), 'timed-out');
  assert.equal(failures.shift()?.kind, 'observation-timeout');
  assert.equal(await observeReviewStartDecision(async () => { throw new Error('policy exploded'); }, writer,
    () => { throw new Error('diagnostic output failed'); }), 'failed');
});

const parsed = parsePolicyArtifact(policyArtifactFixture());
if (!parsed.ok) { throw new Error(parsed.rejection.message); }
const parsedArtifact = parsed.artifact;

function policyPorts(overrides: Partial<ReviewStartPolicyPorts> = {}) {
  const records: ReviewStartDecisionInput[] = [];
  const failures: ReviewStartFailure[] = [];
  const ports: ReviewStartPolicyPorts = {
    configuration: { mode: 'shadow', artifact: 'policy.json' },
    repositoryId: repositoryId('repository-1'), targetBranch: 'main', operationId: 'operation-9',
    loadPolicy: () => ({ mode: 'shadow', hash: 'pinned-hash', artifact: parsedArtifact }),
    readHistory: async () => ({ ok: true, entries: [], tests: 'unobserved' }),
    identity: { branchHead: () => 'abc1234', changeIdentity: () => 'patch-123', onlyBookkeepingSince: () => false },
    writer: { recordReviewStartDecision: async input => { records.push(input); return true; } },
    diagnostic: failure => { failures.push(failure); },
    ...overrides,
  };
  return { ports, records, failures };
}

function startFacts(overrides: Partial<Parameters<typeof observePolicyReviewStart>[0]> = {}) {
  return {
    missionId: missionId('task-2859.09'), actualAction: 'agent' as const, revision: 'abc1234',
    verdictCorrelation: 'review:1:agent-verdict', agentRunId: 'run-1',
    operatorInvocation: true, ...overrides,
  };
}

test('shadow and pilot evaluate recommendations, probabilities, overrides and switch changes (TASK-2859.09)', async () => {
  const shadow = policyPorts();
  assert.equal(await observePolicyReviewStart(startFacts(), shadow.ports), 'recorded');
  assert.equal(shadow.records[0]?.configuredMode, 'shadow');
  assert.equal(shadow.records[0]?.effectiveMode, 'shadow');
  assert.equal(shadow.records[0]?.recommendedAction, 'human');
  assert.deepEqual(shadow.records[0]?.predictedPassProbability, { tests: 1, agent: 1, human: 1 });
  assert.equal(shadow.records[0]?.operatorOverride, true);
  assert.equal(shadow.records[0]?.artifactSha256, 'pinned-hash');

  const pilot = policyPorts({ configuration: { mode: 'pilot', artifact: 'policy.json' } });
  assert.equal(await observePolicyReviewStart(startFacts({ actualAction: 'human', agentRunId: null }), pilot.ports), 'recorded');
  assert.equal(pilot.records[0]?.configuredMode, 'pilot');
  assert.equal(pilot.records[0]?.effectiveMode, 'shadow');
  assert.equal(pilot.records[0]?.operatorOverride, false);

  const automated = policyPorts();
  assert.equal(await observePolicyReviewStart(startFacts({ operatorInvocation: false }), automated.ports), 'recorded');
  assert.equal(automated.records[0]?.operatorOverride, false, 'workflow automation is not an operator override');
});

test('tests action records the full linked row and preserves unknown policy values (TASK-2859.10)', async () => {
  const linked = policyPorts();
  assert.equal(await observePolicyTestsStart({ missionId: missionId('task-2859.10'), actualAction: 'tests',
    revision: 'abc1234', verdictCorrelation: 'gate-run-42', agentRunId: null, gateRunId: 'gate-run-42',
    operatorInvocation: true }, linked.ports), 'recorded');
  assert.deepEqual(linked.records[0], {
    missionId: 'task-2859.10', repositoryId: 'repository-1', changeIdentity: 'patch-123',
    configuredMode: 'shadow', effectiveMode: 'shadow', artifactSha256: 'pinned-hash',
    recommendedAction: 'human', predictedPassProbability: { tests: 1, agent: 1, human: 1 },
    actualAction: 'tests', operatorOverride: true, verdictCorrelation: 'gate-run-42',
    agentRunId: null, gateRunId: 'gate-run-42', operationId: 'operation-9', failureReason: null,
  });

  const missing = policyPorts({ loadPolicy: () => ({ mode: 'fixed', reason: 'missing' }),
    identity: { branchHead: () => null, changeIdentity: () => null, onlyBookkeepingSince: () => false } });
  assert.equal(await observePolicyTestsStart({ missionId: missionId('task-2859.10'), actualAction: 'tests',
    revision: '', verdictCorrelation: 'gate-run-unknown', agentRunId: null, gateRunId: 'gate-run-unknown',
    operatorInvocation: false }, missing.ports), 'recorded');
  assert.equal(missing.records[0]?.changeIdentity, null);
  assert.equal(missing.records[0]?.artifactSha256, null);
  assert.deepEqual(missing.records[0]?.predictedPassProbability, { agent: null, human: null, tests: null });
  assert.equal(missing.records[0]?.failureReason?.kind, 'artifact-missing');
});

test('artifact and history failures record typed fixed-policy decisions (TASK-2859.09)', async () => {
  const artifactReasons = ['missing', 'invalid', 'hash-mismatch', 'unreadable'] as const;
  for (const reason of artifactReasons) {
    const fixture = policyPorts({ loadPolicy: () => ({ mode: 'fixed', reason }) });
    assert.equal(await observePolicyReviewStart(startFacts(), fixture.ports), 'recorded');
    assert.equal(fixture.records[0]?.effectiveMode, 'fixed');
    assert.equal(fixture.records[0]?.failureReason?.kind, `artifact-${reason}`);
    assert.equal(fixture.failures[0]?.kind, `artifact-${reason}`);
  }
  for (const kind of ['unavailable', 'invalid', 'contradiction', 'unmodelled-history'] as const) {
    const fixture = policyPorts({ readHistory: async () => ({ ok: false, failure: { kind, message: kind } }) });
    assert.equal(await observePolicyReviewStart(startFacts(), fixture.ports), 'recorded');
    assert.equal(fixture.records[0]?.failureReason?.kind,
      `history-${kind}`);
  }
});

test('unmodelled belief and absent recommendation remain typed observations (TASK-2859.09)', async () => {
  const pending = policyPorts({ readHistory: async () => ({ ok: true,
    entries: [{ kind: 'verdict', check: 'tests', passed: false }], tests: 'observed' }) });
  assert.equal(await observePolicyReviewStart(startFacts(), pending.ports), 'recorded');
  assert.equal(pending.records[0]?.failureReason?.kind, 'belief-unmodelled-history');
  assert.equal(pending.records[0]?.effectiveMode, 'fixed');

  const complete = policyPorts({ readHistory: async () => ({ ok: true, entries: [
    { kind: 'verdict', check: 'tests', passed: true },
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'human', passed: true },
  ], tests: 'observed' }) });
  assert.equal(await observePolicyReviewStart(startFacts(), complete.ports), 'recorded');
  assert.equal(complete.records[0]?.failureReason?.kind, 'no-recommendation');
  assert.equal(complete.records[0]?.effectiveMode, 'shadow');
});
