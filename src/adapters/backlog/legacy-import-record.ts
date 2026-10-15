import fs from 'node:fs';

import { missionStatusFromBacklog } from './mission-materialization.js';

import { readLegacyTaskContent } from './legacy-task-content.js';
import { agentFamily, type AgentFamily } from '../../domain/agents.js';
import { externalTaskRef } from '../../domain/external-task.js';
import { missionId, missionLabels, type Mission, type MissionId, type MissionLabel } from '../../domain/mission.js';
import { LEGACY_TASK_SOURCE, UNIMPORTABLE_LANES, INTAKE_CAPABILITY, type MissionImportServices, type LegacyImportOptions, type LegacyRecord } from './legacy-import-types.js';
import { relative, sourceLocator, latestSourceCommit, historicalClosedAt, sameLabels, normalizedLegacyLabels } from './legacy-record-source.js';

import { type DependencyCandidate } from './legacy-import-dependencies.js';

export interface LegacyImportProgress { importable: number; alreadyMaterialized: number; unrepresented: number }
interface LegacyRecordContext {
  services: MissionImportServices; options: LegacyImportOptions; dryRun: boolean; occurredAt: string; commit: string | null;
  bySourceId: Map<string, LegacyRecord[]>; conflicts: string[]; deferredRecords: string[]; unrepresentedFields: string[];
  imported: MissionId[]; withMission: DependencyCandidate[]; progress: LegacyImportProgress;
  preserveBody: (_id: string, _url: string | null, _sourcePath: string) => void;
}
export async function importLegacyRecord(sourceId: string, copies: LegacyRecord[], context: LegacyRecordContext): Promise<void> {
  const { services, options, commit, conflicts, unrepresentedFields, progress } = context;
  const selectedLegacy = selectLegacyCopy(sourceId, copies, options.rootDir, conflicts);
  if (!selectedLegacy) { return; }
  const identity = legacyIdentity(sourceId, selectedLegacy, conflicts);
  if (!identity) { return; }
  const { id, legacy } = identity;
  if (legacy.unrepresentedKeys.length > 0) {
    progress.unrepresented += 1;
    for (const key of legacy.unrepresentedKeys) {
      unrepresentedFields.push(`${sourceId}: ${key}`);
    }
  }

  const trace = externalTaskRef(
    LEGACY_TASK_SOURCE,
    sourceId,
    sourceLocator(relative(options.rootDir, legacy.sourcePath), commit),
  );

  const read = await services.store.load(id);
  if (read.kind === 'unavailable') {
    conflicts.push(`${sourceId}: mission store unavailable (${read.reason})`);
    return;
  }
  if (options.existingOnly && (read.kind === 'missing'
    || (read.kind === 'found' && (read.mission.status === 'backlog'
      || read.mission.externalTaskRef?.source !== LEGACY_TASK_SOURCE)))) { return; }
  if (read.kind === 'found') { await refreshExistingRecord(sourceId, identity, trace, read, context); return; }

  await createHistoricalRecord(sourceId, identity, trace, context);
}

