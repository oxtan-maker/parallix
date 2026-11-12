/**
 * Deterministic presentation data for the Mission flow reference comparison
 * (TASK-2836). Delivered-mission facts are shaped so the shared FLOW projection
 * reproduces the reference picture's example numbers; the facts go through the
 * production `flowStatistics` calculation and the board transport, never into
 * runtime code. Actor names "Agent B" and "Agent C" and the merged step names
 * copy the picture's placeholder text so geometry can be compared; they are
 * presentation examples, not product constants.
 */
import { flowStatistics, type FlowMissionFacts } from '../../src/application/projections/flow-statistics.js';
import type { FlowGateRun, FlowRebaseRun } from '../../src/application/projections/flow-mission-facts.js';
import type { ReviewStatistics } from '../../src/application/services/review-statistics.js';
import type { BoardProjection } from '../../src/application/projections/board.js';
import { weeklyDecisionWindows } from '../../src/domain/decision-window.js';
import { makeAttentionItem, makeCard, makeProjection, emptyMetrics } from './board-projection.js';

const MINUTE = 60_000;
type Return = { readonly kind: 'repair' | 'agent' | 'human' | 'integration' };

/** Spread `total` items over `slots` buckets, earliest buckets first, at least `floor` each. */
function spread(total: number, slots: number, floor = 0): number[] {
  const values = Array.from({ length: slots }, () => floor);
  for (let index = 0; index < total - floor * slots; index++) { values[index % slots]! += 1; }
  return values;
}

function review(mission: string, returns: readonly Return[], agentRounds: number, humanRounds: number): ReviewStatistics {
  const origin = (item: Return, index: number) => item.kind === 'agent'
    ? { actor: 'agent' as const, stage: 'agent-review' as const, cause: 'changes-requested' }
    : item.kind === 'human' ? { actor: 'human' as const, stage: 'human-review' as const, cause: 'changes-requested' }
      : { actor: 'workflow' as const, stage: 'workflow' as const, cause: item.kind === 'repair' ? 'repair' : 'integration-gate-failure', index };
  const agentReturns = returns.filter(item => item.kind === 'agent').length;
  const humanReturns = returns.filter(item => item.kind === 'human').length;
  const metric = (numerator: number, eligible: number) => ({ numerator, eligibleEpisodes: eligible, coverage: 1,
    rate: eligible === 0 ? { state: 'no-eligible-population' as const, value: null } : { state: 'measured' as const, value: numerator / eligible } });
  const episode = (actor: 'agent' | 'human', index: number) => ({ identity: `${mission}:${actor}:${index}`, actor,
    stage: actor === 'agent' ? 'agent-review' as const : 'human-review' as const,
    startedAt: '2026-10-30T10:00:00.000Z', endedAt: '2026-10-30T10:30:00.000Z', revision: null, sender: actor === 'agent' ? 'Agent C' : 'operator' });
  return { implementer: 'Agent B', total: returns.length, byImplementer: returns.length ? { 'Agent B': returns.length } : {},
    returns: returns.map((item, index) => { const { cause, actor, stage } = origin(item, index);
      return { identity: `${mission}:return:${index}`, author: 'Agent B', at: '2026-10-30T11:00:00.000Z',
        origin: { actor, stage, decisionIdentity: `${mission}:return:${index}`, revision: null, sender: null, cause } }; }),
    episodes: [...Array.from({ length: agentRounds }, (_, index) => episode('agent', index)),
      ...Array.from({ length: humanRounds }, (_, index) => episode('human', index))],
    sendBacks: { agent: metric(agentReturns, agentRounds), human: metric(humanReturns, humanRounds) }, source: 'review-aggregate' };
}

/** Elapsed rows of one average mission (minutes): every mission holds the reference's average. */
const ROWS: readonly [step: string, actor: string, waiting: number, working: number, held: number][] = [
  ['workflow-admission', 'Agent B', 9, 0, 0],
  ['implement', 'Agent B', 6, 76, 0],
  ['Rebase + declared gates', 'parallix', 10, 18, 0],
  ['agent-review', 'Agent C', 7, 28, 0],
  ['human-review', 'human', 0, 0, 950],
  ['Rebase + integration gates', 'parallix', 14, 32, 0],
  ['Rework + resolve conflicts', 'Agent B', 11, 74, 0],
];

