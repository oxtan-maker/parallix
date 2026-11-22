import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBelief, verificationCheckStates, verificationHistoryRecord, verificationIntegrationEligible,
  type VerificationHistoryEntry } from '../../../../src/application/verification-policy/belief.js';
import { POLICY_ACTIONS, parsePolicyArtifact, type PolicyAction, type PolicyArtifact, type PolicyRejectionCode } from '../../../../src/application/verification-policy/policy-artifact.js';
import { recommend } from '../../../../src/application/verification-policy/recommend.js';
import { ALL_ACTIONS, policyArtifactFixture as fixture, syntheticPolicyArtifactV2 as syntheticV2,
  v2State, oneHot, half, type Json } from './policy-artifact.fixture.js';

type AlphaVector = { action: PolicyAction; values: number[] };
type FilterModel = { transition: number[][][]; observation: number[][][]; prior: number[] };

/** Independent reference of the belief filter: B_y P' pi, normalized. Contract v1 is outside the research solver, which now solves the current model. */
function referenceUpdate(model: FilterModel, belief: number[], action: number, observation: 0 | 1) {
  const next = belief.map((_p, column) => model.observation[action][column][observation]
    * belief.reduce((sum, p, row) => sum + p * model.transition[action][row][column], 0));
  const probability = next.reduce((sum, value) => sum + value, 0);
  return { probability, belief: next.map(value => value / probability) };
}

/** Independent reference of the maximizing alpha vector. */
function referenceSelect(vectors: AlphaVector[], belief: number[]) {
  const value = (vector: AlphaVector) => vector.values.reduce((sum, entry, state) => sum + entry * belief[state], 0);
  return vectors.reduce((best, vector) => value(vector) > value(best) ? vector : best, vectors[0]);
}

const mutated = (change: (a: Json) => void): Json => { const a = fixture(); change(a); return a; };
const code = (input: unknown): PolicyRejectionCode | 'accepted' => { const r = parsePolicyArtifact(input); return r.ok ? 'accepted' : r.rejection.code; };
const artifact = (): PolicyArtifact => { const result = parsePolicyArtifact(fixture()); if (!result.ok) { throw new Error(result.rejection.message); } return result.artifact; };
const failure = (result: ReturnType<typeof deriveBelief>) => result.ok ? 'ok' : result.failure.kind;

test('parses an exact contract-v1 fixture as value and as text, preserving every field (TASK-2859.03)', () => {
  for (const input of [fixture(), JSON.stringify(fixture())]) {
    const result = parsePolicyArtifact(input);
    assert.ok(result.ok);
    assert.ok(result.ok);
    const { states, schemaVersion, ruleCheck, ...rest } = result.artifact;
    const { states: sourceStates, schemaVersion: sourceVersion, ...sourceRest } = fixture();
    assert.deepEqual(rest, sourceRest);
    // the thin v1-to-v2 mapping: a status says acceptable and, once passed, the carried verdict
    assert.deepEqual([schemaVersion, sourceVersion, ruleCheck, states.length, sourceStates.length], [1, 1, null, 27, 27]);
    assert.deepEqual(states[0], { acceptable: { tests: false, agent: false, human: false }, verdicts: { tests: 'unread', agent: 'unread', human: 'unread' } });
    assert.deepEqual(states[13], { acceptable: { tests: true, agent: true, human: true }, verdicts: { tests: 'unread', agent: 'unread', human: 'unread' } });
    assert.deepEqual(states[26], { acceptable: { tests: true, agent: true, human: true }, verdicts: { tests: 'passed', agent: 'passed', human: 'passed' } });
  }
});

test('parsed artifacts do not share mutable state objects across parses (TASK-2859.03)', () => {
  const first = parsePolicyArtifact(fixture());
  assert.ok(first.ok);
  if (first.ok) { (first.artifact.states[0].acceptable as { tests: boolean }).tests = true; }
  assert.equal(code(fixture()), 'accepted');
});

