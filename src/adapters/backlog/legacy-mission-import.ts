/**
 * Explicit one-way legacy Backlog importer (TASK-2521.04).
 *
 * Reads the retired repository task representation — the configured
 * `backlog/tasks`, `backlog/completed`, and `backlog/archive` locations, plus
 * `backlog.md` when it exists — and materializes each importable record as a
 * backlog `Mission` through the existing `MissionIntakeService`. There is no
 * second task catalog, no second task lifecycle, and no task-source table: the
 * only durable record an import writes is the Mission aggregate the rest of
 * Parallix already owns (ADR 0053).
 *
 * Historical refined and completed lanes can be preserved without inventing
 * a current contract, checkpoint, or review. A completed lane requires a
 * source-backed closure date. Other post-intake lanes remain deferred.
 *
 * This module is an explicit migration path, never a runtime fallback reader.
 * Nothing in the normal `draft`, `active`, board, review, or integration path
 * calls it; it is reachable only through `px import-legacy`.
 *
 * It reads the legacy files and never writes, renames, or deletes them.
 *
 * Safety rules, in the order they apply to one legacy task id:
 *   1. Historical copies of one id that disagree on a Mission-owned field are
 *      reported as conflicting; the importer picks no winner.
 *   2. A record without a usable Mission identity, title, single assignee, or
 *      mappable lifecycle status is reported as conflicting — never guessed
 *      into the aggregate.
 *   3. A mapped status requiring live execution or review evidence is deferred;
 *      historical refined and done states are imported without forged evidence.
 *   4. An existing Mission whose `ExternalTaskRef` already traces this legacy
 *      id, and whose Mission-owned source material still agrees, counts as
 *      already materialized, so repeated runs import each id at most once.
 *   5. An existing Mission with a different title is reported as conflicting;
 *      current Mission labels supersede old task labels retained in the body.
 *   6. Frontmatter fields `Mission` has no representation for are reported by
 *      name; the record's identity and Mission-owned fields still import.
 *   7. A legacy `dependencies` entry is recorded as a Mission dependency once
 *      the Mission it names exists; one that resolves to nothing is reported so
 *      the reference stays visible instead of being dropped. Dependencies are
 *      resolved in a second pass over every record this run left with a
 *      Mission, so a reference to a record imported later in the same run is
 *      recorded rather than reported unresolved.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { missionStatusFromBacklog } from './mission-materialization.js';
import { git } from '../git/git.js';
import { parseTaskFrontmatterValue } from './task-file-io.js';
import { readLegacyTaskContent } from './legacy-task-content.js';
import { agentFamily, type AgentFamily } from '../../domain/agents.js';
import { externalTaskRef } from '../../domain/external-task.js';
import { missionId, missionLabels, type MissionId, type MissionLabel } from '../../domain/mission.js';
import { LEGACY_TASK_SOURCE, UNIMPORTABLE_LANES, INTAKE_CAPABILITY, type MissionImportServices, type LegacyImportOptions, type LegacyImportReport, type LegacyRecord } from './legacy-import-types.js';
import { legacyDirectories, markdownFiles, parseLegacyRecord, relative, headCommit, sourceLocator, sourceMatchesCommit, latestSourceCommit, historicalClosedAt, sameLabels, normalizedLegacyLabels } from './legacy-record-source.js';
import { importLegacyMissionDocuments, importLegacyReviewLaunches, importLegacyReviews, importLegacyNel } from './legacy-import-companions.js';
import { importLegacyCheckpoints } from './legacy-import-checkpoints.js';
import { recordDependencies, type DependencyCandidate } from './legacy-import-dependencies.js';
export { LEGACY_TASK_SOURCE } from './legacy-import-types.js';
export type { MissionImportServices, LegacyImportOptions, LegacyImportReport } from './legacy-import-types.js';
export async function importLegacyMissions(
  services: MissionImportServices,
  options: LegacyImportOptions,
): Promise<LegacyImportReport> {
  const dryRun = options.dryRun === true;
  const occurredAt = options.now ?? new Date().toISOString();
  const conflicts: string[] = [];
  const deferredRecords: string[] = [];
  const unresolvedDependencies: string[] = [];
  const obsoleteDependencies: string[] = [];
  const unrepresentedFields: string[] = [];
  const imported: MissionId[] = [];
  const commit = options.commit === undefined ? headCommit(options.rootDir) : options.commit;
  const archiveName = 'missions/task-2521.06/artifacts/task-bodies.json';
  const archiveFile = path.join(options.rootDir, archiveName);
  const archiveRaw = fs.existsSync(archiveFile) ? fs.readFileSync(archiveFile, 'utf8') : null;
  type BodyEntry = { id: string; url: string; sha256: string; content: string };
  const archive = archiveRaw === null ? null : JSON.parse(archiveRaw) as { entries: BodyEntry[] };
  if (archive && (git(['show', `HEAD:${archiveName}`], { cwd: options.rootDir, maxBuffer: 8 * 1024 * 1024 }).stdout !== archiveRaw
    || !Array.isArray(archive.entries) || new Set(archive.entries.map(entry => entry.id)).size !== archive.entries.length
    || archive.entries.some(entry => typeof entry.content !== 'string'
      || createHash('sha256').update(entry.content).digest('hex') !== entry.sha256
      || parseTaskFrontmatterValue(entry.content, 'id')?.trim().toUpperCase() !== entry.id))) {
    throw new Error('Legacy task archive must be committed and verified before import');
  }
  const bodyUpdates = new Map<string, BodyEntry>();
  const preserveBody = (id: string, url: string | null, sourcePath: string) => {
    if (!archive || !url) { return; }
    const content = fs.readFileSync(sourcePath, 'utf8');
    bodyUpdates.set(id, { id, url, content, sha256: createHash('sha256').update(content).digest('hex') });
  };

  // --- Discovery, grouped by legacy task id -------------------------------
  const bySourceId = new Map<string, LegacyRecord[]>();
  let discovered = 0;
  const scanned = new Set<string>();
  for (const directory of legacyDirectories(options.rootDir)) {
    for (const filePath of markdownFiles(directory)) {
      // `archive` and `archive/tasks` can resolve to overlapping scans; one
      // file is one discovered record regardless of how many roots reach it.
      if (scanned.has(filePath)) { continue; }
      scanned.add(filePath);
      discovered += 1;
      if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, filePath, commit)) {
        conflicts.push(`${relative(options.rootDir, filePath)}: source differs from pinned Git commit`);
        continue;
      }
      const parsed = parseLegacyRecord(filePath);
      if (parsed === null) {
        conflicts.push(`${relative(options.rootDir, filePath)}: no task id in frontmatter`);
        continue;
      }
      const group = bySourceId.get(parsed.sourceId);
      if (group === undefined) { bySourceId.set(parsed.sourceId, [parsed]); } else { group.push(parsed); }
    }
  }

  /** Records this run leaves with a Mission, for the dependency pass below. */
  const withMission: DependencyCandidate[] = [];
  let importable = 0;
  let alreadyMaterialized = 0;
  let unrepresented = 0;

  // `backlog.md` is an aggregate index without a unique task mapping. The
  // audit verifies its committed external preservation artifact.
  const aggregate = path.join(options.rootDir, 'backlog.md');
  if (fs.existsSync(aggregate)) {
    discovered += 1;
  }

  for (const [sourceId, copies] of [...bySourceId.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const currentCopies = copies.filter(copy => relative(options.rootDir, copy.sourcePath).startsWith('backlog/completed/'));
    const selected = currentCopies.length === 1
      && copies.every(copy => copy.title === currentCopies[0].title)
      ? currentCopies[0]
      : null;
    if (new Set(copies.map(copy => copy.representedMaterial)).size > 1 && selected === null) {
      conflicts.push(
        `${sourceId}: ${copies.length} historical copies disagree on Mission-owned fields (`
        + `${copies.map(copy => relative(options.rootDir, copy.sourcePath)).join(', ')})`,
      );
      continue;
    }
    const legacy = selected ?? copies[0];

    let id: MissionId;
    try {
      id = missionId(sourceId.toLowerCase());
    } catch {
      conflicts.push(`${sourceId}: identity is not a valid Mission slug`);
      continue;
    }
    if (legacy.title === null || legacy.title.trim().length === 0) {
      conflicts.push(`${sourceId}: no title to import`);
      continue;
    }
    const status = legacy.rawStatus === null ? null : missionStatusFromBacklog(legacy.rawStatus);
    if (status === null) {
      conflicts.push(
        `${sourceId}: status ${JSON.stringify(legacy.rawStatus)} has no Mission lifecycle mapping`,
      );
      continue;
    }
    if (legacy.assignees.length > 1) {
      conflicts.push(
        `${sourceId}: ${legacy.assignees.length} assignees; Mission owns exactly one`,
      );
      continue;
    }
    let assignee: AgentFamily | null = null;
    try {
      assignee = legacy.assignees.length === 0 ? null : agentFamily(legacy.assignees[0]);
    } catch {
      conflicts.push(`${sourceId}: assignee ${JSON.stringify(legacy.assignees[0])} is not an agent family`);
      continue;
    }
    let labels: readonly MissionLabel[];
    try {
      labels = missionLabels(legacy.labels);
    } catch {
      conflicts.push(`${sourceId}: labels are not representable as Mission labels`);
      continue;
    }

    if (legacy.unrepresentedKeys.length > 0) {
      unrepresented += 1;
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
      continue;
    }
    if (options.existingOnly && (read.kind === 'missing'
      || (read.kind === 'found' && (read.mission.status === 'backlog'
        || read.mission.externalTaskRef?.source !== LEGACY_TASK_SOURCE)))) { continue; }
    if (read.kind === 'found') {
      const existing = read.mission;
      if (existing.repositoryId !== services.repositoryId) {
        conflicts.push(`${sourceId}: Mission identity belongs to repository ${existing.repositoryId}, expected ${services.repositoryId}`);
        continue;
      }
      const existingTrace = existing.externalTaskRef ?? null;
      if (existingTrace !== null
        && (existingTrace.source !== trace.source || existingTrace.id !== trace.id)) {
        conflicts.push(`${sourceId}: an existing Mission traces a different task source`);
        continue;
      }
      // Only fields the import itself sets are compared. `assignee` and
      // `status` move under the normal lifecycle (a local `px active` sets
      // both), so a divergence there is expected Parallix authority, not a
      // source disagreement, and must never read as a conflict. `url` is a
      // locator: a record that merely moved from `tasks/` to `completed/` is
      // still the same accepted material.
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
      const changed = [
        ...(existing.title !== legacy.title.trim() && !titleIsPlaceholder ? ['title'] : []),
      ];
      if (changed.length > 0) {
        conflicts.push(`${sourceId}: existing Mission disagrees with the legacy source material (${changed.join(', ')}; recorded title=${JSON.stringify(existing.title)}, legacy title=${JSON.stringify(legacy.title.trim())}, recorded labels=${JSON.stringify(existing.labels)}, legacy labels=${JSON.stringify(labels)})`);
        continue;
      }
      // A task body may have changed on main since the first import. Keep the
      // current canonical body pinned without replacing Mission-owned fields.
      const pinned = existingTrace && options.commit === undefined
        ? readLegacyTaskContent(existingTrace, options.rootDir) : null;
      if (pinned?.error) {
        conflicts.push(`${sourceId}: prior task body unavailable (${pinned.error})`);
        continue;
      }
      const bodyChanged = pinned?.content !== undefined && pinned?.content !== null
        && pinned.content !== fs.readFileSync(legacy.sourcePath, 'utf8');
      const refreshedCommit = bodyChanged ? latestSourceCommit(options.rootDir, legacy.sourcePath) : null;
      if (bodyChanged && !refreshedCommit) {
        conflicts.push(`${sourceId}: changed task body has no matching committed source`);
        continue;
      }
      const refreshedTrace = refreshedCommit
        ? externalTaskRef(LEGACY_TASK_SOURCE, sourceId,
          sourceLocator(relative(options.rootDir, legacy.sourcePath), refreshedCommit))
        : null;
      const repairedClosedAt = existing.status === 'done' && existing.closedAt === null
        ? historicalClosedAt(options.rootDir, legacy.sourcePath)
        : null;
      if (existing.status === 'done' && existing.closedAt === null && repairedClosedAt === null) {
        conflicts.push(`${sourceId}: completed Mission has no source-backed closure date`);
        continue;
      }
      if (existingTrace === null || titleIsPlaceholder || !sameLabels(existing.labels, recordedLabels)
        || repairedClosedAt || refreshedTrace) {
        importable += 1;
        if (dryRun) { continue; }
        try {
          await services.store.save({
            ...existing,
            title: titleIsPlaceholder ? legacy.title.trim() : existing.title,
            labels: titleBelongsToAnotherTask ? labels : recordedLabels,
            closedAt: repairedClosedAt ?? existing.closedAt,
            externalTaskRef: refreshedTrace ?? existingTrace ?? trace,
          } as import('../../domain/mission.js').Mission, read.version);
        } catch (error) {
          importable -= 1;
          conflicts.push(`${sourceId}: source trace write refused (${error instanceof Error ? error.message : String(error)})`);
          continue;
        }
        imported.push(id);
        preserveBody(sourceId, (refreshedTrace ?? existingTrace ?? trace).url, legacy.sourcePath);
        withMission.push({ sourceId, id, entries: legacy.dependencies, imported: true });
        continue;
      }
      alreadyMaterialized += 1;
      withMission.push({ sourceId, id, entries: legacy.dependencies, imported: false });
      continue;
    }

    // Historical records predate the current lifecycle. Preserve their lane
    // without inventing a contract, checkpoint, or review. A completed record
    // needs an actual source-backed closure time.
    const closedAt = status === 'done' ? historicalClosedAt(options.rootDir, legacy.sourcePath) : null;
    if (status !== 'backlog' && status !== 'refined' && status !== 'done') {
      deferredRecords.push(`${sourceId}: legacy lane "${status}" ${UNIMPORTABLE_LANES[status]}`);
      continue;
    }
    if (status === 'done' && closedAt === null) {
      deferredRecords.push(`${sourceId}: completed lane has no source-backed closure date`);
      continue;
    }

    importable += 1;
    if (dryRun) { continue; }

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
      importable -= 1;
      conflicts.push(`${sourceId}: intake refused (${intake.error?.message ?? intake.status})`);
      continue;
    }

    if (status !== 'backlog') {
      const loaded = await services.store.load(id);
      if (loaded.kind !== 'found') {
        conflicts.push(`${sourceId}: imported Mission unavailable for historical lane`);
        continue;
      }
      try {
        await services.store.save({
          ...loaded.mission,
          status,
          closedAt,
        } as import('../../domain/mission.js').Mission, loaded.version);
      } catch (error) {
        conflicts.push(`${sourceId}: historical lane write refused (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
    }

    imported.push(id);
    preserveBody(sourceId, trace.url, legacy.sourcePath);
    withMission.push({ sourceId, id, entries: legacy.dependencies, imported: true });
  }

  await recordDependencies(services, withMission, dryRun, unresolvedDependencies, obsoleteDependencies, conflicts);
  const checkpointFilesImportable = await importLegacyCheckpoints(services, options, commit, conflicts);
  importable += await importLegacyNel(services, options, commit, conflicts);
  importable += await importLegacyReviews(services, options, commit, conflicts);
  importable += await importLegacyReviewLaunches(services, options, commit, conflicts);
  importable += await importLegacyMissionDocuments(services, options, commit, conflicts);

  // Repair only legacy-imported rows. A native Mission can be `done` with no
  // closedAt while integration finishes stats, cleanup, and the post hook;
  // import-legacy must not close that in-flight delivery from its lane event.
  if (services.store.loadByRepository && services.store.findTransitions) {
    const missions = await services.store.loadByRepository(services.repositoryId);
    for (const mission of missions) {
      if (mission.status !== 'done' || mission.closedAt !== null
        || mission.externalTaskRef?.source !== LEGACY_TASK_SOURCE
        || bySourceId.has(mission.id.toUpperCase())) { continue; }
      const transitions = await services.store.findTransitions(mission.id);
      const doneAt = [...transitions].reverse().find(event => event.toStatus === 'done' && event.occurredAt)?.occurredAt;
      if (!doneAt || Number.isNaN(Date.parse(doneAt))) {
        conflicts.push(`${mission.id}: completed Mission has no recorded closure event`);
        continue;
      }
      importable += 1;
      if (dryRun) { continue; }
      const loaded = await services.store.load(mission.id);
      if (loaded.kind !== 'found') {
        importable -= 1;
        conflicts.push(`${mission.id}: completed Mission unavailable for closure repair`);
        continue;
      }
      try {
        await services.store.save({ ...loaded.mission, status: 'done', closedAt: new Date(doneAt).toISOString() }, loaded.version);
        imported.push(mission.id);
      } catch (error) {
        importable -= 1;
        conflicts.push(`${mission.id}: closure repair refused (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }

  if (!dryRun && archive && bodyUpdates.size) {
    const entries = new Map(archive.entries.map(entry => [entry.id, entry]));
    for (const [id, entry] of bodyUpdates) { entries.set(id, entry); }
    fs.writeFileSync(archiveFile, JSON.stringify({ ...archive, entries: [...entries.values()] }, null, 2) + '\n');
  }

  return {
    discovered,
    importable,
    checkpointFilesImportable,
    alreadyMaterialized,
    conflicting: conflicts.length,
    deferred: deferredRecords.length,
    unrepresented,
    dryRun,
    conflicts,
    deferredRecords,
    unresolvedDependencies,
    obsoleteDependencies,
    unrepresentedFields,
    imported,
  };
}

