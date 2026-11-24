import type { FlowGateRun, FlowLeadEpisodes, FlowRebaseRun } from './flow-mission-facts.js';
import type { FlowConfiguredPolicy, FlowHumanJoinState, FlowPolicyExecution, FlowVerificationRound } from './flow-verification-round.js';
import type { ReviewStatistics } from '../services/review-statistics.js';
import { isSuccessfulRebaseOutcome } from '../ports/rebase-workflow.js';
import { flowReviewInputs, flowRoundRepairs, roundStartedAt, type FlowRoundRepair } from './flow-review-observations.js';

/** Actor swimlanes of the Mission flow: who holds the work at each node and each elapsed row. */
export type FlowLaneId = 'refine-agent' | 'implement-agent' | 'parallix' | 'review-agent' | 'lead' | 'human' | 'external' | 'main';
export type FlowNodeId = 'refine' | 'implement' | 'rebase' | 'rebase-resolve' | 'declared-gates'
  | 'integration-tests' | 'agent-review' | 'human-review' | 'automated-join' | 'human-verdict' | 'landed' | 'lead';
export type FlowEdgeKind = 'flow' | 'clean' | 'gate-failed' | 'agent-findings' | 'human-changes' | 'rebase-conflict'
  | 'rebase-repeat' | 'rebase-failed' | 'workflow-return' | 'lead-escalation' | 'concurrent-request'
  | 'automated-verdict' | 'automated-pass' | 'gate-repair' | 'agent-repair' | 'joint-repair'
  | 'human-ready' | 'human-wait' | 'human-pending' | 'human-withdrawn' | 'timing-unavailable'
  | 'tests-passed' | 'landing-rebase' | 'operator-land';

export interface FlowGraphNode {
  readonly id: FlowNodeId;
  readonly lane: FlowLaneId;
  /** Passes through the node: missions, runs, rounds or conflicts, as named by the node. */
  readonly count: number;
  /** Disjoint observations that add up to the displayed count. */
  readonly parts: readonly { readonly label: string; readonly count: number }[];
  /** Implementation only: returns of every cause, counted once by the shared return authority. */
  readonly rework: number | null;
  /** Delivered missions whose observations of this node's source exist; `population` is the cohort size. */
  readonly observedMissions: number;
  readonly population: number;
}
export interface FlowGraphEdge {
  readonly id: string;
  /** Null only for returns whose sending stage the retained evidence does not record. */
  readonly from: FlowNodeId | null;
  readonly to: FlowNodeId;
  readonly kind: FlowEdgeKind;
  /** Rebase edges keep the retained stage even though both stages reuse one depiction. */
  readonly stage: FlowRebaseRun['stage'] | null;
  /** Distinct outcomes carried by the edge. Gate-failed edges count typed returns. */
  readonly count: number;
  /**
   * Share of the source node's observed outcomes. Gate-failed shares describe
   * settled failed gate runs while their count retains all typed returns; the
   * presentation labels that distinction. Null means no denominator was observed.
   */
  readonly share: number | null;
  /** Whole percentage points allocated with sibling branches so displayed outcomes total 100%. */
  readonly percentage: number | null;
  /** Missions contributing an observed denominator for this edge and the whole delivered cohort. */
  readonly observedMissions: number;
  readonly population: number;
}
export interface FlowVerificationSummary {
  readonly configured: FlowConfiguredPolicy | null;
  readonly executions: Readonly<Record<FlowPolicyExecution | 'historical', number>>;
  readonly observedRounds: number;
  readonly concurrentRounds: number;
  readonly joinedRounds: number;
  readonly pilotApprovedMissions: number;
  readonly human: Readonly<Record<FlowHumanJoinState, number>>;
  readonly repairs: Readonly<Record<'gate' | 'agent' | 'joint', number>>;
  readonly exceptions: Readonly<Record<'interrupted' | 'revisionDrift' | 'handoff' | 'humanCorrection', number>>;
  readonly sameRevisionTestReruns: number;
  readonly population: number;
}
export interface FlowGraph {
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
  readonly verification: FlowVerificationSummary;
}

export interface FlowGraphFacts {
  readonly window: { readonly startedAt: string; readonly finishedAt: string } | null;
  readonly gateRuns: readonly FlowGateRun[];
  readonly rebaseRuns: readonly FlowRebaseRun[];
  readonly lead: FlowLeadEpisodes;
  readonly reviewStatistics: ReviewStatistics;
  readonly verificationPolicy?: FlowConfiguredPolicy | null;
  readonly verificationRounds?: readonly FlowVerificationRound[];
}

