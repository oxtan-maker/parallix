import type { DecisionWindows } from '../../domain/decision-window.js';
import { decisionWindowContains } from '../../domain/decision-window.js';
import { compareCodeUnits } from '../../domain/comparators.js';
import type { FlowOwnershipRow } from './flow-elapsed-ownership.js';
import type { FlowGateRun, FlowLeadEpisodes, FlowRebaseRun,
  FlowRebaseStage, FlowRebaseStageFact, FlowRebaseStageState, ScopedFlowRebaseStageFact } from './flow-mission-facts.js';
import { formatObservationDiagnostic, type ObservationDiagnostic } from './verification-diagnostic.js';
import { scopeFlowRebaseStages } from './flow-mission-facts.js';
import { flowGraph, type FlowGraph, type FlowLaneId } from './flow-graph.js';
import type { ReviewStatistics } from '../services/review-statistics.js';
import { isRebaseObservationStage } from '../ports/rebase-workflow.js';
import { selectFlowRebaseStageDetails } from '../presentation/flow-rebase-stage-details.js';

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
  readonly rebaseStages: readonly FlowRebaseStageFact[];
  readonly lead: FlowLeadEpisodes;
  /** Summed closed lifecycle dwell per state; null when lifecycle transitions were not read. */
  readonly laneDwellMs: Readonly<Partial<Record<FlowDwellState, number>>> | null;
  readonly actualAgentLaunches: number | null;
  readonly agentLaunchesLowerBound?: boolean;
  readonly agentLaunches: readonly { readonly runId: string; readonly startedAt: string;
    readonly family: string | null; readonly model: string | null }[];
  readonly observedDisqualifiers: readonly string[] | null;
  /** Named upstream exclusions that make this measured subset incomplete. */
  readonly diagnostics: readonly ObservationDiagnostic[];
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
  /** Missions with complete, partial or absent applicable FLOW observations. */
  readonly observation: { readonly complete: number; readonly partial: number; readonly unobserved: number };
  readonly defects: readonly string[];
  readonly rebaseStages: { readonly visible: readonly ScopedFlowRebaseStageFact[]; readonly omitted: number };
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
    .sort(compareCodeUnits);
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
  const recordedDiagnostics = uniqueDiagnostics(facts.flatMap(fact => fact.diagnostics ?? []));
  const derivedDiagnostics = uniqueDiagnostics(facts.flatMap(derivedObservationDiagnostics));
  const diagnostics = uniqueDiagnostics([...recordedDiagnostics, ...derivedDiagnostics]);
  const { observedFirstPass, launchFacts, timeFacts } = observedFlowFacts(facts);
  const firstPass = observedFirstPass.filter(fact => fact.observedDisqualifiers!.length === 0
    && fact.reviewStatistics.total === 0).length;
  const extra = launchFacts.map(fact => Math.max(0, fact.actualAgentLaunches! - 1));
  const extraTotal = launchFacts.length ? sum(extra) : null;
  const reworkFacts = facts.filter(fact => fact.reviewStatistics.total !== null);
  const reworkJobs = reworkFacts.length ? sum(reworkFacts.map(fact => fact.reviewStatistics.total!)) : null;
  const rows = timeRows(timeFacts);
  const totalTime = rows.reduce((sum, row) => sum + row.totalMs, 0);
  const largest = rows.filter(row => laneOf(row.step, row.actor) !== 'external')
    .sort((a, b) => b.totalMs - a.totalMs || compareCodeUnits(key(a), key(b)))[0];
  const elapsed = elapsedSummary(facts);
  const observation = observationSummary(facts, diagnostics);
  const defects = uniqueDiagnostics([...recordedDiagnostics,
    ...derivedDiagnostics.filter(diagnostic => !isRebaseObservationStage(diagnostic.stage))])
    .map(formatObservationDiagnostic);
  const rebaseStages = selectFlowRebaseStageDetails(scopeFlowRebaseStages(facts));
  return {
    label: window.label, startDate: window.startDate, endDate: window.endDate, completedMissions: facts.length,
    throughputChange: previousCompleted === null ? null : facts.length - previousCompleted,
    observation, defects, rebaseStages,
    diagram: { nodeCount: new Set(facts.flatMap(fact => fact.diagramNodeIds)).size,
      edgeCount: new Set(facts.flatMap(fact => fact.diagramEdgeIds)).size },
    graph: flowGraph(facts),
    cycleTime: elapsed.cycleTime,
    firstPassYield: rate(firstPass, observedFirstPass.length, facts.length),
    extraAgentLaunches: { total: extraTotal,
      meanPerMission: extraTotal !== null ? extraTotal / launchFacts.length : null, n: launchFacts.length,
      lowerBound: launchFacts.some(fact => fact.agentLaunchesLowerBound === true), reworkJobs,
      reworkMeanPerMission: reworkJobs !== null ? reworkJobs / reworkFacts.length : null, reworkN: reworkFacts.length },
    sendBacks: { agent: aggregateSendBacks(facts, 'agent'), human: aggregateSendBacks(facts, 'human') },
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
  };
}