function ownership(): FlowMissionFacts['ownership'] {
  let offset = 0;
  return ROWS.flatMap(([step, actor, waiting, working, held]) => {
    const firstOffsetMs = offset * MINUTE;
    offset += waiting + working + held;
    return ([['waiting', waiting], ['working', working], ['held', held]] as const).filter(([, minutes]) => minutes > 0)
      .map(([state, minutes]) => ({ step, actor, model: null, state, durationMs: minutes * MINUTE, firstOffsetMs }));
  });
}

/** Per-state dwell minutes whose median and nearest-rank p90 over 24 missions give the reference state cards. */
function dwell(index: number): FlowMissionFacts['laneDwellMs'] {
  const value = (median: number, p90: number) => (index >= 21 ? p90 : median) * MINUTE;
  return { backlog: value(3, 24), refined: value(9, 52), active: value(110, 246), review: value(35, 96), integration: value(1081, 2880) };
}

function gateRuns(mission: number, declared: number, declaredFailed: number, integration: number, integrationFailed: number): FlowGateRun[] {
  const runs = (phase: string, total: number, failed: number) => Array.from({ length: total }, (_, index) => ({
    id: `m${mission}:${phase}:${index}`, phase, result: index < failed ? 'failed' as const : 'passed' as const }));
  return [...runs('handoff', declared, declaredFailed), ...runs('integration', integration, integrationFailed)];
}

function rebaseRuns(mission: number, stage: FlowRebaseRun['stage'], outcomes: readonly FlowRebaseRun['outcomes'][]): FlowRebaseRun[] {
  return outcomes.map((sequence, index) => ({ id: `m${mission}:${stage}:${index}`,
    operationId: `m${mission}:${stage}`, stage, outcomes: sequence }));
}

/** Rebase outcome sequences for one stage, dealt round-robin over the missions. */
function rebaseOutcomes(clean: number, resolved: number, failed: number, repeats: number): FlowRebaseRun['outcomes'][] {
  const conflicted: FlowRebaseRun['outcomes'][] = [
    ...Array.from({ length: resolved }, (_, index) => [...(index < repeats ? ['conflict' as const] : []), 'conflict' as const, 'resolved' as const]),
    ...Array.from({ length: failed }, () => ['conflict' as const, 'failed' as const]),
  ];
  return [...Array.from({ length: clean }, (_, index) => [index % 3 === 0 ? 'no-op' as const : 'clean' as const]), ...conflicted];
}