test('rejects each malformed class with a typed rejection and never throws (TASK-2859.03)', () => {
  const cases: Array<[string, unknown, PolicyRejectionCode]> = [
    ['not json', '{nope', 'invalid-json'], ['null', null, 'not-an-object'], ['hostile getter', { get schemaVersion(): never { throw new Error('x'); } }, 'unreadable'],
    ['throwing proxy', { get schemaVersion(): never { throw new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }); } }, 'unreadable'],
    ['schema version', mutated(a => { a.schemaVersion = 3; }), 'schema-version'],
    ['missing field', mutated(a => { delete a.parameterHash; }), 'missing-field'],
    ['missing action matrix', mutated(a => { delete a.transition.human; }), 'missing-field'],
    ['unknown objective', mutated(a => { a.objective = 'speed'; }), 'out-of-range'],
    ['swapped states', mutated(a => { [a.states[0], a.states[1]] = [a.states[1], a.states[0]]; }), 'numbering'],
    ['numbered actions', mutated(a => { a.actions = [0, 1, 2]; }), 'numbering'],
    ['reordered observations', mutated(a => { a.observations = ['passed', 'not-passed']; }), 'numbering'],
    ['numbered vector action', mutated(a => { a.vectors[0].action = 0; }), 'numbering'],
    ['26 states', mutated(a => { a.states.pop(); }), 'dimensions'],
    ['26 transition rows', mutated(a => { a.transition.agent.pop(); }), 'dimensions'],
    ['26 transition columns', mutated(a => { a.transition.human[3].pop(); }), 'dimensions'],
    ['3 observation columns', mutated(a => { a.observation.tests[2] = [0.2, 0.3, 0.5]; }), 'dimensions'],
    ['26 costs', mutated(a => { a.cost.tests.pop(); }), 'dimensions'],
    ['26 prior values', mutated(a => { a.prior.pop(); }), 'dimensions'],
    ['26 vector values', mutated(a => { a.vectors[1].values.pop(); }), 'dimensions'],
    ['sparse vectors', mutated(a => { delete a.vectors[1]; }), 'not-an-object'], ['no vectors', mutated(a => { a.vectors = []; }), 'dimensions'],
    ['NaN cost', mutated(a => { a.cost.agent[5] = NaN; }), 'non-finite'],
    ['infinite vector value', mutated(a => { a.vectors[0].values[2] = Infinity; }), 'non-finite'],
    ['string entry', mutated(a => { a.transition.tests[0][0] = '1'; }), 'non-finite'],
    ['transition row off by 2e-9', mutated(a => { a.transition.tests[4][4] = 0.5 + 2e-9; }), 'row-sum'],
    ['observation row off by 2e-9', mutated(a => { a.observation.agent[0] = [0.25, 0.75 + 2e-9]; }), 'row-sum'],
    ['prior off by 2e-9', mutated(a => { a.prior[13] = 1 - 2e-9; }), 'row-sum'],
    ['negative probability', mutated(a => { Object.assign(a.transition.human[0], { 0: -0.5, 1: 0.5, 26: 1 }); }), 'out-of-range'],
    ['sparse actions', mutated(a => { a.actions = new Array(3); }), 'numbering'], ['deleted state', mutated(a => { delete a.states[0]; }), 'not-an-object'],
    ['sparse transition row', mutated(a => { a.transition.tests[3] = Object.assign(new Array(27), { 26: 1 }); }), 'non-finite'],
    ['probability above 1', mutated(a => { a.prior = oneHot(0); a.prior[0] = 1 + 5e-10; }), 'out-of-range'],
    ['negative cost', mutated(a => { a.cost.tests[0] = -1; }), 'out-of-range'],
    ['discount 1', mutated(a => { a.discount = 1; }), 'out-of-range'],
    ['reversed bounds', mutated(a => { a.bounds = { lower: 15, upper: 14 }; }), 'out-of-range'],
    ['state 27 not absorbing', mutated(a => { a.transition.tests[26] = half(25); }), 'absorbing-state'],
    ['state 27 with cost', mutated(a => { a.cost.human[26] = 1; }), 'absorbing-state'],
  ];
  for (const [name, input, expected] of cases) { assert.equal(code(input), expected, name); }
  assert.equal(code(mutated(a => { a.transition.tests[4][4] = 0.5 + 5e-10; })), 'accepted');
  const iterated = parsePolicyArtifact(mutated(a => { let reads = 0; a.states[Symbol.iterator] = function* () { yield a.states[0]; };
    a.states = new Proxy(a.states, { get: (target, key) => (key === 'length' && reads++ ? 0 : Reflect.get(target, key)) }); }));
  assert.equal(iterated.ok && iterated.artifact.states.length, 27);
  const rejected = parsePolicyArtifact(null); assert.ok(!rejected.ok && Object.isFrozen(rejected.rejection));
  for (const input of [undefined, 7, Symbol('x'), () => 1]) { assert.doesNotThrow(() => parsePolicyArtifact(input)); }
});

