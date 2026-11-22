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
type ReplayState = { readonly snapshot: ExecutionActivitySnapshot | null; readonly accepted: EventChain | null;
  readonly currentTerminals: EventChain | null };
/**
 * Append-only view of the events one replay path accepted. Copying the accumulated set for every publication is
 * quadratic in a Mission's retained publications, while a cons cell makes each advance O(1); the sets the consumers
 * ask for are materialised once, when the replay ends.
 */
type EventChain = { readonly event: ExecutionActivity; readonly prev: EventChain | null; readonly size: number };
const chainSize = (chain: EventChain | null): number => chain?.size ?? 0;
const chainAdd = (chain: EventChain | null, event: ExecutionActivity): EventChain =>
  ({ event, prev: chain, size: chainSize(chain) + 1 });

/** Replay through the existing transition owner; audit publication alone grants no activity authority. */
export function historicalActivityReplay(publications: readonly HistoricalActivityPublication[], end: number,
  defects: Set<string>): HistoricalActivityReplay {
  let states: readonly ReplayState[] = [{ snapshot: null, accepted: null, currentTerminals: null }];
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
    // Grow the accumulated sets in place after copying; spreading them into an array first makes each
    // publication of a Mission's replay copy the whole accepted history again.
    accepted: result.accepted ? chainAdd(state.accepted, event) : state.accepted,
    currentTerminals: isCurrentTerminal ? chainAdd(state.currentTerminals, event) : state.currentTerminals };
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
      accepted: chainIntersect(prior.accepted, state.accepted),
      currentTerminals: chainIntersect(prior.currentTerminals, state.currentTerminals) } : state);
  }
  return [...unique.values()];
}

function commonEvents(states: readonly ReplayState[], select: (state: ReplayState) => EventChain | null): ReadonlySet<ExecutionActivity> {
  const chains = states.map(select);
  if (!chains.length) { return new Set(); }
  let common: EventChain | null = chains[0]!;
  for (const chain of chains.slice(1)) { common = chainIntersect(common, chain); }
  const events = new Set<ExecutionActivity>();
  for (let node: EventChain | null = common; node; node = node.prev) { events.add(node.event); }
  return events;
}

/** Events the two replay paths accepted in common, as a chain rooted at the larger path's order. */
function chainIntersect(left: EventChain | null, right: EventChain | null): EventChain | null {
  if (left === right) { return left; }
  const smaller = chainSize(left) <= chainSize(right) ? left : right;
  const larger = smaller === left ? right : left;
  const candidates = new Set<ExecutionActivity>();
  for (let node = smaller; node; node = node.prev) { candidates.add(node.event); }
  let common: EventChain | null = null;
  for (let node = larger; node; node = node.prev) {
    if (candidates.has(node.event)) { common = chainAdd(common, node.event); }
  }
  return common;
}
