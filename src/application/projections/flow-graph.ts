import type { FlowGateRun, FlowLeadEpisodes, FlowRebaseRun } from './flow-mission-facts.js';
import type { ReviewStatistics } from '../services/review-statistics.js';
import { isSuccessfulRebaseOutcome } from '../ports/rebase-workflow.js';

/** Actor swimlanes of the Mission flow: who holds the work at each node and each elapsed row. */
export type FlowLaneId = 'refine-agent' | 'implement-agent' | 'parallix' | 'review-agent' | 'lead' | 'human' | 'external' | 'main';
export type FlowNodeId = 'refine' | 'implement' | 'pre-review-rebase' | 'pre-review-resolve' | 'declared-gates'
  | 'agent-review' | 'human-review' | 'integration-rebase' | 'integration-resolve' | 'integration-gates' | 'landed' | 'lead';
export type FlowEdgeKind = 'flow' | 'clean' | 'gate-failed' | 'agent-findings' | 'human-changes' | 'rebase-conflict'
  | 'rebase-repeat' | 'rebase-failed' | 'workflow-return' | 'lead-escalation';

export interface FlowGraphNode {
  readonly id: FlowNodeId;
  readonly lane: FlowLaneId;
  /** Passes through the node: missions, runs, rounds or conflicts, as named by the node. */
  readonly count: number;
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
}
export interface FlowGraph {
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
}

export interface FlowGraphFacts {
  readonly window: { readonly startedAt: string; readonly finishedAt: string } | null;
  readonly gateRuns: readonly FlowGateRun[];
  readonly rebaseRuns: readonly FlowRebaseRun[];
  readonly lead: FlowLeadEpisodes;
  readonly reviewStatistics: ReviewStatistics;
}

const DECLARED_GATE_PHASES = new Set(['handoff', 'review']);

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
  const returns = facts.flatMap(fact => fact.reviewStatistics.returns);
  const episodes = facts.flatMap(fact => fact.reviewStatistics.episodes ?? []);
  const observed = (predicate: (fact: FlowGraphFacts) => boolean) => facts.filter(predicate).length;
  const gate = (declared: boolean) => facts.flatMap(fact => fact.gateRuns.filter(run => DECLARED_GATE_PHASES.has(run.phase) === declared));
  const declared = gate(true), integration = gate(false);
  const declaredMissions = observed(fact => fact.gateRuns.some(run => DECLARED_GATE_PHASES.has(run.phase)));
  const integrationMissions = observed(fact => fact.gateRuns.some(run => !DECLARED_GATE_PHASES.has(run.phase)));
  const rebase = (stage: FlowRebaseRun['stage']) => rebaseSummary(facts.flatMap(fact => fact.rebaseRuns.filter(run => run.stage === stage)));
  const preRebase = rebase('pre-review-rebase'), integrationRebase = rebase('integration-rebase');
  const rebaseMissions = (stage: FlowRebaseRun['stage']) => observed(fact => fact.rebaseRuns.some(run => run.stage === stage));
  const agentRounds = episodes.filter(item => item.actor === 'agent').length;
  const humanRounds = episodes.filter(item => item.actor === 'human').length;
  const reviewMissions = observed(fact => fact.reviewStatistics.total !== null);
  const placed = returns.map(item => ({ item, from: returnSource(item.origin) }));
  const returnsFrom = (from: FlowNodeId | null) => placed.filter(value => value.from === from).length;
  const leadRecoveries = facts.reduce((sum, fact) => sum + fact.lead.recoveries, 0);
  const escalations = facts.reduce((sum, fact) => sum + fact.lead.escalations, 0);
  const leadMissions = observed(fact => fact.lead.recoveries + fact.lead.queued + fact.lead.escalations > 0);
  const node = (id: FlowNodeId, lane: FlowLaneId, count: number, observedMissions: number, rework: number | null = null): FlowGraphNode =>
    ({ id, lane, count, rework, observedMissions, population });
  const nodes: FlowGraphNode[] = [
    node('refine', 'refine-agent', observed(fact => fact.window !== null), observed(fact => fact.window !== null)),
    node('implement', 'implement-agent', population + returns.length, reviewMissions, returns.length),
    node('pre-review-rebase', 'parallix', preRebase.runs, rebaseMissions('pre-review-rebase')),
    node('pre-review-resolve', 'implement-agent', preRebase.conflicted, rebaseMissions('pre-review-rebase')),
    node('declared-gates', 'parallix', declared.length, declaredMissions),
    node('agent-review', 'review-agent', agentRounds, reviewMissions),
    node('human-review', 'human', humanRounds, reviewMissions),
    node('integration-rebase', 'parallix', integrationRebase.runs, rebaseMissions('integration-rebase')),
    node('integration-resolve', 'implement-agent', integrationRebase.conflicted, rebaseMissions('integration-rebase')),
    node('integration-gates', 'parallix', integration.length, integrationMissions),
    node('landed', 'main', population, population),
    ...(leadMissions > 0 ? [node('lead', 'lead', leadRecoveries, leadMissions)] : []),
  ];
  const passed = (runs: readonly FlowGateRun[]) => runs.filter(run => run.result === 'passed').length;
  const agentReturns = returnsFrom('agent-review'), humanReturns = returnsFrom('human-review');
  const edge = (from: FlowNodeId | null, to: FlowNodeId, kind: FlowEdgeKind, count: number,
    metric: BranchMetric | null): FlowGraphEdge => ({ id: `${from ?? 'unrecorded'}->${to}:${kind}`, from, to, kind, count,
    share: metric?.share ?? null, percentage: metric?.percentage ?? null });
  const declaredOutcomes = gateMetrics(declared);
  const agentOutcomes = branchMetrics([Math.max(0, agentRounds - agentReturns), agentReturns]);
  const humanOutcomes = branchMetrics([Math.max(0, humanRounds - humanReturns), humanReturns]);
  const integrationOutcomes = gateMetrics(integration);
  const edges: FlowGraphEdge[] = [
    edge('refine', 'implement', 'flow', nodes[0]!.count, null),
    edge('implement', 'pre-review-rebase', 'flow', preRebase.runs, null),
    edge('pre-review-rebase', 'implement', 'workflow-return', returnsFrom('pre-review-rebase'), null),
    ...rebaseEdges('pre-review-rebase', 'pre-review-resolve', 'declared-gates', preRebase, edge),
    edge('declared-gates', 'agent-review', 'flow', passed(declared), declaredOutcomes[0]!),
    edge('declared-gates', 'implement', 'gate-failed', returnsFrom('declared-gates'), declaredOutcomes[1]!),
    edge('agent-review', 'human-review', 'flow', Math.max(0, agentRounds - agentReturns), agentOutcomes[0]!),
    edge('agent-review', 'implement', 'agent-findings', agentReturns, agentOutcomes[1]!),
    edge('human-review', 'integration-rebase', 'flow', Math.max(0, humanRounds - humanReturns), humanOutcomes[0]!),
    edge('human-review', 'implement', 'human-changes', humanReturns, humanOutcomes[1]!),
    ...rebaseEdges('integration-rebase', 'integration-resolve', 'integration-gates', integrationRebase, edge),
    edge('integration-gates', 'landed', 'flow', passed(integration), integrationOutcomes[0]!),
    edge('integration-gates', 'implement', 'gate-failed', returnsFrom('integration-gates'), integrationOutcomes[1]!),
    edge(null, 'implement', 'workflow-return', returnsFrom(null), null),
    ...(escalations > 0 ? [edge('lead', 'human-review', 'lead-escalation', escalations, null)] : []),
  ];
  return { nodes, edges };
}

