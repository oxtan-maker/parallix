/**
 * Verification-policy artifact: typed value and pure parser. Contract v2 takes state count, action names and vector
 * length from the artifact; its states say which checks the code is acceptable to and may carry the verdict record.
 * Contract v1 (27 states, three actions, Table 3 order) is read through a thin mapping onto the same value.
 * Parsing never throws, so a caller can fall back to the fixed policy and record the rejection code.
 */
export const POLICY_ACTIONS = ['tests', 'agent', 'human'] as const;
export const POLICY_ACTION_NAMES = [...POLICY_ACTIONS, 'repair-tests', 'repair-agent', 'repair-human', 'merge'] as const;
export const POLICY_OBSERVATIONS = ['not-passed', 'passed'] as const;
export const POLICY_OBJECTIVES = ['money', 'time'] as const;
export const POLICY_VERDICTS = ['unread', 'failed', 'passed'] as const;
export const POLICY_RULE_OUTCOMES = ['passed', 'violated'] as const;
export const POLICY_ROW_TOLERANCE = 1e-9;
const V1_STATUSES = ['would-fail', 'would-pass', 'passed'] as const;
const V1_STATE_COUNT = 27;
const SHA256 = /^[0-9a-f]{64}$/;
/** The three checks; also the actions a recommendation or a history entry can name. */
export type PolicyAction = typeof POLICY_ACTIONS[number];
/** Any action an artifact may define: read each check, repair it, or merge. */
export type PolicyActionName = typeof POLICY_ACTION_NAMES[number];
export type PolicyObservation = typeof POLICY_OBSERVATIONS[number];
export type PolicyObjective = typeof POLICY_OBJECTIVES[number];
export type PolicyVerdict = typeof POLICY_VERDICTS[number];
export type PerAction<T> = { readonly [A in PolicyAction]: T };
/** One entry per action the artifact defines. */
export type ByActionName<T> = Readonly<Record<string, T>>;
/** `acceptable`: the checks the code state passes; `verdicts`: the record carried in the state (all unread when omitted). */
export interface PolicyState { readonly acceptable: PerAction<boolean>; readonly verdicts: PerAction<PolicyVerdict> }
/** One row per state; each row holds one entry per column. */
export type PolicyMatrix = readonly (readonly number[])[];
/** The solver's rule-check outcome; `violatingMissions` counts simulated missions that broke a rule. */
export interface PolicyRuleCheck { readonly outcome: typeof POLICY_RULE_OUTCOMES[number]; readonly violatingMissions: number }
export interface PolicyArtifact {
  readonly schemaVersion: 1 | 2;
  readonly objective: PolicyObjective;
  readonly parameterHash: string;
  readonly solverVersion: string;
  /** Absent for a v1 artifact, which predates the rule check. */
  readonly ruleCheck: PolicyRuleCheck | null;
  readonly discount: number;
  readonly states: readonly PolicyState[];
  readonly actions: readonly PolicyActionName[];
  readonly observations: readonly PolicyObservation[];
  /** transition[action][i][j]: probability of moving from state i to state j. */
  readonly transition: ByActionName<PolicyMatrix>;
  /** observation[action][j][o]: probability of observation o after reaching state j. */
  readonly observation: ByActionName<PolicyMatrix>;
  readonly cost: ByActionName<readonly number[]>;
  readonly prior: readonly number[];
  readonly vectors: readonly { readonly action: PolicyActionName; readonly values: readonly number[] }[];
  readonly bounds: { readonly lower: number; readonly upper: number };
  readonly predicted: { readonly policyValue: number; readonly currentSequenceValue: number };
}
export type PolicyRejectionCode = 'invalid-json' | 'not-an-object' | 'missing-field' | 'schema-version' | 'numbering'
  | 'dimensions' | 'non-finite' | 'row-sum' | 'out-of-range' | 'absorbing-state' | 'action-names' | 'parameter-hash'
  | 'rule-check' | 'unreadable';
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
const perCheck = <T>(from: Fields, path: string, parse: (value: unknown, path: string) => T): PerAction<T> =>
  Object.fromEntries(POLICY_ACTIONS.map(check => [check, parse(field(from, check, path), `${path}.${check}`)])) as PerAction<T>;
