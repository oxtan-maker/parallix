import {
  POLICY_ACTIONS,
  POLICY_ROW_TOLERANCE,
  type PolicyAction,
  type PolicyArtifact,
  type PolicyObservation,
  type PolicyState,
} from './policy-artifact.js';

export type VerificationHistoryEntry =
  | { readonly kind: 'verdict'; readonly check: PolicyAction; readonly passed: boolean }
  | { readonly kind: 'repair'; readonly check: PolicyAction }
  | { readonly kind: 'retained-pass'; readonly check: PolicyAction }
  | { readonly kind: 'unmodelled-change' };

export type BeliefRecord =
  | { readonly kind: 'complete'; readonly passed: readonly PolicyAction[] }
  | { readonly kind: 'pending-repair'; readonly check: PolicyAction; readonly passed: readonly PolicyAction[] };

export type VerificationCheckState = 'unknown' | 'passed';

export type BeliefFailureKind = 'contradiction' | 'unmodelled-history' | 'invalid';
export type BeliefDerivation =
  | { readonly ok: true; readonly belief: readonly number[]; readonly record: BeliefRecord }
  | { readonly ok: false; readonly failure: { readonly kind: BeliefFailureKind; readonly historyIndex: number | null; readonly message: string } };

const failed = (kind: BeliefFailureKind, message: string, historyIndex: number | null = null): BeliefDerivation =>
  ({ ok: false, failure: { kind, historyIndex, message } });
const isCheck = (value: unknown): value is PolicyAction => POLICY_ACTIONS.includes(value as PolicyAction);

function validatedPrior(artifact: PolicyArtifact): readonly number[] | null {
  if (!Array.isArray(artifact.prior) || artifact.prior.length !== artifact.states.length) { return null; }
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

const actionIndexError = (action: string) => failed('invalid', `artifact defines no ${action} action`);

/** Belief after one action's transition and, when observed, the observation's likelihood; a missing observation leaves the prediction. */
function filter(
  artifact: PolicyArtifact,
  belief: readonly number[],
  action: string,
  observation: PolicyObservation | null,
  historyIndex: number,
): BeliefDerivation | readonly number[] {
  const transition = artifact.transition[action];
  const likelihoods = artifact.observation[action];
  if (!transition || !likelihoods) { return actionIndexError(action); }
  const count = artifact.states.length;
  const values = Array<number>(count).fill(0);
  const observationIndex = observation === 'passed' ? 1 : 0;
  for (let next = 0; next < count; next += 1) {
    let predicted = 0;
    for (let current = 0; current < count; current += 1) {
      const probability = transition[current][next];
      if (!Number.isFinite(probability) || probability < 0) { return failed('invalid', 'artifact transition is invalid', historyIndex); }
      predicted += belief[current] * probability;
    }
    const likelihood = observation === null ? 1 : likelihoods[next][observationIndex];
    if (!Number.isFinite(likelihood) || likelihood < 0) { return failed('invalid', 'artifact observation is invalid', historyIndex); }
    values[next] = likelihood * predicted;
  }
  return normalized(values, `${action} ${observation ?? 'transition'} has zero predicted probability`, historyIndex);
}

/**
 * A failed verdict then its repair. A v1 artifact's read action holds both; a v2 artifact splits them, so one that
 * defines no repair-<check> action cannot say what the repair did and the belief fails typed instead of guessing.
 */
function repaired(
  artifact: PolicyArtifact,
  belief: readonly number[],
  check: PolicyAction,
  historyIndex: number,
): BeliefDerivation | readonly number[] {
  const failedRead = filter(artifact, belief, check, 'not-passed', historyIndex);
  if ('ok' in failedRead || artifact.schemaVersion === 1) { return failedRead; }
  const repair = `repair-${check}` as const;
  return artifact.actions.includes(repair) ? filter(artifact, failedRead, repair, null, historyIndex)
    : failed('unmodelled-history', `artifact defines no ${repair} action`, historyIndex);
}

const stateKey = (acceptable: PolicyState['acceptable'], verdicts: PolicyState['verdicts']) => JSON.stringify([acceptable, verdicts]);

/** The state a retained pass of `check` moves each state to: same code state, that check's verdict passed. */
function retainedPass(
  artifact: PolicyArtifact,
  belief: readonly number[],
  check: PolicyAction,
  historyIndex: number,
): BeliefDerivation | readonly number[] {
  const values = Array<number>(artifact.states.length).fill(0);
  const index = new Map(artifact.states.map((state, at) => [stateKey(state.acceptable, state.verdicts), at]));
  const carriesRecord = artifact.states.some(state => POLICY_ACTIONS.some(action => state.verdicts[action] !== 'unread'));
  for (const [current, state] of artifact.states.entries()) {
    if (!state || !isCheck(check) || !state.acceptable[check]) { continue; }
    const target = carriesRecord ? index.get(stateKey(state.acceptable, { ...state.verdicts, [check]: 'passed' })) : current;
    if (target === undefined) { return failed('invalid', 'artifact state is invalid', historyIndex); }
    values[target] += belief[current];
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
      const next = repaired(artifact, belief, entry.check, index);
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

/** Exhaustive check-state projection; a missing pass remains explicitly unknown. */
export function verificationCheckStates(record: BeliefRecord): Readonly<Record<PolicyAction, VerificationCheckState>> {
  const passed = new Set(record.passed);
  return Object.fromEntries(POLICY_ACTIONS.map(check => [check, passed.has(check) ? 'passed' : 'unknown'])) as
    Record<PolicyAction, VerificationCheckState>;
}

/** Only a completed history with all three current-change passes may land. */
export function verificationIntegrationEligible(record: BeliefRecord): boolean {
  return record.kind === 'complete' && POLICY_ACTIONS.every(check => record.passed.includes(check));
}