const DECLARED_GATE_PHASES = new Set(['handoff', 'review']);

function returnObservations(facts: readonly FlowGraphFacts[], repairs: readonly FlowRoundRepair[]) {
  const all = facts.flatMap(fact => fact.reviewStatistics.returns.map(item => ({ fact, item })));
  const repaired = new Map<FlowGraphFacts, Set<string>>();
  for (const repair of repairs) {
    const identities = repaired.get(repair.fact) ?? new Set<string>();
    identities.add(repair.returnIdentity);
    repaired.set(repair.fact, identities);
  }
  const placed = all.filter(value => !repaired.get(value.fact)?.has(value.item.identity))
    .map(value => ({ ...value, from: flowReturnSource(value.item.origin) }));
  return { total: all.length, placed,
    countFrom: (from: FlowNodeId | null) => placed.filter(value => value.from === from).length,
    missionsFrom: (from: FlowNodeId | null) => new Set(placed.filter(value => value.from === from)
      .map(value => value.fact)).size };
}

function flowNode(population: number, id: FlowNodeId, lane: FlowLaneId, observedMissions: number,
  inputs: readonly (readonly [string, number])[], rework: number | null = null): FlowGraphNode {
  return { id, lane, count: inputs.reduce((sum, [, count]) => sum + count, 0),
    parts: inputs.map(([label, count]) => ({ label, count })), rework, observedMissions, population };
}

function reviewParts(input: ReturnType<typeof flowReviewInputs>) {
  return [['Concurrent requests', input.concurrent], ['Other recorded requests', input.otherRequests],
    ['Review episodes without a matched request', input.reviewEpisodes]] as const;
}

function batchParts(runs: readonly FlowGateRun[]) {
  return (['passed', 'failed', 'running'] as const)
    .map(result => [result === 'running' ? 'Unsettled batches' : `${result === 'passed' ? 'Passing' : 'Failing'} batches`,
      runs.filter(run => run.result === result).length] as const);
}

/**
 * Aggregate one delivered cohort into the semantic Mission flow graph. Every
 * count is a distinct observation from its own authority: gate batches from
 * verification attempts, rebase identities from rebase observations, rounds
 * and returns from the shared Review statistics, landings from lifecycle.
 * Returns into implementation come from the shared return authority and keep
 * their recorded source. Gate branch percentages use settled gate results;
 * gate-failed counts remain typed returns so every return is drawn exactly once.
 */