const nonNegativeInteger = (value: unknown, path: string): number => {
  const number = finite(value, path);
  return Number.isInteger(number) && number >= 0 ? number : reject('rule-check', path, `${path} must be a non-negative integer`);
};

/** v1: 27 states in the model's Table 3 order; state k + 1 at position k (tests slowest, human fastest). */
const TABLE_3 = V1_STATUSES.flatMap(tests => V1_STATUSES.flatMap(agent => V1_STATUSES.map(human => ({ tests, agent, human }))));
function v1States(value: unknown): readonly PolicyState[] {
  return list(value, V1_STATE_COUNT, 'artifact.states').map((entry, index) => {
    const path = `artifact.states[${index}]`;
    const from = fields(entry, path);
    const statuses = Object.fromEntries(POLICY_ACTIONS.map(check =>
      [check, oneOf([TABLE_3[index][check]], field(from, check, path), `${path}.${check}`)])) as Record<PolicyAction, typeof V1_STATUSES[number]>;
    return { acceptable: perCheck(statuses, path, status => status !== 'would-fail'),
      verdicts: perCheck(statuses, path, status => (status === 'passed' ? 'passed' : 'unread')) };
  });
}
/** v2: any states, each saying which checks it is acceptable to and, optionally, the verdict record. */
function v2States(value: unknown): readonly PolicyState[] {
  const seen = new Set<string>();
  return list(value, 0, 'artifact.states').map((entry, index) => {
    const path = `artifact.states[${index}]`;
    const from = fields(entry, path);
    const state: PolicyState = {
      acceptable: perCheck(fields(field(from, 'acceptable', path), `${path}.acceptable`), `${path}.acceptable`,
        (flag, at) => (typeof flag === 'boolean' ? flag : reject('out-of-range', at, `${at} must be a boolean`))),
      verdicts: Object.hasOwn(from, 'record') && from.record !== null && from.record !== undefined
        ? perCheck(fields(from.record, `${path}.record`), `${path}.record`, (verdict, at) => oneOf(POLICY_VERDICTS, verdict, at, 'out-of-range'))
        : perCheck({ tests: 'unread', agent: 'unread', human: 'unread' }, path, () => 'unread'),
    };
    const key = JSON.stringify([state.acceptable, state.verdicts]);
    if (seen.has(key)) { reject('numbering', path, `${path} repeats an earlier state`); }
    seen.add(key);
    return state;
  });
}
function v2Actions(value: unknown): readonly PolicyActionName[] {
  const names = list(value, 0, 'artifact.actions').map((name, index) =>
    oneOf(POLICY_ACTION_NAMES, name, `artifact.actions[${index}]`, 'action-names'));
  if (new Set(names).size !== names.length) { reject('action-names', 'artifact.actions', 'artifact.actions must not repeat a name'); }
  const repairs = POLICY_ACTIONS.filter(check => names.includes(`repair-${check}`));
  if (repairs.length > 0 && repairs.length < POLICY_ACTIONS.length) {
    reject('action-names', 'artifact.actions', 'artifact.actions must declare a repair action for every check or for none');
  }
  const missing = POLICY_ACTIONS.find(check => !names.includes(check));
  return missing ? reject('action-names', 'artifact.actions', `artifact.actions must read every check; ${missing} is missing`) : names;
}
function ruleCheck(value: unknown): PolicyRuleCheck {
  const from = fields(value, 'artifact.ruleCheck');
  const outcome = oneOf(POLICY_RULE_OUTCOMES, field(from, 'outcome', 'artifact.ruleCheck'), 'artifact.ruleCheck.outcome', 'rule-check');
  const violatingMissions = nonNegativeInteger(field(from, 'violatingMissions', 'artifact.ruleCheck'), 'artifact.ruleCheck.violatingMissions');
  return (outcome === 'passed') === (violatingMissions === 0) ? { outcome, violatingMissions }
    : reject('rule-check', 'artifact.ruleCheck', 'ruleCheck.outcome must be passed exactly when no mission violated a rule');
}
const hash = (root: Fields, version: 1 | 2): string => {
  const value = text(root, 'parameterHash', 'artifact');
  return version === 2 && !SHA256.test(value)
    ? reject('parameter-hash', 'artifact.parameterHash', 'parameterHash must be a lowercase SHA-256 hex digest') : value;
};

