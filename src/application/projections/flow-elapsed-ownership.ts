import type { LifecycleHistoryEntry, OperationalHistoryEntry } from '../ports/operation-history.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../ports/verification-observation.js';

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
  readonly start: number; readonly end: number; readonly priority: number };
type Activity = { repositoryId?: string; missionId?: string; operationId?: string; operationGeneration?: number | null;
  sourceId?: string; revision?: string | null; dependencies?: readonly string[] | null; phase?: string; state?: string; agent?: string | null;
  actor?: string; model?: string | null; timeState?: FlowTimeState };
type MissionWindow = { readonly missionId: string; readonly start: number; readonly end: number;
  readonly laneEvents: readonly LifecycleHistoryEntry[] };
type TimedActivity = { readonly at: number; readonly value: Activity };
type IndexedHistoryEntry = { readonly entry: OperationalHistoryEntry; readonly value: Record<string, unknown> };
type HistoryIndex = ReadonlyMap<string, ReadonlyMap<string, readonly IndexedHistoryEntry[]>>;

/**
 * Reconcile refined-to-first-delivery wall time from existing durable owners.
 * Lane events define the measured mission window. Only explicit activity,
 * gate, rebase and handoff observations own elapsed slices; lane and blocked
 * state alone never imply a human, lead or external owner. Nested work wins
 * only through its recorded dependency depth, never publication order.
 */
export function flowElapsedOwnership(input: {
  readonly repositoryId: string;
  readonly history: readonly OperationalHistoryEntry[];
  readonly lifecycle: readonly LifecycleHistoryEntry[];
}, defects: Set<string>, missions?: ReadonlySet<string>): FlowElapsedOwnership | null {
  const windows = missionWindows(input, defects, missions);
  if (!windows.length) { return null; }
  const history = indexHistory(input.history);
  const segments = windows.flatMap(window => [
    ...activitySegments(input.repositoryId, history, window, defects),
    ...gateSegments(input.repositoryId, history, window),
    ...rebaseSegments(input.repositoryId, history, window),
    ...leadHandoffSegments(input.repositoryId, history, window),
    ...operationFinalizationSegments(input.repositoryId, history, window),
    ...operationHandoffSegments(input.repositoryId, history, window),
  ]);
  const terminalStates = { blocked: 0, interrupted: 0, cancelled: 0 };
  for (const window of windows) {
    for (const { value } of indexed(history, 'mission.current-work', window.missionId)) {
      const activity = value as Activity;
      if (activity.repositoryId === input.repositoryId
        && activity.state && activity.state in terminalStates) {
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
      const winner = scoped.filter(segment => segment.start <= start && segment.end >= end)
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
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
    const events = [...unsorted].sort(compareLaneEvents);
    const refined = events.find(event => event.toStatus === 'refined');
    const delivered = events.find(event => event.toStatus === 'done' && (!refined || Date.parse(event.occurredAt) >= Date.parse(refined.occurredAt)));
    if (!refined || !delivered) {
      defects.add(`Refined-to-first-delivery boundary incomplete for ${missionId}; rerun the affected fresh workflow with FLOW collection enabled`);
      continue;
    }
    windows.push({ missionId, start: Date.parse(refined.occurredAt), end: Date.parse(delivered.occurredAt), laneEvents: events });
  }
  return windows;
}

function compareLaneEvents(left: LifecycleHistoryEntry, right: LifecycleHistoryEntry): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER)
    || left.idempotencyKey.localeCompare(right.idempotencyKey);
}

function activitySegments(repositoryId: string, history: HistoryIndex, window: MissionWindow,
  defects: Set<string>): Segment[] {
  const events = observedActivities(repositoryId, history, window);
  const depths = dependencyDepths(events.map(event => event.value));
  const bySource = activitiesBySource(events, window, defects);
  const segments: Segment[] = [];
  for (const [source, rows] of bySource) {
    for (let index = 0; index < rows.length; index++) {
      const segment = activitySegment(source, rows, index, events, window, depths, defects);
      if (segment) { segments.push(segment); }
    }
  }
  return segments;
}

function observedActivities(repositoryId: string, history: HistoryIndex, window: MissionWindow): TimedActivity[] {
  return indexed(history, 'mission.current-work', window.missionId).flatMap(({ entry, value }) => {
    const activity = value as Activity;
    return activity.repositoryId === repositoryId ? [{ at: Date.parse(entry.createdAt), value: activity }] : [];
  }).filter(event => Number.isFinite(event.at)).sort((a, b) => a.at - b.at);
}

function activitiesBySource(events: readonly TimedActivity[], window: MissionWindow, defects: Set<string>): Map<string, TimedActivity[]> {
  const grouped = new Map<string, TimedActivity[]>();
  for (const event of events) {
    if (!event.value.sourceId) { defects.add(`Activity source identity missing for ${window.missionId}`); continue; }
    const rows = grouped.get(event.value.sourceId) ?? [];
    rows.push(event); grouped.set(event.value.sourceId, rows);
  }
  return grouped;
}

