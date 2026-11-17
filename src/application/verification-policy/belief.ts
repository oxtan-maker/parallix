import {
  POLICY_ACTIONS,
  POLICY_ROW_TOLERANCE,
  POLICY_STATE_COUNT,
  type PolicyAction,
  type PolicyArtifact,
  type PolicyObservation,
  type PolicyStatus,
} from './policy-artifact.js';

export type VerificationHistoryEntry =
  | { readonly kind: 'verdict'; readonly check: PolicyAction; readonly passed: boolean }
  | { readonly kind: 'repair'; readonly check: PolicyAction }
  | { readonly kind: 'retained-pass'; readonly check: PolicyAction }
  | { readonly kind: 'unmodelled-change' };

export type BeliefRecord =
  | { readonly kind: 'complete'; readonly passed: readonly PolicyAction[] }
  | { readonly kind: 'pending-repair'; readonly check: PolicyAction; readonly passed: readonly PolicyAction[] };

export type BeliefFailureKind = 'contradiction' | 'unmodelled-history' | 'invalid';
export type BeliefDerivation =
  | { readonly ok: true; readonly belief: readonly number[]; readonly record: BeliefRecord }
  | { readonly ok: false; readonly failure: { readonly kind: BeliefFailureKind; readonly historyIndex: number | null; readonly message: string } };

const failed = (kind: BeliefFailureKind, message: string, historyIndex: number | null = null): BeliefDerivation =>
  ({ ok: false, failure: { kind, historyIndex, message } });
const isCheck = (value: unknown): value is PolicyAction => POLICY_ACTIONS.includes(value as PolicyAction);
const statusCode: Record<PolicyStatus, number> = { 'would-fail': 0, 'would-pass': 1, passed: 2 };

function validatedPrior(artifact: PolicyArtifact): readonly number[] | null {
  if (!Array.isArray(artifact.prior) || artifact.prior.length !== POLICY_STATE_COUNT) { return null; }
  let sum = 0;
  const copy: number[] = [];
  for (const value of artifact.prior as readonly unknown[]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) { return null; }
    sum += value; copy.push(value);
  }
  return Math.abs(sum - 1) <= POLICY_ROW_TOLERANCE ? copy : null;
}

function normalized(values: number[], message: string, historyIndex: number): BeliefDerivation | readonly number[] {
  let mass = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) { return failed('invalid', 'artifact produced an invalid belief', historyIndex); }
    mass += value;
  }
  if (!Number.isFinite(mass)) { return failed('invalid', 'artifact produced non-finite belief mass', historyIndex); }
  if (mass <= 0) { return failed('contradiction', message, historyIndex); }
  return values.map(value => value / mass);
}

function filter(
  artifact: PolicyArtifact,
  belief: readonly number[],
  check: PolicyAction,
  observation: PolicyObservation,
  historyIndex: number,
): BeliefDerivation | readonly number[] {
  const values = Array<number>(POLICY_STATE_COUNT).fill(0);
  const observationIndex = observation === 'passed' ? 1 : 0;
  for (let next = 0; next < POLICY_STATE_COUNT; next += 1) {
    let predicted = 0;
    for (let current = 0; current < POLICY_STATE_COUNT; current += 1) {
      const probability = artifact.transition[check][current][next];
      if (!Number.isFinite(probability) || probability < 0) { return failed('invalid', 'artifact transition is invalid', historyIndex); }
      predicted += belief[current] * probability;
    }
    const likelihood = artifact.observation[check][next][observationIndex];
    if (!Number.isFinite(likelihood) || likelihood < 0) { return failed('invalid', 'artifact observation is invalid', historyIndex); }
    values[next] = likelihood * predicted;
  }
  return normalized(values, `${check} ${observation} has zero predicted probability`, historyIndex);
}

