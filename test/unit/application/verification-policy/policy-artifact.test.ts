import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBelief, verificationCheckStates, verificationHistoryRecord, verificationIntegrationEligible,
  type VerificationHistoryEntry } from '../../../../src/application/verification-policy/belief.js';
import { POLICY_ACTIONS, parsePolicyArtifact, type PolicyAction, type PolicyArtifact, type PolicyRejectionCode } from '../../../../src/application/verification-policy/policy-artifact.js';
import { recommend } from '../../../../src/application/verification-policy/recommend.js';
import { ALL_ACTIONS, syntheticPolicyArtifactV2 as syntheticV2, v2State, oneHot, type Json } from './policy-artifact.fixture.js';

type AlphaVector = { action: PolicyAction; values: number[] };
type FilterModel = { transition: number[][][]; observation: number[][][]; prior: number[] };

/** Independent reference of the belief filter: B_y P' pi, normalized. */
function referenceUpdate(model: FilterModel, belief: number[], action: number, observation: 0 | 1) {
  const next = belief.map((_p, column) => model.observation[action][column][observation]
    * belief.reduce((sum, p, row) => sum + p * model.transition[action][row][column], 0));
  const probability = next.reduce((sum, value) => sum + value, 0);
  return { probability, belief: next.map(value => value / probability) };
}

function referencePredict(model: FilterModel, belief: number[], action: number) {
  return belief.map((_p, column) => belief.reduce((sum, p, row) => sum + p * model.transition[action][row][column], 0));
}

/** Independent reference of the maximizing alpha vector. */
function referenceSelect(vectors: AlphaVector[], belief: number[]) {
  const value = (vector: AlphaVector) => vector.values.reduce((sum, entry, state) => sum + entry * belief[state], 0);
  return vectors.reduce((best, vector) => value(vector) > value(best) ? vector : best, vectors[0]);
}

const code = (input: unknown): PolicyRejectionCode | 'accepted' => { const r = parsePolicyArtifact(input); return r.ok ? 'accepted' : r.rejection.code; };
const parsedV2 = (input: Json): PolicyArtifact => { const result = parsePolicyArtifact(input); if (!result.ok) { throw new Error(result.rejection.message); } return result.artifact; };
const mutatedV2 = (change: (a: Json) => void, base: Json = syntheticV2()): Json => { change(base); return base; };
const artifact = (): PolicyArtifact => parsedV2(syntheticV2());
const failure = (result: ReturnType<typeof deriveBelief>) => result.ok ? 'ok' : result.failure.kind;

test('parses a contract-v2 fixture as value and text without sharing mutable state (TASK-2867.08)', () => {
  const source = syntheticV2();
  for (const input of [source, JSON.stringify(source)]) {
    const result = parsePolicyArtifact(input);
    assert.ok(result.ok);
    const { states, ...rest } = result.artifact;
    const { states: sourceStates, ...sourceRest } = source;
    assert.deepEqual(rest, sourceRest);
    assert.deepEqual(states.map(state => state.acceptable), sourceStates.map((state: Json) => state.acceptable));
    assert.ok(states.every(state => POLICY_ACTIONS.every(check => state.verdicts[check] === 'unread')));
  }
  const first = parsePolicyArtifact(source);
  assert.ok(first.ok);
  if (first.ok) { (first.artifact.states[0].acceptable as { tests: boolean }).tests = true; }
  assert.equal(parsedV2(source).states[0].acceptable.tests, false);
});