function currentFacts(): FlowMissionFacts[] {
  const missions = 24;
  const firstPass = 7;
  // 32 returns over the 17 missions that were sent back: 15 gate repairs, 10 agent, 5 human, 2 integration gate failures.
  const returns: Return[][] = Array.from({ length: missions }, () => []);
  const deal = (kind: Return['kind'], count: number) => { for (let index = 0; index < count; index++) { returns[firstPass + (index + kind.length) % (missions - firstPass)]!.push({ kind }); } };
  deal('repair', 15); deal('agent', 10); deal('human', 5); deal('integration', 2);
  const agentRounds = spread(39, missions, 1), humanRounds = spread(32, missions, 1);
  const declared = spread(54, missions, 2), integration = spread(26, missions, 1);
  const repairs = returns.map(items => items.filter(item => item.kind === 'repair').length);
  const integrationFailures = returns.map(items => items.filter(item => item.kind === 'integration').length);
  const pre = rebaseOutcomes(42, 12, 2, 4), post = rebaseOutcomes(14, 12, 1, 2);
  const launches = spread(65, missions);
  const windows = weeklyDecisionWindows('2026-11-03', 'UTC');
  return Array.from({ length: missions }, (_, index) => {
    const mission = index + 1;
    const closedAt = new Date(Date.parse('2026-10-28T08:00:00Z') + index * 6 * 60 * MINUTE).toISOString();
    const startedAt = new Date(Date.parse(closedAt) - 1235 * MINUTE).toISOString();
    const preReview = rebaseRuns(mission, 'pre-review-rebase', pre.filter((_, run) => run % missions === index));
    const integrationRebase = rebaseRuns(mission, 'integration-rebase', post.filter((_, run) => run % missions === index));
    return { repositoryId: 'parallix', missionId: `task-${String(3000 + mission)}`, closedAt,
      implementer: ['claude', 'codex', 'custom'][index % 3]!,
      diagramNodeIds: [], diagramEdgeIds: [], ownership: ownership(), window: { startedAt, finishedAt: closedAt },
      gateRuns: gateRuns(mission, Math.max(declared[index]!, repairs[index]!), repairs[index]!, Math.max(integration[index]!, integrationFailures[index]!), integrationFailures[index]!),
      rebaseRuns: [...preReview, ...integrationRebase], rebaseStages: [
        { stage: 'direct-rebase', state: 'inapplicable', operationId: null, sourceId: null,
          reason: 'no direct rebase workflow was requested', outcomes: [] },
        { stage: 'pre-review-rebase', state: 'measured', operationId: `m${mission}:review`, sourceId: preReview[0]!.id,
          reason: 'retained terminal rebase outcome', outcomes: preReview.flatMap(run => run.outcomes) },
        { stage: 'integration-rebase', state: 'measured', operationId: `m${mission}:integrate`, sourceId: integrationRebase[0]!.id,
          reason: 'retained terminal rebase outcome', outcomes: integrationRebase.flatMap(run => run.outcomes) },
      ], diagnostics: [],
      lead: { queued: 0, recoveries: 0, escalations: 0 }, laneDwellMs: dwell(index),
      actualAgentLaunches: 1 + launches[index]!, agentLaunches: [],
      observedDisqualifiers: index < firstPass ? [] : ['return'], reviewStatistics: review(`m${mission}`, returns[index]!, agentRounds[index]!, humanRounds[index]!),
    } satisfies FlowMissionFacts;
  }).filter(fact => windows.current.startDate <= fact.closedAt.slice(0, 10));
}

function previousFacts(): FlowMissionFacts[] {
  return Array.from({ length: 21 }, (_, index) => ({ ...currentFacts()[index % 24]!, missionId: `task-${String(2900 + index)}`,
    closedAt: new Date(Date.parse('2026-10-21T08:00:00Z') + index * 7 * 60 * MINUTE).toISOString() }));
}

/** The shared FLOW projection for the reference example, through the production calculation. */
export function flowReferenceStatistics() {
  return flowStatistics([...currentFacts(), ...previousFacts()], weeklyDecisionWindows('2026-11-03', 'UTC'));
}

/** A board projection carrying the reference header facts (wip 6, 24 missions/wk, attention 17) and its FLOW. */
export function flowReferenceProjection(): BoardProjection {
  const active = Array.from({ length: 6 }, (_, index) => makeCard({ id: `task-${3100 + index}` as never, lane: 'active', status: 'active', title: `Mission ${index + 1}` }));
  const refined = Array.from({ length: 17 }, (_, index) => makeCard({ id: `task-${3200 + index}` as never, lane: 'refined', status: 'refined', title: `Queued ${index + 1}` }));
  const base = makeProjection({ active }, 'parallix');
  const reasons = refined.map((card, index) => makeAttentionItem(card, { kind: 'blocking', detail: 'awaiting activation' }, index + 1));
  const window = (label: string, startDate: string, endDate: string, completedMissions: number) => ({ label, startDate, endDate, completedMissions,
    cycleTime: { value: null, observationCount: 0 }, agentRuntime: { value: null, observationCount: 0 }, activeDwell: { value: null, observationCount: 0 },
    reviewDwell: { value: null, observationCount: 0 }, integrationDwell: { value: null, observationCount: 0 }, reviewBounce: { value: null, observationCount: 0 } });
  return { ...base, attentionQueue: reasons,
    metrics: { ...emptyMetrics, health: { state: 'healthy' }, flow: flowReferenceStatistics(),
      decisionWindow: { current: window('2026-10-28 → 2026-11-03', '2026-10-28', '2026-11-03', 24), previous: window('2026-10-21 → 2026-10-27', '2026-10-21', '2026-10-27', 21) } } };
}
