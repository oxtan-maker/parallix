import test from 'node:test';
import assert from 'node:assert/strict';
import type { OperationalHistoryEntry } from '../../../../src/application/ports/operation-history.js';
import type { ReviewStartDecision, ReviewStartOutcome } from '../../../../src/application/ports/verification-policy.js';
import { modelSaving, verificationModelStatistics } from '../../../../src/application/projections/verification-model-statistics.js';
import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';
import { renderVerificationModelStatistics } from '../../../../src/application/presentation/verification-statistics.js';
import { REVIEW_START_DECISION_EVENT } from '../../../../src/application/verification-policy/review-start-decision.js';
import { REVIEW_START_OUTCOME_EVENT } from '../../../../src/application/verification-policy/review-start-outcome.js';
import type { PolicyAction } from '../../../../src/application/verification-policy/policy-artifact.js';

const REPO = 'repo-a';
type Probabilities = ReviewStartDecision['predictedPassProbability'];
const row = (eventType: string, data: unknown): OperationalHistoryEntry => ({ eventType, eventData: JSON.stringify(data), createdAt: '2026-10-01T00:00:00Z' });
function start(key: string, action: PolicyAction, predicted: Partial<Probabilities> | null, mission = 'task-1', repositoryId: string | undefined = REPO): OperationalHistoryEntry {
  const probabilities = predicted === null ? { tests: null, agent: null, human: null } : { tests: null, agent: null, human: null, ...predicted };
  return row(REVIEW_START_DECISION_EVENT, { idempotencyKey: key, repositoryId, missionId: mission, actualAction: action, predictedPassProbability: probabilities });
}
const outcome = (key: string, passed: boolean | null | undefined): OperationalHistoryEntry =>
  row(REVIEW_START_OUTCOME_EVENT, { startKey: key, ...(passed === undefined ? {} : { passed }) } satisfies Partial<ReviewStartOutcome>);
const check = (history: readonly OperationalHistoryEntry[], name: PolicyAction, missions?: ReadonlySet<string>) =>
  verificationModelStatistics(history, REPO, null, missions).calibration.find(entry => entry.check === name)!;

test('calibration is reported per check from predictions matched to outcomes (TASK-2867.07)', () => {
  const history = [
    start('a1', 'agent', { agent: 0.9 }), outcome('a1', true),
    start('a2', 'agent', { agent: 0.8 }), outcome('a2', false),
    start('h1', 'human', { human: 0.2 }), outcome('h1', false),
    start('t1', 'tests', { tests: 0.95 }), outcome('t1', true),
  ];
  const agent = check(history, 'agent');
  assert.deepEqual([agent.starts, agent.matched, agent.matchedPassed], [2, 2, 1]);
  assert.ok(Math.abs(agent.meanPredicted! - 0.85) < 1e-9);
  assert.equal(agent.observedPassRate, 0.5);
  assert.ok(Math.abs(agent.meanAbsoluteErrorPoints! - 35) < 1e-9, 'both predictions share the top bin: |0.85 - 0.5| * 100');
  assert.deepEqual([check(history, 'human').matched, check(history, 'human').observedPassRate], [1, 0]);
  assert.deepEqual([check(history, 'tests').matched, check(history, 'tests').observedPassRate], [1, 1], 'each check keeps its own population');
});

test('unknown predictions and outcomes are counted and excluded, never imputed as zero (TASK-2867.07)', () => {
  const history = [
    start('a1', 'agent', { agent: 0.6 }), outcome('a1', true),
    start('a2', 'agent', null), outcome('a2', true),
    start('a3', 'agent', { agent: 0.7 }), outcome('a3', null),
    start('a4', 'agent', { agent: 0.7 }), outcome('a4', undefined),
    start('a5', 'agent', { agent: 0.7 }),
  ];
  const agent = check(history, 'agent');
  assert.deepEqual([agent.starts, agent.matched, agent.unknownPrediction, agent.unknownOutcome], [5, 1, 1, 3]);
  assert.equal(agent.meanPredicted, 0.6, 'only the matched pair contributes');
  const none = check([start('t1', 'tests', { tests: 0.5 })], 'tests');
  assert.deepEqual([none.matched, none.meanPredicted, none.observedPassRate, none.meanAbsoluteErrorPoints], [0, null, null, null]);
});

test('calibration is limited to the requested missions (TASK-2867.07)', () => {
  const history = [start('a1', 'agent', { agent: 0.9 }, 'task-1'), outcome('a1', true), start('a2', 'agent', { agent: 0.9 }, 'task-2'), outcome('a2', false)];
  assert.equal(check(history, 'agent', new Set(['task-2'])).observedPassRate, 0);
  assert.equal(check(history, 'agent').matched, 2);
});

test('saving is J_mu(pi_0) - V(pi_0) with the percentage over J_mu(pi_0), unknown when unavailable (TASK-2867.07)', () => {
  const saving = modelSaving({ currentSequenceValue: 12, policyValue: 9 });
  assert.deepEqual([saving.absolute, saving.percentage], [3, 25]);
  assert.deepEqual(modelSaving({ currentSequenceValue: 0, policyValue: -1 }).percentage, null, 'a zero denominator is unknown');
  assert.equal(modelSaving({ currentSequenceValue: 0, policyValue: -1 }).absolute, 1, 'the absolute saving stays known');
  assert.deepEqual(modelSaving(null), { policyValue: null, currentSequenceValue: null, absolute: null, percentage: null });
  const tiny = modelSaving({ currentSequenceValue: Number.MIN_VALUE, policyValue: -Number.MAX_VALUE });
  assert.deepEqual([tiny.absolute, tiny.percentage], [Number.MAX_VALUE, null], 'a finite saving over a finite denominator that overflows is unknown, never Infinity');
  const huge = modelSaving({ currentSequenceValue: Number.MAX_VALUE, policyValue: -Number.MAX_VALUE });
  assert.deepEqual([huge.absolute, huge.percentage], [null, null], 'a subtraction that overflows is unknown, never Infinity');
  assert.equal(modelSaving({ currentSequenceValue: Number.NaN, policyValue: 1 }).absolute, null, 'an unusable artifact value is unknown');
});

