import { reconcileExecutionActivity, type ExecutionActivity, type ExecutionActivitySnapshot } from '../../domain/execution-activity.js';
import { compareCodeUnits } from '../../domain/comparators.js';

export interface HistoricalActivityPublication {
  readonly at: number;
  readonly id: number | undefined;
  readonly sourceId: string;
  readonly event: ExecutionActivity;
}
export interface HistoricalActivityInterval {
  readonly start: number;
  readonly end: number;
  /** Null means the retained publication order cannot prove a current owner. */
  readonly owner: { readonly sourceId: string; readonly event: ExecutionActivity } | null;
}
export interface HistoricalActivityReplay {
  readonly intervals: readonly HistoricalActivityInterval[];
  /** Publications accepted under every retained historical ordering. */
  readonly accepted: ReadonlySet<ExecutionActivity>;
  /** Current-operation terminal candidates; the workflow lifecycle owner must still authorize them. */
  readonly currentTerminals: ReadonlySet<ExecutionActivity>;
}
type ReplayState = { readonly snapshot: ExecutionActivitySnapshot | null; readonly accepted: ReadonlySet<ExecutionActivity>;
  readonly currentTerminals: ReadonlySet<ExecutionActivity> };

/** Replay through the existing transition owner; audit publication alone grants no activity authority. */
export function historicalActivityReplay(publications: readonly HistoricalActivityPublication[], end: number,
  defects: Set<string>): HistoricalActivityReplay {
  let states: readonly ReplayState[] = [{ snapshot: null, accepted: new Set(), currentTerminals: new Set() }];
  const intervals: HistoricalActivityInterval[] = [];
  const tokens = new Map(publications.map((publication, index) => [publication.event, index]));
  const ended = new Set<ExecutionActivity>();
  for (let start = 0; start < publications.length;) {
    let next = start + 1;
    const at = publications[start]!.at;
    if (at >= end) { break; }
    while (next < publications.length && publications[next]!.at === at) { next++; }
    const group = publications.slice(start, next);
    const advanced = advanceGroup(states, group, tokens, ended);
    const until = Math.min(end, publications[next]?.at ?? end);
    if (advanced === null) {
      defects.add(`Activity publication order exceeds bounded historical replay for ${group[0]!.event.missionId}; remaining activity ownership is unobserved`);
      intervals.push({ start: at, end, owner: null });
      break;
    }
    states = advanced;
    const frames = states.map(state => state.snapshot?.frames.at(-1) ?? null);
    const first = frames[0];
    const unanimous = frames.every(frame => frame?.event === first?.event && frame?.sourceId === first?.sourceId);
    // A retained blocker remains a control fact after its bracket ends. That
    // retention does not extend the explicitly measured responsibility interval.
    if (unanimous && (!first || ended.has(first.event))) { start = next; continue; }
    intervals.push({ start: at, end: until, owner: unanimous && first ? first : null });
    start = next;
  }
  return { intervals, accepted: commonEvents(states, state => state.accepted),
    currentTerminals: commonEvents(states, state => state.currentTerminals) };
}

function advanceGroup(states: readonly ReplayState[], group: readonly HistoricalActivityPublication[],
  tokens: ReadonlyMap<ExecutionActivity, number>, ended: Set<ExecutionActivity>): readonly ReplayState[] | null {
  if (group.every(publication => publication.id !== undefined)) {
    return distinct(states.map(state => [...group].sort((a, b) => a.id! - b.id!)
      .reduce((prior, publication) => advance(prior, publication, ended), state)), tokens);
  }
  if (group.length === 1) { return distinct(states.map(state => advance(state, group[0]!, ended)), tokens); }
  // Partial history can have several valid orders. Retain every possible
  // domain outcome; only an owner common to all of them may receive time.
  // The bound limits legacy ambiguity work, never the fresh ordered path.
  let remaining = 512;
  const results: ReplayState[] = [];
  const visit = (state: ReplayState, pending: readonly HistoricalActivityPublication[]): boolean => {
    if (--remaining < 0) { return false; }
    if (!pending.length) { results.push(state); return true; }
    return pending.every(publication => {
      if (publication.id !== undefined && pending.some(other => other.id !== undefined && other.id < publication.id!)) { return true; }
      return visit(advance(state, publication, ended), pending.filter(other => other !== publication));
    });
  };
  if (!states.every(state => visit(state, group))) { return null; }
  const unique = distinct(results, tokens);
  return unique.length <= 64 ? unique : null;
}

function advance(state: ReplayState, publication: HistoricalActivityPublication, ended: Set<ExecutionActivity>): ReplayState {
  const event = publication.event;
  if (['ended', 'interrupted', 'cancelled'].includes(event.state) && state.snapshot?.operationId === event.operationId) {
    const frame = state.snapshot.frames.find(frame => frame.sourceId === publication.sourceId);
    if (frame?.event.state === 'blocked') { ended.add(frame.event); }
  }
  const result = reconcileExecutionActivity(state.snapshot, event, publication.sourceId);
  const isCurrentTerminal = ['ended', 'interrupted', 'cancelled'].includes(event.state)
    && state.snapshot?.operationId === event.operationId && !state.snapshot.supersededOperations.includes(event.operationId);
  return { snapshot: result.snapshot,
    accepted: result.accepted ? new Set([...state.accepted, event]) : state.accepted,
    currentTerminals: isCurrentTerminal ? new Set([...state.currentTerminals, event]) : state.currentTerminals };
}

function distinct(states: readonly ReplayState[], tokens: ReadonlyMap<ExecutionActivity, number>): ReplayState[] {
  const identity = (event: ExecutionActivity | null) => event === null ? null : tokens.get(event);
  const unique = new Map<string, ReplayState>();
  for (const state of states) {
    const snapshot = state.snapshot;
    const key = snapshot === null ? 'null' : JSON.stringify({
      operationId: snapshot.operationId, frames: snapshot.frames.map(frame => [frame.sourceId, identity(frame.event)]),
      closed: [...snapshot.closedSources].sort(compareCodeUnits), superseded: [...snapshot.supersededOperations].sort(compareCodeUnits),
      blocker: identity(snapshot.retainedBlocker), terminal: identity(snapshot.terminal),
    });
    const prior = unique.get(key);
    unique.set(key, prior ? { snapshot: prior.snapshot,
      accepted: intersection(prior.accepted, state.accepted),
      currentTerminals: intersection(prior.currentTerminals, state.currentTerminals) } : state);
  }
  return [...unique.values()];
}

function commonEvents(states: readonly ReplayState[], select: (state: ReplayState) => ReadonlySet<ExecutionActivity>): ReadonlySet<ExecutionActivity> {
  return states.length ? states.slice(1).reduce((events, state) => intersection(events, select(state)), select(states[0]!)) : new Set();
}

function intersection(left: ReadonlySet<ExecutionActivity>, right: ReadonlySet<ExecutionActivity>): ReadonlySet<ExecutionActivity> {
  return new Set([...left].filter(event => right.has(event)));
}