function selectLegacyCopy(sourceId: string, copies: LegacyRecord[], rootDir: string, conflicts: string[]): LegacyRecord | null {
  const currentCopies = copies.filter(copy => relative(rootDir, copy.sourcePath).startsWith('backlog/completed/'));
  const selected = currentCopies.length === 1
    && copies.every(copy => copy.title === currentCopies[0].title)
    ? currentCopies[0]
    : null;
  if (new Set(copies.map(copy => copy.representedMaterial)).size > 1 && selected === null) {
    conflicts.push(
      `${sourceId}: ${copies.length} historical copies disagree on Mission-owned fields (`
      + `${copies.map(copy => relative(rootDir, copy.sourcePath)).join(', ')})`,
    );
    return null;
  }
  return selected ?? copies[0];

}
function legacyIdentity(sourceId: string, legacy: LegacyRecord, conflicts: string[]) {
  let id: MissionId;
  try {
    id = missionId(sourceId.toLowerCase());
  } catch {
    conflicts.push(`${sourceId}: identity is not a valid Mission slug`);
    return null;
  }
  if (legacy.title === null || legacy.title.trim().length === 0) {
    conflicts.push(`${sourceId}: no title to import`);
    return null;
  }
  const status = legacy.rawStatus === null ? null : missionStatusFromBacklog(legacy.rawStatus);
  if (status === null) {
    conflicts.push(
      `${sourceId}: status ${JSON.stringify(legacy.rawStatus)} has no Mission lifecycle mapping`,
    );
    return null;
  }
  if (legacy.assignees.length > 1) {
    conflicts.push(
      `${sourceId}: ${legacy.assignees.length} assignees; Mission owns exactly one`,
    );
    return null;
  }
  let assignee: AgentFamily | null = null;
  try {
    assignee = legacy.assignees.length === 0 ? null : agentFamily(legacy.assignees[0]);
  } catch {
    conflicts.push(`${sourceId}: assignee ${JSON.stringify(legacy.assignees[0])} is not an agent family`);
    return null;
  }
  let labels: readonly MissionLabel[];
  try {
    labels = missionLabels(legacy.labels);
  } catch {
    conflicts.push(`${sourceId}: labels are not representable as Mission labels`);
    return null;
  }

  return { id, legacy: { ...legacy, title: legacy.title }, status, assignee, labels };
}

type LegacyIdentity = NonNullable<ReturnType<typeof legacyIdentity>>;
type FoundMission = Extract<Awaited<ReturnType<MissionImportServices['store']['load']>>, { kind: 'found' }>;
async function refreshExistingRecord(sourceId: string, identity: LegacyIdentity, trace: ReturnType<typeof externalTaskRef>, read: FoundMission, context: LegacyRecordContext): Promise<void> {
  const { id, legacy, labels } = identity;
  const { services, options, dryRun, bySourceId, conflicts, imported, withMission, progress, preserveBody } = context;
  const existing = read.mission;
  if (existing.repositoryId !== services.repositoryId) {
    conflicts.push(`${sourceId}: Mission identity belongs to repository ${existing.repositoryId}, expected ${services.repositoryId}`);
    return;
  }
  const existingTrace = existing.externalTaskRef ?? null;
  if (existingTrace !== null
    && (existingTrace.source !== trace.source || existingTrace.id !== trace.id)) {
    conflicts.push(`${sourceId}: an existing Mission traces a different task source`);
    return;
  }
  // Only fields the import itself sets are compared. `assignee` and
  // `status` move under the normal lifecycle (a local `px active` sets
  // both), so a divergence there is expected Parallix authority, not a
  // source disagreement, and must never read as a conflict. `url` is a
  // locator: a record that merely moved from `tasks/` to `completed/` is
  // still the same accepted material.
  const { recordedLabels, titleBelongsToAnotherTask, titleIsPlaceholder } = legacyTitleFacts(existing, legacy, id, sourceId, bySourceId, existingTrace);
  const changed = [
    ...(existing.title !== legacy.title.trim() && !titleIsPlaceholder ? ['title'] : []),
  ];
  if (changed.length > 0) {
    conflicts.push(`${sourceId}: existing Mission disagrees with the legacy source material (${changed.join(', ')}; recorded title=${JSON.stringify(existing.title)}, legacy title=${JSON.stringify(legacy.title.trim())}, recorded labels=${JSON.stringify(existing.labels)}, legacy labels=${JSON.stringify(labels)})`);
    return;
  }
  // A task body may have changed on main since the first import. Keep the
  // current canonical body pinned without replacing Mission-owned fields.
  const refreshed = refreshLegacyTrace(sourceId, legacy, existingTrace, options, conflicts);
  if (refreshed === null) { return; }
  const { refreshedTrace } = refreshed;
  const closure = repairLegacyClosedAt(existing, legacy, sourceId, options, conflicts);
  if (closure === null) { return; }
  const { repairedClosedAt } = closure;
  if (needsLegacyRefresh(existing, existingTrace, titleIsPlaceholder, recordedLabels, repairedClosedAt, refreshedTrace)) {
    progress.importable += 1;
    if (dryRun) { return; }
    try {
      const updated = refreshedLegacyMission(existing, legacy, labels, trace, existingTrace, refreshedTrace, repairedClosedAt, titleIsPlaceholder, titleBelongsToAnotherTask, recordedLabels);
      await services.store.save(updated, read.version);
    } catch (error) {
      progress.importable -= 1;
      conflicts.push(`${sourceId}: source trace write refused (${legacyWriteError(error)})`);
      return;
    }
    imported.push(id);
    preserveBody(sourceId, selectedLegacyTrace(refreshedTrace, existingTrace, trace).url, legacy.sourcePath);
    withMission.push({ sourceId, id, entries: legacy.dependencies, imported: true });
    return;
  }
  progress.alreadyMaterialized += 1;
  withMission.push({ sourceId, id, entries: legacy.dependencies, imported: false });
  return;
}

