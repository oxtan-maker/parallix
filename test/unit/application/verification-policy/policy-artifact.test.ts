import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBelief, type VerificationHistoryEntry } from '../../../../src/application/verification-policy/belief.js';
import { POLICY_ACTIONS, parsePolicyArtifact, type PolicyAction, type PolicyArtifact, type PolicyRejectionCode } from '../../../../src/application/verification-policy/policy-artifact.js';
import { recommend } from '../../../../src/application/verification-policy/recommend.js';
import { selectAlpha, type AlphaVector } from '../../../../research/verification-pomdp/alpha-policy.js';
import { buildPolicyArtifact } from '../../../../research/verification-pomdp/artifact.js';
import { updateBelief, type SolverModel } from '../../../../research/verification-pomdp/solver-model.js';
import { policyArtifactFixture as fixture, oneHot, half, type Json } from './policy-artifact.fixture.js';

const mutated = (change: (a: Json) => void): Json => { const a = fixture(); change(a); return a; };
const code = (input: unknown): PolicyRejectionCode | 'accepted' => { const r = parsePolicyArtifact(input); return r.ok ? 'accepted' : r.rejection.code; };
const artifact = (): PolicyArtifact => { const result = parsePolicyArtifact(fixture()); if (!result.ok) { throw new Error(result.rejection.message); } return result.artifact; };
const failure = (result: ReturnType<typeof deriveBelief>) => result.ok ? 'ok' : result.failure.kind;

test('parses an exact contract-v1 fixture as value and as text, preserving every field (TASK-2859.03)', () => {
  for (const input of [fixture(), JSON.stringify(fixture())]) {
    const result = parsePolicyArtifact(input);
    assert.ok(result.ok);
    assert.deepEqual(result.ok && result.artifact, fixture());
  }
});

test('parsed artifacts do not share mutable state objects across parses (TASK-2859.03)', () => {
  const first = parsePolicyArtifact(fixture());
  assert.ok(first.ok);
  if (first.ok) { (first.artifact.states[0] as { tests: string }).tests = 'passed'; }
  assert.equal(code(fixture()), 'accepted');
});

