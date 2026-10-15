import { importLegacyRecord, type LegacyImportProgress } from './legacy-import-record.js';
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

import { git } from '../git/git.js';
import { parseTaskFrontmatterValue } from './task-file-io.js';

import { type MissionId } from '../../domain/mission.js';
import { LEGACY_TASK_SOURCE, type MissionImportServices, type LegacyImportOptions, type LegacyImportReport, type LegacyRecord } from './legacy-import-types.js';
import { legacyDirectories, markdownFiles, parseLegacyRecord, relative, headCommit, sourceMatchesCommit } from './legacy-record-source.js';
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
  const { preserveBody, flushBodies } = legacyBodyArchive(options.rootDir);

  // --- Discovery, grouped by legacy task id -------------------------------
  const { bySourceId, discovered: sourceCount } = discoverLegacyRecords(options, commit, conflicts);
  let discovered = sourceCount;

  /** Records this run leaves with a Mission, for the dependency pass below. */
  const withMission: DependencyCandidate[] = [];
  const progress: LegacyImportProgress = { importable: 0, alreadyMaterialized: 0, unrepresented: 0 };

  // `backlog.md` is an aggregate index without a unique task mapping. The
  // audit verifies its committed external preservation artifact.
  const aggregate = path.join(options.rootDir, 'backlog.md');
  if (fs.existsSync(aggregate)) {
    discovered += 1;
  }

  for (const [sourceId, copies] of [...bySourceId.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    await importLegacyRecord(sourceId, copies, {
      services, options, dryRun, occurredAt, commit,
      bySourceId, conflicts, deferredRecords, unrepresentedFields, imported, withMission, progress, preserveBody
    });
  }

  await recordDependencies(services, withMission, dryRun, unresolvedDependencies, obsoleteDependencies, conflicts);
  const checkpointFilesImportable = await importLegacyCheckpoints(services, options, commit, conflicts);
  progress.importable += await importLegacyNel(services, options, commit, conflicts);
  progress.importable += await importLegacyReviews(services, options, commit, conflicts);
  progress.importable += await importLegacyReviewLaunches(services, options, commit, conflicts);
  progress.importable += await importLegacyMissionDocuments(services, options, commit, conflicts);

  // Repair only legacy-imported rows. A native Mission can be `done` with no
  // closedAt while integration finishes stats, cleanup, and the post hook;
  // import-legacy must not close that in-flight delivery from its lane event.
  await repairLegacyClosures(services, bySourceId, dryRun, progress, conflicts, imported);

  flushBodies(dryRun);

  return {
    discovered,
    importable: progress.importable,
    checkpointFilesImportable,
    alreadyMaterialized: progress.alreadyMaterialized,
    conflicting: conflicts.length,
    deferred: deferredRecords.length,
    unrepresented: progress.unrepresented,
    dryRun,
    conflicts,
    deferredRecords,
    unresolvedDependencies,
    obsoleteDependencies,
    unrepresentedFields,
    imported,
  };
}

function legacyBodyArchive(rootDir: string) {
  const archiveName = 'missions/task-2521.06/artifacts/task-bodies.json';
  const archiveFile = path.join(rootDir, archiveName);
  const archiveRaw = fs.existsSync(archiveFile) ? fs.readFileSync(archiveFile, 'utf8') : null;
  type BodyEntry = { id: string; url: string; sha256: string; content: string };
  const archive = archiveRaw === null ? null : JSON.parse(archiveRaw) as { entries: BodyEntry[] };
  if (archive && (git(['show', `HEAD:${archiveName}`], { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 }).stdout !== archiveRaw
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

  const flushBodies = (dryRun: boolean) => {
    if (!dryRun && archive && bodyUpdates.size) {
      const entries = new Map(archive.entries.map(entry => [entry.id, entry]));
      for (const [id, entry] of bodyUpdates) { entries.set(id, entry); }
      fs.writeFileSync(archiveFile, JSON.stringify({ ...archive, entries: [...entries.values()] }, null, 2) + '\n');
    }
  };
  return { preserveBody, flushBodies };
}

function discoverLegacyRecords(options: LegacyImportOptions, commit: string | null, conflicts: string[]) {
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

  return { bySourceId, discovered };
}

async function repairLegacyClosures(services: MissionImportServices, bySourceId: Map<string, LegacyRecord[]>, dryRun: boolean, progress: LegacyImportProgress, conflicts: string[], imported: MissionId[]): Promise<void> {
  if (services.store.loadByRepository && services.store.findTransitions) {
    const missions = await services.store.loadByRepository(services.repositoryId);
    for (const mission of missions) {
      if (!needsLegacyClosure(mission, bySourceId)) { continue; }
      const transitions = await services.store.findTransitions(mission.id);
      const doneAt = [...transitions].reverse().find(event => event.toStatus === 'done' && event.occurredAt)?.occurredAt;
      if (!doneAt || Number.isNaN(Date.parse(doneAt))) {
        conflicts.push(`${mission.id}: completed Mission has no recorded closure event`);
        continue;
      }
      progress.importable += 1;
      if (dryRun) { continue; }
      const loaded = await services.store.load(mission.id);
      if (loaded.kind !== 'found') {
        progress.importable -= 1;
        conflicts.push(`${mission.id}: completed Mission unavailable for closure repair`);
        continue;
      }
      try {
        await services.store.save({ ...loaded.mission, status: 'done', closedAt: new Date(doneAt).toISOString() }, loaded.version);
        imported.push(mission.id);
      } catch (error) {
        progress.importable -= 1;
        conflicts.push(`${mission.id}: closure repair refused (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }

}

function needsLegacyClosure(mission: import('../../domain/mission.js').Mission, bySourceId: ReadonlyMap<string, readonly LegacyRecord[]>): boolean {
  return !(mission.status !== 'done' || mission.closedAt !== null || mission.externalTaskRef?.source !== LEGACY_TASK_SOURCE || bySourceId.has(mission.id.toUpperCase()));
}