async function createHistoricalRecord(sourceId: string, identity: LegacyIdentity, trace: ReturnType<typeof externalTaskRef>, context: LegacyRecordContext): Promise<void> {
  const { id, legacy, status, labels, assignee } = identity;
  const { services, options, dryRun, occurredAt, conflicts, deferredRecords, imported, withMission, progress, preserveBody } = context;
  // Historical records predate the current lifecycle. Preserve their lane
  // without inventing a contract, checkpoint, or review. A completed record
  // needs an actual source-backed closure time.
  const closedAt = status === 'done' ? historicalClosedAt(options.rootDir, legacy.sourcePath) : null;
  if (status !== 'backlog' && status !== 'refined' && status !== 'done') {
    deferredRecords.push(`${sourceId}: legacy lane "${status}" ${UNIMPORTABLE_LANES[status]}`);
    return;
  }
  if (status === 'done' && closedAt === null) {
    deferredRecords.push(`${sourceId}: completed lane has no source-backed closure date`);
    return;
  }

  progress.importable += 1;
  if (dryRun) { return; }

  const intake = await services.intake.execute({
    operationId: `import-legacy:${sourceId}`,
    missionId: id,
    repositoryId: services.repositoryId,
    title: legacy.title.trim(),
    labels,
    assignee,
    rawStatus: legacy.rawStatus ?? status,
    externalTaskRef: trace,
    occurredAt,
    idempotencyKey: `import-legacy-intake-${id}`,
    capabilities: INTAKE_CAPABILITY,
  });
  if (intake.status !== 'completed') {
    progress.importable -= 1;
    conflicts.push(`${sourceId}: intake refused (${intake.error?.message ?? intake.status})`);
    return;
  }

  if (status !== 'backlog') {
    const loaded = await services.store.load(id);
    if (loaded.kind !== 'found') {
      conflicts.push(`${sourceId}: imported Mission unavailable for historical lane`);
      return;
    }
    try {
      await services.store.save(historicalLaneMission(loaded.mission, status, closedAt), loaded.version);
    } catch (error) {
      conflicts.push(`${sourceId}: historical lane write refused (${legacyWriteError(error)})`);
      return;
    }
  }

  imported.push(id);
  preserveBody(sourceId, trace.url, legacy.sourcePath);
  withMission.push({ sourceId, id, entries: legacy.dependencies, imported: true });
}

