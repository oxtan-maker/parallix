import { parseExecutionActivityData } from '../recording/execution-activity-recorder.js';
import { historicalActivityReplay, type HistoricalActivityInterval,
  type HistoricalActivityPublication } from './execution-activity-history.js';
import type { LifecycleHistoryEntry, OperationalHistoryEntry } from '../ports/operation-history.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../ports/verification-observation.js';
import { workflowObservationAuthorization, type WorkflowOperation } from '../../domain/workflow-operation.js';

export type FlowTimeState = 'working' | 'waiting' | 'held';
export interface FlowOwnershipRow {
  readonly step: string;
  readonly actor: string;
  readonly model: string | null;
  readonly state: FlowTimeState;
  readonly durationMs: number;
  /** Per-mission rows only: when the row's first slice began, measured from the mission's refined boundary. */
  readonly firstOffsetMs?: number;
}
export interface FlowElapsedOwnership {
  readonly totalMs: number;
  readonly unexplainedMs: number;
  readonly rows: readonly FlowOwnershipRow[];
  /** Exclusive raw slices in causal/runtime order; their durations reconcile exactly to totalMs. */
  readonly segments: readonly FlowOwnershipSegment[];
  readonly terminalStates: Readonly<Record<'blocked' | 'interrupted' | 'cancelled', number>>;
  /** Each measured mission interval (refined to first delivery), including missions no observation explains. */
  readonly windows: readonly { readonly missionId: string; readonly startedAt: string; readonly finishedAt: string }[];
}