function build(root: Fields): PolicyArtifact {
  const version = finite(field(root, 'schemaVersion', 'artifact'), 'artifact.schemaVersion');
  if (version !== 1 && version !== 2) { reject('schema-version', 'artifact.schemaVersion', `schemaVersion ${version} is unsupported, expected 1 or 2`); }
  const v = version as 1 | 2;
  const objective = oneOf(POLICY_OBJECTIVES, text(root, 'objective', 'artifact'), 'artifact.objective', 'out-of-range');
  const discount = finite(field(root, 'discount', 'artifact'), 'artifact.discount');
  if (discount <= 0 || discount >= 1) { reject('out-of-range', 'artifact.discount', 'discount must be strictly between 0 and 1'); }
  const bounds = fields(field(root, 'bounds', 'artifact'), 'artifact.bounds');
  const lower = finite(field(bounds, 'lower', 'artifact.bounds'), 'artifact.bounds.lower');
  const upper = finite(field(bounds, 'upper', 'artifact.bounds'), 'artifact.bounds.upper');
  if (lower > upper) { reject('out-of-range', 'artifact.bounds', 'bounds.lower must not exceed bounds.upper'); }
  const predicted = fields(field(root, 'predicted', 'artifact'), 'artifact.predicted');
  const parameterHash = hash(root, v);
  const solverVersion = text(root, 'solverVersion', 'artifact');
  const check = v === 2 ? ruleCheck(field(root, 'ruleCheck', 'artifact')) : null;
  const states = (v === 1 ? v1States : v2States)(field(root, 'states', 'artifact'));
  const actions = v === 1 ? exactNames(POLICY_ACTIONS, field(root, 'actions', 'artifact'), 'artifact.actions')
    : v2Actions(field(root, 'actions', 'artifact'));
  const count = states.length;
  const perAction = <T>(key: string, parse: (value: unknown, path: string) => T): ByActionName<T> => {
    const entries = fields(field(root, key, 'artifact'), `artifact.${key}`);
    return Object.fromEntries(actions.map(action => [action, parse(field(entries, action, `artifact.${key}`), `artifact.${key}.${action}`)]));
  };
  const matrix = (columns: number) => (value: unknown, path: string): PolicyMatrix =>
    list(value, count, path).map((row, index) => probabilities(row, columns, `${path}[${index}]`));
  const artifact: PolicyArtifact = {
    schemaVersion: v, objective, discount, bounds: { lower, upper }, parameterHash, solverVersion, ruleCheck: check,
    states, actions,
    observations: exactNames(POLICY_OBSERVATIONS, field(root, 'observations', 'artifact'), 'artifact.observations'),
    transition: perAction('transition', matrix(count)),
    observation: perAction('observation', matrix(POLICY_OBSERVATIONS.length)),
    cost: perAction('cost', (value, path) => numbers(value, count, path, 0)),
    prior: probabilities(field(root, 'prior', 'artifact'), count, 'artifact.prior'),
    vectors: list(root.vectors, 0, 'artifact.vectors').map((entry, index) => {
      const path = `artifact.vectors[${index}]`;
      const from = fields(entry, path);
      return { action: oneOf(actions, field(from, 'action', path), `${path}.action`),
        values: numbers(field(from, 'values', path), count, `${path}.values`) };
    }),
    predicted: { policyValue: finite(field(predicted, 'policyValue', 'artifact.predicted'), 'artifact.predicted.policyValue'),
      currentSequenceValue: finite(field(predicted, 'currentSequenceValue', 'artifact.predicted'), 'artifact.predicted.currentSequenceValue') },
  };
  if (v === 1) {
    for (const action of actions) {
      const absorbing = artifact.transition[action][count - 1];
      if (absorbing.some((entry, column) => entry !== Number(column === count - 1)) || artifact.cost[action][count - 1] !== 0) {
        reject('absorbing-state', `artifact.transition.${action}`, 'state 27 must be absorbing with zero cost');
      }
    }
  }
  return artifact;
}
/** Parse a contract-v1 or contract-v2 artifact from a decoded JSON value or JSON text. Pure; never throws. */
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
