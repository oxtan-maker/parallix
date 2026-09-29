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
import { compareCodeUnits } from '../../domain/comparators.js';
import { missionStatusFromBacklog } from './mission-materialization.js';
import { git } from '../git/git.js';
import { parseTaskFrontmatterValue } from './task-file-io.js';
import { parseCheckpointDocument, reconcileLegacyCheckpoint } from './checkpoint-document.js';
import { parseLegacyMissionDocument } from './legacy-mission-document.js';
import { readLegacyTaskContent } from './legacy-task-content.js';
import { hasApprovedCheckpointException } from './legacy-mission-content.js';
import type { CheckpointData } from '../../domain/checkpoint.js';
import { classifyNelBucket, type NelBucketLabel } from '../../domain/net-engineering-lines.js';
import { backfillReviewFromLegacyState } from '../review/review-state.js';
import { stageLaunchWindowsFrom } from '../../domain/review.js';
import { findFieldBlock, parseAssigneeFamilies, parseTaskLabels } from './task-metadata.js';
import { resolveTaskStorage } from '../config/product-config.js';
import type { Capability } from '../../application/contracts.js';
import type { MissionStore, MissionTransitionHistoryEntry } from '../../application/domain-ports.js';
import type {
  MissionIntakeRequest,
  MissionIntakeResult,
} from '../../application/mission-intake-service.js';
import type {
  MissionDependenciesResult,
  SetMissionDependenciesRequest,
} from '../../application/mission-brief-service.js';
import type { ApplicationOutcome } from '../../application/contracts.js';
import { agentFamily, type AgentFamily } from '../../domain/agents.js';
import { externalTaskRef } from '../../domain/external-task.js';
import {
  missionId,
  missionLabels,
  type MissionId,
  type MissionLabel,
  type MissionStatus,
} from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';

/** The owning system recorded on every imported Mission's `ExternalTaskRef`. */
export const LEGACY_TASK_SOURCE = 'backlog-md';

/**
 * Frontmatter keys `Mission` represents. Everything else a legacy file carries
 * (`priority`, `ordinal`, `created_date`, `milestone`, …) is reported by name
 * rather than given an invented Mission field.
 */
const REPRESENTED_KEYS: readonly string[] = [
  'id', 'title', 'status', 'assignee', 'labels', 'dependencies',
];
/** Explicitly retired by the operator; canonical body remains in the archive. */
const RETIRED_KEYS: readonly string[] = [
  'priority', 'references', 'ordinal', 'parent_task_id', 'documentation',
  'modified_files', 'created_date', 'updated_date', 'milestone',
  'completed_date', 'operator_note', 'mission_contract',
];

/** Lanes whose live evidence cannot be inferred from historical task files. */
const UNIMPORTABLE_LANES: Readonly<Record<Exclude<MissionStatus, 'backlog'>, string>> = {
  refined: 'needs a recorded contract',
  active: 'needs a recorded contract',
  review: 'needs checkpoint and review evidence',
  integration: 'needs checkpoint and review evidence',
  done: 'needs checkpoint and review evidence',
};

const INTAKE_CAPABILITY: ReadonlySet<Capability> = new Set<Capability>(['mission:intake']);
const CONTEXT_CAPABILITY: ReadonlySet<Capability> = new Set<Capability>(['mission:context']);
const OBSOLETE_LEGACY_DEPENDENCIES = new Set(['TASK-1233', 'TASK-1265', 'TASK-1285', 'TASK-2500']);

/** The existing Mission use cases the importer writes through; no new port. */
export interface MissionImportServices {
  readonly repositoryId: RepositoryId;
  readonly store: MissionStore & {
    findTransitions?(_missionId: MissionId): Promise<readonly MissionTransitionHistoryEntry[]>;
  };
  readonly intake: {
    execute(_request: MissionIntakeRequest): Promise<ApplicationOutcome<MissionIntakeResult>>;
  };
  /** The same use case `px depends` writes through. */
  readonly dependencies: {
    setDependencies(
      _request: SetMissionDependenciesRequest,
    ): Promise<ApplicationOutcome<MissionDependenciesResult>>;
  };
}

