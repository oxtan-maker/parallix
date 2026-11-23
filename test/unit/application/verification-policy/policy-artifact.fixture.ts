export type Json = Record<string, any>;
export const oneHot = (at: number, size: number) => Array.from({ length: size }, (_u, k) => Number(k === at));

const CHECKS = ['tests', 'agent', 'human'] as const;
/** A v2 state: the checks the code is acceptable to, from a 3-bit mask (tests = 4, agent = 2, human = 1), plus an optional verdict record. */
export const v2State = (mask: number, record?: Record<string, string>): Json => ({
  acceptable: Object.fromEntries(CHECKS.map((check, slot) => [check, Boolean(mask & (4 >> slot))])), ...(record ? { record } : {}),
});
export const ALL_ACTIONS = ['tests', 'agent', 'human', 'repair-tests', 'repair-agent', 'repair-human', 'merge'];
/**
 * SYNTHETIC contract-v2 artifact: hand-built numbers, no estimate of any real parameter and no solver output.
 * Reads and merge keep the state; a repair redraws it from the prior; a read observes whether the state is acceptable.
 */
export function syntheticPolicyArtifactV2(states: Json[] = Array.from({ length: 8 }, (_u, mask) => v2State(mask)),
  actions: string[] = ALL_ACTIONS, testFlakeRate = 0): Json {
  const count = states.length;
  const prior = Array.from({ length: count }, (_u, k) => (k + 1) / (count * (count + 1) / 2));
  const identity = () => Array.from({ length: count }, (_u, k) => oneHot(k, count));
  const redraw = () => Array.from({ length: count }, () => [...prior]);
  const reads = (action: string) => CHECKS.indexOf(action as 'tests');
  const observe = (action: string) => states.map(state => {
    if (reads(action) < 0) { return [0, 1]; }
    if (!state.acceptable[action]) { return [1, 0]; }
    return action === 'tests' ? [testFlakeRate, 1 - testFlakeRate] : [0, 1];
  });
  const cost = (action: string) => states.map(() => [1.1, 1, 3][reads(action)] ?? (action === 'merge' ? 0.5 : 6));
  const byAction = (build: (action: string) => unknown) => Object.fromEntries(actions.map(action => [action, build(action)]));
  return {
    schemaVersion: 2, objective: 'time', parameterHash: 'a'.repeat(64), solverVersion: 'synthetic-v2-1', discount: 0.99,
    ruleCheck: { outcome: 'passed', violatingMissions: 0 },
    roundPlan: { rule: 'all-then-last', repairMode: 'joint', stages: [
      { request: ['agent', 'tests', 'human'], waitFor: ['agent', 'tests'], repair: ['agent', 'tests'], withdrawOnFailure: ['human'] },
      { request: [], waitFor: ['human'], repair: ['human'], withdrawOnFailure: [] },
    ] },
    states, actions: [...actions], observations: ['not-passed', 'passed'],
    transition: byAction(action => (action.startsWith('repair-') ? redraw() : identity())),
    observation: byAction(observe), cost: byAction(cost), prior,
    vectors: CHECKS.map((check, slot) => ({ action: check,
      values: states.map(state => (state.acceptable[check] ? 10 - slot * 0.01 : 2)) })),
    bounds: { lower: 9, upper: 10 }, predicted: { policyValue: 9.5, currentSequenceValue: 11 },
  };
}
