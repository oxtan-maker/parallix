/**
 * Legacy checkpoint import: load the reconciliation artifact and import or
 * reconcile each legacy checkpoint without forging evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareCodeUnits } from '../../domain/comparators.js';
import { parseCheckpointDocument, reconcileLegacyCheckpoint } from './checkpoint-document.js';
import { hasApprovedCheckpointException } from './legacy-mission-content.js';
import type { CheckpointData } from '../../domain/checkpoint.js';
import { missionId, type MissionId } from '../../domain/mission.js';
import { type MissionImportServices, type LegacyImportOptions } from './legacy-import-types.js';
import { relative, sourceMatchesCommit } from './legacy-record-source.js';

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

export async function importLegacyCheckpoints(
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
  const context: CheckpointImportContext = { services, options, commit, reconciliation, visited, conflicts };
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    count += await importMissionCheckpoints(context, entry.name, root);
  }
  for (const file of reconciliation?.keys() ?? []) {
    if (!visited.has(file)) { conflicts.push(`${file}: reconciliation artifact entry was not discovered`); }
  }
  return count;
}

/** One record the dependency pass may write, and how it got its Mission. */

interface CheckpointImportContext {
  services: MissionImportServices; options: LegacyImportOptions; commit: string | null;
  reconciliation: Map<string, CheckpointReconciliationEntry> | null;
  visited: Set<string>; conflicts: string[];
}
type LoadedMission = Extract<Awaited<ReturnType<MissionImportServices['store']['load']>>, { kind: 'found' }>;
async function importMissionCheckpoints(context: CheckpointImportContext, name: string, root: string): Promise<number> {
  const { services, options, conflicts } = context;
  let id: MissionId;
  try { id = missionId(name); } catch { return 0; }
  const dir = path.join(root, name);
  const files = fs.readdirSync(dir).filter(name => /^CP-\d+\.md$/.test(name)).sort(compareCodeUnits);
  if (files.length === 0) { return 0; }
  const read = await services.store.load(id);
  if (read.kind !== 'found' || read.mission.repositoryId !== services.repositoryId) {
    conflicts.push(`${id}: checkpoint files have no Mission in repository ${services.repositoryId}`);
    return 0;
  }
  const checkpoints = [...read.mission.checkpoints];
  let count = 0;
  for (const file of files) {
    if (importCheckpointFile(context, id, dir, file, read, checkpoints)) { count += 1; }
  }

  if (count === 0 || options.dryRun) { return count; }
  try { await services.store.save({ ...read.mission, checkpoints }, read.version); }
  catch (error) { conflicts.push(`${id}: checkpoint import refused (${error instanceof Error ? error.message : String(error)})`); }
  return count;
}
function importCheckpointFile(context: CheckpointImportContext, id: MissionId, dir: string, file: string, read: LoadedMission, checkpoints: CheckpointData[]): boolean {
  const { options, reconciliation, visited, commit, conflicts } = context;
  const source = path.join(dir, file);
  const sourcePath = relative(options.rootDir, source).split(path.sep).join('/');
  const approved = reconciliation?.get(sourcePath);
  if (approved) { visited.add(sourcePath); }
  if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, source, commit)) {
    conflicts.push(`${relative(options.rootDir, source)}: checkpoint source differs from pinned Git commit`);
    return false;
  }
  let parsed;
  let content: string;
  try {
    content = fs.readFileSync(source, 'utf8');
    parsed = parseCheckpointDocument(id, file, content);
  }
  catch (error) {
    conflicts.push(`${relative(options.rootDir, source)}: checkpoint parse refused (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
  const index = checkpoints.findIndex(checkpoint => checkpoint.name === parsed.name);
  const existing = index < 0 ? null : checkpoints[index];
  if (hasApprovedCheckpointException(options.rootDir, read.mission, sourcePath, content)) { return false; }
  const merged = mergeCheckpointSource(context, sourcePath, content, approved, existing, parsed);
  if (!merged) {
    if (approved) { return false; }
    conflicts.push(`${relative(options.rootDir, source)}: recorded checkpoint disagrees with source`);
    return false;
  }
  if (existing && JSON.stringify(existing) === JSON.stringify(merged)) { return false; }
  if (index < 0) { checkpoints.push(merged); }
  else { checkpoints[index] = merged; }
  return true;
}

function mergeCheckpointSource(context: CheckpointImportContext, sourcePath: string, content: string, approved: CheckpointReconciliationEntry | undefined, existing: CheckpointData | null, parsed: CheckpointData): CheckpointData | null {
  const { conflicts } = context;
  let merged = existing ? reconcileLegacyCheckpoint(existing, parsed) : parsed;
  if (approved) {
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== approved.sha256 || !existing) {
      conflicts.push(`${sourcePath}: reconciliation artifact source or recorded checkpoint is missing`);
      return null;
    }
    if (JSON.stringify(existing) === JSON.stringify(parsed)) { return null; }
    if (JSON.stringify(existing) !== JSON.stringify(approved.recorded)) {
      conflicts.push(`${sourcePath}: recorded checkpoint differs from committed reconciliation artifact`);
      return null;
    }
    merged = parsed;
  }

  return merged;
}