export interface LegacyImportOptions {
  /** Repository root holding the legacy task tree. */
  readonly rootDir: string;
  /** Report only; no Mission row is written. */
  readonly dryRun?: boolean;
  /** Refresh imported Missions without ingesting native Missions or future backlog items. */
  readonly existingOnly?: boolean;
  /** Occurrence time recorded on intake and lane events; defaults to now. */
  readonly now?: string;
  /**
   * The commit the legacy files are read at, pinned into each imported trace.
   * Defaults to the checkout's `HEAD`.
   */
  readonly commit?: string | null;
  /** One-shot, artifact-verified replacement of disputed historical CP rows. */
  readonly reconcileCheckpoints?: boolean;
}

interface CheckpointReconciliationEntry {
  readonly file: string;
  readonly sha256: string;
  readonly recorded: CheckpointData;
  readonly sourceCommit?: string;
}

interface CheckpointReconciliationArtifact {
  readonly sourceCommit: string;
  readonly entries: readonly CheckpointReconciliationEntry[];
}

const CHECKPOINT_RECONCILIATION_ARTIFACT =
  'missions/task-2521.06/artifacts/legacy-checkpoint-reconciliation.json';

function loadCheckpointReconciliation(rootDir: string, commit: string | null): Map<string, CheckpointReconciliationEntry> {
  const file = path.join(rootDir, CHECKPOINT_RECONCILIATION_ARTIFACT);
  if (!sourceMatchesCommit(rootDir, file, commit)) {
    throw new Error('Checkpoint reconciliation artifact must match the current committed revision');
  }
  const artifact = JSON.parse(fs.readFileSync(file, 'utf8')) as CheckpointReconciliationArtifact;
  if (!/^[a-f0-9]{40,64}$/.test(artifact.sourceCommit) || !Array.isArray(artifact.entries)) {
    throw new Error('Checkpoint reconciliation artifact has invalid source commit or entries');
  }
  const entries = new Map<string, CheckpointReconciliationEntry>();
  for (const entry of artifact.entries) {
    if (!/^missions\/task-[^/]+\/CP-\d+\.md$/.test(entry.file)
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || entry.recorded?.missionId !== entry.file.split('/')[1]
      || entry.recorded.name !== path.basename(entry.file, '.md')
      || entries.has(entry.file)
      || (entry.sourceCommit !== undefined && !/^[a-f0-9]{40,64}$/.test(entry.sourceCommit))
      || !sourceMatchesCommit(rootDir, path.join(rootDir, entry.file), entry.sourceCommit ?? artifact.sourceCommit)) {
      throw new Error(`Checkpoint reconciliation artifact has invalid entry: ${entry.file}`);
    }
    entries.set(entry.file, entry);
  }
  return entries;
}

export interface LegacyImportReport {
  /** Legacy source records found across every scanned location. */
  readonly discovered: number;
  /** Missions created, or in a dry run that would be created. */
  readonly importable: number;
  /** Legacy checkpoint files whose parsed data would be attached to a Mission. */
  readonly checkpointFilesImportable: number;
  /** Legacy ids an existing Mission already traces with agreeing material. */
  readonly alreadyMaterialized: number;
  /** Records refused because a human decision is required. */
  readonly conflicting: number;
  /** Records in a legacy lane past `backlog`, reported for TASK-2521.06. */
  readonly deferred: number;
  /** Records carrying at least one field `Mission` cannot represent. */
  readonly unrepresented: number;
  readonly dryRun: boolean;
  /** One line per refusal, naming the legacy id and the reason. */
  readonly conflicts: readonly string[];
  /** One line per deferred record, naming the legacy id, lane and reason. */
  readonly deferredRecords: readonly string[];
  /** One line per legacy dependency that resolves to no Mission. */
  readonly unresolvedDependencies: readonly string[];
  /** Proven stale links retained in the pinned source body, not current graph edges. */
  readonly obsoleteDependencies: readonly string[];
  /** One line per unrepresented field, naming the legacy id and the field. */
  readonly unrepresentedFields: readonly string[];
  /** Mission ids this run materialized, in import order. */
  readonly imported: readonly MissionId[];
}

interface LegacyRecord {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly title: string | null;
  readonly rawStatus: string | null;
  readonly assignees: readonly string[];
  readonly labels: readonly string[];
  readonly unrepresentedKeys: readonly string[];
  /** Raw `dependencies` frontmatter entries, in the order the file lists them. */
  readonly dependencies: readonly string[];
  /** Mission-owned material only: two copies differing elsewhere still agree. */
  readonly representedMaterial: string;
}