test('rejects non-v2 and hostile inputs with typed results and never throws (TASK-2867.08)', () => {
  const cases: Array<[string, unknown, PolicyRejectionCode]> = [
    ['not json', '{nope', 'invalid-json'], ['null', null, 'not-an-object'], ['hostile getter', { get schemaVersion(): never { throw new Error('x'); } }, 'unreadable'],
    ['throwing proxy', { get schemaVersion(): never { throw new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }); } }, 'unreadable'],
    ['contract v1', mutatedV2(a => { a.schemaVersion = 1; }), 'schema-version'],
    ['missing field', mutatedV2(a => { delete a.parameterHash; }), 'missing-field'],
  ];
  for (const [name, input, expected] of cases) { assert.equal(code(input), expected, name); }
  const iterated = parsePolicyArtifact(mutatedV2(a => { let reads = 0; a.states[Symbol.iterator] = function* () { yield a.states[0]; };
    a.states = new Proxy(a.states, { get: (target, key) => (key === 'length' && reads++ ? 0 : Reflect.get(target, key)) }); }));
  assert.equal(iterated.ok && iterated.artifact.states.length, 8);
  const rejected = parsePolicyArtifact(null); assert.ok(!rejected.ok && Object.isFrozen(rejected.rejection));
  for (const input of [undefined, 7, Symbol('x'), () => 1]) { assert.doesNotThrow(() => parsePolicyArtifact(input)); }
});

test('replays hand-computed verdict, repair, reset, retained-pass and failed-verdict history (TASK-2859.04)', () => {
  const a = artifact();
  const agentPass = { kind: 'verdict', check: 'agent', passed: true } as const;
  const passed = deriveBelief(a, [agentPass]);
  assert.ok(passed.ok);
  assert.deepEqual(passed.belief, referenceUpdate({ prior: [...a.prior], transition: POLICY_ACTIONS.map(action => a.transition[action].map(row => [...row])),
    observation: POLICY_ACTIONS.map(action => a.observation[action].map(row => [...row])) }, [...a.prior], 1, 1).belief);
  const repaired = deriveBelief(a, [agentPass, { kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }]);
  assert.ok(repaired.ok); repaired.belief.forEach((mass, index) => assert.ok(Math.abs(mass - a.prior[index]) < 1e-15));
  const reset = deriveBelief(a, [agentPass, { kind: 'unmodelled-change' }]);
  assert.ok(reset.ok); assert.deepEqual(reset, { ok: true, belief: a.prior });
  const retained = deriveBelief(a, [{ kind: 'retained-pass', check: 'tests' }]);
  assert.ok(retained.ok); assert.ok(retained.belief.every((mass, index) => a.states[index].acceptable.tests ? mass > 0 : mass === 0));
  const pending = deriveBelief(a, [{ kind: 'verdict', check: 'human', passed: false }]);
  assert.ok(pending.ok);
  assert.deepEqual(verificationHistoryRecord([{ kind: 'verdict', check: 'human', passed: false }]),
    { passed: [], failed: ['human'] });
  assert.equal('recommendation' in pending, false);
});

test('returns typed contradictions, invalid inputs and unmodelled history without throwing (TASK-2859.04)', () => {
  const impossibleVerdict = artifact(); (impossibleVerdict.prior as number[]).splice(0, 8, ...oneHot(7, 8));
  const noRetainedMass = artifact(); (noRetainedMass.prior as number[]).splice(0, 8, ...oneHot(0, 8));
  const contradiction = deriveBelief(impossibleVerdict, [{ kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }]);
  assert.equal(failure(contradiction), 'contradiction'); assert.equal('belief' in contradiction, false);
  assert.equal(failure(deriveBelief(noRetainedMass, [{ kind: 'retained-pass', check: 'tests' }])), 'contradiction');
  assert.equal(failure(deriveBelief(artifact(), [{ kind: 'repair', check: 'agent' }])), 'unmodelled-history');
  assert.equal(failure(deriveBelief(artifact(), [{ kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'human' }])), 'unmodelled-history');
  const invalid = [{ kind: 'verdict', check: 'unknown', passed: true }] as unknown as VerificationHistoryEntry[];
  assert.doesNotThrow(() => deriveBelief(null as unknown as PolicyArtifact, invalid));
  assert.equal(failure(deriveBelief(artifact(), invalid)), 'invalid');
});

function checkOrders(values: readonly PolicyAction[]): PolicyAction[][] {
  return values.length === 0 ? [[]] : values.flatMap((value, index) =>
    checkOrders(values.filter((_other, otherIndex) => otherIndex !== index)).map(rest => [value, ...rest]));
}

