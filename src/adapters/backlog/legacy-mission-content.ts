import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Mission } from '../../domain/mission.js';
import { missionId } from '../../domain/mission.js';
import { git } from '../git/git.js';
import { isLegacyMissionTemplate } from './legacy-mission-document.js';

/** Operator-approved final summary is historical text, not typed CP-1 evidence. */
export function hasApprovedCheckpointException(rootDir: string, mission: Mission, file: string, content: string): boolean {
  if (mission.id !== 'task-2576' || mission.status !== 'done' || !mission.closedAt
    || file !== 'missions/task-2576/CP-1.md') { return false; }
  const name = 'missions/task-2521.06/artifacts/task-2576-checkpoint-comparison.json';
  try {
    const raw = fs.readFileSync(path.join(rootDir, name), 'utf8');
    const committed = git(['show', `HEAD:${name}`], { cwd: rootDir });
    if (committed.status !== 0 || committed.stdout !== raw) { return false; }
    const artifact = JSON.parse(raw) as {
      missionId: string;
      exception?: { approvedBy: string; reason: string };
      source: { file: string; sourceCommit: string; sha256: string; content: string };
      recordedCheckpoints: unknown;
    };
    if (artifact.missionId !== mission.id || artifact.exception?.approvedBy !== 'operator'
      || !artifact.exception.reason?.trim() || artifact.source.file !== file
      || !/^[a-f0-9]{40,64}$/.test(artifact.source.sourceCommit)
      || artifact.source.content !== content
      || createHash('sha256').update(content).digest('hex') !== artifact.source.sha256) { return false; }
    const source = git(['show', `${artifact.source.sourceCommit}:${file}`], { cwd: rootDir });
    if (source.status !== 0 || source.stdout !== content) { return false; }
    const current = mission.checkpoints.map(checkpoint => ({
      missionId: checkpoint.missionId, name: checkpoint.name,
      rawFilename: checkpoint.rawFilename ?? null, firstLine: checkpoint.firstLine ?? null,
      goalCheck: checkpoint.goalCheck, nextActionText: checkpoint.nextActionText,
    }));
    return isDeepStrictEqual(current, artifact.recordedCheckpoints);
  } catch { return false; }
}

/** Read historical mission text from a committed artifact that survives cleanup. */
export function readLegacyMissionContent(
  slug: string,
  rootDir: string,
): { content: string | null; error: string | null } {
  const archived = readArchivedMissionText(slug, rootDir, 'mission-documents.json', 'MISSION.md');
  return archived.content && isLegacyMissionTemplate(archived.content)
    ? { content: null, error: null } : archived;
}

/** Discrepant closed-review snapshots remain visible beside current Review state. */
export function readLegacyReviewSnapshot(
  slug: string,
  rootDir: string,
): { content: string | null; error: string | null } {
  return readArchivedMissionText(slug, rootDir, 'review-state-discrepancies.json', 'review-state.json');
}

function readArchivedMissionText(slug: string, rootDir: string, archiveFile: string, sourceFile: string) {
  try { missionId(slug); }
  catch { return { content: null, error: `Invalid historical Mission identity: ${slug}` }; }
  const name = `missions/task-2521.06/artifacts/${archiveFile}`;
  const file = path.join(rootDir, name);
  if (!fs.existsSync(file)) { return { content: null, error: null }; }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const committed = git(['show', `HEAD:${name}`], { cwd: rootDir, maxBuffer: 16 * 1024 * 1024 });
    if (committed.status !== 0 || committed.stdout !== raw) {
      return { content: null, error: 'Committed historical Mission archive differs from the working tree' };
    }
    const archive = JSON.parse(raw) as { entries?: { file: string; sha256: string; content: string }[] };
    const entries = archive.entries?.filter(entry => entry.file === `missions/${slug}/${sourceFile}`);
    if (!entries?.length) { return { content: null, error: null }; }
    if (entries.length !== 1 || createHash('sha256').update(entries[0].content).digest('hex') !== entries[0].sha256) {
      return { content: null, error: `Historical Mission archive has no verified document for ${slug}` };
    }
    return { content: entries[0].content, error: null };
  } catch (error) {
    return { content: null, error: `Historical Mission archive unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