/** Legacy locations this importer reads, from the configured task storage. */
function legacyDirectories(rootDir: string): readonly string[] {
  const storage = resolveTaskStorage(rootDir);
  return [
    storage.tasksDir,
    storage.completedDir,
    // `archive/tasks` holds the archived records; the archive root also holds
    // loose ones in this repository, so both are scanned.
    storage.archiveTasksDir,
    path.dirname(storage.archiveTasksDir),
  ];
}

function markdownFiles(directory: string): readonly string[] {
  if (!fs.existsSync(directory)) { return []; }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => path.join(directory, entry.name));
}

/**
 * A frontmatter list in either form the legacy files wrote it: block style
 * (`dependencies:` then `  - TASK-1`) or inline (`dependencies: [TASK-1,
 * TASK-2]`). Both appear across the historical records, so reading only one of
 * them would silently drop the other's entries.
 */
function parseListField(content: string, field: string): readonly string[] {
  const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '').trim();
  const block = findFieldBlock(content, field);
  if (block !== null) {
    return block.lines.slice(block.itemStart, block.end)
      .map(line => unquote(line.trim().replace(/^-[ \t]*/, '')))
      .filter(entry => entry.length > 0);
  }
  const inline = new RegExp(`^${field}:[ \\t]*\\[(.*?)\\]`, 'm').exec(content);
  if (inline === null) { return []; }
  return inline[1].split(',').map(unquote).filter(entry => entry.length > 0);
}

function frontmatterKeys(content: string): readonly string[] {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') { return []; }
  const keys: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') { break; }
    const match = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (match) { keys.push(match[1].toLowerCase()); }
  }
  return keys;
}

function parseLegacyRecord(filePath: string): LegacyRecord | null {
  const content = fs.readFileSync(filePath, 'utf8');
  const rawId = parseTaskFrontmatterValue(content, 'id');
  if (rawId === null) { return null; }
  const record = {
    sourceId: rawId.trim().toUpperCase(),
    sourcePath: filePath,
    title: parseTaskFrontmatterValue(content, 'title'),
    rawStatus: parseTaskFrontmatterValue(content, 'status'),
    assignees: parseAssigneeFamilies(content).families,
    labels: parseTaskLabels(content),
    unrepresentedKeys: frontmatterKeys(content).filter(key => !REPRESENTED_KEYS.includes(key) && !RETIRED_KEYS.includes(key)),
    dependencies: parseListField(content, 'dependencies'),
  };
  // Only Mission-owned material decides whether two historical copies of one id
  // disagree. A copy that differs solely in an unrepresented field (a bumped
  // `updated_date`, a `priority` edit) changes nothing this importer would
  // write, so it must not read as a conflict.
  const representedMaterial = JSON.stringify([
    record.sourceId,
    record.title,
    record.rawStatus,
    [...record.assignees].sort((a, b) => a.localeCompare(b)),
    [...record.labels].sort((a, b) => a.localeCompare(b)),
    [...record.dependencies].sort((a, b) => a.localeCompare(b)),
  ]);
  return { ...record, representedMaterial };
}

function relative(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath);
}

/**
 * The commit the legacy files are read at. TASK-2521.07 removes those files, so
 * pinning it keeps the imported record's source text recoverable with
 * `git show <commit>:<path>`. Outside a checkout there is nothing to pin.
 */
function headCommit(rootDir: string): string | null {
  const result = git(['rev-parse', 'HEAD'], { cwd: rootDir });
  const sha = result.stdout.trim();
  return result.status === 0 && sha.length > 0 ? sha : null;
}

/**
 * `<source path>@<commit>`: where the record was read and at which commit. It
 * is a locator, not an identity — the legacy id in the same `ExternalTaskRef`
 * is the identity, so a moved file or a newer commit is not a conflict.
 */
function sourceLocator(sourcePath: string, commit: string | null): string {
  return commit === null ? sourcePath : `${sourcePath}@${commit}`;
}

function sourceMatchesCommit(rootDir: string, filePath: string, commit: string | null): boolean {
  if (commit === null) { return false; }
  try {
    const pinned = git(['show', `${commit}:${relative(rootDir, filePath)}`], { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 });
    if (pinned.status !== 0) { return false; }
    const digest = (content: string) => createHash('sha256').update(content).digest('hex');
    return digest(pinned.stdout) === digest(fs.readFileSync(filePath, 'utf8'));
  } catch { return false; }
}