function legacyTitleFacts(existing: Mission, legacy: LegacyIdentity['legacy'], id: MissionId, sourceId: string, bySourceId: Map<string, LegacyRecord[]>, existingTrace: Mission['externalTaskRef']) {
  const recordedLabels = normalizedLegacyLabels(existing.labels);
  const titleBelongsToAnotherTask = existingTrace === null && [...bySourceId.entries()]
    .some(([otherId, records]) => otherId !== sourceId
      && records.some(record => record.title?.trim() === existing.title));
  const titleIsPlaceholder = existingTrace === null
    && (existing.title.toLowerCase() === id
      || existing.title.toLowerCase().startsWith(`${id}-`)
      || existing.title.startsWith('<Title>')
      || existing.title === '>-'
      || existing.title === '|-'
      || titleBelongsToAnotherTask
      || (/^(['"]).*\1$/.test(existing.title)
        && existing.title.slice(1, -1) === legacy.title.trim()));
  return { recordedLabels, titleBelongsToAnotherTask, titleIsPlaceholder };
}

function refreshLegacyTrace(sourceId: string, legacy: LegacyIdentity['legacy'], existingTrace: Mission['externalTaskRef'], options: LegacyImportOptions, conflicts: string[]) {
  const pinned = existingTrace && options.commit === undefined
    ? readLegacyTaskContent(existingTrace, options.rootDir) : null;
  if (pinned?.error) {
    conflicts.push(`${sourceId}: prior task body unavailable (${pinned.error})`);
    return null;
  }
  const bodyChanged = pinned?.content !== undefined && pinned?.content !== null
    && pinned.content !== fs.readFileSync(legacy.sourcePath, 'utf8');
  const refreshedCommit = bodyChanged ? latestSourceCommit(options.rootDir, legacy.sourcePath) : null;
  if (bodyChanged && !refreshedCommit) {
    conflicts.push(`${sourceId}: changed task body has no matching committed source`);
    return null;
  }
  const refreshedTrace = refreshedCommit
    ? externalTaskRef(LEGACY_TASK_SOURCE, sourceId,
      sourceLocator(relative(options.rootDir, legacy.sourcePath), refreshedCommit))
    : null;
  return { refreshedTrace };
}

function repairLegacyClosedAt(existing: Mission, legacy: LegacyIdentity['legacy'], sourceId: string, options: LegacyImportOptions, conflicts: string[]) {
  const repairedClosedAt = existing.status === 'done' && existing.closedAt === null
    ? historicalClosedAt(options.rootDir, legacy.sourcePath)
    : null;
  if (existing.status === 'done' && existing.closedAt === null && repairedClosedAt === null) {
    conflicts.push(`${sourceId}: completed Mission has no source-backed closure date`);
    return null;
  }
  return { repairedClosedAt };
}

function needsLegacyRefresh(existing: Mission, existingTrace: Mission['externalTaskRef'], titleIsPlaceholder: boolean, recordedLabels: readonly MissionLabel[], repairedClosedAt: string | null, refreshedTrace: Mission['externalTaskRef']): boolean {
  return existingTrace === null || titleIsPlaceholder || !sameLabels(existing.labels, recordedLabels) || Boolean(repairedClosedAt || refreshedTrace);
}

function refreshedLegacyMission(existing: Mission, legacy: LegacyIdentity['legacy'], labels: readonly MissionLabel[], trace: ReturnType<typeof externalTaskRef>, existingTrace: Mission['externalTaskRef'], refreshedTrace: Mission['externalTaskRef'], repairedClosedAt: string | null, titleIsPlaceholder: boolean, titleBelongsToAnotherTask: boolean, recordedLabels: readonly MissionLabel[]): Mission {
  const updated = {
    ...existing,
    title: titleIsPlaceholder ? legacy.title.trim() : existing.title,
    labels: titleBelongsToAnotherTask ? labels : recordedLabels,
    externalTaskRef: selectedLegacyTrace(refreshedTrace, existingTrace, trace),
  };
  return repairedClosedAt === null ? updated : { ...updated, status: 'done', closedAt: repairedClosedAt };

}

function legacyWriteError(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function selectedLegacyTrace(refreshed: Mission['externalTaskRef'], existing: Mission['externalTaskRef'], fallback: ReturnType<typeof externalTaskRef>): ReturnType<typeof externalTaskRef> { return refreshed ?? existing ?? fallback; }

function historicalLaneMission(mission: Mission, status: 'refined' | 'done', closedAt: string | null): Mission {
  return closedAt === null ? { ...mission, status, closedAt: null } : { ...mission, status: 'done', closedAt };
}
