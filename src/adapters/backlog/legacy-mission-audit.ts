import { LegacyFileClassifier } from './legacy-file-classifier.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { Mission } from '../../domain/mission.js';

import { compareCodeUnits } from '../../domain/comparators.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { RepositoryId } from '../../domain/repository.js';

import { git } from '../git/git.js';

export type LegacyFileClass = 'imported Mission' | 'identical Mission' | 'retained product/configuration'
  | 'retained external artifact' | 'obsolete' | 'UNRESOLVED';

export interface LegacyFileFinding {
  readonly path: string;
  readonly classification: LegacyFileClass;
  readonly reason: string;
  readonly sha256: string;
}

export interface LegacyFileAudit {
  readonly files: readonly LegacyFileFinding[];
  readonly counters: {
    readonly unresolvedLegacyFiles: number;
    readonly unparsedDataBearingFiles: number;
    readonly conflictingDuplicateRecords: number;
    readonly normalRuntimeReadersOfRetiredPaths: number;
    readonly normalRuntimeWritersOfRetiredPaths: number;
    readonly requiredMissionContextMissing: number;
    readonly requiredTaskRecordsMissing: number;
    readonly migrationVerificationFailures: number;
  };
  readonly verdict: 'GO' | 'NO-GO';
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) { return []; }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
  });
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Backlog intake/title reads and lifecycle mirrors are retained provider use. */
function runtimeRetiredPathCounts(rootDir: string) {
  const sources = walk(path.join(rootDir, 'src')).filter(file => file.endsWith('.ts'));
  let readers = 0;
  let writers = 0;
  for (const file of sources) {
    const relative = path.relative(rootDir, file).split(path.sep).join('/');
    if (relative.startsWith('src/adapters/backlog/legacy-')
      || relative === 'src/adapters/backlog/concrete-mission-read-adapter.ts') { continue; }
    const code = fs.readFileSync(file, 'utf8').split('\n')
      .filter(line => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n');
    // The retired materializer reads completed catalogs and checkpoint files.
    if (/\bConcreteMissionReadAdapter\b|concrete-mission-read-adapter/.test(code)) { readers += 1; }
    // ponytail: lexical write check; the static-analysis workflow-path guard
    // owns indirect path regressions and is a mandatory mission gate.
    const writes = code.matchAll(/\b(?:writeFileSync|writeFile|appendFileSync|writeText)\s*\(([^;]+)/g);
    for (const write of writes) {
      if (/MISSION\.md|CP-.*\.md|review-state\.json|review-events|mission(?:File|Document)|checkpoint(?:File|Path|Document)/i.test(write[1])) {
        writers += 1;
      }
    }
  }
  return { normalRuntimeReadersOfRetiredPaths: readers, normalRuntimeWritersOfRetiredPaths: writers };
}

function stoppedMissionIds(rootDir: string): Set<string> {
  const name = 'missions/task-2521.06/artifacts/stopped-missions.json';
  const file = path.join(rootDir, name);
  if (!fs.existsSync(file)) { return new Set(); }
  const content = fs.readFileSync(file, 'utf8');
  const committed = git(['show', `HEAD:${name}`], { cwd: rootDir });
  if (committed.status !== 0 || committed.stdout !== content) { return new Set(); }
  try {
    const decisions = JSON.parse(content) as { id: string; reason: string }[];
    if (!Array.isArray(decisions) || decisions.some(decision => !/^task-\d+$/.test(decision.id) || !decision.reason?.trim())) { return new Set(); }
    return new Set(decisions.map(decision => decision.id));
  } catch { return new Set(); }
}

/** Full text of historical files that cannot become current Mission fields. */
function preservedExternalFiles(
  rootDir: string,
  name: string,
  allowed: (_file: string) => boolean,
): Map<string, { sha256: string; content: string }> {
  const file = path.join(rootDir, name);
  if (!fs.existsSync(file)) { return new Map(); }
  const content = fs.readFileSync(file, 'utf8');
  const committed = git(['show', `HEAD:${name}`], { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 });
  if (committed.status !== 0 || committed.stdout !== content) { return new Map(); }
  try {
    const archive = JSON.parse(content) as { sourceCommit: string; entries: { file: string; sha256: string; content: string; sourceCommit?: string }[] };
    if (!/^[a-f0-9]{40,64}$/.test(archive.sourceCommit) || !Array.isArray(archive.entries)) { return new Map(); }
    const entries = new Map<string, { sha256: string; content: string }>();
    for (const entry of archive.entries) {
      if (!allowed(entry.file)
        || entries.has(entry.file)
        || digest(entry.content) !== entry.sha256) { return new Map(); }
      const pinned = entry.sourceCommit ?? archive.sourceCommit;
      if (!/^[a-f0-9]{40,64}$/.test(pinned)) { return new Map(); }
      const source = git(['show', `${pinned}:${entry.file}`], { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 });
      if (source.status !== 0 || source.stdout !== entry.content) { return new Map(); }
      entries.set(entry.file, entry);
    }
    return entries;
  } catch { return new Map(); }
}

/** Conservative inventory: a file is unresolved until its data is proven represented. */
export async function auditLegacyFiles(
  rootDir: string,
  repositoryId: RepositoryId,
  store: Pick<MissionStore, 'loadByRepository'>,
): Promise<LegacyFileAudit> {
  if (!store.loadByRepository) { throw new Error('Mission store cannot enumerate repository records'); }
  const missions = new Map<string, Mission>((await store.loadByRepository(repositoryId)).map(mission => [mission.id, mission]));
  const nonstandardCheckpoints = preservedExternalFiles(rootDir,
    'missions/task-2521.06/artifacts/nonstandard-checkpoints.json',
    file => /^missions\/[^/]+\/CP-[^/]+\.md$/.test(file) && !/^missions\/[^/]+\/CP-\d+\.md$/.test(file));
  const retainedArtifacts = preservedExternalFiles(rootDir,
    'missions/task-2521.06/artifacts/retained-mission-artifacts.json',
    file => file === 'backlog.md' || /^missions\/[^/]+\/(?!MISSION\.md$|CP-[^/]+\.md$|review-state\.json$|nel-record\.json$|review-events\/)[^/]+(?:\/[^/]+)*$/.test(file));
  const missionDocuments = preservedExternalFiles(rootDir,
    'missions/task-2521.06/artifacts/mission-documents.json',
    file => /^missions\/[^/]+\/MISSION\.md$/.test(file));
  const reviewStateDiscrepancies = preservedExternalFiles(rootDir,
    'missions/task-2521.06/artifacts/review-state-discrepancies.json',
    file => /^missions\/[^/]+\/review-state\.json$/.test(file));
  const roots = ['missions', 'backlog/tasks', 'backlog/completed', 'backlog/archive'];
  const files = roots.flatMap(root => walk(path.join(rootDir, root)));
  if (fs.existsSync(path.join(rootDir, 'backlog.md'))) { files.push(path.join(rootDir, 'backlog.md')); }
  const findings: LegacyFileFinding[] = [];
  const classifier = new LegacyFileClassifier({ rootDir, missions, nonstandardCheckpoints, retainedArtifacts, missionDocuments, reviewStateDiscrepancies });
  for (const file of files.sort(compareCodeUnits)) {
    const name = path.relative(rootDir, file).split(path.sep).join('/');
    const content = fs.readFileSync(file, 'utf8');
    findings.push(classifier.classify({ name, content, sha256: digest(content) }));
  }
  const { unparsed, missingTasks, verificationFailures, identityTitles } = classifier;
  const conflictingDuplicateRecords = [...identityTitles.values()]
    .filter(titles => new Set(titles).size > 1).length;
  const stopped = stoppedMissionIds(rootDir);
  const requiredMissionContextMissing = [...missions.values()].filter(mission =>
    ['active', 'review', 'integration'].includes(mission.status)
    && (!mission.brief || !mission.successCriteria?.length || !mission.checkpoints.length)
    && !(stopped.has(mission.id) && mission.status === 'review'
      && mission.review?.rounds.at(-1)?.disposition === 'BLOCKED')).length;
  const counters = {
    unresolvedLegacyFiles: findings.filter(finding => finding.classification === 'UNRESOLVED').length,
    unparsedDataBearingFiles: unparsed,
    conflictingDuplicateRecords,
    ...runtimeRetiredPathCounts(rootDir),
    requiredMissionContextMissing,
    requiredTaskRecordsMissing: missingTasks,
    migrationVerificationFailures: verificationFailures,
  };
  return { files: findings, counters, verdict: Object.values(counters).every(value => value === 0) ? 'GO' : 'NO-GO' };
}