test('replays hand-computed verdict, repair, reset, retained-pass and failed-verdict history (TASK-2859.04)', () => {
  const a = artifact();
  const agentPass = { kind: 'verdict', check: 'agent', passed: true } as const;
  const passed = deriveBelief(a, [agentPass]);
  assert.ok(passed.ok);
  assert.ok(Math.abs(passed.belief[13] - 3 / 7) < 1e-12 && Math.abs(passed.belief[26] - 4 / 7) < 1e-12);
  const repaired = deriveBelief(a, [agentPass, { kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }]);
  assert.ok(repaired.ok); assert.deepEqual(repaired.belief, oneHot(13));
  const reset = deriveBelief(a, [agentPass, { kind: 'unmodelled-change' }]);
  assert.ok(reset.ok); assert.deepEqual(reset, { ok: true, belief: a.prior });
  const retained = deriveBelief(a, [{ kind: 'retained-pass', check: 'tests' }]);
  assert.ok(retained.ok); assert.deepEqual(retained, { ok: true, belief: oneHot(22) });
  const pending = deriveBelief(a, [{ kind: 'verdict', check: 'human', passed: false }]);
  assert.ok(pending.ok);
  assert.deepEqual(verificationHistoryRecord([{ kind: 'verdict', check: 'human', passed: false }]),
    { passed: [], failed: ['human'] });
  assert.equal('recommendation' in pending, false);
});

test('returns typed contradictions, invalid inputs and unmodelled history without throwing (TASK-2859.04)', () => {
  const impossibleVerdict = artifact(); (impossibleVerdict.prior as number[]).splice(0, 27, ...oneHot(26));
  const noRetainedMass = artifact(); (noRetainedMass.prior as number[]).splice(0, 27, ...oneHot(0));
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
  const model: FilterModel = { prior: [...a.prior],
    transition: POLICY_ACTIONS.map(action => a.transition[action].map(row => [...row])),
    observation: POLICY_ACTIONS.map(action => a.observation[action].map(row => [...row])) };
  const history: VerificationHistoryEntry[] = [];
  let expected = [...a.prior]; let seed = 19;
  for (let step = 0; step < 200; step += 1) {
    seed = seed * 48_271 % 2_147_483_647;
    const action = seed % 3 as 0 | 1 | 2; const passed = seed % 5 !== 0;
    history.push({ kind: 'verdict', check: POLICY_ACTIONS[action], passed });
    if (!passed) { history.push({ kind: 'repair', check: POLICY_ACTIONS[action] }); }
    expected = referenceUpdate(model, expected, action, passed ? 1 : 0).belief;
  }
  const actual = deriveBelief(a, history); assert.ok(actual.ok);
  assert.ok(actual.belief.every(Number.isFinite));
  assert.ok(Math.abs(actual.belief.reduce((sum, value) => sum + value, 0) - 1) <= 1e-9);
  actual.belief.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
  assert.deepEqual(deriveBelief(a, history), actual);
});

test('selects only permitted vectors and reports each predicted pass probability (TASK-2859.05)', () => {
  const a = artifact();
  const belief = Array<number>(27).fill(0);
  Object.assign(belief, { 0: 0.1, 9: 0.2, 4: 0.3, 26: 0.4 });
  const unrestricted = recommend(a, belief, { passed: [], failed: [] });
  assert.ok(unrestricted.kind === 'recommendation');
  assert.equal(unrestricted.action, 'human');
  assert.ok(Math.abs(unrestricted.passProbabilities.tests - 0.6) < 1e-12);
  assert.ok(Math.abs(unrestricted.passProbabilities.agent - 0.7) < 1e-12);
  assert.ok(Math.abs(unrestricted.passProbabilities.human - 0.7) < 1e-12);
  const restricted = recommend(a, belief, { passed: ['human'], failed: [] });
  assert.ok(restricted.kind === 'recommendation'); assert.equal(restricted.action, 'tests');
  assert.equal(recommend(a, belief, { passed: [...POLICY_ACTIONS], failed: [] }).kind, 'no-recommendation');
});

test('rejects malformed beliefs before selection or probability calculation (TASK-2859.05 F1)', () => {
  const a = artifact(); const record = { passed: [], failed: [] };
  const negative = oneHot(0); negative[0] = 1.1; negative[1] = -0.1;
  const unnormalized = oneHot(0); unnormalized[0] = 0.5;
  const cases: Array<[unknown, string]> = [
    [[1], 'dimensions'], [Array(28).fill(1 / 28), 'dimensions'],
    [Array(27).fill(NaN), 'non-finite'], [negative, 'negative'], [unnormalized, 'not-normalized'],
  ];
  for (const [belief, reason] of cases) {
    const result = recommend(a, belief as readonly number[], record);
    assert.deepEqual(result, { kind: 'invalid-belief', reason });
    assert.equal('action' in result, false); assert.equal('passProbabilities' in result, false);
  }
});

