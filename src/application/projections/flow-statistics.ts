import type { DecisionWindows } from '../../domain/decision-window.js';
import { decisionWindowContains } from '../../domain/decision-window.js';
import type { FlowOwnershipRow } from './flow-elapsed-ownership.js';
import type { ReviewStatistics } from '../services/review-statistics.js';

export interface FlowMissionFacts {
  readonly repositoryId: string;
  readonly missionId: string;
  readonly closedAt: string;
  readonly diagramNodeIds: readonly string[];
  readonly diagramEdgeIds: readonly string[];
  readonly ownership: readonly FlowOwnershipRow[];
  readonly actualAgentLaunches: number | null;
  readonly agentLaunches: readonly { readonly runId: string; readonly startedAt: string;
    readonly family: string | null; readonly model: string | null }[];
  readonly observedDisqualifiers: readonly string[] | null;
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
export interface FlowRate {
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly coverage: number;
  readonly state: 'measured' | 'no-eligible-population' | 'missing-observation';
  readonly value: number | null;
}
export interface FlowWindowStatistics {
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly completedMissions: number;
  readonly diagram: { readonly nodeCount: number; readonly edgeCount: number };
  readonly firstPassYield: FlowRate;
  readonly extraAgentLaunches: { readonly total: number | null; readonly meanPerMission: number | null; readonly n: number };
  readonly sendBacks: Readonly<Record<'agent' | 'human', FlowRate>>;
  readonly returns: readonly { readonly repositoryId: string; readonly missionId: string; readonly identity: string;
    readonly at: string | null; readonly author: string | null; readonly responsibleModel: string | null;
    readonly actor: import('../services/review-statistics.js').ReviewSendingActor;
    readonly stage: string; readonly decisionIdentity: string | null; readonly revision: string | null; readonly sender: string | null }[];
  readonly episodes: readonly { readonly repositoryId: string; readonly missionId: string;
    readonly identity: string; readonly actor: 'agent' | 'human'; readonly stage: string;
    readonly startedAt: string; readonly endedAt: string; readonly revision: string | null; readonly sender: string }[];
  readonly time: {
    readonly rows: readonly FlowTimeSummary[];
    readonly largestHolder: { readonly step: string; readonly actor: string; readonly model: string | null;
      readonly state: 'working' | 'waiting' | 'held';
      readonly totalMs: number; readonly share: number } | null;
    readonly measuredMissions: number;
  };
  readonly defects: readonly string[];
}
export interface FlowStatistics {
  readonly current: FlowWindowStatistics;
  readonly previous: FlowWindowStatistics;
}

/** Shared typed FLOW/px-stats projection. Selection is by first completion; full mission history supplies every metric. */
export function flowStatistics(facts: readonly FlowMissionFacts[], windows: DecisionWindows): FlowStatistics {
  return { current: projectWindow(facts.filter(fact => decisionWindowContains(windows.current, fact.closedAt)), windows.current),
    previous: projectWindow(facts.filter(fact => decisionWindowContains(windows.previous, fact.closedAt)), windows.previous) };
}

function projectWindow(facts: readonly FlowMissionFacts[], window: DecisionWindows['current']): FlowWindowStatistics {
  const defects = new Set<string>();
  const observedFirstPass = facts.filter(fact => fact.observedDisqualifiers !== null && fact.reviewStatistics.total !== null);
  for (const fact of facts.filter(item => item.observedDisqualifiers === null || item.reviewStatistics.total === null)) {
    defects.add(`First-pass observations missing for ${fact.repositoryId}/${fact.missionId}; rerun the fresh workflow with FLOW collection enabled`);
  }
  const firstPass = observedFirstPass.filter(fact => fact.observedDisqualifiers!.length === 0
    && fact.reviewStatistics.total === 0).length;
  const launchFacts = facts.filter(fact => fact.actualAgentLaunches !== null);
  for (const fact of facts.filter(item => item.actualAgentLaunches === null)) {
    defects.add(`Agent launch observations missing for ${fact.repositoryId}/${fact.missionId}; inspect retained run history and rerun the fresh workflow`);
  }
  const extra = launchFacts.map(fact => Math.max(0, fact.actualAgentLaunches! - 1));
  const timeFacts = facts.filter(fact => fact.ownership.length > 0);
  for (const fact of facts.filter(item => item.ownership.length === 0)) {
    defects.add(`Elapsed ownership missing for ${fact.repositoryId}/${fact.missionId}; inspect refined-to-first-delivery boundaries`);
  }
  const rows = timeRows(timeFacts);
  const totalTime = rows.reduce((sum, row) => sum + row.totalMs, 0);
  const largest = [...rows].sort((a, b) => b.totalMs - a.totalMs || key(a).localeCompare(key(b)))[0];
  return {
    label: window.label, startDate: window.startDate, endDate: window.endDate, completedMissions: facts.length,
    diagram: { nodeCount: new Set(facts.flatMap(fact => fact.diagramNodeIds)).size,
      edgeCount: new Set(facts.flatMap(fact => fact.diagramEdgeIds)).size },
    firstPassYield: rate(firstPass, observedFirstPass.length, facts.length),
    extraAgentLaunches: { total: launchFacts.length === facts.length ? sum(extra) : null,
      meanPerMission: launchFacts.length === facts.length && facts.length ? sum(extra) / facts.length : null, n: launchFacts.length },
    sendBacks: { agent: aggregateSendBacks(facts, 'agent', defects), human: aggregateSendBacks(facts, 'human', defects) },
    returns: facts.flatMap(fact => fact.reviewStatistics.returns.map(item => ({ repositoryId: fact.repositoryId,
      missionId: fact.missionId, identity: item.identity, at: item.at, author: item.author,
      responsibleModel: responsibleModel(fact, item.author, item.at),
      actor: item.origin?.actor ?? null, stage: item.origin?.stage ?? 'workflow',
      decisionIdentity: item.origin?.decisionIdentity ?? null, revision: item.origin?.revision ?? null,
      sender: item.origin?.sender ?? null }))),
    episodes: facts.flatMap(fact => (fact.reviewStatistics.episodes ?? []).map(item => ({ repositoryId: fact.repositoryId,
      missionId: fact.missionId, ...item }))),
    time: { rows, largestHolder: largest ? { step: largest.step, actor: largest.actor, model: largest.model, state: largest.state,
      totalMs: largest.totalMs, share: totalTime === 0 ? 0 : largest.totalMs / totalTime } : null,
      measuredMissions: timeFacts.length }, defects: [...defects],
  };
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
  if (missing.length) { return { numerator: null, denominator: null,
    coverage: mean(values.map(({ metric }) => metric.coverage)), state: 'missing-observation', value: null }; }
  const numerator = sum(values.map(({ metric }) => metric.numerator ?? 0));
  const denominator = sum(values.map(({ metric }) => metric.eligibleEpisodes ?? 0));
  return { numerator, denominator, coverage: mean(values.map(({ metric }) => metric.coverage)),
    state: denominator === 0 ? 'no-eligible-population' : 'measured', value: denominator === 0 ? null : numerator / denominator };
}

function responsibleModel(fact: FlowMissionFacts, author: string | null, at: string | null): string | null {
  if (!author || !at) { return null; }
  return [...fact.agentLaunches].filter(launch => launch.family === author && launch.startedAt < at)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.model ?? null;
}

function rate(numerator: number, denominator: number, population: number): FlowRate {
  if (denominator !== population) { return { numerator: null, denominator: null,
    coverage: population === 0 ? 1 : denominator / population, state: 'missing-observation', value: null }; }
  return { numerator, denominator, coverage: 1, state: denominator === 0 ? 'no-eligible-population' : 'measured',
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
function percentile(values: readonly number[], quantile: number): number {
  if (!values.length) { return 0; }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)]!;
}