/** The node a return leaves from: its recorded review actor, or the gate its typed cause names. */
function returnSource(origin: ReviewStatistics['returns'][number]['origin']): FlowNodeId | null {
  if (origin.stage !== 'workflow') { return origin.stage; }
  // Historical rows recorded only a coarse cause; fresh producers name the stage above.
  if (origin.cause === 'repair') { return 'declared-gates'; }
  if (origin.cause === 'integration-gate-failure') { return 'integration-gates'; }
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
    clean: settled.filter(run => isSuccessfulRebaseOutcome(run.outcomes[0]) && run.outcomes[0] !== 'resolved').length,
    conflicted: conflicted.length,
    failedFirst: settled.filter(run => run.outcomes[0] === 'failed').length,
    repeats: conflicted.reduce((sum, run) => sum + run.outcomes.slice(1).filter(outcome => outcome === 'conflict').length, 0),
    resolved: conflicted.filter(run => isSuccessfulRebaseOutcome(last(run))).length,
    failedAfterConflict: conflicted.filter(run => last(run) === 'failed').length };
}

function rebaseEdges(rebase: FlowNodeId, resolve: FlowNodeId, gates: FlowNodeId, summary: RebaseSummary,
  edge: (from: FlowNodeId | null, to: FlowNodeId, kind: FlowEdgeKind, count: number, metric: BranchMetric | null) => FlowGraphEdge): FlowGraphEdge[] {
  const initial = branchMetrics([summary.clean, summary.conflicted, summary.failedFirst]);
  const resolution = branchMetrics([summary.repeats, summary.resolved, summary.failedAfterConflict]);
  return [
    edge(rebase, gates, 'clean', summary.clean, initial[0]!),
    edge(rebase, resolve, 'rebase-conflict', summary.conflicted, initial[1]!),
    edge(rebase, 'human-review', 'rebase-failed', summary.failedFirst, initial[2]!),
    edge(resolve, resolve, 'rebase-repeat', summary.repeats, resolution[0]!),
    edge(resolve, gates, 'flow', summary.resolved, resolution[1]!),
    edge(resolve, 'human-review', 'rebase-failed', summary.failedAfterConflict, resolution[2]!),
  ];
}

interface BranchMetric { readonly share: number; readonly percentage: number }

function gateMetrics(runs: readonly FlowGateRun[]): readonly (BranchMetric | null)[] {
  const terminal = [runs.filter(run => run.result === 'passed').length, runs.filter(run => run.result === 'failed').length];
  return terminal[0]! + terminal[1]! > 0 ? branchMetrics(terminal) : [null, null];
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
