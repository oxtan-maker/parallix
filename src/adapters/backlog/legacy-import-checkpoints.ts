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
