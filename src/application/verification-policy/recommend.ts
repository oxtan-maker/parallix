import {
  POLICY_ACTIONS,
  type PerAction,
  type PolicyAction,
  type PolicyArtifact,
} from './policy-artifact.js';
import type { BeliefRecord } from './belief.js';

export type InvalidBeliefReason = 'dimensions' | 'non-finite' | 'negative' | 'not-normalized';
export type PolicyRecommendation =
  | { readonly kind: 'recommendation'; readonly action: PolicyAction; readonly passProbabilities: PerAction<number> }
  | { readonly kind: 'no-recommendation'; readonly passProbabilities: PerAction<number> }
  | { readonly kind: 'invalid-belief'; readonly reason: InvalidBeliefReason };

function invalidBelief(belief: readonly number[], stateCount: number): InvalidBeliefReason | null {
  if (!Array.isArray(belief) || belief.length !== stateCount) { return 'dimensions'; }
  let mass = 0;
  for (const probability of belief) {
    if (typeof probability !== 'number' || !Number.isFinite(probability)) { return 'non-finite'; }
    if (probability < 0) { return 'negative'; }
    mass += probability;
  }
  return Math.abs(mass - 1) > 1e-10 ? 'not-normalized' : null;
}

function passProbabilities(artifact: PolicyArtifact, belief: readonly number[]): PerAction<number> {
  return Object.fromEntries(POLICY_ACTIONS.map(check => [check, belief.reduce((probability, mass, state) =>
    probability + (artifact.states[state].acceptable[check] ? mass : 0), 0)])) as PerAction<number>;
}

/** Checks the artifact can actually select; an action name without a policy vector is not available. */
function availableChecks(artifact: PolicyArtifact): ReadonlySet<PolicyAction> {
  return new Set(artifact.vectors.flatMap(vector => POLICY_ACTIONS.includes(vector.action as PolicyAction)
    ? [vector.action as PolicyAction] : []));
}

/** The runtime's address-immediately rule: an available test action may be re-run; every other failure is repaired first. */
function permittedChecks(artifact: PolicyArtifact, record: BeliefRecord): ReadonlySet<PolicyAction> {
  const available = availableChecks(artifact);
  if (record.failed.length > 0) {
    return new Set(record.failed.includes('tests') && available.has('tests') ? ['tests'] : []);
  }
  return new Set(POLICY_ACTIONS.filter(check => available.has(check) && !record.passed.includes(check)));
}

/** Select the first maximizing artifact vector permitted by the verdict record. */
export function recommend(
  artifact: PolicyArtifact,
  belief: readonly number[],
  record: BeliefRecord,
): PolicyRecommendation {
  const invalid = invalidBelief(belief, artifact.states.length);
  if (invalid) { return { kind: 'invalid-belief', reason: invalid }; }
  const probabilities = passProbabilities(artifact, belief);
  const permitted = permittedChecks(artifact, record);
  let best: { readonly action: PolicyAction; readonly value: number } | undefined;
  for (const vector of artifact.vectors) {
    const action = POLICY_ACTIONS.find(check => check === vector.action); // a repair or merge vector is never a check to start
    if (!action || !permitted.has(action)) { continue; }
    const value = vector.values.reduce((sum, coefficient, state) => sum + coefficient * belief[state], 0);
    if (!best || value > best.value) { best = { action, value }; }
  }
  return best
    ? { kind: 'recommendation', action: best.action, passProbabilities: probabilities }
    : { kind: 'no-recommendation', passProbabilities: probabilities };
}
