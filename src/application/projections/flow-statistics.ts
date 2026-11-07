import type { DecisionWindows } from '../../domain/decision-window.js';
import { decisionWindowContains } from '../../domain/decision-window.js';
import type { FlowOwnershipRow } from './flow-elapsed-ownership.js';
import type { FlowGateRun, FlowLeadEpisodes, FlowRebaseRun } from './flow-mission-facts.js';
import { flowGraph, type FlowGraph, type FlowLaneId } from './flow-graph.js';
import type { ReviewStatistics } from '../services/review-statistics.js';

export type { FlowEdgeKind, FlowGraph, FlowGraphEdge, FlowGraphNode, FlowLaneId, FlowNodeId } from './flow-graph.js';

/** Lifecycle states whose closed dwell the FLOW state cards report. */
export const FLOW_DWELL_STATES = ['backlog', 'refined', 'active', 'review', 'integration'] as const;
export type FlowDwellState = typeof FLOW_DWELL_STATES[number];

export interface FlowMissionFacts {
  readonly repositoryId: string;
  readonly missionId: string;
  readonly closedAt: string;
  /** Final implementer family that owns the delivery; null when no attribution was recorded. */
  readonly implementer: string | null;
  readonly diagramNodeIds: readonly string[];
  readonly diagramEdgeIds: readonly string[];
  readonly ownership: readonly FlowOwnershipRow[];
  readonly window: { readonly startedAt: string; readonly finishedAt: string } | null;
  readonly gateRuns: readonly FlowGateRun[];
  readonly rebaseRuns: readonly FlowRebaseRun[];
  /** Applicability proven by a fresh workflow reaching its lifecycle boundary after collection became active. */
  readonly rebaseExpected?: Readonly<Record<'preReview' | 'integration', boolean>>;
  readonly lead: FlowLeadEpisodes;
  /** Summed closed lifecycle dwell per state; null when lifecycle transitions were not read. */
  readonly laneDwellMs: Readonly<Partial<Record<FlowDwellState, number>>> | null;
  readonly actualAgentLaunches: number | null;
  readonly agentLaunchesLowerBound?: boolean;
  readonly agentLaunches: readonly { readonly runId: string; readonly startedAt: string;
    readonly family: string | null; readonly model: string | null }[];
  readonly observedDisqualifiers: readonly string[] | null;
  /** Named upstream exclusions that make this measured subset incomplete. */
  readonly collectionDefects?: readonly string[];
  readonly reviewStatistics: ReviewStatistics;
}