function latestSourceCommit(rootDir: string, filePath: string): string | null {
  const result = git(['log', '-1', '--format=%H', '--', relative(rootDir, filePath)], { cwd: rootDir });
  const commit = result.stdout.trim();
  return result.status === 0 && /^[a-f0-9]{40,64}$/.test(commit)
    && sourceMatchesCommit(rootDir, filePath, commit) ? commit : null;
}

/** A commit that recorded this completed artifact. */
function historicalClosedAt(rootDir: string, filePath: string): string | null {
  const sourcePath = relative(rootDir, filePath);
  if (sourcePath.startsWith('backlog/tasks/')) {
    // Some completed wave tasks never moved out of `tasks/`. The commit that
    // first records each done transition supplies their closure date.
    const history = git(['log', '--reverse', '--format=%H', '--', sourcePath], { cwd: rootDir });
    if (history.status !== 0) { return null; }
    let previous: string | null = null;
    let closedAt: string | null = null;
    for (const commit of history.stdout.trim().split('\n').filter(Boolean)) {
      const snapshot = git(['show', `${commit}:${sourcePath}`], { cwd: rootDir });
      if (snapshot.status !== 0) { continue; }
      const status = parseTaskFrontmatterValue(snapshot.stdout, 'status')?.trim().toLowerCase() ?? null;
      if (status === 'done' && previous !== 'done') {
        const event = git(['show', '-s', '--format=%cI', commit], { cwd: rootDir });
        if (event.status === 0 && !Number.isNaN(Date.parse(event.stdout.trim()))) {
          closedAt = new Date(event.stdout.trim()).toISOString();
        }
      }
      previous = status;
    }
    return closedAt;
  }
  if (!sourcePath.startsWith('backlog/completed/') && !sourcePath.startsWith('backlog/archive/')) { return null; }
  const result = git(['log', '-1', '--format=%cI', '--', sourcePath], { cwd: rootDir });
  const value = result.stdout.trim();
  return result.status === 0 && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** Mission-owned labels compared as a set; import order carries no meaning. */
function sameLabels(left: readonly MissionLabel[], right: readonly MissionLabel[]): boolean {
  if (left.length !== right.length) { return false; }
  const seen = new Set<string>(left);
  return right.every(label => seen.has(label));
}

/** Older intake stored an entire frontmatter list as one label string. */
function normalizedLegacyLabels(labels: readonly MissionLabel[]): readonly MissionLabel[] {
  if (labels.length !== 1) { return labels; }
  const value = String(labels[0]);
  if (!value.startsWith('[') || !value.endsWith(']')) { return labels; }
  const contents = value.slice(1, -1).trim();
  try {
    return missionLabels(contents ? contents.split(',').map(label => label.trim().replace(/^['"]|['"]$/g, '')) : []);
  } catch { return labels; }
}

/**
 * Import the legacy repository task records as Missions.
 *
 * Idempotent: a second run over unchanged sources writes nothing and reports
 * every legacy id as already materialized.
 */
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

/** Fill empty typed contract fields from committed historical documents. */
async function importLegacyMissionDocuments(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const directory = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(directory)) { return 0; }
  let changed = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) { continue; }
    const file = path.join(directory, entry.name, 'MISSION.md');
    if (!fs.existsSync(file)) { continue; }
    if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, file, commit)) {
      conflicts.push(`${relative(options.rootDir, file)}: source differs from pinned Git commit`);
      continue;
    }
    let id: MissionId;
    try { id = missionId(entry.name); } catch { continue; }
    const read = await services.store.load(id);
    if (read.kind !== 'found' || read.mission.repositoryId !== services.repositoryId) { continue; }
    const parsed = parseLegacyMissionDocument(fs.readFileSync(file, 'utf8'));
    const mission = read.mission;
    const brief = mission.brief ?? parsed.brief ?? null;
    const success = mission.successCriteria?.length ? mission.successCriteria : (parsed.successCriteria ?? mission.successCriteria ?? []);
    const gates = mission.declaredGates?.length ? mission.declaredGates : (parsed.declaredGates ?? mission.declaredGates ?? []);
    const predicted = mission.predictedNelBucket ?? parsed.predictedNelBucket ?? null;
    const reproduction = mission.reproductionTest ?? parsed.reproductionTest ?? null;
    const checkpoints = [...mission.checkpoints];
    for (const planned of parsed.checkpoints) {
      if (checkpoints.some(cp => cp.name === planned.name)) { continue; }
      checkpoints.push({ missionId: id, name: planned.name, firstLine: planned.description,
        goalCheck: [], nextActionText: '' });
    }
    checkpoints.sort((a, b) => Number(a.name.slice(3)) - Number(b.name.slice(3)));
    if (brief === (mission.brief ?? null) && success === mission.successCriteria
      && gates === mission.declaredGates && predicted === (mission.predictedNelBucket ?? null)
      && reproduction === (mission.reproductionTest ?? null)
      && checkpoints.length === mission.checkpoints.length) { continue; }
    changed += 1;
    if (options.dryRun) { continue; }
    try {
      await services.store.save({ ...mission, brief, successCriteria: success,
        declaredGates: gates, predictedNelBucket: predicted, reproductionTest: reproduction,
        checkpoints }, read.version);
    } catch (error) {
      changed -= 1;
      conflicts.push(`${id}: historical Mission contract write refused (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return changed;
}

/** Retain launch fingerprints omitted by older Review imports. */
async function importLegacyReviewLaunches(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const root = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(root)) { return 0; }
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    const file = path.join(root, entry.name, 'review-state.json');
    if (!fs.existsSync(file)) { continue; }
    if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, file, commit)) {
      conflicts.push(`${relative(options.rootDir, file)}: review state differs from pinned Git commit`); continue;
    }
    let state: { metadata?: { recordedStageLaunches?: unknown } };
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { conflicts.push(`${relative(options.rootDir, file)}: review state is invalid JSON`); continue; }
    const launches = stageLaunchWindowsFrom(state.metadata?.recordedStageLaunches);
    if (launches.length === 0) { continue; }
    const read = await services.store.load(missionId(entry.name));
    if (read.kind !== 'found' || !read.mission.review || read.mission.repositoryId !== services.repositoryId) {
      conflicts.push(`${relative(options.rootDir, file)}: owning Review is missing`); continue;
    }
    if (read.mission.review.stageLaunches.length > 0) { continue; }
    count += 1;
    if (options.dryRun) { continue; }
    try {
      await services.store.save({ ...read.mission,
        review: { ...read.mission.review, stageLaunches: launches },
      }, read.version);
    } catch (error) {
      count -= 1;
      conflicts.push(`${relative(options.rootDir, file)}: launch history import refused (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return count;
}

/** Reuse the existing explicit review backfill, with source pinning for this one-shot import. */
async function importLegacyReviews(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const root = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(root)) { return 0; }
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    const dir = path.join(root, entry.name);
    const state = path.join(dir, 'review-state.json');
    const events = path.join(dir, 'review-events');
    const sources = [
      ...(fs.existsSync(state) ? [state] : []),
      ...(fs.existsSync(events) ? fs.readdirSync(events).map(file => path.join(events, file)) : []),
    ];
    if (sources.length === 0) { continue; }
    const changed = options.commit === undefined && sources.find(file => !sourceMatchesCommit(options.rootDir, file, commit));
    if (changed) { conflicts.push(`${relative(options.rootDir, changed)}: review source differs from pinned Git commit`); continue; }
    const result = await backfillReviewFromLegacyState(entry.name, options.rootDir, {
      apply: !options.dryRun,
      missionStore: services.store,
    });
    if (result.outcome === 'failed') { conflicts.push(`${entry.name}: review backfill refused (${result.diagnostic})`); }
    else if (['backfilled', 'events-backfilled', 'would-backfill', 'would-backfill-events'].includes(result.outcome)) {
      count += 1;
    }
  }
  return count;
}

/** Restore measured NEL from the historical handoff export without changing current measurements. */
async function importLegacyNel(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const root = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(root)) { return 0; }
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    const file = path.join(root, entry.name, 'nel-record.json');
    if (!fs.existsSync(file)) { continue; }
    const name = relative(options.rootDir, file);
    if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, file, commit)) {
      conflicts.push(`${name}: NEL source differs from pinned Git commit`);
      continue;
    }
    let record: { slug?: unknown; actualNel?: unknown; predictedBucket?: unknown; actualBucket?: unknown };
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { conflicts.push(`${name}: NEL record is invalid JSON`); continue; }
    if (record.slug !== entry.name || !Number.isInteger(record.actualNel)
      || Number(record.actualNel) < 0
      || classifyNelBucket(Number(record.actualNel)).label !== record.actualBucket) {
      conflicts.push(`${name}: NEL record has invalid identity or measurement`);
      continue;
    }
    const predicted = record.predictedBucket === 'Unknown' ? null : record.predictedBucket;
    if (predicted !== null && !['Small', 'Medium', 'Large'].includes(String(predicted))) {
      conflicts.push(`${name}: NEL prediction is invalid`);
      continue;
    }
    let id: MissionId;
    try { id = missionId(entry.name); }
    catch { conflicts.push(`${name}: invalid Mission identity`); continue; }
    const read = await services.store.load(id);
    if (read.kind !== 'found' || read.mission.repositoryId !== services.repositoryId) {
      conflicts.push(`${name}: owning Mission is missing`);
      continue;
    }
    const mission = read.mission;
    if ((mission.netEngineeringLines !== null && mission.netEngineeringLines !== record.actualNel)
      || (predicted !== null && mission.predictedNelBucket !== null && mission.predictedNelBucket !== predicted)) {
      conflicts.push(`${name}: Mission measurement disagrees with legacy NEL record`);
      continue;
    }
    if (mission.netEngineeringLines !== null && (predicted === null || mission.predictedNelBucket !== null)) { continue; }
    count += 1;
    if (options.dryRun) { continue; }
    try {
      await services.store.save({ ...mission,
        netEngineeringLines: record.actualNel as number,
        predictedNelBucket: (predicted as NelBucketLabel | null) ?? mission.predictedNelBucket,
      }, read.version);
    } catch (error) {
      count -= 1;
      conflicts.push(`${name}: NEL import refused (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return count;
}

async function importLegacyCheckpoints(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const reconciliation = options.reconcileCheckpoints
    ? loadCheckpointReconciliation(options.rootDir, commit) : null;
  const visited = new Set<string>();
  const root = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(root)) { return 0; }
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    let id: MissionId;
    try { id = missionId(entry.name); } catch { continue; }
    const dir = path.join(root, entry.name);
    const files = fs.readdirSync(dir).filter(name => /^CP-\d+\.md$/.test(name)).sort(compareCodeUnits);
    if (files.length === 0) { continue; }
    const read = await services.store.load(id);
    if (read.kind !== 'found' || read.mission.repositoryId !== services.repositoryId) {
      conflicts.push(`${id}: checkpoint files have no Mission in repository ${services.repositoryId}`);
      continue;
    }
    const checkpoints = [...read.mission.checkpoints];
    let changed = false;
    for (const file of files) {
      const source = path.join(dir, file);
      const sourcePath = relative(options.rootDir, source).split(path.sep).join('/');
      const approved = reconciliation?.get(sourcePath);
      if (approved) { visited.add(sourcePath); }
      if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, source, commit)) {
        conflicts.push(`${relative(options.rootDir, source)}: checkpoint source differs from pinned Git commit`);
        continue;
      }
      let parsed;
      let content: string;
      try {
        content = fs.readFileSync(source, 'utf8');
        parsed = parseCheckpointDocument(id, file, content);
      }
      catch (error) {
        conflicts.push(`${relative(options.rootDir, source)}: checkpoint parse refused (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      const index = checkpoints.findIndex(checkpoint => checkpoint.name === parsed.name);
      const existing = index < 0 ? null : checkpoints[index];
      if (hasApprovedCheckpointException(options.rootDir, read.mission, sourcePath, content)) { continue; }
      let merged = existing ? reconcileLegacyCheckpoint(existing, parsed) : parsed;
      if (approved) {
        const digest = createHash('sha256').update(content).digest('hex');
        if (digest !== approved.sha256 || !existing) {
          conflicts.push(`${sourcePath}: reconciliation artifact source or recorded checkpoint is missing`);
          continue;
        }
        if (JSON.stringify(existing) === JSON.stringify(parsed)) { continue; }
        if (JSON.stringify(existing) !== JSON.stringify(approved.recorded)) {
          conflicts.push(`${sourcePath}: recorded checkpoint differs from committed reconciliation artifact`);
          continue;
        }
        merged = parsed;
      }
      if (!merged) {
        conflicts.push(`${relative(options.rootDir, source)}: recorded checkpoint disagrees with source`);
        continue;
      }
      if (existing && JSON.stringify(existing) === JSON.stringify(merged)) { continue; }
      if (index < 0) { checkpoints.push(merged); }
      else { checkpoints[index] = merged; }
      changed = true;
      count += 1;
    }
    if (!changed || options.dryRun) { continue; }
    try { await services.store.save({ ...read.mission, checkpoints }, read.version); }
    catch (error) { conflicts.push(`${id}: checkpoint import refused (${error instanceof Error ? error.message : String(error)})`); }
  }
  for (const file of reconciliation?.keys() ?? []) {
    if (!visited.has(file)) { conflicts.push(`${file}: reconciliation artifact entry was not discovered`); }
  }
  return count;
}