test('all check orders preserve passes and explicit unknowns until all three are eligible (TASK-2859.13)', () => {
  const orders = checkOrders(POLICY_ACTIONS);
  assert.equal(orders.length, 6);
  assert.ok(orders.some(order => order[0] === 'human'));
  assert.ok(orders.some(order => order[0] === 'tests'));
  for (const order of orders) {
    const history: VerificationHistoryEntry[] = [];
    for (const check of order) {
      history.push({ kind: 'verdict', check, passed: true });
      const result = deriveBelief(artifact(), history);
      assert.ok(result.ok, 'passing history must derive a belief');
      const observed = new Set(history.map(entry => 'check' in entry ? entry.check : null));
      const record = verificationHistoryRecord(history);
      assert.deepEqual(verificationCheckStates(record), Object.fromEntries(POLICY_ACTIONS.map(candidate =>
        [candidate, observed.has(candidate) ? 'passed' : 'unknown'])));
      assert.equal(verificationIntegrationEligible(record), history.length === POLICY_ACTIONS.length);
    }
  }
  const retained = deriveBelief(artifact(), [
    { kind: 'retained-pass', check: 'agent' },
    { kind: 'verdict', check: 'human', passed: true },
    { kind: 'verdict', check: 'tests', passed: true },
  ]);
  assert.equal(retained.ok && verificationIntegrationEligible(verificationHistoryRecord([
    { kind: 'retained-pass', check: 'agent' },
    { kind: 'verdict', check: 'human', passed: true },
    { kind: 'verdict', check: 'tests', passed: true },
  ])), true);
});

test('request-changes enters pending repair without losing earlier passes or hiding failures (TASK-2859.13)', () => {
  const humanFirstHistory = [
    { kind: 'verdict', check: 'human', passed: true },
    { kind: 'verdict', check: 'agent', passed: false },
  ] as const;
  const humanFirst = deriveBelief(artifact(), humanFirstHistory);
  const humanFirstRecord = verificationHistoryRecord(humanFirstHistory);
  assert.deepEqual(humanFirst.ok && humanFirstRecord, { passed: ['human'], failed: ['agent'] });
  assert.equal(humanFirst.ok && verificationIntegrationEligible(humanFirstRecord), false);

  for (const check of ['agent', 'human'] as const) {
    const pendingHistory = [{ kind: 'verdict', check, passed: false }] as const;
    const pending = deriveBelief(artifact(), pendingHistory);
    const pendingRecord = verificationHistoryRecord(pendingHistory);
    assert.deepEqual(pending.ok && pendingRecord, { passed: [], failed: [check] });
    assert.equal(pending.ok && verificationCheckStates(pendingRecord)[check], 'failed');
    const skipped = deriveBelief(artifact(), [
      { kind: 'verdict', check, passed: false },
      { kind: 'verdict', check: 'tests', passed: true },
    ]);
    assert.equal(skipped.ok, false);
    assert.equal(skipped.ok ? null : skipped.failure.kind, 'unmodelled-history');
    assert.equal('record' in skipped, false);
  }
});