export interface FlowDistribution {
  readonly totalMs: number;
  readonly meanMs: number;
  readonly p90Ms: number;
  readonly n: number;
}
export interface FlowTimeSummary extends FlowDistribution {
  readonly step: string;
  readonly actor: string;
  readonly model: string | null;
  readonly state: 'working' | 'waiting' | 'held';
}
/** One step held by one actor, averaged over missions with ownership observations. */
export interface FlowTimeTableRow {
  readonly id: string;
  readonly step: string;
  readonly actor: string;
  readonly lane: FlowLaneId;
  readonly waitingMs: number;
  readonly workingMs: number;
  readonly heldMs: number;
  readonly totalMs: number;
  /** Share of all observed work in the cohort. */
  readonly share: number;
  /** Mission order: mean offset of the row's first slice from the refined boundary. */
  readonly order: number;
}
export interface FlowLaneTime {
  readonly lane: FlowLaneId;
  /** Concrete agent families observed holding this lane's rows, sorted. */
  readonly families: readonly string[];
  readonly waitingMs: number;
  readonly workingMs: number;
  readonly heldMs: number;
  readonly totalMs: number;
  readonly share: number;
}
export interface FlowRate {
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly observed: number;
  readonly population: number;
  readonly coverage: number;
  readonly state: 'measured' | 'no-eligible-population' | 'missing-observation';
  readonly value: number | null;
}
export interface FlowWindowStatistics {
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly completedMissions: number;
  /** Current minus previous deliveries for the same cohort; null for the previous window. */
  readonly throughputChange: number | null;
  /** Missions whose interval observations explain all, part or none of refined-to-first-delivery time. */
  readonly observation: { readonly complete: number; readonly partial: number; readonly unobserved: number };
  readonly diagram: { readonly nodeCount: number; readonly edgeCount: number };
  readonly graph: FlowGraph;
  readonly cycleTime: { readonly meanMs: number; readonly p90Ms: number; readonly n: number } | null;
  readonly firstPassYield: FlowRate;
  readonly extraAgentLaunches: { readonly total: number | null; readonly meanPerMission: number | null; readonly n: number; readonly lowerBound: boolean;
    /** Return-driven rework jobs from the measured subset. */
    readonly reworkJobs: number | null; readonly reworkMeanPerMission: number | null; readonly reworkN: number };
  readonly sendBacks: Readonly<Record<'agent' | 'human', FlowRate>>;
  readonly returns: readonly { readonly repositoryId: string; readonly missionId: string; readonly identity: string;
    readonly at: string | null; readonly author: string | null; readonly responsibleModel: string | null;
    readonly actor: import('../services/review-statistics.js').ReviewSendingActor;
    readonly stage: string; readonly cause: string | null; readonly decisionIdentity: string | null;
    readonly revision: string | null; readonly sender: string | null }[];
  readonly episodes: readonly { readonly repositoryId: string; readonly missionId: string;
    readonly identity: string; readonly actor: 'agent' | 'human'; readonly stage: string;
    readonly startedAt: string; readonly endedAt: string; readonly revision: string | null; readonly sender: string }[];
  readonly time: {
    readonly rows: readonly FlowTimeSummary[];
    readonly largestHolder: { readonly step: string; readonly actor: string; readonly model: string | null;
      readonly state: 'working' | 'waiting' | 'held';
      readonly totalMs: number; readonly share: number } | null;
    readonly measuredMissions: number;
    /** Per-mission averages over missions with durable ownership observations. */
    readonly table: readonly FlowTimeTableRow[];
    /** Published footer values for the average mission; clients only format them. */
    readonly totals: { readonly waitingMs: number; readonly workingMs: number; readonly heldMs: number; readonly totalMs: number };
    readonly unobservedMs: number;
    readonly lanes: readonly FlowLaneTime[];
    readonly largestLane: FlowLaneId | null;
  };
  readonly stateDwell: readonly { readonly state: FlowDwellState; readonly medianMs: number; readonly p90Ms: number; readonly n: number }[];
  readonly defects: readonly string[];
}
export interface FlowCohortStatistics {
  readonly current: FlowWindowStatistics;
  readonly previous: FlowWindowStatistics;
}
export interface FlowStatistics extends FlowCohortStatistics {
  /** The same windows restricted to missions each concrete implementer family delivered. */
  readonly families: readonly ({ readonly family: string } & FlowCohortStatistics)[];
}

/** Shared typed FLOW/px-stats projection. Selection is by first completion; full mission history supplies every metric. */
export function flowStatistics(facts: readonly FlowMissionFacts[], windows: DecisionWindows): FlowStatistics {
  const families = [...new Set(facts.flatMap(fact => fact.implementer ? [fact.implementer] : []))]
    .sort((left, right) => left.localeCompare(right));
  return { ...cohort(facts, windows),
    families: families.map(family => ({ family, ...cohort(facts.filter(fact => fact.implementer === family), windows) })) };
}

function cohort(facts: readonly FlowMissionFacts[], windows: DecisionWindows): FlowCohortStatistics {
  const previous = projectWindow(facts.filter(fact => decisionWindowContains(windows.previous, fact.closedAt)), windows.previous, null);
  const current = projectWindow(facts.filter(fact => decisionWindowContains(windows.current, fact.closedAt)), windows.current,
    previous.completedMissions);
  return { current, previous };
}