export function flowGraph(facts: readonly FlowGraphFacts[]): FlowGraph {
  const population = facts.length;
  const observed = (predicate: (fact: FlowGraphFacts) => boolean) => facts.filter(predicate).length;
  const gate = (declared: boolean) => facts.flatMap(fact => fact.gateRuns.filter(run => DECLARED_GATE_PHASES.has(run.phase) === declared));
  const declared = gate(true), declaredMissions = observed(fact => fact.gateRuns.some(run => DECLARED_GATE_PHASES.has(run.phase)));
  const integrationTests = gate(false);
  const integrationMissions = observed(fact => fact.gateRuns.some(run => !DECLARED_GATE_PHASES.has(run.phase)));
  const preRebase = rebaseSummary(facts.flatMap(fact => fact.rebaseRuns.filter(run => run.stage === 'pre-review-rebase')));
  const preRebaseMissions = observed(fact => fact.rebaseRuns.some(run => run.stage === 'pre-review-rebase'));
  const reviewMissions = observed(fact => fact.reviewStatistics.total !== null);
  const rounds = facts.flatMap(fact => (fact.verificationRounds ?? []).map(round => ({ fact, round })));
  const sequentialOnly = new Set(facts.filter(fact => !fact.verificationRounds?.some(round => round.execution === 'pilot')));
  const integration = integrationRebaseObservations(facts, sequentialOnly);
  const integrationRebase = rebaseSummary(integration.runs.map(({ run }) => run));
  const rebaseMissions = observed(fact => integration.missions.has(fact)
    || fact.rebaseRuns.some(run => run.stage === 'pre-review-rebase'));
  const concurrent = rounds.filter(item => item.round.execution === 'pilot' && item.round.concurrent);
  const joined = concurrent.filter(item => item.round.join !== null);
  const concurrentMissions = new Set(concurrent.map(item => item.fact)).size;
  const joinedMissions = new Set(joined.map(item => item.fact)).size;
  const pilotApprovals = joined.filter(item => item.round.join?.passed === true
    && item.round.human.approvedAt !== null);
  const repairs = flowRoundRepairs(facts);
  const passedJoins = joined.filter(item => item.round.join?.passed === true).length;
  const returns = returnObservations(facts, repairs);
  const leadRecoveries = facts.reduce((sum, fact) => sum + fact.lead.recoveries, 0);
  const escalations = facts.reduce((sum, fact) => sum + fact.lead.escalations, 0);
  const leadMissions = observed(fact => fact.lead.recoveries + fact.lead.queued + fact.lead.escalations > 0);
  const testRequests = concurrent.filter(item => item.round.requests.tests !== null).length;
  const agent = flowReviewInputs(facts, 'agent'), human = flowReviewInputs(facts, 'human');
  const legacy = legacyPathObservations(facts, sequentialOnly, returns.placed);
  const refined = observed(fact => fact.window !== null);
  const nodes: FlowGraphNode[] = [
    flowNode(population, 'refine', 'refine-agent', refined, [['Missions with a recorded flow window', refined]]),
    flowNode(population, 'implement', 'implement-agent', reviewMissions, [['Initial work from Refine', refined],
      ['Initial work without a recorded Refine entry', population - refined], ['Distinct returns', returns.total]], returns.total),
    flowNode(population, 'rebase', 'parallix', rebaseMissions, [['Pre-review runs', preRebase.runs],
      ['Sequential integration checks', integration.sequential.count], ['Operator landing rebases', integration.landing.count],
      ['Other integration rebases', integrationRebase.runs - integration.sequential.count - integration.landing.count]]),
    flowNode(population, 'rebase-resolve', 'implement-agent', rebaseMissions, [['First conflicts', preRebase.conflicted + integrationRebase.conflicted],
      ['Repeated conflicts', preRebase.repeats + integrationRebase.repeats]]),
    flowNode(population, 'declared-gates', 'parallix', declaredMissions, batchParts(declared)),
    flowNode(population, 'integration-tests', 'parallix', integrationMissions, batchParts(integrationTests)),
    flowNode(population, 'agent-review', 'review-agent', agent.observedMissions, reviewParts(agent)),
    flowNode(population, 'human-review', 'human', human.observedMissions, reviewParts(human)),
    flowNode(population, 'automated-join', 'parallix', joinedMissions, [['Passing joins', passedJoins], ['Failed joins with a matched return', repairs.length],
      ['Failed joins without a matched return', joined.length - passedJoins - repairs.length]]),
    flowNode(population, 'human-verdict', 'human', joinedMissions, [['Ready at the join', joined.filter(item => item.round.human.state === 'ready').length],
      ['Answered later', joined.filter(item => item.round.human.state === 'later').length],
      ['Answer recorded without timing', joined.filter(item => item.round.human.state === 'timing-unavailable').length]]),
    flowNode(population, 'landed', 'main', population, [['Completed lifecycle deliveries', population]]),
    ...(leadMissions > 0 ? [flowNode(population, 'lead', 'lead', leadMissions, [['Observed recoveries', leadRecoveries]])] : []),
  ];
  const passed = (runs: readonly FlowGateRun[]) => runs.filter(run => run.result === 'passed').length;
  const humanReturns = returns.countFrom('human-review');
  const edge = (from: FlowNodeId | null, to: FlowNodeId, kind: FlowEdgeKind, count: number,
    metric: BranchMetric | null, observedMissions: number, stage: FlowGraphEdge['stage'] = null): FlowGraphEdge =>
    ({ id: `${from ?? 'unrecorded'}->${to}:${kind}${stage ? `:${stage}` : ''}`, from, to, kind, stage, count,
      share: metric?.share ?? null, percentage: metric?.percentage ?? null, observedMissions, population });
  const agentOutcomes = outcomeMetrics(legacy.agentApprovals, legacy.agentRejections);
  const legacyDeclaredOutcomes = gateMetrics(legacy.declared);
  const legacyIntegrationOutcomes = gateMetrics(legacy.integration);
  const joinedOutcomes = outcomeMetrics(passedJoins, joined.length - passedJoins);
  const humanTiming = humanJoinMetrics(joined.map(item => item.round));
  const edges: FlowGraphEdge[] = [
    edge('refine', 'implement', 'flow', nodes[0]!.count, null, nodes[0]!.observedMissions),
    edge('implement', 'rebase', 'flow', preRebase.runs, null, preRebaseMissions, 'pre-review-rebase'),
    edge('rebase', 'implement', 'workflow-return', returns.countFrom('rebase'), null, returns.missionsFrom('rebase')),
    ...rebaseEdges('declared-gates', preRebase, preRebaseMissions, 'pre-review-rebase', edge),
    edge('declared-gates', 'agent-review', 'flow', passed(legacy.declared), legacyDeclaredOutcomes[0]!, declaredMissions),
    edge('declared-gates', 'integration-tests', 'concurrent-request', testRequests, null, concurrentMissions),
    edge('declared-gates', 'agent-review', 'concurrent-request', agent.concurrent, null, concurrentMissions),
    edge('declared-gates', 'human-review', 'concurrent-request', human.concurrent, null, concurrentMissions),
    edge('declared-gates', 'implement', 'gate-failed', returns.countFrom('declared-gates'), legacyDeclaredOutcomes[1]!, declaredMissions),
    edge('integration-tests', 'automated-join', 'automated-verdict', joined.length, null, joinedMissions),
    edge('agent-review', 'automated-join', 'automated-verdict', joined.length, null, joinedMissions),
    edge('automated-join', 'human-verdict', 'automated-pass', passedJoins, joinedOutcomes[0]!, joinedMissions),
    ...repairEdges(repairs, joinedMissions, edge),
    ...humanJoinEdges(humanTiming, joinedMissions, edge),
    edge('agent-review', 'human-review', 'flow', legacy.agentApprovals, agentOutcomes[0]!, reviewMissions),
    edge('agent-review', 'implement', 'agent-findings', legacy.agentReturns, agentOutcomes[1]!, reviewMissions),
    edge('human-review', 'implement', 'human-changes', humanReturns, null, Math.max(reviewMissions, returns.missionsFrom('human-review'))),
    edge('human-verdict', 'rebase', 'flow', integration.sequential.count, null, integration.sequential.missions, 'integration-rebase'),
    edge('human-verdict', 'rebase', 'landing-rebase', integration.landing.count, null, integration.landing.missions, 'integration-rebase'),
    ...(integrationRebase.runs > 0 ? rebaseEdges('integration-tests', integrationRebase, integration.missions.size, 'integration-rebase', edge) : []),
    edge('integration-tests', 'human-verdict', 'tests-passed', passed(legacy.integration), legacyIntegrationOutcomes[0]!,
      legacy.integrationMissions),
    ...((legacy.integrationMissions > 0 || returns.countFrom('integration-tests') > 0) ? [edge('integration-tests', 'implement', 'gate-failed',
      returns.countFrom('integration-tests'), legacyIntegrationOutcomes[1]!, Math.max(legacy.integrationMissions, returns.missionsFrom('integration-tests')))] : []),
    edge('human-verdict', 'landed', 'operator-land', population, null, population),
    edge(null, 'implement', 'workflow-return', returns.countFrom(null), null, returns.missionsFrom(null)),
    ...(escalations > 0 ? [edge('lead', 'human-review', 'lead-escalation', escalations, null, leadMissions)] : []),
  ];
  return { nodes, edges, verification: verificationSummary(facts, rounds.map(item => item.round), repairs,
    new Set(pilotApprovals.map(item => item.fact)).size) };
}