function activitySegment(source: string, rows: readonly TimedActivity[], index: number, events: readonly TimedActivity[],
  window: MissionWindow, depths: ReadonlyMap<string, number>, defects: Set<string>): Segment | null {
  const current = rows[index]!;
  if (current.value.state !== 'running' && current.value.state !== 'blocked') { return null; }
  const next = nextActivityBoundary(current, rows.slice(index + 1), events);
  const end = Math.min(window.end, next?.at ?? window.end);
  const start = Math.max(window.start, current.at);
  if (end <= start) { return null; }
  if (!completeActivityOwnership(current.value)) {
    defects.add(`Activity ownership incomplete for ${window.missionId} operation ${current.value.operationId ?? 'unknown'} source ${source}; rerun the affected fresh workflow with FLOW collection enabled`);
    return null;
  }
  if (!next && current.value.state === 'running') {
    defects.add(`Open activity bounded at first delivery for ${window.missionId} operation ${current.value.operationId ?? 'unknown'} source ${source}`);
  }
  const actor = current.value.actor;
  const state = current.value.timeState;
  return { id: `activity:${source}`, missionId: window.missionId, start, end,
    priority: 20 + (depths.get(source) ?? 0),
    ...row(activityStep(current.value.phase ?? 'unknown', actor, state), actor, current.value.model ?? null, state) };
}

function nextActivityBoundary(current: TimedActivity, following: readonly TimedActivity[], events: readonly TimedActivity[]): TimedActivity | undefined {
  return following.find(event => event.at >= current.at)
    ?? (current.value.state === 'blocked' ? events.find(event => event.at > current.at && event.value.state === 'running') : undefined);
}

function completeActivityOwnership(value: Activity): value is Activity & { operationId: string; operationGeneration: number;
  revision: string; actor: string; timeState: FlowTimeState } {
  return Boolean(value.operationId) && value.operationGeneration !== null && value.operationGeneration !== undefined
    && Boolean(value.revision) && Boolean(value.actor) && value.actor !== 'unattributed' && Boolean(value.timeState);
}

function dependencyDepths(events: readonly Activity[]): Map<string, number> {
  const dependencies = new Map(events.flatMap(event => event.sourceId ? [[event.sourceId, event.dependencies ?? []] as const] : []));
  const memo = new Map<string, number>();
  const visit = (source: string, visiting = new Set<string>()): number => {
    if (memo.has(source)) { return memo.get(source)!; }
    if (visiting.has(source)) { return 0; }
    visiting.add(source);
    const depth = Math.max(0, ...(dependencies.get(source) ?? []).map(parent => 1 + visit(parent, visiting)));
    visiting.delete(source); memo.set(source, depth); return depth;
  };
  for (const source of dependencies.keys()) { visit(source); }
  return memo;
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

function leadHandoffSegments(repositoryId: string, history: HistoryIndex, window: MissionWindow): Segment[] {
  const running = indexed(history, 'mission.current-work', window.missionId).flatMap(({ entry, value }) => {
    const activity = value as Activity;
    return activity.repositoryId === repositoryId && activity.state === 'running' ? [Date.parse(entry.createdAt)] : [];
  }).filter(Number.isFinite).sort((a, b) => a - b);
  return indexed(history, 'lead.operator-judgment', window.missionId).flatMap(({ entry, value: raw }) => {
    const value = raw as { repositoryId?: string; missionId?: string; action?: string; summary?: string; evidenceRefs?: string[] };
    const start = Date.parse(entry.createdAt);
    // Rows written before repository attribution was added are still scoped by
    // the mission index. A conflicting explicit repository never crosses over.
    if ((value.repositoryId !== undefined && value.repositoryId !== repositoryId)
      || value.action !== 'escalate' || !Number.isFinite(start)) { return []; }
    const end = Math.min(window.end, running.find(at => at > start) ?? window.end);
    const incident = value.evidenceRefs?.slice().sort().join('|') || value.summary || String(entry.id ?? entry.createdAt);
    return end > start ? [{ id: `lead-escalation:${window.missionId}:${incident}`, missionId: window.missionId,
      start: Math.max(window.start, start), end, priority: 15, ...row('lead-escalation', 'human', null, 'held') }] : [];
  });
}

/**
 * Attribute only the explicitly observed gap between one completed workflow
 * operation and the next admitted operation. This is external waiting because
 * the first process recorded that it ended and the next process had not yet
 * started; it is never promoted to human or lead ownership.
 */
function operationHandoffSegments(repositoryId: string, history: HistoryIndex, window: MissionWindow): Segment[] {
  const events = indexed(history, 'mission.current-work', window.missionId).flatMap(({ entry, value: raw }) => {
    const value = raw as Activity & { summary?: string };
    return value.repositoryId === repositoryId ? [{ at: Date.parse(entry.createdAt), value }] : [];
  }).filter(event => Number.isFinite(event.at)).sort((a, b) => a.at - b.at);
  return events.flatMap((event, index) => {
    if (event.value.state !== 'ended' || event.value.summary !== 'workflow completed' || !event.value.operationId) { return []; }
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
function operationFinalizationSegments(repositoryId: string, history: HistoryIndex, window: MissionWindow): Segment[] {
  const events = indexed(history, 'mission.current-work', window.missionId).flatMap(({ entry, value: raw }) => {
    const value = raw as Activity & { summary?: string };
    return value.repositoryId === repositoryId ? [{ at: Date.parse(entry.createdAt), value }] : [];
  }).filter(event => Number.isFinite(event.at)).sort((a, b) => a.at - b.at);
  return events.flatMap((event, index) => {
    if (event.value.state !== 'ended' || event.value.summary !== 'workflow completed'
      || event.value.actor !== 'parallix' || !event.value.operationId) { return []; }
    const prior = [...events.slice(0, index)].reverse().find(candidate => candidate.value.operationId === event.value.operationId);
    if (!prior || prior.value.state !== 'ended') { return []; }
    const start = Math.max(window.start, prior.at), end = Math.min(window.end, event.at);
    return end > start ? [{ id: `finalize:${event.value.operationId}`, missionId: window.missionId,
      start, end, priority: 20,
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
  return history.get(eventType)?.get(missionId) ?? [];
}