function projectWindow(facts: readonly FlowMissionFacts[], window: DecisionWindows['current'],
  previousCompleted: number | null): FlowWindowStatistics {
  const defects = new Set<string>(facts.flatMap(fact => fact.collectionDefects ?? []));
  const { observedFirstPass, launchFacts, timeFacts } = observedFlowFacts(facts, defects);
  const firstPass = observedFirstPass.filter(fact => fact.observedDisqualifiers!.length === 0
    && fact.reviewStatistics.total === 0).length;
  const extra = launchFacts.map(fact => Math.max(0, fact.actualAgentLaunches! - 1));
  const extraTotal = launchFacts.length ? sum(extra) : null;
  const reworkFacts = facts.filter(fact => fact.reviewStatistics.total !== null);
  const reworkJobs = reworkFacts.length ? sum(reworkFacts.map(fact => fact.reviewStatistics.total!)) : null;
  const rows = timeRows(timeFacts);
  const totalTime = rows.reduce((sum, row) => sum + row.totalMs, 0);
  const largest = rows.filter(row => laneOf(row.step, row.actor) !== 'external')
    .sort((a, b) => b.totalMs - a.totalMs || key(a).localeCompare(key(b)))[0];
  const elapsed = elapsedSummary(facts);
  recordElapsedCoverageDefects(timeFacts, defects);
  recordRebaseCoverageDefects(facts, defects);
  return {
    label: window.label, startDate: window.startDate, endDate: window.endDate, completedMissions: facts.length,
    throughputChange: previousCompleted === null ? null : facts.length - previousCompleted,
    observation: elapsed.observation,
    diagram: { nodeCount: new Set(facts.flatMap(fact => fact.diagramNodeIds)).size,
      edgeCount: new Set(facts.flatMap(fact => fact.diagramEdgeIds)).size },
    graph: flowGraph(facts),
    cycleTime: elapsed.cycleTime,
    firstPassYield: rate(firstPass, observedFirstPass.length, facts.length),
    extraAgentLaunches: { total: extraTotal,
      meanPerMission: extraTotal !== null ? extraTotal / launchFacts.length : null, n: launchFacts.length,
      lowerBound: launchFacts.some(fact => fact.agentLaunchesLowerBound === true), reworkJobs,
      reworkMeanPerMission: reworkJobs !== null ? reworkJobs / reworkFacts.length : null, reworkN: reworkFacts.length },
    sendBacks: { agent: aggregateSendBacks(facts, 'agent', defects), human: aggregateSendBacks(facts, 'human', defects) },
    returns: facts.flatMap(fact => fact.reviewStatistics.returns.map(item => ({ repositoryId: fact.repositoryId,
      missionId: fact.missionId, identity: item.identity, at: item.at, author: item.author,
      responsibleModel: responsibleModel(fact, item.author, item.at),
      actor: item.origin?.actor ?? null, stage: item.origin?.stage ?? 'workflow', cause: item.origin?.cause ?? null,
      decisionIdentity: item.origin?.decisionIdentity ?? null, revision: item.origin?.revision ?? null,
      sender: item.origin?.sender ?? null }))),
    episodes: facts.flatMap(fact => (fact.reviewStatistics.episodes ?? []).map(item => ({ repositoryId: fact.repositoryId,
      missionId: fact.missionId, ...item }))),
    time: { rows, largestHolder: largest ? { step: largest.step, actor: largest.actor, model: largest.model, state: largest.state,
      totalMs: largest.totalMs, share: totalTime === 0 ? 0 : largest.totalMs / totalTime } : null,
      measuredMissions: timeFacts.length, table: elapsed.table, totals: elapsed.totals, unobservedMs: elapsed.unobservedMs,
      lanes: elapsed.lanes, largestLane: elapsed.largestLane },
    stateDwell: stateDwell(facts),
    defects: [...defects],
  };
}

function observedFlowFacts(facts: readonly FlowMissionFacts[], defects: Set<string>) {
  const observedFirstPass = facts.filter(fact => fact.observedDisqualifiers !== null && fact.reviewStatistics.total !== null);
  for (const fact of facts.filter(item => item.observedDisqualifiers === null || item.reviewStatistics.total === null)) {
    defects.add(`First-pass observations missing for ${fact.repositoryId}/${fact.missionId}; rerun the fresh workflow with FLOW collection enabled`);
  }
  const launchFacts = facts.filter(fact => fact.actualAgentLaunches !== null);
  for (const fact of facts.filter(item => item.actualAgentLaunches === null)) {
    defects.add(`Agent launch observations missing for ${fact.repositoryId}/${fact.missionId}; inspect retained run history and rerun the fresh workflow`);
  }
  const timeFacts = facts.filter(fact => fact.ownership.length > 0);
  for (const fact of facts.filter(item => item.ownership.length === 0)) {
    defects.add(`Elapsed ownership missing for ${fact.repositoryId}/${fact.missionId}; inspect refined-to-first-delivery boundaries`);
  }
  return { observedFirstPass, launchFacts, timeFacts };
}

function recordElapsedCoverageDefects(facts: readonly FlowMissionFacts[], defects: Set<string>): void {
  for (const fact of facts.filter(item => item.window)) {
    const windowMs = Date.parse(fact.window!.finishedAt) - Date.parse(fact.window!.startedAt);
    const explained = sum(fact.ownership.map(row => row.durationMs));
    if (explained < windowMs) {
      defects.add(`Elapsed ownership explains ${Math.floor(explained / windowMs * 100)}% of refined-to-first-delivery for ${fact.repositoryId}/${fact.missionId}; the remainder is reported as not observed`);
    }
  }
}

