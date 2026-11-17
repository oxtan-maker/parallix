/**
 * Contract-v1 verification-policy artifact: typed value and pure parser. Parsing never throws, so a caller can
 * fall back to the fixed policy and record the rejection code. State k + 1 sits at array position k in the
 * model document's Table 3 order: tests slowest, human fastest, statuses would-fail, would-pass, passed.
 */
export const POLICY_STATUSES = ['would-fail', 'would-pass', 'passed'] as const;
export const POLICY_ACTIONS = ['tests', 'agent', 'human'] as const;
export const POLICY_OBSERVATIONS = ['not-passed', 'passed'] as const;
export const POLICY_OBJECTIVES = ['money', 'time'] as const;
export const POLICY_STATE_COUNT = 27;
export const POLICY_ROW_TOLERANCE = 1e-9;
export type PolicyStatus = typeof POLICY_STATUSES[number];
export type PolicyAction = typeof POLICY_ACTIONS[number];
export type PolicyObservation = typeof POLICY_OBSERVATIONS[number];
export type PolicyObjective = typeof POLICY_OBJECTIVES[number];
export type PolicyState = { readonly [A in PolicyAction]: PolicyStatus };
export type PerAction<T> = { readonly [A in PolicyAction]: T };
/** One row per state; each row holds one entry per column. */
export type PolicyMatrix = readonly (readonly number[])[];
export interface PolicyArtifact {
  readonly schemaVersion: 1;
  readonly objective: PolicyObjective;
  readonly parameterHash: string;
  readonly solverVersion: string;
  readonly discount: number;
  readonly states: readonly PolicyState[];
  readonly actions: readonly PolicyAction[];
  readonly observations: readonly PolicyObservation[];
  /** transition[action][i][j]: probability of moving from state i + 1 to state j + 1. */
  readonly transition: PerAction<PolicyMatrix>;
  /** observation[action][j][o]: probability of observation o after reaching state j + 1. */
  readonly observation: PerAction<PolicyMatrix>;
  readonly cost: PerAction<readonly number[]>;
  readonly prior: readonly number[];
  readonly vectors: readonly { readonly action: PolicyAction; readonly values: readonly number[] }[];
  readonly bounds: { readonly lower: number; readonly upper: number };
  readonly predicted: { readonly policyValue: number; readonly currentSequenceValue: number };
}
export type PolicyRejectionCode = 'invalid-json' | 'not-an-object' | 'missing-field' | 'schema-version' | 'numbering'
  | 'dimensions' | 'non-finite' | 'row-sum' | 'out-of-range' | 'absorbing-state' | 'unreadable';
export interface PolicyRejection { readonly code: PolicyRejectionCode; readonly path: string; readonly message: string }
export type PolicyParseResult =
  | { readonly ok: true; readonly artifact: PolicyArtifact }
  | { readonly ok: false; readonly rejection: PolicyRejection };
const raised = new WeakSet<object>(); // unlike instanceof, WeakSet.has never runs a hostile proxy's traps
const reject = (code: PolicyRejectionCode, path: string, message: string): never => {
  const rejection: PolicyRejection = Object.freeze({ code, path, message });
  raised.add(rejection); throw rejection;
};
type Fields = Readonly<Record<string, unknown>>;
const fields = (value: unknown, path: string): Fields => (typeof value !== 'object' || value === null || Array.isArray(value)
  ? reject('not-an-object', path, `${path} must be an object`) : value as Fields);
const field = (from: Fields, key: string, path: string): unknown => (Object.hasOwn(from, key) && from[key] !== undefined && from[key] !== null
  ? from[key] : reject('missing-field', `${path}.${key}`, `${path}.${key} is missing`));
const finite = (value: unknown, path: string): number => (typeof value === 'number' && Number.isFinite(value)
  ? value : reject('non-finite', path, `${path} must be a finite number`));
const text = (from: Fields, key: string, path: string): string => {
  const value = field(from, key, path);
  return typeof value === 'string' && value ? value : reject('missing-field', `${path}.${key}`, `${path}.${key} must be a non-empty string`);
};
const list = (value: unknown, length: number, path: string): readonly unknown[] => {
  const size = Array.isArray(value) ? value.length : -1; // read once: a proxy could report another length later
  return (length ? size === length : size > 0) ? Array.from({ length: size }, (_hole, index) => (value as unknown[])[index])
    : reject('dimensions', path, `${path} must have ${length ? `exactly ${length}` : 'at least 1'} entries`);
};
const numbers = (value: unknown, length: number, path: string, low = -Infinity, high = Infinity): readonly number[] =>
  list(value, length, path).map((entry, index) => {
    const number = finite(entry, `${path}[${index}]`);
    return number < low || number > high ? reject('out-of-range', `${path}[${index}]`, `${path}[${index}] must be within [${low}, ${high}]`) : number;
  });
const probabilities = (value: unknown, length: number, path: string): readonly number[] => {
  const row = numbers(value, length, path, 0, 1);
  const sum = row.reduce((total, entry) => total + entry, 0);
  return Math.abs(sum - 1) > POLICY_ROW_TOLERANCE
    ? reject('row-sum', path, `${path} sums to ${sum}, expected 1 within ${POLICY_ROW_TOLERANCE}`) : row;
};
const oneOf = <T extends string>(options: readonly T[], value: unknown, path: string, code: PolicyRejectionCode = 'numbering'): T =>
  (options.includes(value as T) ? value as T : reject(code, path, `${path} must be one of ${options.join(', ')}`));