test('the shared projection carries the model statistics beside every existing measurement (TASK-2867.07)', () => {
  const report = verificationStatistics({ repositoryId: REPO, operations: [], lifecycle: [],
    history: [start('a1', 'agent', { agent: 0.9 }), outcome('a1', true)], policyValues: { currentSequenceValue: 10, policyValue: 8 } });
  assert.equal(report.model.saving.percentage, 20);
  assert.equal(report.attemptCount, 0, 'existing measurements are unaffected by decision rows');
  const lines = renderVerificationModelStatistics(report).join('\n');
  assert.match(lines, /Calibration agent: starts 1; matched 1 \(passed 1\)/);
  assert.match(lines, /Calibration tests: starts 0; matched 0 \(passed 0\); excluded unknown outcome 0, unknown prediction 0; mean predicted unknown; observed pass rate unknown/);
  assert.match(lines, /saving 2\.0000; percentage of J_mu\(pi_0\) 20\.0%/);
  const unknown = renderVerificationModelStatistics(verificationStatistics({ repositoryId: REPO, operations: [], lifecycle: [], history: [] })).join('\n');
  assert.match(unknown, /J_mu\(pi_0\) unknown; V\(pi_0\) unknown; saving unknown; percentage of J_mu\(pi_0\) unknown/);
});

test('calibration reads only the report repository, whatever the mission scope (TASK-2867.07)', () => {
  const history = [start('a1', 'agent', { agent: 0.9 }, 'task-1', REPO), outcome('a1', true),
    start('b1', 'agent', { agent: 0.1 }, 'task-1', 'repo-b'), outcome('b1', false),
    start('b2', 'agent', { agent: 0.1 }, 'task-9', 'repo-b'), outcome('b2', false),
    start('legacy', 'agent', { agent: 0.7 }, 'task-1', undefined), outcome('legacy', true)];
  const scoped = check(history, 'agent', new Set(['task-1']));
  assert.deepEqual([scoped.starts, scoped.matched, scoped.observedPassRate], [2, 2, 1], 'the other repository, same slug or not, is excluded; a row with no repository stays');
  assert.equal(check(history, 'agent').starts, 2, 'the repository-wide read is repository-scoped too');
});

test('unreadable decision and outcome rows are counted, not dropped or imputed (TASK-2867.07)', () => {
  const broken = { eventType: REVIEW_START_OUTCOME_EVENT, eventData: '{not json', createdAt: '2026-10-01T00:00:00Z' };
  const model = verificationModelStatistics([start('a1', 'agent', { agent: 0.9 }), outcome('a1', true), broken,
    { ...broken, eventType: REVIEW_START_DECISION_EVENT, eventData: 'null' }], REPO, null);
  assert.equal(model.unreadableRows, 2);
  assert.equal(model.calibration.find(entry => entry.check === 'agent')!.matched, 1);
  const lines = renderVerificationModelStatistics({ model } as never).join('\n');
  assert.match(lines, /Unreadable decision or outcome rows excluded: 2/);
});

test('a decision and an outcome without their correlation keys are unreadable, never a matched pair (TASK-2867.07)', () => {
  const keyless = [row(REVIEW_START_DECISION_EVENT, { repositoryId: REPO, missionId: 'task-1', actualAction: 'agent', predictedPassProbability: { tests: null, agent: 0.8, human: null } }),
    row(REVIEW_START_OUTCOME_EVENT, { passed: true }), row(REVIEW_START_OUTCOME_EVENT, { startKey: '', passed: true })];
  const model = verificationModelStatistics(keyless, REPO, null);
  const agent = model.calibration.find(entry => entry.check === 'agent')!;
  assert.deepEqual([agent.starts, agent.matched, model.unreadableRows], [0, 0, 3]);
});

test('model statistics count only decisions recorded inside the report windows (TASK-2867.07)', () => {
  const at = (day: string, entry: OperationalHistoryEntry): OperationalHistoryEntry => {
    const data = JSON.parse(entry.eventData) as Record<string, unknown>;
    return { ...entry, eventData: JSON.stringify({ ...data, recordedAt: `${day}T12:00:00.000Z` }) };
  };
  const history = [at('2026-06-10', start('old', 'agent', { agent: 0.9 })), outcome('old', false),
    at('2026-06-23', start('new', 'agent', { agent: 0.9 })), outcome('new', true)];
  const window = { start: new Date('2026-06-16T00:00:00Z'), end: new Date('2026-06-30T00:00:00Z'), timeZone: 'UTC' };
  const windowed = verificationModelStatistics(history, REPO, null, undefined, [window]).calibration.find(entry => entry.check === 'agent')!;
  assert.deepEqual([windowed.starts, windowed.observedPassRate], [1, 1], 'the earlier decision is outside the window');
  assert.equal(check(history, 'agent').starts, 2, 'no window means every recorded decision');
});