export interface FlowOwnershipSegment extends FlowOwnershipRow {
  readonly id: string;
  readonly missionId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

type Segment = FlowOwnershipRow & { readonly id: string; readonly missionId: string;
  readonly start: number; readonly end: number; readonly priority: number; readonly unobserved?: boolean };
type Activity = { repositoryId?: string; missionId?: string; operationId?: string; operationGeneration?: number | null;
  sourceId?: string; revision?: string | null; dependencies?: readonly string[] | null; phase?: string; state?: string; agent?: string | null;
  actor?: string; model?: string | null; timeState?: FlowTimeState };
type MissionWindow = { readonly missionId: string; readonly start: number; readonly end: number;
  readonly laneEvents: readonly LifecycleHistoryEntry[] };
type IndexedHistoryEntry = { readonly entry: OperationalHistoryEntry; readonly value: Record<string, unknown> };
type HistoryIndex = ReadonlyMap<string, ReadonlyMap<string, readonly IndexedHistoryEntry[]>>;
type ActivityReplay = { readonly intervals: readonly HistoricalActivityInterval[];
  readonly accepted: readonly IndexedHistoryEntry[]; readonly operation: readonly IndexedHistoryEntry[] };

/**
 * Reconcile refined-to-first-delivery wall time from existing durable owners.
 * Lane events define the measured mission window. Only explicit activity,
 * gate, rebase and handoff observations own elapsed slices; the durable
 * review-to-integration approval is an explicit human handoff boundary, while
 * lane and blocked state alone never imply a human, lead or external owner.
 * The existing activity transition owner decides nesting and supersession.
 */
export function flowElapsedOwnership(input: {
  readonly repositoryId: string;
  readonly history: readonly OperationalHistoryEntry[];
  readonly operations: readonly WorkflowOperation[];
  readonly lifecycle: readonly LifecycleHistoryEntry[];
}, defects: Set<string>, missions?: ReadonlySet<string>): FlowElapsedOwnership | null {
  const windows = missionWindows(input, defects, missions);
  if (!windows.length) { return null; }
  const history = indexHistory(input.history);
  const operations = new Map(input.operations.map(operation => [operation.id, operation]));
  const activity = new Map(windows.map(window => [window.missionId,
    replayActivity(input.repositoryId, history, operations, window, defects)]));
  const segments = windows.flatMap(window => {
    const replay = activity.get(window.missionId)!;
    return [
      ...activitySegments(window, defects, replay.intervals),
      ...gateSegments(input.repositoryId, history, window),
      ...rebaseSegments(input.repositoryId, history, window),
      ...leadHandoffSegments(input.repositoryId, history, window, replay.accepted),
      ...humanReviewHandoffSegments(window),
      ...operationFinalizationSegments(window, replay.operation),
      ...operationHandoffSegments(window, replay.operation),
    ];
  });
  const terminalStates = { blocked: 0, interrupted: 0, cancelled: 0 };
  for (const window of windows) {
    for (const { value } of activity.get(window.missionId)!.accepted) {
      const activity = value as Activity;
      if (activity.state && activity.state in terminalStates) {
        terminalStates[activity.state as keyof typeof terminalStates]++;
      }
    }
  }
  const rows: FlowOwnershipRow[] = [];
  const exclusive: FlowOwnershipSegment[] = [];
  let explained = 0;
  for (const window of windows) {
    const scoped = segments.filter(segment => segment.missionId === window.missionId);
    const boundaries = [...new Set([window.start, window.end, ...scoped.flatMap(segment => [segment.start, segment.end])])]
      .filter(value => value >= window.start && value <= window.end).sort((a, b) => a - b);
    for (let index = 1; index < boundaries.length; index++) {
      const start = boundaries[index - 1]!, end = boundaries[index]!;
      if (end <= start) { continue; }
      const winner = exclusiveWinner(scoped.filter(segment => segment.start <= start && segment.end >= end));
      if (!winner) { continue; }
      explained += end - start;
      appendRow(rows, winner, end - start);
      appendSegment(exclusive, winner, start, end);
    }
  }
  const totalMs = windows.reduce((sum, window) => sum + window.end - window.start, 0);
  return { totalMs, unexplainedMs: Math.max(0, totalMs - explained), rows, segments: exclusive, terminalStates,
    windows: windows.map(window => ({ missionId: window.missionId, startedAt: new Date(window.start).toISOString(),
      finishedAt: new Date(window.end).toISOString() })) };
}

function missionWindows(input: { repositoryId: string; lifecycle: readonly LifecycleHistoryEntry[] }, defects: Set<string>,
  missions?: ReadonlySet<string>): MissionWindow[] {
  const grouped = new Map<string, LifecycleHistoryEntry[]>();
  for (const event of input.lifecycle) {
    if (event.repositoryId !== input.repositoryId || (missions && !missions.has(event.missionId))
      || !Number.isFinite(Date.parse(event.occurredAt))) { continue; }
    const events = grouped.get(event.missionId) ?? [];
    events.push(event); grouped.set(event.missionId, events);
  }
  const windows: MissionWindow[] = [];
  for (const [missionId, unsorted] of grouped) {
    const events = sortedByInstant(unsorted, event => Date.parse(event.occurredAt), event => event.id,
      event => event.toStatus === 'integration');
    const refined = events.find(event => event.toStatus === 'refined');
    const delivered = events.find(event => event.toStatus === 'done' && (!refined || Date.parse(event.occurredAt) >= Date.parse(refined.occurredAt)));
    if (!refined || !delivered) {
      defects.add(`Refined-to-first-delivery boundary incomplete for ${missionId}; inspect retained lifecycle history`);
      continue;
    }
    windows.push({ missionId, start: Date.parse(refined.occurredAt), end: Date.parse(delivered.occurredAt), laneEvents: events });
  }
  return windows;
}

function replayActivity(repositoryId: string, history: HistoryIndex, operations: ReadonlyMap<string, WorkflowOperation>, window: MissionWindow,
  defects: Set<string>): ActivityReplay {
  const publications = indexed(history, 'mission.current-work', window.missionId).flatMap(({ entry, value }) => {
    if (value.repositoryId !== repositoryId) { return []; }
    const at = Date.parse(entry.createdAt);
    if (!Number.isFinite(at)) { return []; }
    if (typeof value.sourceId !== 'string' || !value.sourceId.trim()) {
      defects.add(`Activity source identity missing for ${window.missionId}`); return [];
    }
    const event = parseExecutionActivityData(value, entry.createdAt, entry.id);
    if (!event) { defects.add(`Malformed activity observation for ${window.missionId}`); return []; }
    return [{ at, id: entry.id, sourceId: value.sourceId, event, indexed: { entry, value } }];
  }).sort((a, b) => a.at - b.at);
  const replay = historicalActivityReplay(publications, window.end, defects);
  return { intervals: replay.intervals,
    accepted: publications.filter(publication => replay.accepted.has(publication.event)).map(publication => publication.indexed),
    operation: publications.filter(publication => isWorkflowCompletion(publication.event)
      ? replay.currentTerminals.has(publication.event)
        && workflowCompletionAuthorized(repositoryId, operations, publication)
      : replay.accepted.has(publication.event)).map(publication => publication.indexed) };
}

function isWorkflowCompletion(event: HistoricalActivityPublication['event']): boolean {
  return event.state === 'ended' && event.summary === 'workflow completed';
}

function workflowCompletionAuthorized(repositoryId: string, operations: ReadonlyMap<string, WorkflowOperation>,
  publication: HistoricalActivityPublication & { readonly indexed: IndexedHistoryEntry }): boolean {
  const event = publication.event;
  const operation = operations.get(event.operationId);
  return publication.sourceId === event.operationId && operation?.phase === 'completed'
    && workflowObservationAuthorization(operation, { repositoryId, missionId: event.missionId,
      operationId: event.operationId, generation: event.operationGeneration }) === 'authorized';
}

function activitySegments(window: MissionWindow, defects: Set<string>, intervals: readonly HistoricalActivityInterval[]): Segment[] {
  return intervals.flatMap(interval => {
    const start = Math.max(window.start, interval.start), end = Math.min(window.end, interval.end);
    if (end <= start) { return []; }
    if (!interval.owner) {
      return [{ id: `unobserved:${window.missionId}`, missionId: window.missionId, start, end, priority: 20,
        unobserved: true, ...row('unobserved', 'unattributed', null, 'waiting') }];
    }
    const { event, sourceId } = interval.owner;
    if (!completeActivityOwnership(event)) {
      defects.add(`Activity ownership incomplete for ${window.missionId} operation ${event.operationId} source ${sourceId}; rerun the affected fresh workflow with FLOW collection enabled`);
      return [{ id: `unobserved:${sourceId}`, missionId: window.missionId, start, end, priority: 20,
        unobserved: true, ...row('unobserved', 'unattributed', null, 'waiting') }];
    }
    if (end === window.end && event.state === 'running') {
      defects.add(`Open activity bounded at first delivery for ${window.missionId} operation ${event.operationId} source ${sourceId}`);
    }
    return [{ id: `activity:${sourceId}`, missionId: window.missionId, start, end, priority: 20,
      ...row(activityStep(event.phase, event.actor, event.timeState), event.actor, event.model ?? null, event.timeState) }];
  });
}

function completeActivityOwnership(value: Activity): value is Activity & { operationId: string; revision: string;
  actor: string; timeState: FlowTimeState } {
  return Boolean(value.operationId) && (value.actor === 'lead'
    || value.operationGeneration !== null && value.operationGeneration !== undefined)
    && Boolean(value.revision) && Boolean(value.actor) && value.actor !== 'unattributed' && Boolean(value.timeState);
}

function exclusiveWinner(covering: readonly Segment[]): Segment | undefined {
  const top = [...covering].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
  return top?.unobserved ? undefined : top;
}

function gateSegments(repositoryId: string, history: HistoryIndex, window: MissionWindow): Segment[] {
  const latest = new Map<string, VerificationMeasurement>();
  for (const { value } of indexed(history, VERIFICATION_MEASUREMENT_EVENT, window.missionId)) {
    const measurement = value as unknown as VerificationMeasurement;
    if (measurement.repositoryId === repositoryId) { latest.set(measurement.id, measurement); }
  }
  return [...latest.values()].flatMap(value => {
    const result: Segment[] = [];
    addMeasured(result, window, `gate-wait:${value.id}`, value.requestedAt, value.startedAt, 29,
      row('gate-admission', 'parallix', null, 'waiting'));
    if (value.result !== 'reused') {
      addMeasured(result, window, `gate:${value.id}`, value.startedAt, value.finishedAt, 30,
        row('declared-gates', 'parallix', null, 'working'));
    }
    return result;
  });
}

function rebaseSegments(repositoryId: string, history: HistoryIndex, window: MissionWindow): Segment[] {
  const started = new Map<string, { at: string; stage: string; attempt: number }>();
  const segments: Segment[] = [];
  for (const { entry, value: raw } of indexed(history, 'flow.rebase', window.missionId)) {
    const value = raw as { id?: string; repositoryId?: string; missionId?: string; stage?: string; attempt?: number; outcome?: string };
    if (!value.id || value.repositoryId !== repositoryId) { continue; }
    if (value.outcome === 'running') {
      started.set(value.id, { at: entry.createdAt, stage: value.stage ?? 'rebase', attempt: value.attempt ?? 1 });
      continue;
    }
    const start = started.get(value.id);
    if (!start) { continue; }
    addMeasured(segments, window, `rebase:${value.id}:${start.attempt}:${value.outcome}`, start.at, entry.createdAt, 25,
      row(start.stage, 'parallix', null, 'working'));
    if (value.outcome === 'conflict') {
      started.set(value.id, { at: entry.createdAt, stage: value.stage ?? start.stage, attempt: value.attempt ?? start.attempt });
    } else {
      started.delete(value.id);
    }
  }
  return segments;
}

function leadHandoffSegments(repositoryId: string, history: HistoryIndex, window: MissionWindow,
  currentWork: readonly IndexedHistoryEntry[]): Segment[] {
  const running = sortedByInstant(currentWork.flatMap(({ entry, value }) => {
    const activity = value as Activity;
    return activity.state === 'running'
      ? [{ at: Date.parse(entry.createdAt), id: entry.id }] : [];
  }).filter(event => Number.isFinite(event.at)), event => event.at, event => event.id, () => true);
  return indexed(history, 'lead.operator-judgment', window.missionId).flatMap(({ entry, value: raw }) => {
    const value = raw as { repositoryId?: string; missionId?: string; action?: string; summary?: string; evidenceRefs?: string[] };
    const start = Date.parse(entry.createdAt);
    // Rows written before repository attribution was added are still scoped by
    // the mission index. A conflicting explicit repository never crosses over.
    if ((value.repositoryId !== undefined && value.repositoryId !== repositoryId)
      || value.action !== 'escalate' || !Number.isFinite(start)) { return []; }
    // Durable ids order same-millisecond judgment and current-work rows, so
    // work published right after the escalation ends it. Without both ids the
    // order is unknown: the escalation may be ended in its own millisecond, so
    // it owns no interval rather than reaching past the tie.
    if (running.some(event => event.at === start && (event.id === undefined || entry.id === undefined))) { return []; }
    const next = running.find(event => event.at > start
      || event.at === start && entry.id !== undefined && event.id !== undefined && event.id > entry.id);
    const end = Math.min(window.end, next?.at ?? window.end);
    const incident = value.evidenceRefs?.slice().sort().join('|') || value.summary || String(entry.id ?? entry.createdAt);
    return end > start ? [{ id: `lead-escalation:${window.missionId}:${incident}`, missionId: window.missionId,
      start: Math.max(window.start, start), end, priority: 17, ...row('lead-escalation', 'human', null, 'held') }] : [];
  });
}

/** The integration transition is the durable ordinary-review handoff to the human operator. */
function humanReviewHandoffSegments(window: MissionWindow): Segment[] {
  return window.laneEvents.flatMap((event, index) => {
    if (event.toStatus !== 'integration') { return []; }
    // Any other lane event in an unordered tie may be the boundary that returns
    // the mission, so the handoff owns nothing rather than reaching past it.
    if (tiedUnprovably(window.laneEvents, laneEvent => Date.parse(laneEvent.occurredAt), laneEvent => laneEvent.id, event, () => true)) { return []; }
    const start = Math.max(window.start, Date.parse(event.occurredAt));
    const next = window.laneEvents.slice(index + 1).find(candidate => Date.parse(candidate.occurredAt) >= start);
    const end = Math.min(window.end, next ? Date.parse(next.occurredAt) : window.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? [{ id: `human-handoff:${event.idempotencyKey}`, missionId: window.missionId, start, end, priority: 16,
        ...row('human-review', 'human', null, 'held') }]
      : [];
  });
}

/**
 * Attribute only the explicitly observed gap between one completed workflow
 * operation and the next admitted operation. This is external waiting because
 * the first process recorded that it ended and the next process had not yet
 * started; it is never promoted to human or lead ownership.
 */
function operationHandoffSegments(window: MissionWindow, currentWork: readonly IndexedHistoryEntry[]): Segment[] {
  const events = sortedByInstant(currentWork.flatMap(({ entry, value: raw }) => {
    const value = raw as Activity & { summary?: string };
    return [{ at: Date.parse(entry.createdAt), id: entry.id, value }];
  }).filter(event => Number.isFinite(event.at)), event => event.at, event => event.id, event => event.value.state === 'running');
  return events.flatMap((event, index) => {
    if (event.value.state !== 'ended' || event.value.summary !== 'workflow completed' || !event.value.operationId) { return []; }
    // A running publication in the terminal row's unordered tie may follow it
    // immediately, which would leave no gap to attribute.
    if (tiedUnprovably(events, candidate => candidate.at, candidate => candidate.id, event,
      candidate => candidate.value.state === 'running' && candidate.value.operationId !== event.value.operationId)) { return []; }
    const next = events.slice(index + 1).find(candidate => candidate.value.state === 'running'
      && candidate.value.operationId && candidate.value.operationId !== event.value.operationId);
    if (!next) { return []; }
    const start = Math.max(window.start, event.at), end = Math.min(window.end, next.at);
    return end > start ? [{ id: `handoff:${event.value.operationId}:${next.value.operationId}`,
      missionId: window.missionId, start, end, priority: 10,
      ...row('responsibility-handoff', 'external', null, 'waiting') }] : [];
  });
}

/** A terminal workflow publication explicitly owns finalization after its last nested activity ended. */
function operationFinalizationSegments(window: MissionWindow, currentWork: readonly IndexedHistoryEntry[]): Segment[] {
  const events = sortedByInstant(currentWork.flatMap(({ entry, value: raw }) => {
    const value = raw as Activity & { summary?: string };
    return [{ at: Date.parse(entry.createdAt), id: entry.id, value }];
  }).filter(event => Number.isFinite(event.at)), event => event.at, event => event.id, event => event.value.state === 'running');
  return events.flatMap((event, index) => {
    if (event.value.state !== 'ended' || event.value.summary !== 'workflow completed'
      || event.value.actor !== 'parallix' || !event.value.operationId) { return []; }
    const prior = [...events.slice(0, index)].reverse().find(candidate => candidate.value.operationId === event.value.operationId);
    if (!prior || prior.value.state !== 'ended') { return []; }
    // A same-operation row in the terminal row's unordered tie may be the last
    // preceding one, which would leave a zero-length interval instead.
    if (tiedUnprovably(events, candidate => candidate.at, candidate => candidate.id, event,
      candidate => candidate.value.operationId === event.value.operationId)) { return []; }
    const start = Math.max(window.start, prior.at), end = Math.min(window.end, event.at);
    return end > start ? [{ id: `finalize:${event.value.operationId}`, missionId: window.missionId,
      // Finalization fills a gap after activity ends; it cannot replace either
      // an authoritative activity owner or replay that explicitly stayed unobserved.
      start, end, priority: 19,
      ...row(activityStep(event.value.phase ?? 'unknown', 'parallix', 'working'), 'parallix', null, 'working') }] : [];
  });
}

function addMeasured(target: Segment[], window: MissionWindow, id: string, from: string | null, to: string | null,
  priority: number, ownership: FlowOwnershipRow): void {
  const start = from === null ? NaN : Math.max(window.start, Date.parse(from));
  const end = to === null ? NaN : Math.min(window.end, Date.parse(to));
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    target.push({ id, missionId: window.missionId, start, end, priority, ...ownership });
  }
}

function activityStep(phase: string, actor: string, state: FlowTimeState): string {
  if (state === 'waiting' && ['execute', 'waiting'].includes(phase)) { return 'workflow-admission'; }
  if (phase === 'execute') { return actor === 'parallix' ? 'preparation' : 'implement'; }
  if (phase === 'review-response') { return 'repair'; }
  if (phase === 'review') { return actor === 'human' ? 'human-review' : 'agent-review'; }
  return phase;
}

function row(step: string, actor: string, model: string | null, state: FlowTimeState): FlowOwnershipRow {
  return { step, actor, model, state, durationMs: 0 };
}

/**
 * Time order with durable ids breaking same-instant ties only when every tied
 * row carries one. A tie containing a legacy or partial row has no provable
 * order, and neither input order nor key order is authority for it. Such a tie
 * keeps every row as a boundary at its own instant, because that instant is
 * known, and places interval-opening rows first so what they open can close
 * inside the tie. Ownership that would start inside the tie is suppressed by
 * `tiedUnprovably` in the consumer that opens it.
 */
function sortedByInstant<T>(items: readonly T[], at: (item: T) => number, id: (item: T) => number | undefined,
  opens: (item: T) => boolean): T[] {
  const byTime = [...items].sort((left, right) => at(left) - at(right));
  const ordered: T[] = [];
  for (let start = 0, end = 1; start < byTime.length; start = end, end = start + 1) {
    while (end < byTime.length && at(byTime[end]!) === at(byTime[start]!)) { end++; }
    const tied = byTime.slice(start, end);
    tied.sort(tied.every(item => id(item) !== undefined)
      ? (left, right) => id(left)! - id(right)!
      : (left, right) => Number(opens(right)) - Number(opens(left)));
    ordered.push(...tied);
  }
  return ordered;
}

/**
 * True when another row shares `self`'s instant, is one this interval would
 * search past, and no durable id orders the two. The interval may open and
 * close inside that millisecond, so it owns no elapsed time.
 */
function tiedUnprovably<T>(items: readonly T[], at: (item: T) => number, id: (item: T) => number | undefined,
  self: T, relates: (item: T) => boolean): boolean {
  const instant = at(self);
  const selfId = id(self);
  return items.some(item => item !== self && at(item) === instant && relates(item)
    && (selfId === undefined || id(item) === undefined));
}

function appendRow(rows: FlowOwnershipRow[], winner: FlowOwnershipRow, durationMs: number): void {
  const prior = rows.at(-1);
  if (prior && prior.step === winner.step && prior.actor === winner.actor && prior.model === winner.model && prior.state === winner.state) {
    (prior as { durationMs: number }).durationMs += durationMs;
  } else { rows.push({ step: winner.step, actor: winner.actor, model: winner.model, state: winner.state, durationMs }); }
}

function appendSegment(segments: FlowOwnershipSegment[], winner: Segment, start: number, end: number): void {
  const prior = segments.at(-1);
  if (prior && prior.id === winner.id && prior.missionId === winner.missionId
    && prior.step === winner.step && prior.actor === winner.actor && prior.model === winner.model && prior.state === winner.state
    && Date.parse(prior.finishedAt) === start) {
    (prior as { finishedAt: string; durationMs: number }).finishedAt = new Date(end).toISOString();
    (prior as { durationMs: number }).durationMs += end - start;
    return;
  }
  segments.push({ id: winner.id, missionId: winner.missionId, startedAt: new Date(start).toISOString(),
    finishedAt: new Date(end).toISOString(), step: winner.step, actor: winner.actor, model: winner.model,
    state: winner.state, durationMs: end - start });
}

function indexHistory(entries: readonly OperationalHistoryEntry[]): HistoryIndex {
  const byType = new Map<string, Map<string, IndexedHistoryEntry[]>>();
  for (const entry of entries) {
    let value: Record<string, unknown>;
    try { value = JSON.parse(entry.eventData) as Record<string, unknown>; } catch { continue; }
    if (!value || typeof value !== 'object' || typeof value.missionId !== 'string') { continue; }
    const byMission = byType.get(entry.eventType) ?? new Map<string, IndexedHistoryEntry[]>();
    const mission = byMission.get(value.missionId) ?? [];
    mission.push({ entry, value });
    byMission.set(value.missionId, mission);
    byType.set(entry.eventType, byMission);
  }
  return byType;
}

function indexed(history: HistoryIndex, eventType: string, missionId: string): readonly IndexedHistoryEntry[] {
  const entries = history.get(eventType)?.get(missionId) ?? [];
  return eventType === 'mission.current-work'
    ? entries.filter(({ value }) => value.ownerAccepted !== false)
    : entries;
}