function uniqueDiagnostics(diagnostics: readonly ObservationDiagnostic[]): ObservationDiagnostic[] {
  return [...new Map(diagnostics.map(diagnostic => [[diagnostic.kind, diagnostic.state, diagnostic.repositoryId,
    diagnostic.missionId, diagnostic.operationId, diagnostic.sourceId, diagnostic.stage, diagnostic.message]
    .join('\0'), diagnostic])).values()];
}

function observedFlowFacts(facts: readonly FlowMissionFacts[]) {
  const observedFirstPass = facts.filter(fact => fact.observedDisqualifiers !== null && fact.reviewStatistics.total !== null);
  const launchFacts = facts.filter(fact => fact.actualAgentLaunches !== null);
  const timeFacts = facts.filter(fact => fact.ownership.length > 0);
  return { observedFirstPass, launchFacts, timeFacts };
}

function observationSummary(facts: readonly FlowMissionFacts[], diagnostics: readonly ObservationDiagnostic[]) {
  const incomplete = new Set(diagnostics.map(diagnostic => `${diagnostic.repositoryId}\0${diagnostic.missionId}`));
  const complete = facts.filter(fact => !incomplete.has(`${fact.repositoryId}\0${fact.missionId}`)).length;
  const unobserved = facts.filter(fact => incomplete.has(`${fact.repositoryId}\0${fact.missionId}`)
    && fact.window === null && fact.ownership.length === 0 && fact.gateRuns.length === 0
    && fact.rebaseRuns.length === 0 && fact.actualAgentLaunches === null
    && fact.observedDisqualifiers === null).length;
  return { complete, partial: facts.length - complete - unobserved, unobserved };
}

const REBASE_STAGE_LABELS: Readonly<Record<FlowRebaseStage, string>> = {
  'direct-rebase': 'Direct', 'pre-review-rebase': 'Pre-review', 'integration-rebase': 'Integration',
};
const REBASE_STAGE_DEFECTS: Readonly<Partial<Record<FlowRebaseStageState, {
  readonly kind: ObservationDiagnostic['kind']; readonly state: ObservationDiagnostic['state']; readonly status: string;
}>>> = {
  absent: { kind: 'coverage', state: 'absent', status: 'missing' },
  running: { kind: 'terminal', state: 'running', status: 'running' },
  interrupted: { kind: 'terminal', state: 'interrupted', status: 'interrupted' },
  'historical-unavailable': { kind: 'coverage', state: 'absent', status: 'historically unavailable' },
};