test('matches the reference best vector on 1000 beliefs reached from a synthetic contract-v1 artifact (TASK-2859.05)', () => {
  const states = artifact().states;
  const fresh = [0.03, 0.07, 0.11, 0.13, 0.17, 0.19, 0.14, 0.16];
  const freshStates = [0, 1, 3, 4, 9, 10, 12, 13];
  const code = { 'would-fail': 0, 'would-pass': 1, passed: 2 } as const;
  const status = (state: (typeof states)[number], check: PolicyAction) =>
    state.verdicts[check] === 'passed' ? 'passed' : state.acceptable[check] ? 'would-pass' : 'would-fail';
  const transition = POLICY_ACTIONS.map((action, slot) => states.map((state, index) => {
    const row = Array<number>(27).fill(0);
    if (index === 26 || status(state, action) === 'passed') { row[index] = 1; }
    else if (status(state, action) === 'would-pass') {
      const statuses = POLICY_ACTIONS.map(check => code[status(state, check)]);
      statuses[slot] = 2;
      row[9 * statuses[0] + 3 * statuses[1] + statuses[2]] = 1;
    } else { freshStates.forEach((next, position) => { row[next] = fresh[position]; }); }
    return row;
  }));
  const observation = POLICY_ACTIONS.map(action => states.map(state => status(state, action) === 'passed' ? [0, 1] : [1, 0]));
  const prior = Array<number>(27).fill(0); freshStates.forEach((state, index) => { prior[state] = fresh[index]; });
  const cost = POLICY_ACTIONS.map((_action, slot) => states.map((_state, index) => index === 26 ? 0 : slot + 1));
  const model: FilterModel = { transition, observation, prior };
  const vectors: AlphaVector[] = POLICY_ACTIONS.flatMap((action, slot) => [
    { action, values: states.map((state, index) => 7 * code[status(state, action)] - (index * (slot + 2) % 11)) },
    { action, values: states.map((state, index) => 4 * code[status(state, action)] + (index * (slot + 3) % 13) - 8) },
  ]);
  const byAction = <T>(values: T[]) => Object.fromEntries(POLICY_ACTIONS.map((name, slot) => [name, values[slot]]));
  const emitted = { schemaVersion: 1, objective: 'time', parameterHash: '0'.repeat(64), solverVersion: 'synthetic-unit', discount: 0.99,
    states: states.map(state => Object.fromEntries(POLICY_ACTIONS.map(check => [check, status(state, check)]))),
    actions: [...POLICY_ACTIONS], observations: ['not-passed', 'passed'], transition: byAction(transition), observation: byAction(observation),
    cost: byAction(cost), prior, vectors, bounds: { lower: -20, upper: 20 }, predicted: { policyValue: 0, currentSequenceValue: 0 } };
  const parsed = parsePolicyArtifact(JSON.stringify(emitted)); assert.ok(parsed.ok);
  const a = parsed.artifact;
  const record = { passed: [] as PolicyAction[], failed: [] as PolicyAction[] };
  let seed = 2_859_005; const random = () => ((seed = seed * 48_271 % 2_147_483_647) - 1) / 2_147_483_646;
  const sample = (distribution: readonly number[]) => {
    const target = random(); let cumulative = 0;
    for (let index = 0; index < distribution.length; index += 1) { cumulative += distribution[index]; if (target < cumulative) { return index; } }
    return distribution.length - 1;
  };
  let belief = [...model.prior]; let hidden = sample(model.prior); const selected = new Set<PolicyAction>();
  for (let compared = 0; compared < 1000; compared += 1) {
    const expected = referenceSelect(vectors, belief);
    const actual = recommend(a, belief, record);
    assert.ok(actual.kind === 'recommendation'); assert.equal(actual.action, expected.action); selected.add(actual.action);
    const action = Math.floor(random() * POLICY_ACTIONS.length) as 0 | 1 | 2;
    hidden = sample(model.transition[action][hidden]);
    const observed = sample(model.observation[action][hidden]) as 0 | 1;
    belief = referenceUpdate(model, belief, action, observed).belief;
    if (hidden === 26) { hidden = sample(model.prior); belief = [...model.prior]; }
  }
  assert.ok(selected.size > 1, 'the reachable-belief comparison must exercise more than one selected action');
});