/** One record the dependency pass may write, and how it got its Mission. */
interface DependencyCandidate {
  readonly sourceId: string;
  readonly id: MissionId;
  readonly entries: readonly string[];
  /** True when this run created the Mission; false when it already existed. */
  readonly imported: boolean;
}

/**
 * Record each record's dependencies once every record in this run has its
 * Mission.
 *
 * Resolving during import would make the outcome depend on the order the
 * records happen to be read in: a reference to a record imported later would
 * resolve to nothing, and the record would be already materialized by the time
 * anything could retry it. This pass runs after all of them, so only a
 * reference that truly names no Mission is reported.
 *
 * Which records it writes to is what keeps a rerun idempotent:
 *
 *   * A Mission this run imported gets the references its legacy record states.
 *   * A Mission that already existed is written only when one of its references
 *     names a Mission this run imported — the one case where the reference could
 *     not have been recorded before. An unchanged rerun therefore writes
 *     nothing, so a dependency an operator removed with `px depends remove`
 *     stays removed.
 *   * Either way, a Mission that already has dependencies recorded is left
 *     alone: the import never overwrites a recorded list.
 */
async function recordDependencies(
  services: MissionImportServices,
  records: readonly DependencyCandidate[],
  dryRun: boolean,
  unresolved: string[],
  obsolete: string[],
  conflicts: string[],
): Promise<void> {
  const importedNow = new Set(records.filter((record) => record.imported).map((record) => record.id));
  for (const record of records.filter(candidate => candidate.entries.length > 0)) {
    // A legacy file may name the same predecessor twice; that is one dependency,
    // not a record the domain's duplicate rule should refuse outright.
    const resolved = new Set<MissionId>();
    for (const entry of record.entries) {
      const candidate = await resolveDependency(services, entry, record.id);
      if (candidate === null) {
        if (OBSOLETE_LEGACY_DEPENDENCIES.has(entry.toUpperCase())) {
          obsolete.push(`${record.sourceId}: dependency ${entry} is obsolete; retained in pinned task body`);
        } else {
          unresolved.push(`${record.sourceId}: dependency ${entry} resolves to no Mission`);
        }
        continue;
      }
      resolved.add(candidate);
    }
    const dependencies = [...resolved];
    if (dryRun || dependencies.length === 0) { continue; }
    if (!record.imported && !dependencies.some((dependency) => importedNow.has(dependency))) {
      continue;
    }
    const read = await services.store.load(record.id);
    if (read.kind !== 'found' || (read.mission.dependencies ?? []).length > 0) { continue; }
    const written = await services.dependencies.setDependencies({
      operationId: `import-legacy:${record.id}:dependencies`,
      missionId: record.id,
      dependencies,
      capabilities: CONTEXT_CAPABILITY,
    });
    // A refused write is a refusal to report, not a silent loss: the references
    // resolved, so dropping them here would lose material the file states.
    if (written.status !== 'completed') {
      conflicts.push(
        `${record.sourceId}: dependencies ${dependencies.join(', ')} were refused `
        + `(${written.error?.message ?? written.status})`,
      );
    }
  }
}

/**
 * The Mission a legacy `dependencies` entry names, or null when the reference
 * resolves to nothing: not a Mission slug, this Mission itself, or an id no
 * Mission holds.
 */
async function resolveDependency(
  services: MissionImportServices,
  entry: string,
  owner: MissionId,
): Promise<MissionId | null> {
  let candidate: MissionId;
  try { candidate = missionId(entry.trim().toLowerCase()); } catch { return null; }
  if (candidate === owner) { return null; }
  const read = await services.store.load(candidate);
  return read.kind === 'found' ? candidate : null;
}