const exactNames = <T extends string>(expected: readonly T[], value: unknown, path: string): readonly T[] => {
  list(value, expected.length, path).forEach((entry, index) => oneOf([expected[index]], entry, `${path}[${index}]`));
  return [...expected];
};
function perAction<T>(root: Fields, key: string, parse: (value: unknown, path: string) => T): PerAction<T> {
  const entries = fields(field(root, key, 'artifact'), `artifact.${key}`);
  return Object.fromEntries(POLICY_ACTIONS.map(action =>
    [action, parse(field(entries, action, `artifact.${key}`), `artifact.${key}.${action}`)])) as PerAction<T>;
}
const matrix = (columns: number) => (value: unknown, path: string): PolicyMatrix =>
  list(value, POLICY_STATE_COUNT, path).map((row, index) => probabilities(row, columns, `${path}[${index}]`));
const TABLE_3 = POLICY_STATUSES.flatMap(tests => POLICY_STATUSES.flatMap(agent => POLICY_STATUSES.map(human => ({ tests, agent, human }))));
function states(value: unknown): readonly PolicyState[] {
  return list(value, POLICY_STATE_COUNT, 'artifact.states').map((entry, index) => {
    const path = `artifact.states[${index}]`;
    const from = fields(entry, path);
    for (const action of POLICY_ACTIONS) { oneOf([TABLE_3[index][action]], field(from, action, path), `${path}.${action}`); }
    return { ...TABLE_3[index] };
  });
}
function build(root: Fields): PolicyArtifact {
  const version = finite(field(root, 'schemaVersion', 'artifact'), 'artifact.schemaVersion');
  if (version !== 1) { reject('schema-version', 'artifact.schemaVersion', `schemaVersion ${version} is unsupported, expected 1`); }
  const objective = oneOf(POLICY_OBJECTIVES, text(root, 'objective', 'artifact'), 'artifact.objective', 'out-of-range');
  const discount = finite(field(root, 'discount', 'artifact'), 'artifact.discount');
  if (discount <= 0 || discount >= 1) { reject('out-of-range', 'artifact.discount', 'discount must be strictly between 0 and 1'); }
  const bounds = fields(field(root, 'bounds', 'artifact'), 'artifact.bounds');
  const lower = finite(field(bounds, 'lower', 'artifact.bounds'), 'artifact.bounds.lower');
  const upper = finite(field(bounds, 'upper', 'artifact.bounds'), 'artifact.bounds.upper');
  if (lower > upper) { reject('out-of-range', 'artifact.bounds', 'bounds.lower must not exceed bounds.upper'); }
  const predicted = fields(field(root, 'predicted', 'artifact'), 'artifact.predicted');
  const artifact: PolicyArtifact = {
    schemaVersion: 1, objective, discount, bounds: { lower, upper },
    parameterHash: text(root, 'parameterHash', 'artifact'),
    solverVersion: text(root, 'solverVersion', 'artifact'),
    states: states(field(root, 'states', 'artifact')),
    actions: exactNames(POLICY_ACTIONS, field(root, 'actions', 'artifact'), 'artifact.actions'),
    observations: exactNames(POLICY_OBSERVATIONS, field(root, 'observations', 'artifact'), 'artifact.observations'),
    transition: perAction(root, 'transition', matrix(POLICY_STATE_COUNT)),
    observation: perAction(root, 'observation', matrix(POLICY_OBSERVATIONS.length)),
    cost: perAction(root, 'cost', (value, path) => numbers(value, POLICY_STATE_COUNT, path, 0)),
    prior: probabilities(field(root, 'prior', 'artifact'), POLICY_STATE_COUNT, 'artifact.prior'),
    vectors: list(root.vectors, 0, 'artifact.vectors').map((entry, index) => {
      const path = `artifact.vectors[${index}]`;
      const from = fields(entry, path);
      return { action: oneOf(POLICY_ACTIONS, field(from, 'action', path), `${path}.action`),
        values: numbers(field(from, 'values', path), POLICY_STATE_COUNT, `${path}.values`) };
    }),
    predicted: { policyValue: finite(field(predicted, 'policyValue', 'artifact.predicted'), 'artifact.predicted.policyValue'),
      currentSequenceValue: finite(field(predicted, 'currentSequenceValue', 'artifact.predicted'), 'artifact.predicted.currentSequenceValue') },
  };
  for (const action of POLICY_ACTIONS) {
    const absorbing = artifact.transition[action][POLICY_STATE_COUNT - 1];
    if (absorbing.some((entry, column) => entry !== Number(column === POLICY_STATE_COUNT - 1)) || artifact.cost[action][POLICY_STATE_COUNT - 1] !== 0) {
      reject('absorbing-state', `artifact.transition.${action}`, 'state 27 must be absorbing with zero cost');
    }
  }
  return artifact;
}
/** Parse a contract-v1 artifact from a decoded JSON value or JSON text. Pure; never throws. */
export function parsePolicyArtifact(input: unknown): PolicyParseResult {
  try {
    let decoded = input;
    if (typeof input === 'string') {
      try { decoded = JSON.parse(input); } catch { return reject('invalid-json', 'artifact', 'artifact text is not valid JSON'); }
    }
    return { ok: true, artifact: build(fields(decoded, 'artifact')) };
  } catch (error) {
    return { ok: false, rejection: raised.has(error as object) ? error as PolicyRejection
      : { code: 'unreadable', path: 'artifact', message: 'artifact could not be read' } };
  }
}