function derivedObservationDiagnostics(fact: FlowMissionFacts): ObservationDiagnostic[] {
  const diagnostics: ObservationDiagnostic[] = [];
  const add = (kind: ObservationDiagnostic['kind'], state: ObservationDiagnostic['state'], stage: string,
    message: string, recovery: string, operationId: string | null = null, sourceId: string | null = null) => {
    diagnostics.push({ kind, state, repositoryId: fact.repositoryId, missionId: fact.missionId,
      operationId, sourceId, stage, message, recovery });
  };
  if (fact.observedDisqualifiers === null || fact.reviewStatistics.total === null) {
    add('coverage', 'absent', 'first-pass', `First-pass observations missing for ${fact.repositoryId}/${fact.missionId}`, 'inspect retained review and verification history');
  }
  if (fact.actualAgentLaunches === null) {
    add('coverage', 'absent', 'agent-launch', `Agent launch observations missing for ${fact.repositoryId}/${fact.missionId}`, 'inspect retained run history and rerun the fresh workflow');
  }
  if (fact.ownership.length === 0) {
    add('coverage', 'absent', 'elapsed-ownership', `Elapsed ownership missing for ${fact.repositoryId}/${fact.missionId}`, 'inspect refined-to-first-delivery boundaries');
  } else if (fact.window) {
    const windowMs = Date.parse(fact.window.finishedAt) - Date.parse(fact.window.startedAt);
    const explained = sum(fact.ownership.map(row => row.durationMs));
    if (explained < windowMs) { add('coverage', 'absent', 'elapsed-ownership',
      `Elapsed ownership explains ${Math.floor(explained / windowMs * 100)}% of refined-to-first-delivery for ${fact.repositoryId}/${fact.missionId}`, 'inspect refined-to-first-delivery boundaries; the remainder is reported as not observed'); }
  }
  for (const stage of fact.rebaseStages ?? []) {
    const metadata = REBASE_STAGE_DEFECTS[stage.state];
    if (!metadata) { continue; }
    add(metadata.kind, metadata.state, stage.stage,
      `${REBASE_STAGE_LABELS[stage.stage]} rebase observations ${metadata.status} for ${fact.repositoryId}/${fact.missionId}`,
      'inspect retained flow.rebase observations', stage.operationId, stage.sourceId);
  }
  for (const item of fact.reviewStatistics.returns.filter(value => value.origin.actor === null)) {
    add('provenance', 'absent', 'return', `Return ${item.identity} has unplaced provenance for ${fact.repositoryId}/${fact.missionId}`, 'inspect retained return producer context');
  }
  return diagnostics;
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
  }).sort((a, b) => a.order - b.order || compareCodeUnits(a.id, b.id));
  const unobservedMs = windowed.length
    ? sum(windowed.map(({ fact, windowMs }) => Math.max(0, windowMs - explained(fact)))) / windowed.length : 0;
  const totals = { waitingMs: sum(table.map(row => row.waitingMs)), workingMs: sum(table.map(row => row.workingMs)),
    heldMs: sum(table.map(row => row.heldMs)), totalMs: observedMean };
  const lanes = laneTimes(table, share);
  const largestLane = [...lanes].filter(lane => lane.totalMs > 0 && lane.lane !== 'external')
    .sort((a, b) => b.totalMs - a.totalMs || compareCodeUnits(a.lane, b.lane))[0]?.lane ?? null;
  return { table, totals, unobservedMs, lanes, largestLane,
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
      .sort(compareCodeUnits),
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

function aggregateSendBacks(facts: readonly FlowMissionFacts[], actor: 'agent' | 'human'): FlowRate {
  const values = facts.map(fact => ({ fact, metric: fact.reviewStatistics.sendBacks?.[actor] ?? {
    numerator: null, eligibleEpisodes: null, coverage: 0,
    rate: { state: 'missing-provenance' as const, value: null },
  } }));
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
    .sort((a, b) => compareCodeUnits(b.startedAt, a.startedAt))[0]?.model ?? null;
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
    .sort((a, b) => compareCodeUnits(key(a), key(b)));
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
