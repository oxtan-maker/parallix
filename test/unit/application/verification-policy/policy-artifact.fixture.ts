export type Json = Record<string, any>;
const STATUS = { W: 'would-fail', P: 'would-pass', D: 'passed' } as const;
/** The 27-state numbering, written out state by state (tests, agent, human); index k holds state k + 1. */
const TABLE_3 = 'WWW WWP WWD WPW WPP WPD WDW WDP WDD PWW PWP PWD PPW PPP PPD PDW PDP PDD DWW DWP DWD DPW DPP DPD DDW DDP DDD'.split(' ');
export const oneHot = (at: number) => Array.from({ length: 27 }, (_u, k) => Number(k === at));
export const half = (at: number) => Array.from({ length: 27 }, (_u, k) => (k === at || k === 26 ? 0.5 : 0));
const transitions = () => Array.from({ length: 27 }, (_u, k) => (k === 26 ? oneHot(26) : half(k)));
const observations = () => Array.from({ length: 27 }, (_u, k) => (k === 26 ? [0, 1] : [0.25, 0.75]));
const costs = (unit: number) => Array.from({ length: 27 }, (_u, k) => (k === 26 ? 0 : unit));
export const policyArtifactFixture = (): Json => ({
  schemaVersion: 1, objective: 'time', parameterHash: 'hand-written-hash', solverVersion: 'hand-written-1', discount: 0.99,
  states: TABLE_3.map(([t, a, h]) => ({ tests: STATUS[t as 'W'], agent: STATUS[a as 'W'], human: STATUS[h as 'W'] })),
  actions: ['tests', 'agent', 'human'], observations: ['not-passed', 'passed'],
  transition: { tests: transitions(), agent: transitions(), human: transitions() },
  observation: { tests: observations(), agent: observations(), human: observations() },
  cost: { tests: costs(1.1), agent: costs(1), human: costs(3) }, prior: oneHot(13),
  vectors: [{ action: 'tests', values: costs(14.5) }, { action: 'agent', values: costs(14.2) }, { action: 'human', values: costs(15) }],
  bounds: { lower: 14.1, upper: 14.2 }, predicted: { policyValue: 14.18, currentSequenceValue: 16.82 },
});