function legacyPathObservations(facts: readonly FlowGraphFacts[], sequentialOnly: ReadonlySet<FlowGraphFacts>,
  placed: readonly { readonly fact: FlowGraphFacts; readonly from: FlowNodeId | null }[]) {
  const gates = facts.flatMap(fact => fact.gateRuns.map(run => ({ fact, run,
    round: policyRoundForGate(run, fact.verificationRounds ?? []) })));
  const isLegacy = ({ fact, round }: typeof gates[number]) => round ? round.execution !== 'pilot' : sequentialOnly.has(fact);
  const declared = gates.filter(item => DECLARED_GATE_PHASES.has(item.run.phase) && isLegacy(item)).map(item => item.run);
  const independent = gates.filter(item => !DECLARED_GATE_PHASES.has(item.run.phase)
    && !(item.round?.execution === 'pilot' && item.round.concurrent));
  const integration = independent.filter(isLegacy);
  const agentDecisions = facts.flatMap(fact => {
    const rounds = fact.verificationRounds ?? [];
    const decisions = new Map<string, 'approved' | 'changes-requested'>();
    for (const round of rounds) {
      const passed = round.requests.agent?.passed;
      if (round.execution !== 'pilot' && typeof passed === 'boolean') {
        decisions.set(`review:${round.round}`, passed ? 'approved' : 'changes-requested');
      }
    }
    for (const episode of fact.reviewStatistics.episodes) {
      if (episode.actor !== 'agent' || !episode.decision) { continue; }
      if (sequentialOnly.has(fact) || decisions.has(episode.identity)) { decisions.set(episode.identity, episode.decision); }
    }
    return [...decisions.values()];
  });
  const agentReturns = placed.filter(value => value.from === 'agent-review').length;
  return { declared, integration: integration.map(item => item.run),
    integrationMissions: new Set(integration.map(item => item.fact)).size, agentReturns,
    agentApprovals: agentDecisions.filter(value => value === 'approved').length,
    agentRejections: agentDecisions.filter(value => value === 'changes-requested').length };
}

