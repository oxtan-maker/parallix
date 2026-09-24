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
 * Intake is the only lane an import reaches. TASK-2521.03 made the Mission
 * contract durable state, so `refine` now requires a recorded brief, scope,
 * success criteria, checkpoint plan, gate and predicted NEL bucket. A legacy
 * file carries none of that, and inventing one would forge the contract the
 * lifecycle exists to check, so every legacy lane past `backlog` is reported
 * instead of imported.
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
 *   3. A mapped status that the current lifecycle cannot reach from intake
 *      without fabricating review evidence is reported as conflicting, per the
 *      mission risk "a legacy status may not be reachable through the current
 *      lifecycle".
 *   4. An existing Mission whose `ExternalTaskRef` already traces this legacy
 *      id, and whose Mission-owned source material still agrees, counts as
 *      already materialized, so repeated runs import each id at most once.
 *   5. An existing Mission that disagrees, or that owns the identity with no
 *      trace to this material, is reported as conflicting and left untouched.
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
import { missionStatusFromBacklog } from './mission-materialization.js';
import { git } from '../git/git.js';
import { parseTaskFrontmatterValue } from './task-file-io.js';
import { findFieldBlock, parseAssigneeFamilies, parseTaskLabels } from './task-metadata.js';
import { resolveTaskStorage } from '../config/product-config.js';
import type { Capability } from '../../application/contracts.js';
import type { MissionStore } from '../../application/domain-ports.js';
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

/**
 * Why each legacy lane past intake is reported rather than imported. `refined`
 * and `active` need the recorded contract `refine` checks; the later lanes also
 * need checkpoint evidence and a decided review round.
 */
const UNIMPORTABLE_LANES: Readonly<Record<Exclude<MissionStatus, 'backlog'>, string>> = {
  refined: 'needs a recorded contract',
  active: 'needs a recorded contract',
  review: 'needs checkpoint and review evidence',
  integration: 'needs checkpoint and review evidence',
  done: 'needs checkpoint and review evidence',
};

const INTAKE_CAPABILITY: ReadonlySet<Capability> = new Set<Capability>(['mission:intake']);
const CONTEXT_CAPABILITY: ReadonlySet<Capability> = new Set<Capability>(['mission:context']);

/** The existing Mission use cases the importer writes through; no new port. */
export interface MissionImportServices {
  readonly repositoryId: RepositoryId;
  readonly store: MissionStore;
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
  /** Occurrence time recorded on intake and lane events; defaults to now. */
  readonly now?: string;
  /**
   * The commit the legacy files are read at, pinned into each imported trace.
   * Defaults to the checkout's `HEAD`.
   */
  readonly commit?: string | null;
}

export interface LegacyImportReport {
  /** Legacy source records found across every scanned location. */
  readonly discovered: number;
  /** Missions created, or in a dry run that would be created. */
  readonly importable: number;
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
    unrepresentedKeys: frontmatterKeys(content).filter(key => !REPRESENTED_KEYS.includes(key)),
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

/** Mission-owned labels compared as a set; import order carries no meaning. */
function sameLabels(left: readonly MissionLabel[], right: readonly MissionLabel[]): boolean {
  if (left.length !== right.length) { return false; }
  const seen = new Set<string>(left);
  return right.every(label => seen.has(label));
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
  const unrepresentedFields: string[] = [];
  const imported: MissionId[] = [];

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
      const parsed = parseLegacyRecord(filePath);
      if (parsed === null) {
        conflicts.push(`${relative(options.rootDir, filePath)}: no task id in frontmatter`);
        continue;
      }
      const group = bySourceId.get(parsed.sourceId);
      if (group === undefined) { bySourceId.set(parsed.sourceId, [parsed]); } else { group.push(parsed); }
    }
  }

  const commit = options.commit === undefined ? headCommit(options.rootDir) : options.commit;
  /** Records this run leaves with a Mission, for the dependency pass below. */
  const withMission: DependencyCandidate[] = [];
  let importable = 0;
  let alreadyMaterialized = 0;
  let unrepresented = 0;

  // `backlog.md` is an aggregate index, not a structured unique record, so it
  // is reported as unrepresented migration input rather than mapped (mission
  // scope: "treat backlog.md as migration input only when a structured, unique
  // record can be mapped safely").
  const aggregate = path.join(options.rootDir, 'backlog.md');
  if (fs.existsSync(aggregate)) {
    discovered += 1;
    unrepresented += 1;
    unrepresentedFields.push(
      'backlog.md: aggregate task material carries no structured unique record to map onto a Mission',
    );
  }

  for (const [sourceId, copies] of [...bySourceId.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (new Set(copies.map(copy => copy.representedMaterial)).size > 1) {
      conflicts.push(
        `${sourceId}: ${copies.length} historical copies disagree on Mission-owned fields (`
        + `${copies.map(copy => relative(options.rootDir, copy.sourcePath)).join(', ')})`,
      );
      continue;
    }
    const legacy = copies[0];

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
    if (read.kind === 'found') {
      const existing = read.mission;
      const existingTrace = existing.externalTaskRef ?? null;
      if (existingTrace === null
        || existingTrace.source !== trace.source
        || existingTrace.id !== trace.id) {
        conflicts.push(`${sourceId}: an existing Mission owns this identity with no trace to this material`);
        continue;
      }
      // Only fields the import itself sets are compared. `assignee` and
      // `status` move under the normal lifecycle (a local `px active` sets
      // both), so a divergence there is expected Parallix authority, not a
      // source disagreement, and must never read as a conflict. `url` is a
      // locator: a record that merely moved from `tasks/` to `completed/` is
      // still the same accepted material.
      if (existing.title !== legacy.title.trim() || !sameLabels(existing.labels, labels)) {
        conflicts.push(`${sourceId}: existing Mission disagrees with the legacy source material`);
        continue;
      }
      alreadyMaterialized += 1;
      withMission.push({ sourceId, id, entries: legacy.dependencies, imported: false });
      continue;
    }

    // Past `backlog`, the lane itself is the blocker: `refine` requires the
    // recorded contract a legacy file cannot supply, and the later lanes also
    // need checkpoint and review evidence. Report the record for TASK-2521.06
    // instead of inventing what the lifecycle checks.
    if (status !== 'backlog') {
      deferredRecords.push(`${sourceId}: legacy lane "${status}" ${UNIMPORTABLE_LANES[status]}`);
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

    imported.push(id);
    withMission.push({ sourceId, id, entries: legacy.dependencies, imported: true });
  }

  await recordDependencies(services, withMission, dryRun, unresolvedDependencies, conflicts);

  return {
    discovered,
    importable,
    alreadyMaterialized,
    conflicting: conflicts.length,
    deferred: deferredRecords.length,
    unrepresented,
    dryRun,
    conflicts,
    deferredRecords,
    unresolvedDependencies,
    unrepresentedFields,
    imported,
  };
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
        unresolved.push(`${record.sourceId}: dependency ${entry} resolves to no Mission`);
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