test('matches the research filter deterministically and stays normalized over 200 fixed-seed steps (TASK-2859.04)', () => {
  const a = artifact();
  const model: FilterModel = { prior: [...a.prior], transition: a.actions.map(action => a.transition[action].map(row => [...row])),
    observation: a.actions.map(action => a.observation[action].map(row => [...row])) };
  const history: VerificationHistoryEntry[] = [];
  let expected = [...a.prior]; let seed = 19;
  const random = () => ((seed = seed * 48_271 % 2_147_483_647) - 1) / 2_147_483_646;
  const sample = (distribution: readonly number[]) => {
    const target = random(); let cumulative = 0;
    for (let index = 0; index < distribution.length; index += 1) { cumulative += distribution[index]; if (target < cumulative) { return index; } }
    return distribution.length - 1;
  };
  let hidden = sample(model.prior);
  for (let step = 0; step < 200; step += 1) {
    const action = Math.floor(random() * 3) as 0 | 1 | 2;
    hidden = sample(model.transition[action][hidden]);
    const passed = sample(model.observation[action][hidden]) === 1;
    history.push({ kind: 'verdict', check: POLICY_ACTIONS[action], passed });
    expected = referenceUpdate(model, expected, action, passed ? 1 : 0).belief;
    if (!passed) {
      history.push({ kind: 'repair', check: POLICY_ACTIONS[action] });
      const repair = action + 3;
      hidden = sample(model.transition[repair][hidden]);
      expected = referencePredict(model, expected, repair);
    }
  }
  const actual = deriveBelief(a, history); assert.ok(actual.ok);
  assert.ok(actual.belief.every(Number.isFinite));
  assert.ok(Math.abs(actual.belief.reduce((sum, value) => sum + value, 0) - 1) <= 1e-9);
  actual.belief.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
  assert.deepEqual(deriveBelief(a, history), actual);
});

test('rejects malformed beliefs before selection or probability calculation (TASK-2859.05 F1)', () => {
  const a = artifact(); const record = { passed: [], failed: [] };
  const negative = oneHot(0, 8); negative[0] = 1.1; negative[1] = -0.1;
  const unnormalized = oneHot(0, 8); unnormalized[0] = 0.5;
  const cases: Array<[unknown, string]> = [
    [[1], 'dimensions'], [Array(9).fill(1 / 9), 'dimensions'],
    [Array(8).fill(NaN), 'non-finite'], [negative, 'negative'], [unnormalized, 'not-normalized'],
  ];
  for (const [belief, reason] of cases) {
    const result = recommend(a, belief as readonly number[], record);
    assert.deepEqual(result, { kind: 'invalid-belief', reason });
    assert.equal('action' in result, false); assert.equal('passProbabilities' in result, false);
  }
});

test('matches the reference best vector on 1000 deterministic contract-v2 beliefs (TASK-2859.05, TASK-2867.08)', () => {
  const a = artifact();
  const vectors = a.vectors as AlphaVector[];
  const record = { passed: [] as PolicyAction[], failed: [] as PolicyAction[] };
  let seed = 2_859_005; const random = () => ((seed = seed * 48_271 % 2_147_483_647) - 1) / 2_147_483_646;
  const selected = new Set<PolicyAction>();
  for (let compared = 0; compared < 1000; compared += 1) {
    const weights = a.states.map(() => random());
    const total = weights.reduce((sum, value) => sum + value, 0);
    const belief = weights.map(value => value / total);
    const expected = referenceSelect(vectors, belief);
    const actual = recommend(a, belief, record);
    assert.ok(actual.kind === 'recommendation'); assert.equal(actual.action, expected.action); selected.add(actual.action);
  }
  assert.ok(selected.size > 1, 'the deterministic belief comparison must exercise more than one selected action');
});

// Contract v2 (TASK-2867.01): every dimension comes from the artifact. All fixtures are SYNTHETIC.
const recommended = (a: PolicyArtifact, history: VerificationHistoryEntry[]) => {
  const belief = deriveBelief(a, history); assert.ok(belief.ok);
  const record = verificationHistoryRecord(history);
  return { belief: belief.belief, record, result: recommend(a, belief.belief, record) };
};