/** Keep integration checks for sequential execution and real rebases for the parallel path. */
function integrationRebaseObservations(facts: readonly FlowGraphFacts[], sequentialOnly: ReadonlySet<FlowGraphFacts>) {
  const runs = facts.flatMap(fact => fact.rebaseRuns.flatMap(run => {
    if (run.stage !== 'integration-rebase' || run.outcomes.length === 0) { return []; }
    const owners = fact.verificationRounds?.filter(round => round.operationId === run.operationId) ?? [];
    const seq = owners.length > 0 ? owners.every(round => round.execution !== 'pilot') : sequentialOnly.has(fact);
    const real = run.outcomes.some(outcome => outcome !== 'no-op');
    return seq || real ? [{ fact, run, seq }] : [];
  }));
  const coverage = (selected: typeof runs) => ({ count: selected.length, missions: new Set(selected.map(item => item.fact)).size });
  return { runs, missions: new Set(runs.map(item => item.fact)), sequential: coverage(runs.filter(item => item.seq)),
    landing: coverage(runs.filter(item => !item.seq && item.run.operationCommand === 'integrate:merge')) };
}

function policyRoundForGate(run: FlowGateRun, rounds: readonly FlowVerificationRound[]): FlowVerificationRound | null {
  if (run.operationId === null) { return null; }
  const candidates = rounds.filter(round => round.operationId === run.operationId);
  if (DECLARED_GATE_PHASES.has(run.phase)) {
    if (run.finishedAt === null) { return null; }
    return candidates.map(round => ({ round, at: roundStartedAt(round) }))
      .filter(value => value.at >= run.finishedAt!)
      .sort((left, right) => left.at.localeCompare(right.at))[0]?.round ?? null;
  }
  return candidates.flatMap(round => round.testRequests.map(request => ({ round, request })))
    .filter(value => value.request.startedAt <= run.requestedAt
      && (value.request.outcomeAt === null || run.requestedAt <= value.request.outcomeAt))
    .sort((left, right) => right.request.startedAt.localeCompare(left.request.startedAt))[0]?.round ?? null;
}

function repairEdges(repairs: readonly FlowRoundRepair[], observedMissions: number,
  edge: (from: FlowNodeId | null, to: FlowNodeId, kind: FlowEdgeKind, count: number,
    metric: BranchMetric | null, observedMissions: number, stage?: FlowGraphEdge['stage']) => FlowGraphEdge): FlowGraphEdge[] {
  const counts = [repairs.filter(value => value.kind === 'gate').length,
    repairs.filter(value => value.kind === 'agent').length, repairs.filter(value => value.kind === 'joint').length];
  const metrics = branchMetrics(counts);
  return [edge('automated-join', 'implement', 'gate-repair', counts[0]!, metrics[0]!, observedMissions),
    edge('automated-join', 'implement', 'agent-repair', counts[1]!, metrics[1]!, observedMissions),
    edge('automated-join', 'implement', 'joint-repair', counts[2]!, metrics[2]!, observedMissions)];
}