function recordRebaseCoverageDefects(facts: readonly FlowMissionFacts[], defects: Set<string>): void {
  for (const fact of facts) {
    for (const [stage, expected, label] of [
      ['pre-review-rebase', fact.rebaseExpected?.preReview, 'Pre-review'],
      ['integration-rebase', fact.rebaseExpected?.integration, 'Integration'],
    ] as const) {
      if (expected && !fact.rebaseRuns.some(run => run.stage === stage)) {
        defects.add(`${label} rebase observations missing for ${fact.repositoryId}/${fact.missionId}; inspect flow.rebase workflow collection`);
      }
    }
  }
}

/** Observed ownership averages and shares, plus separate wall-time coverage diagnostics. */
function elapsedSummary(facts: readonly FlowMissionFacts[]) {
  const windowed = facts.flatMap(fact => {
    const windowMs = fact.window ? Date.parse(fact.window.finishedAt) - Date.parse(fact.window.startedAt) : NaN;
    return Number.isFinite(windowMs) && windowMs >= 0 ? [{ fact, windowMs }] : [];
  });
  const observed = windowed.filter(({ fact }) => fact.ownership.length > 0);
  const n = observed.length;
  const explained = (fact: FlowMissionFacts) => sum(fact.ownership.map(row => row.durationMs));
  const observation = { complete: windowed.filter(({ fact, windowMs }) => fact.ownership.length > 0 && explained(fact) >= windowMs).length,
    partial: windowed.filter(({ fact, windowMs }) => fact.ownership.length > 0 && explained(fact) < windowMs).length, unobserved: 0 };
  observation.unobserved = facts.length - observation.complete - observation.partial;
  const cycleMean = windowed.length ? sum(windowed.map(value => value.windowMs)) / windowed.length : 0;
  const observedMean = n ? sum(observed.map(({ fact }) => explained(fact))) / n : 0;
  const groups = new Map<string, { step: string; actor: string; waiting: number; working: number; held: number; offsets: number[] }>();
  for (const { fact } of observed) {
    for (const row of fact.ownership) {
      const id = `${row.step}\0${row.actor}`;
      const group = groups.get(id) ?? { step: row.step, actor: row.actor, waiting: 0, working: 0, held: 0, offsets: [] };
      group[row.state === 'held' ? 'held' : row.state] += row.durationMs;
      if (row.firstOffsetMs !== undefined) { group.offsets.push(row.firstOffsetMs); }
      groups.set(id, group);
    }
  }
  const perMission = (value: number) => n ? value / n : 0;
  const share = (value: number) => observedMean > 0 ? value / observedMean : 0;
  const table: FlowTimeTableRow[] = [...groups].map(([id, group]) => {
    const totalMs = perMission(group.waiting + group.working + group.held);
    return { id: id.replace('\0', ':'), step: group.step, actor: group.actor, lane: laneOf(group.step, group.actor),
      waitingMs: perMission(group.waiting), workingMs: perMission(group.working), heldMs: perMission(group.held), totalMs,
      share: share(totalMs), order: group.offsets.length ? mean(group.offsets) : Number.MAX_SAFE_INTEGER };
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const unobservedMs = windowed.length
    ? sum(windowed.map(({ fact, windowMs }) => Math.max(0, windowMs - explained(fact)))) / windowed.length : 0;
  const totals = { waitingMs: sum(table.map(row => row.waitingMs)), workingMs: sum(table.map(row => row.workingMs)),
    heldMs: sum(table.map(row => row.heldMs)), totalMs: observedMean };
  const lanes = laneTimes(table, share);
  const largestLane = [...lanes].filter(lane => lane.totalMs > 0 && lane.lane !== 'external')
    .sort((a, b) => b.totalMs - a.totalMs || a.lane.localeCompare(b.lane))[0]?.lane ?? null;
  return { observation, table, totals, unobservedMs, lanes, largestLane,
    cycleTime: windowed.length ? { meanMs: cycleMean, p90Ms: percentile(windowed.map(value => value.windowMs), 0.9), n: windowed.length } : null };
}

const LANES: readonly FlowLaneId[] = ['refine-agent', 'implement-agent', 'parallix', 'review-agent', 'lead', 'human', 'external'];
const NON_AGENT_ACTORS = new Set(['parallix', 'lead', 'human', 'external', 'unattributed']);

/** The swimlane an elapsed row belongs to: its recorded actor, and for agents the step they held. */
export function laneOf(step: string, actor: string): FlowLaneId {
  if (actor === 'human') { return 'human'; }
  if (actor === 'lead') { return 'lead'; }
  if (actor === 'parallix') { return 'parallix'; }
  if (actor === 'external' || actor === 'unattributed') { return 'external'; }
  if (step === 'draft') { return 'refine-agent'; }
  return step === 'agent-review' ? 'review-agent' : 'implement-agent';
}

function laneTimes(table: readonly FlowTimeTableRow[], share: (value: number) => number): FlowLaneTime[] {
  return LANES.map(lane => {
    const rows = table.filter(row => row.lane === lane);
    const totalMs = sum(rows.map(row => row.totalMs));
    return { lane, families: [...new Set(rows.map(row => row.actor).filter(actor => !NON_AGENT_ACTORS.has(actor)))]
      .sort((left, right) => left.localeCompare(right)),
      waitingMs: sum(rows.map(row => row.waitingMs)), workingMs: sum(rows.map(row => row.workingMs)),
      heldMs: sum(rows.map(row => row.heldMs)), totalMs, share: share(totalMs) };
  });
}

function stateDwell(facts: readonly FlowMissionFacts[]): FlowWindowStatistics['stateDwell'] {
  return FLOW_DWELL_STATES.map(state => {
    const values = facts.flatMap(fact => {
      const value = fact.laneDwellMs?.[state];
      return value === undefined ? [] : [value];
    });
    return { state, medianMs: median(values), p90Ms: percentile(values, 0.9), n: values.length };
  });
}

function aggregateSendBacks(facts: readonly FlowMissionFacts[], actor: 'agent' | 'human', defects: Set<string>): FlowRate {
  const values = facts.map(fact => ({ fact, metric: fact.reviewStatistics.sendBacks?.[actor] ?? {
    numerator: null, eligibleEpisodes: null, coverage: 0,
    rate: { state: 'missing-provenance' as const, value: null },
  } }));
  const missing = values.filter(({ metric }) => metric.rate.state === 'missing-provenance');
  for (const { fact } of missing) {
    defects.add(`${actor} review provenance missing for ${fact.repositoryId}/${fact.missionId}; inspect retained decision and handoff evidence`);
  }
  const measured = values.filter(({ metric }) => metric.rate.state !== 'missing-provenance');
  if (measured.length === 0 && facts.length > 0) { return { numerator: null, denominator: null, observed: 0, population: facts.length,
    coverage: 0, state: 'missing-observation', value: null }; }
  const numerator = sum(measured.map(({ metric }) => metric.numerator ?? 0));
  const denominator = sum(measured.map(({ metric }) => metric.eligibleEpisodes ?? 0));
  return { numerator, denominator, observed: measured.length, population: facts.length, coverage: facts.length === 0 ? 1 : measured.length / facts.length,
    state: denominator === 0 ? 'no-eligible-population' : 'measured', value: denominator === 0 ? null : numerator / denominator };
}

function responsibleModel(fact: FlowMissionFacts, author: string | null, at: string | null): string | null {
  if (!author || !at) { return null; }
  return [...fact.agentLaunches].filter(launch => launch.family === author && launch.startedAt < at)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.model ?? null;
}

function rate(numerator: number, denominator: number, population: number): FlowRate {
  const coverage = population === 0 ? 1 : denominator / population;
  if (denominator === 0 && population > 0) { return { numerator: null, denominator: null, observed: 0, population,
    coverage, state: 'missing-observation', value: null }; }
  return { numerator, denominator, observed: denominator, population, coverage, state: denominator === 0 ? 'no-eligible-population' : 'measured',
    value: denominator === 0 ? null : numerator / denominator };
}
function timeRows(facts: readonly FlowMissionFacts[]): FlowTimeSummary[] {
  const groups = new Map<string, { row: FlowOwnershipRow; values: number[] }>();
  for (const fact of facts) {
    for (const row of fact.ownership) {
      const id = key(row), held = groups.get(id) ?? { row, values: [] };
      held.values.push(row.durationMs); groups.set(id, held);
    }
  }
  return [...groups.values()].map(({ row, values }) => ({ step: row.step, actor: row.actor, model: row.model, state: row.state,
    totalMs: sum(values), meanMs: mean(values), p90Ms: percentile(values, 0.9), n: values.length }))
    .sort((a, b) => key(a).localeCompare(key(b)));
}
function key(row: Pick<FlowOwnershipRow, 'step' | 'actor' | 'model' | 'state'>): string {
  return `${row.step}\0${row.actor}\0${row.model ?? ''}\0${row.state}`;
}
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function mean(values: readonly number[]): number { return values.length ? sum(values) / values.length : 0; }
function median(values: readonly number[]): number {
  if (!values.length) { return 0; }
  const ordered = [...values].sort((left, right) => left - right), middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
}
function percentile(values: readonly number[], quantile: number): number {
  if (!values.length) { return 0; }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)]!;
}