test('parses a synthetic 8-state 7-action v2 artifact and drives recommend from its own dimensions (TASK-2867.01)', () => {
  const a = parsedV2(syntheticV2());
  assert.deepEqual([a.schemaVersion, a.states.length, a.actions.length, a.vectors[0].values.length, a.prior.length], [2, 8, 7, 8, 8]);
  const fresh = recommended(a, []);
  assert.deepEqual(fresh.belief, a.prior);
  assert.ok(fresh.result.kind === 'recommendation' && fresh.result.action === 'tests');
  assert.ok(Math.abs(fresh.result.passProbabilities.tests - 26 / 36) < 1e-12 && Math.abs(fresh.result.passProbabilities.human - 20 / 36) < 1e-12);
  const afterTests = recommended(a, [{ kind: 'verdict', check: 'tests', passed: true }]);
  assert.ok(Math.abs(afterTests.belief[7] - 8 / 26) < 1e-12 && afterTests.belief[3] === 0);
  assert.ok(afterTests.result.kind === 'recommendation' && afterTests.result.action === 'agent');
  // a failed verdict then its repair conditions on the failure, then redraws through the repair action
  const repaired = recommended(a, [{ kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }]);
  assert.ok(repaired.belief.every((mass, index) => Math.abs(mass - a.prior[index]) < 1e-12));
});

test('a synthetic artifact test vector makes the failed check re-runnable, and its absence does not (TASK-2867.05)', () => {
  const states = Array.from({ length: 8 }, (_u, mask) => v2State(mask));
  const a = parsedV2(syntheticV2(states, [...ALL_ACTIONS], 0.25));
  const afterFailure = recommended(a, [{ kind: 'verdict', check: 'tests', passed: false }]);
  const acceptableMass = afterFailure.belief.reduce((sum, mass, index) =>
    sum + (a.states[index].acceptable.tests ? mass : 0), 0);
  assert.ok(acceptableMass > 0 && acceptableMass < 1, 'a flaky failure leaves both acceptable and unacceptable states possible');
  assert.deepEqual(afterFailure.record, { passed: [], failed: ['tests'] });
  assert.ok(afterFailure.result.kind === 'recommendation' && afterFailure.result.action === 'tests');

  const withoutRerun = syntheticV2(states, [...ALL_ACTIONS], 0.25);
  withoutRerun.vectors = withoutRerun.vectors.filter((vector: Json) => vector.action !== 'tests');
  assert.equal(recommended(parsedV2(withoutRerun), [{ kind: 'verdict', check: 'tests', passed: false }]).result.kind,
    'no-recommendation', 'the artifact, not a runtime parameter, decides whether the re-run action exists');

  const afterRerun = recommended(a, [
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'verdict', check: 'tests', passed: true },
  ]);
  assert.deepEqual(afterRerun.record, { passed: ['tests'], failed: [] });
  assert.ok(afterRerun.result.kind === 'recommendation' && afterRerun.result.action !== 'tests',
    'the passed re-run clears the failed test and leaves another check permitted');
});

test('the same record path serves zero flake and an artifact without record-bearing states (TASK-2867.02, TASK-2867.05)', () => {
  const source = syntheticV2();
  assert.ok(source.states.every((state: Json) => !Object.hasOwn(state, 'record')), 'the SYNTHETIC artifact omits state records');
  const a = parsedV2(source);
  assert.ok(a.states.every(state => POLICY_ACTIONS.every(check => state.verdicts[check] === 'unread')));
  const failed = recommended(a, [{ kind: 'verdict', check: 'tests', passed: false }]);
  assert.equal(failed.belief.reduce((sum, mass, index) =>
    sum + (a.states[index].acceptable.tests ? mass : 0), 0), 0, 'beta_1 = 0 makes the failure conclusive');
  assert.deepEqual(failed.record, { passed: [], failed: ['tests'] });
  assert.ok(failed.result.kind === 'recommendation' && failed.result.action === 'tests',
    'a zero pass probability does not override an action present in the artifact');
  const repaired = recommended(a, [
    { kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' },
  ]);
  assert.deepEqual(repaired.record, { passed: [], failed: [] });
  assert.ok(repaired.belief.every((mass, index) => Math.abs(mass - a.prior[index]) < 1e-12));
});

test('a second synthetic v2 artifact of other dimensions parses and recommends with no code change (TASK-2867.01)', () => {
  const small = syntheticV2([1, 3, 5, 7].map(mask => v2State(mask)), ['tests', 'agent', 'human', 'merge']);
  const a = parsedV2(small);
  assert.deepEqual([a.states.length, a.actions, a.vectors[0].values.length], [4, ['tests', 'agent', 'human', 'merge'], 4]);
  const first = recommended(a, []);
  assert.ok(first.result.kind === 'recommendation' && first.result.action === 'human');
  assert.ok(Math.abs(first.result.passProbabilities.tests - 0.7) < 1e-12 && Math.abs(first.result.passProbabilities.agent - 0.6) < 1e-12);
  const second = recommended(a, [{ kind: 'verdict', check: 'tests', passed: true }]);
  assert.deepEqual(second.belief.map(mass => Math.round(mass * 7 * 1e6) / 1e6), [0, 0, 3, 4]);
  assert.ok(second.result.kind === 'recommendation' && second.result.action === 'human');
  // no repair action is declared, so a v2 failed verdict has no modelled repair: a typed failure, never a stale belief
  assert.equal(failure(deriveBelief(a, [{ kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }])), 'unmodelled-history');
  assert.equal(failure(deriveBelief(a, [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'verdict', check: 'tests', passed: true }])), 'ok');
  assert.equal(failure(deriveBelief(a, [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'verdict', check: 'agent', passed: false }, { kind: 'repair', check: 'agent' }])), 'contradiction');
});