function humanJoinMetrics(rounds: readonly FlowVerificationRound[]) {
  const states: FlowHumanJoinState[] = ['ready', 'later', 'pending', 'withdrawn', 'timing-unavailable'];
  const counts = states.map(state => rounds.filter(round => round.human.state === state).length);
  const metrics = branchMetrics(counts);
  return states.map((state, index) => ({ state, count: counts[index]!, metric: metrics[index]! }));
}

function humanJoinEdges(values: ReturnType<typeof humanJoinMetrics>, observedMissions: number,
  edge: (from: FlowNodeId | null, to: FlowNodeId, kind: FlowEdgeKind, count: number,
    metric: BranchMetric | null, observedMissions: number, stage?: FlowGraphEdge['stage']) => FlowGraphEdge): FlowGraphEdge[] {
  const kinds: Readonly<Record<FlowHumanJoinState, FlowEdgeKind>> = {
    ready: 'human-ready', later: 'human-wait', pending: 'human-pending', withdrawn: 'human-withdrawn',
    'timing-unavailable': 'timing-unavailable',
  };
  return values.map(value => edge('human-review', 'human-verdict', kinds[value.state], value.count,
    value.metric, observedMissions));
}

function verificationSummary(facts: readonly FlowGraphFacts[], rounds: readonly FlowVerificationRound[],
  repairs: readonly FlowRoundRepair[], pilotApprovedMissions: number): FlowVerificationSummary {
  const executions = { pilot: 0, fallback: 0, shadow: 0, unobserved: 0, historical: 0 };
  for (const fact of facts) {
    const observed = fact.verificationRounds ?? [];
    if (observed.length === 0) { executions.historical += 1; continue; }
    const mode = observed.some(round => round.execution === 'fallback') ? 'fallback'
      : observed.some(round => round.execution === 'pilot') ? 'pilot'
        : observed.some(round => round.execution === 'shadow') ? 'shadow' : 'unobserved';
    executions[mode] += 1;
  }
  const human = { ready: 0, later: 0, pending: 0, withdrawn: 0, 'timing-unavailable': 0 };
  const joined = rounds.filter(round => round.execution === 'pilot' && round.concurrent && round.join !== null);
  for (const round of joined) { human[round.human.state] += 1; }
  const reasons = facts.flatMap(fact => fact.reviewStatistics.intervention?.reason
    ? [fact.reviewStatistics.intervention.reason] : []);
  return { configured: facts.find(fact => fact.verificationPolicy !== undefined)?.verificationPolicy ?? null,
    executions, observedRounds: rounds.length,
    concurrentRounds: rounds.filter(round => round.execution === 'pilot' && round.concurrent).length,
    joinedRounds: rounds.filter(round => round.execution === 'pilot' && round.concurrent && round.join !== null).length,
    pilotApprovedMissions, human, repairs: { gate: repairs.filter(value => value.kind === 'gate').length,
      agent: repairs.filter(value => value.kind === 'agent').length,
      joint: repairs.filter(value => value.kind === 'joint').length },
    exceptions: { interrupted: reasons.filter(reason => reason === 'CONCURRENT_TESTS_INTERRUPTED').length,
      revisionDrift: reasons.filter(reason => reason === 'CONCURRENT_REVIEW_REVISION_DRIFT').length,
      handoff: reasons.filter(reason => reason.startsWith('CONCURRENT_TESTS_')
        && !['CONCURRENT_TESTS_INTERRUPTED', 'CONCURRENT_TESTS_UNSETTLED'].includes(reason)).length
        + reasons.filter(reason => reason === 'CONCURRENT_TESTS_UNSETTLED').length,
      humanCorrection: reasons.filter(reason => reason === 'APPROVED_ROUND_HUMAN_CORRECTION').length },
    sameRevisionTestReruns: rounds.reduce((sum, round) => sum + round.sameRevisionTestReruns, 0), population: facts.length };
}

/** Rebase continuation counts are projection-owned so renderers only format retained graph facts. */
export function flowRebaseContinuationCount(graph: FlowGraph,
  stage: Exclude<FlowRebaseRun['stage'], 'direct-rebase'>): number {
  const continuation = stage === 'pre-review-rebase' ? 'declared-gates' : 'integration-tests';
  return graph.edges.filter(edge => edge.stage === stage && edge.to === continuation)
    .reduce((sum, edge) => sum + edge.count, 0);
}