// Contract v2 (TASK-2867.01): every dimension comes from the artifact. All fixtures are SYNTHETIC.
const parsedV2 = (input: Json): PolicyArtifact => { const result = parsePolicyArtifact(input); if (!result.ok) { throw new Error(result.rejection.message); } return result.artifact; };
const mutatedV2 = (change: (a: Json) => void, base: Json = syntheticV2()): Json => { change(base); return base; };
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

test('a synthetic flaky-test failure stays inconclusive while its record permits only a test re-run (TASK-2867.02)', () => {
  const states = Array.from({ length: 8 }, (_u, mask) => v2State(mask));
  const a = parsedV2(syntheticV2(states, [...ALL_ACTIONS], 0.25));
  const afterFailure = recommended(a, [{ kind: 'verdict', check: 'tests', passed: false }]);
  const acceptableMass = afterFailure.belief.reduce((sum, mass, index) =>
    sum + (a.states[index].acceptable.tests ? mass : 0), 0);
  assert.ok(acceptableMass > 0 && acceptableMass < 1, 'a flaky failure leaves both acceptable and unacceptable states possible');
  assert.deepEqual(afterFailure.record, { passed: [], failed: ['tests'] });
  assert.ok(afterFailure.result.kind === 'recommendation' && afterFailure.result.action === 'tests');

  const afterRerun = recommended(a, [
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'verdict', check: 'tests', passed: true },
  ]);
  assert.deepEqual(afterRerun.record, { passed: ['tests'], failed: [] });
  assert.ok(afterRerun.result.kind === 'recommendation' && afterRerun.result.action !== 'tests',
    'the passed re-run clears the failed test and leaves another check permitted');
});

test('the same record path serves zero flake and an artifact without record-bearing states (TASK-2867.02)', () => {
  const source = syntheticV2();
  assert.ok(source.states.every((state: Json) => !Object.hasOwn(state, 'record')), 'the SYNTHETIC artifact omits state records');
  const a = parsedV2(source);
  assert.ok(a.states.every(state => POLICY_ACTIONS.every(check => state.verdicts[check] === 'unread')));
  const failed = recommended(a, [{ kind: 'verdict', check: 'tests', passed: false }]);
  assert.equal(failed.belief.reduce((sum, mass, index) =>
    sum + (a.states[index].acceptable.tests ? mass : 0), 0), 0, 'beta_1 = 0 makes the failure conclusive');
  assert.deepEqual(failed.record, { passed: [], failed: ['tests'] });
  assert.ok(failed.result.kind === 'recommendation' && failed.result.action === 'tests');
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

test('rejects each invalid v2 class with its own typed reason (TASK-2867.01)', () => {
  const cases: Array<[string, Json, PolicyRejectionCode]> = [
    ['transition rows differ from the state count', mutatedV2(a => { a.transition.tests.pop(); }), 'dimensions'],
    ['transition columns differ from the state count', mutatedV2(a => { a.transition.merge[0] = [1]; }), 'dimensions'],
    ['vector length differs from the state count', mutatedV2(a => { a.vectors[0].values.pop(); }), 'dimensions'],
    ['prior length differs from the state count', mutatedV2(a => { a.prior.pop(); }), 'dimensions'],
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
    ['state omits acceptability', mutatedV2(a => { delete a.states[2].acceptable; }), 'missing-field'],
    ['state record verdict is unknown', mutatedV2(a => { a.states[2].record = { tests: 'lost', agent: 'unread', human: 'unread' }; }), 'out-of-range'],
    ['two states repeat', mutatedV2(a => { a.states[1] = a.states[0]; }), 'numbering'],
    ['no states', mutatedV2(a => { a.states = []; }), 'dimensions'],
    ['row does not sum to 1', mutatedV2(a => { a.transition.agent[0][0] = 0.5; }), 'row-sum'],
    ['schema version 3', mutatedV2(a => { a.schemaVersion = 3; }), 'schema-version'],
  ];
  for (const [name, input, expected] of cases) { assert.equal(code(input), expected, name); }
  const codes = new Set(cases.map(([, , expected]) => expected));
  for (const required of ['dimensions', 'action-names', 'parameter-hash', 'rule-check']) { assert.ok(codes.has(required as PolicyRejectionCode), required); }
});