test('a v2 state with a verdict record moves a retained pass to its passed-record state (TASK-2867.01)', () => {
  const passedTests = { tests: 'passed', agent: 'unread', human: 'unread' };
  const a = parsedV2(syntheticV2([v2State(7), v2State(7, passedTests), v2State(3)], ['tests', 'agent', 'human', 'merge']));
  assert.deepEqual(a.states[1].verdicts, passedTests);
  assert.deepEqual(a.states[0].verdicts, { tests: 'unread', agent: 'unread', human: 'unread' });
  assert.deepEqual(recommended(a, [{ kind: 'retained-pass', check: 'tests' }]).belief, [0, 1, 0]);
  const missingTarget = parsedV2(syntheticV2([v2State(7), v2State(7, passedTests), v2State(7, { tests: 'unread', agent: 'failed', human: 'unread' })],
    ['tests', 'agent', 'human', 'merge']));
  assert.equal(failure(deriveBelief(missingTarget, [{ kind: 'retained-pass', check: 'agent' }])), 'invalid');
});

test('the parsed v2 value carries action names, parameter hash, solver version and rule-check outcome (TASK-2867.01)', () => {
  const source = syntheticV2();
  for (const input of [source, JSON.stringify(source)]) {
    const a = parsedV2(input as Json);
    assert.deepEqual([a.actions, a.parameterHash, a.solverVersion, a.ruleCheck], [source.actions, 'a'.repeat(64), 'synthetic-v2-1', { outcome: 'passed', violatingMissions: 0 }]);
  }
  assert.deepEqual(parsedV2(mutatedV2(a => { a.ruleCheck = { outcome: 'violated', violatingMissions: 3 }; })).ruleCheck, { outcome: 'violated', violatingMissions: 3 });
});