/** The node a return leaves from: its recorded review actor, or the gate its typed cause names. */
/** The retained sending node for a return, or null when its stored facts do not name one. */
export function flowReturnSource(origin: ReviewStatistics['returns'][number]['origin']): FlowNodeId | null {
  if (origin.stage === 'pre-review-rebase') { return 'rebase'; }
  if (origin.stage === 'integration-gates') { return 'integration-tests'; }
  if (origin.stage !== 'workflow') { return origin.stage; }
  // Historical rows recorded only a coarse cause; fresh producers name the stage above.
  if (origin.cause === 'repair') { return 'declared-gates'; }
  if (origin.cause === 'integration-gate-failure') { return 'integration-tests'; }
  return null;
}

interface RebaseSummary {
  readonly runs: number;
  readonly clean: number;
  readonly conflicted: number;
  readonly failedFirst: number;
  readonly repeats: number;
  readonly resolved: number;
  readonly failedAfterConflict: number;
}

function rebaseSummary(runs: readonly FlowRebaseRun[]): RebaseSummary {
  const settled = runs.filter(run => run.outcomes.length > 0);
  const conflicted = settled.filter(run => run.outcomes[0] === 'conflict');
  const last = (run: FlowRebaseRun) => run.outcomes.at(-1);
  return { runs: settled.length,
    clean: settled.filter(run => isSuccessfulRebaseOutcome(run.outcomes[0])).length,
    conflicted: conflicted.length,
    failedFirst: settled.filter(run => run.outcomes[0] === 'failed').length,
    repeats: conflicted.reduce((sum, run) => sum + run.outcomes.slice(1).filter(outcome => outcome === 'conflict').length, 0),
    resolved: conflicted.filter(run => isSuccessfulRebaseOutcome(last(run))).length,
    failedAfterConflict: conflicted.filter(run => last(run) === 'failed').length };
}

function rebaseEdges(continuation: FlowNodeId, summary: RebaseSummary, observedMissions: number, stage: FlowRebaseRun['stage'],
  edge: (from: FlowNodeId | null, to: FlowNodeId, kind: FlowEdgeKind, count: number,
    metric: BranchMetric | null, observedMissions: number, stage?: FlowGraphEdge['stage']) => FlowGraphEdge): FlowGraphEdge[] {
  const initial = branchMetrics([summary.clean, summary.conflicted, summary.failedFirst]);
  const resolution = branchMetrics([summary.repeats, summary.resolved, summary.failedAfterConflict]);
  return [
    edge('rebase', continuation, 'clean', summary.clean, initial[0]!, observedMissions, stage),
    edge('rebase', 'rebase-resolve', 'rebase-conflict', summary.conflicted, initial[1]!, observedMissions, stage),
    edge('rebase', 'human-review', 'rebase-failed', summary.failedFirst, initial[2]!, observedMissions, stage),
    edge('rebase-resolve', 'rebase-resolve', 'rebase-repeat', summary.repeats, resolution[0]!, observedMissions, stage),
    edge('rebase-resolve', continuation, 'flow', summary.resolved, resolution[1]!, observedMissions, stage),
    edge('rebase-resolve', 'human-review', 'rebase-failed', summary.failedAfterConflict, resolution[2]!, observedMissions, stage),
  ];
}

interface BranchMetric { readonly share: number; readonly percentage: number }

function gateMetrics(runs: readonly FlowGateRun[]): readonly (BranchMetric | null)[] {
  const terminal = [runs.filter(run => run.result === 'passed').length, runs.filter(run => run.result === 'failed').length];
  return outcomeMetrics(terminal[0]!, terminal[1]!);
}

function outcomeMetrics(passed: number, failed: number): readonly (BranchMetric | null)[] {
  return passed + failed > 0 ? branchMetrics([passed, failed]) : [null, null];
}

/** Largest-remainder allocation keeps rendered sibling outcomes honest and exactly at 100%. */
function branchMetrics(counts: readonly number[]): BranchMetric[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) { return counts.map(() => ({ share: 0, percentage: 0 })); }
  const exact = counts.map(count => count * 100 / total);
  const percentages = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - percentages[index]! }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = 100 - percentages.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index++) {
    percentages[order[index]!.index]! += 1;
  }
  return counts.map((count, index) => ({ share: count / total, percentage: percentages[index]! }));
}