test('rejects each malformed class with a typed rejection and never throws (TASK-2859.03)', () => {
  const cases: Array<[string, unknown, PolicyRejectionCode]> = [
    ['not json', '{nope', 'invalid-json'], ['null', null, 'not-an-object'], ['hostile getter', { get schemaVersion(): never { throw new Error('x'); } }, 'unreadable'],
    ['throwing proxy', { get schemaVersion(): never { throw new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }); } }, 'unreadable'],
    ['schema version', mutated(a => { a.schemaVersion = 2; }), 'schema-version'],
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

test('replays hand-computed verdict, repair, reset, retained-pass and pending-repair history (TASK-2859.04)', () => {
  const a = artifact();
  const agentPass = { kind: 'verdict', check: 'agent', passed: true } as const;
  const passed = deriveBelief(a, [agentPass]);
  assert.ok(passed.ok);
  assert.ok(Math.abs(passed.belief[13] - 3 / 7) < 1e-12 && Math.abs(passed.belief[26] - 4 / 7) < 1e-12);
  const repaired = deriveBelief(a, [agentPass, { kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }]);
  assert.ok(repaired.ok); assert.deepEqual(repaired.belief, oneHot(13));
  const reset = deriveBelief(a, [agentPass, { kind: 'unmodelled-change' }]);
  assert.ok(reset.ok); assert.deepEqual(reset, { ok: true, belief: a.prior, record: { kind: 'complete', passed: [] } });
  const retained = deriveBelief(a, [{ kind: 'retained-pass', check: 'tests' }]);
  assert.ok(retained.ok); assert.deepEqual(retained, { ok: true, belief: oneHot(22), record: { kind: 'complete', passed: ['tests'] } });
  const pending = deriveBelief(a, [{ kind: 'verdict', check: 'human', passed: false }]);
  assert.ok(pending.ok); assert.deepEqual(pending, { ok: true, belief: a.prior, record: { kind: 'pending-repair', check: 'human', passed: [] } });
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

test('matches the research filter deterministically and stays normalized over 200 fixed-seed steps (TASK-2859.04)', () => {
  const a = artifact();
  const model: SolverModel = { objective: 'T', discount: a.discount, prior: [...a.prior], cost: [[], [], []],
    transition: POLICY_ACTIONS.map(action => a.transition[action].map(row => [...row])),
    observation: POLICY_ACTIONS.map(action => a.observation[action].map(row => [...row])) };
  const history: VerificationHistoryEntry[] = [];
  let expected = [...a.prior]; let seed = 19;
  for (let step = 0; step < 200; step += 1) {
    seed = seed * 48_271 % 2_147_483_647;
    const action = seed % 3 as 0 | 1 | 2; const passed = seed % 5 !== 0;
    history.push({ kind: 'verdict', check: POLICY_ACTIONS[action], passed });
    if (!passed) { history.push({ kind: 'repair', check: POLICY_ACTIONS[action] }); }
    expected = updateBelief(model, expected, action, passed ? 1 : 0).belief;
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
  const unrestricted = recommend(a, belief, new Set(POLICY_ACTIONS));
  assert.ok(unrestricted.kind === 'recommendation');
  assert.equal(unrestricted.action, 'human');
  assert.ok(Math.abs(unrestricted.passProbabilities.tests - 0.6) < 1e-12);
  assert.ok(Math.abs(unrestricted.passProbabilities.agent - 0.7) < 1e-12);
  assert.ok(Math.abs(unrestricted.passProbabilities.human - 0.7) < 1e-12);
  const restricted = recommend(a, belief, new Set<PolicyAction>(['tests', 'agent']));
  assert.ok(restricted.kind === 'recommendation'); assert.equal(restricted.action, 'tests');
  assert.equal(recommend(a, belief, new Set()).kind, 'no-recommendation');
});

test('rejects malformed beliefs before selection or probability calculation (TASK-2859.05 F1)', () => {
  const a = artifact(); const permitted = new Set(POLICY_ACTIONS);
  const negative = oneHot(0); negative[0] = 1.1; negative[1] = -0.1;
  const unnormalized = oneHot(0); unnormalized[0] = 0.5;
  const cases: Array<[unknown, string]> = [
    [[1], 'dimensions'], [Array(28).fill(1 / 28), 'dimensions'],
    [Array(27).fill(NaN), 'non-finite'], [negative, 'negative'], [unnormalized, 'not-normalized'],
  ];
  for (const [belief, reason] of cases) {
    const result = recommend(a, belief as readonly number[], permitted);
    assert.deepEqual(result, { kind: 'invalid-belief', reason });
    assert.equal('action' in result, false); assert.equal('passProbabilities' in result, false);
  }
});

test('matches the solver best vector on 1000 beliefs reached from a synthetic emitted artifact (TASK-2859.05)', () => {
  const states = artifact().states;
  const fresh = [0.03, 0.07, 0.11, 0.13, 0.17, 0.19, 0.14, 0.16];
  const freshStates = [0, 1, 3, 4, 9, 10, 12, 13];
  const code = { 'would-fail': 0, 'would-pass': 1, passed: 2 } as const;
  const transition = POLICY_ACTIONS.map((action, slot) => states.map((state, index) => {
    const row = Array<number>(27).fill(0);
    if (index === 26 || state[action] === 'passed') { row[index] = 1; }
    else if (state[action] === 'would-pass') {
      const statuses = POLICY_ACTIONS.map(check => code[state[check]]);
      statuses[slot] = 2;
      row[9 * statuses[0] + 3 * statuses[1] + statuses[2]] = 1;
    } else { freshStates.forEach((next, position) => { row[next] = fresh[position]; }); }
    return row;
  }));
  const observation = POLICY_ACTIONS.map(action => states.map(state => state[action] === 'passed' ? [0, 1] : [1, 0]));
  const prior = Array<number>(27).fill(0); freshStates.forEach((state, index) => { prior[state] = fresh[index]; });
  const model: SolverModel = { objective: 'T', discount: 0.99, transition, observation,
    cost: POLICY_ACTIONS.map((_action, slot) => states.map((_state, index) => index === 26 ? 0 : slot + 1)), prior };
  const vectors: AlphaVector[] = POLICY_ACTIONS.flatMap((action, slot) => [
    { action, values: states.map((state, index) => 7 * code[state[action]] - (index * (slot + 2) % 11)) },
    { action, values: states.map((state, index) => 4 * code[state[action]] + (index * (slot + 3) % 13) - 8) },
  ]);
  const emitted = buildPolicyArtifact({ model, objective: 'T', solverVersion: 'synthetic-unit',
    parameterFileSha256: '0'.repeat(64), vectors, bounds: { lower: -20, upper: 20 }, policyValue: 0, currentSequenceValue: 0 });
  const parsed = parsePolicyArtifact(emitted.canonical); assert.ok(parsed.ok);
  const a = parsed.artifact;
  const permitted = new Set(POLICY_ACTIONS);
  let seed = 2_859_005; const random = () => ((seed = seed * 48_271 % 2_147_483_647) - 1) / 2_147_483_646;
  const sample = (distribution: readonly number[]) => {
    const target = random(); let cumulative = 0;
    for (let index = 0; index < distribution.length; index += 1) { cumulative += distribution[index]; if (target < cumulative) { return index; } }
    return distribution.length - 1;
  };
  let belief = [...model.prior]; let hidden = sample(model.prior); const selected = new Set<PolicyAction>();
  for (let compared = 0; compared < 1000; compared += 1) {
    const expected = selectAlpha(vectors, belief);
    const actual = recommend(a, belief, permitted);
    assert.ok(actual.kind === 'recommendation'); assert.equal(actual.action, expected.action); selected.add(actual.action);
    const action = Math.floor(random() * POLICY_ACTIONS.length) as 0 | 1 | 2;
    hidden = sample(model.transition[action][hidden]);
    const observed = sample(model.observation[action][hidden]) as 0 | 1;
    belief = updateBelief(model, belief, action, observed).belief;
    if (hidden === 26) { hidden = sample(model.prior); belief = [...model.prior]; }
  }
  assert.ok(selected.size > 1, 'the reachable-belief comparison must exercise more than one selected action');
});