test('rejects each invalid v2 class with its own typed reason (TASK-2867.01, TASK-2867.08 F1)', () => {
  const cases: Array<[string, Json, PolicyRejectionCode | 'accepted']> = [
    ['transition rows differ from the state count', mutatedV2(a => { a.transition.tests.pop(); }), 'dimensions'],
    ['transition columns differ from the state count', mutatedV2(a => { a.transition.merge[0] = [1]; }), 'dimensions'],
    ['vector length differs from the state count', mutatedV2(a => { a.vectors[0].values.pop(); }), 'dimensions'],
    ['prior length differs from the state count', mutatedV2(a => { a.prior.pop(); }), 'dimensions'],
    ['cost is not finite', mutatedV2(a => { a.cost.tests[0] = Number.NaN; }), 'non-finite'],
    ['transition entry is not numeric', mutatedV2(a => { a.transition.tests[0][0] = '1'; }), 'non-finite'],
    ['vector value is not finite', mutatedV2(a => { a.vectors[0].values[0] = Number.POSITIVE_INFINITY; }), 'non-finite'],
    ['discount reaches one', mutatedV2(a => { a.discount = 1; }), 'out-of-range'],
    ['bounds are reversed', mutatedV2(a => { a.bounds = { lower: 11, upper: 10 }; }), 'out-of-range'],
    ['cost is negative', mutatedV2(a => { a.cost.tests[0] = -1; }), 'out-of-range'],
    ['transition probability exceeds one', mutatedV2(a => { a.transition.tests[0][0] = 1.1; }), 'out-of-range'],
    ['row sum stays inside tolerance', mutatedV2(a => { a.transition['repair-agent'][0][0] += 5e-10; }), 'accepted'],
    ['unknown action name', mutatedV2(a => { a.actions[6] = 'deploy'; }), 'action-names'],
    ['repair declared for only some checks', mutatedV2(a => { a.actions = a.actions.filter((name: string) => name !== 'repair-human'); }), 'action-names'],
    ['repeated action name', mutatedV2(a => { a.actions[6] = 'tests'; }), 'action-names'],
    ['a check is not readable', mutatedV2(a => { a.actions = a.actions.filter((name: string) => name !== 'human'); }), 'action-names'],
    ['an action has no matrix', mutatedV2(a => { delete a.transition['repair-agent']; }), 'missing-field'],
    ['vector names an undeclared action', mutatedV2(a => { a.vectors[0].action = 'deploy'; }), 'numbering'],
    ['hash is not a sha-256 digest', mutatedV2(a => { a.parameterHash = 'hand-written-hash'; }), 'parameter-hash'],
    ['hash is upper case', mutatedV2(a => { a.parameterHash = 'A'.repeat(64); }), 'parameter-hash'],
    ['solver version is empty', mutatedV2(a => { a.solverVersion = ''; }), 'missing-field'],
    ['rule check is absent', mutatedV2(a => { delete a.ruleCheck; }), 'missing-field'],
    ['rule check outcome is unknown', mutatedV2(a => { a.ruleCheck.outcome = 'maybe'; }), 'rule-check'],
    ['rule check passed with violations', mutatedV2(a => { a.ruleCheck.violatingMissions = 2; }), 'rule-check'],
    ['rule check count is fractional', mutatedV2(a => { a.ruleCheck = { outcome: 'violated', violatingMissions: 1.5 }; }), 'rule-check'],
    ['round plan is absent', mutatedV2(a => { delete a.roundPlan; }), 'missing-field'],
    ['round plan serializes agent before tests', mutatedV2(a => { a.roundPlan.stages[0].request = ['agent']; }), 'action-names'],
    ['round plan omits human withdrawal', mutatedV2(a => { a.roundPlan.stages[0].withdrawOnFailure = []; }), 'action-names'],
    ['state omits acceptability', mutatedV2(a => { delete a.states[2].acceptable; }), 'missing-field'],
    ['state record verdict is unknown', mutatedV2(a => { a.states[2].record = { tests: 'lost', agent: 'unread', human: 'unread' }; }), 'out-of-range'],
    ['two states repeat', mutatedV2(a => { a.states[1] = a.states[0]; }), 'numbering'],
    ['observations are reversed', mutatedV2(a => { a.observations.reverse(); }), 'numbering'],
    ['no states', mutatedV2(a => { a.states = []; }), 'dimensions'],
    ['row does not sum to 1', mutatedV2(a => { a.transition.agent[0][0] = 0.5; }), 'row-sum'],
    ['schema version 3', mutatedV2(a => { a.schemaVersion = 3; }), 'schema-version'],
  ];
  for (const [name, input, expected] of cases) { assert.equal(code(input), expected, name); }
  const codes = new Set(cases.map(([, , expected]) => expected));
  for (const required of ['dimensions', 'non-finite', 'out-of-range', 'numbering', 'action-names', 'parameter-hash', 'rule-check', 'accepted']) {
    assert.ok(codes.has(required as PolicyRejectionCode | 'accepted'), required);
  }
});