function retainedPass(
  artifact: PolicyArtifact,
  belief: readonly number[],
  check: PolicyAction,
  historyIndex: number,
): BeliefDerivation | readonly number[] {
  const values = Array<number>(POLICY_STATE_COUNT).fill(0);
  for (let current = 0; current < POLICY_STATE_COUNT; current += 1) {
    const state = artifact.states[current];
    if (!state || !isCheck(check) || state[check] === 'would-fail') { continue; }
    const codes = POLICY_ACTIONS.map(action => action === check ? 2 : statusCode[state[action]]);
    if (codes.some(code => code === undefined)) { return failed('invalid', 'artifact state is invalid', historyIndex); }
    values[9 * codes[0] + 3 * codes[1] + codes[2]] += belief[current];
  }
  return normalized(values, `${check} retained pass has zero belief mass`, historyIndex);
}

function checkedEntry(value: unknown, index: number): VerificationHistoryEntry | BeliefDerivation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failed('invalid', 'history entry must be an object', index);
  }
  const entry = value as Record<string, unknown>;
  if (entry.kind === 'unmodelled-change') { return { kind: entry.kind }; }
  if (entry.kind !== 'verdict' && entry.kind !== 'repair' && entry.kind !== 'retained-pass') {
    return failed('invalid', 'history entry kind is invalid', index);
  }
  if (!isCheck(entry.check)) { return failed('invalid', 'history entry check is invalid', index); }
  if (entry.kind === 'verdict') {
    return typeof entry.passed === 'boolean' ? { kind: entry.kind, check: entry.check, passed: entry.passed }
      : failed('invalid', 'verdict passed must be boolean', index);
  }
  return { kind: entry.kind, check: entry.check };
}

function replay(artifact: PolicyArtifact, history: readonly VerificationHistoryEntry[]): BeliefDerivation {
  const prior = validatedPrior(artifact);
  if (!prior) { return failed('invalid', 'artifact prior is invalid'); }
  let belief = prior;
  const passed = new Set<PolicyAction>();
  for (let index = 0; index < history.length; index += 1) {
    const entry = checkedEntry(history[index], index);
    if ('ok' in entry) { return entry; }
    if (entry.kind === 'unmodelled-change') { belief = [...prior]; passed.clear(); continue; }
    if (entry.kind === 'repair') { return failed('unmodelled-history', 'repair has no preceding failed verdict', index); }
    if (entry.kind === 'retained-pass') {
      const next = retainedPass(artifact, belief, entry.check, index);
      if ('ok' in next) { return next; }
      belief = next; passed.add(entry.check); continue;
    }
    if (!entry.passed) {
      if (index + 1 === history.length) {
        return { ok: true, belief, record: { kind: 'pending-repair', check: entry.check, passed: POLICY_ACTIONS.filter(check => passed.has(check)) } };
      }
      const repair = checkedEntry(history[index + 1], index + 1);
      if ('ok' in repair) { return repair; }
      if (repair.kind !== 'repair' || repair.check !== entry.check) {
        return failed('unmodelled-history', `failed ${entry.check} verdict must be followed by its repair`, index + 1);
      }
      const next = filter(artifact, belief, entry.check, 'not-passed', index);
      if ('ok' in next) { return next; }
      belief = next; passed.clear(); index += 1; continue;
    }
    const next = filter(artifact, belief, entry.check, 'passed', index);
    if ('ok' in next) { return next; }
    belief = next; passed.add(entry.check);
  }
  return { ok: true, belief, record: { kind: 'complete', passed: POLICY_ACTIONS.filter(check => passed.has(check)) } };
}

/** Replay contract-v1 verification history. Pure and total: invalid inputs become typed failures. */
export function deriveBelief(artifact: PolicyArtifact, history: readonly VerificationHistoryEntry[]): BeliefDerivation {
  try {
    if (!Array.isArray(history)) { return failed('invalid', 'history is invalid'); }
    return replay(artifact, history);
  } catch {
    return failed('invalid', 'artifact or history could not be read');
  }
}
