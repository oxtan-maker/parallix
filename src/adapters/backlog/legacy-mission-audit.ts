import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Mission } from '../../domain/mission.js';
import { missionId } from '../../domain/mission.js';
import { compareCodeUnits } from '../../domain/comparators.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { RepositoryId } from '../../domain/repository.js';
import { parseTaskFrontmatterValue } from './task-file-io.js';
import { parseCheckpointDocument, reconcileLegacyCheckpoint } from './checkpoint-document.js';
import { isLegacyMissionTemplate, parseLegacyMissionDocument } from './legacy-mission-document.js';
import { readLegacyTaskContent } from './legacy-task-content.js';
import { hasApprovedCheckpointException } from './legacy-mission-content.js';
import { classifyNelBucket } from '../../domain/net-engineering-lines.js';
import { readExportedReviewEvents } from '../review/review-state.js';
import { reviewStateDataFrom } from '../review/review-state-mapping.js';
import { stageLaunchWindowsFrom } from '../../domain/review.js';
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
  store: MissionStore,
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
  let unparsed = 0;
  let missingTasks = 0;
  let verificationFailures = 0;
  const identityTitles = new Map<string, string[]>();
  for (const file of files.sort(compareCodeUnits)) {
    const name = path.relative(rootDir, file).split(path.sep).join('/');
    const content = fs.readFileSync(file, 'utf8');
    const sha256 = digest(content);
    let classification: LegacyFileClass = 'UNRESOLVED';
    let reason = 'No proven Mission representation or retained artifact classification';
    if (/^backlog\/(?:tasks|completed|archive)\/.*\.md$/.test(name)) {
      const id = parseTaskFrontmatterValue(content, 'id')?.trim().toUpperCase();
      if (!id) { unparsed += 1; reason = 'Task identity is missing'; }
      else {
        const title = parseTaskFrontmatterValue(content, 'title')?.trim() ?? '';
        identityTitles.set(id, [...(identityTitles.get(id) ?? []), title]);
        const mission = missions.get(id.toLowerCase());
        if ((!mission || mission.status === 'backlog') && name.startsWith('backlog/tasks/')
          && parseTaskFrontmatterValue(content, 'status')?.trim().toLowerCase() === 'backlog') {
          classification = 'retained product/configuration';
          reason = `Unstarted backlog input retained in place; no Mission required for ${id}`;
        }
        else if (!mission) { missingTasks += 1; reason = `No Mission for ${id}`; }
        else if (!mission.externalTaskRef) {
          classification = 'retained product/configuration';
          reason = `Native Mission backlog input retained in place; no legacy import trace required for ${id}`;
        }
        else if (mission.externalTaskRef?.id !== id) { reason = `Mission ${id} has no matching source trace`; }
        else {
          const pinned = readLegacyTaskContent(mission.externalTaskRef, rootDir);
          if (pinned.error) { verificationFailures += 1; reason = pinned.error; }
          else if (pinned.content !== content && name.startsWith('backlog/archive/')
            && mission.externalTaskRef.url?.startsWith('backlog/completed/')) {
            classification = 'obsolete';
            reason = `Archived copy is superseded by the pinned completed body for ${id}`;
          }
          else if (pinned.content !== content) { reason = 'This copy differs from the pinned task artifact'; }
          else {
            classification = name.startsWith('backlog/tasks/') ? 'retained product/configuration' : 'imported Mission';
            reason = name.startsWith('backlog/tasks/')
              ? `Current Backlog title source and lifecycle mirror retained; pinned artifact matches ${id} byte for byte`
              : `Pinned artifact matches ${id} byte for byte`;
          }
        }
      }
    } else if (/^missions\/[^/]+\/CP-[0-9]+\.md$/.test(name)) {
      const slug = name.split('/')[1];
      const mission = missions.get(slug);
      try {
        const parsed = parseCheckpointDocument(missionId(slug), path.basename(name), content);
        const recorded = mission?.checkpoints.find(checkpoint => checkpoint.name === parsed.name);
        if (mission && hasApprovedCheckpointException(rootDir, mission, name, content)) {
          classification = 'retained external artifact';
          reason = 'Operator-approved historical final summary preserved; typed checkpoint phases remain authoritative';
        }
        else if (!recorded) { reason = `Mission ${slug} lacks ${parsed.name}`; }
        else {
          const merged = reconcileLegacyCheckpoint(recorded, parsed);
          if (merged && JSON.stringify(merged) === JSON.stringify(recorded)) {
            classification = 'identical Mission'; reason = `Parsed checkpoint is represented by ${slug} aggregate`;
          } else {
            verificationFailures += 1;
            reason = merged ? `Parsed ${parsed.name} has data missing from ${slug} aggregate`
              : `Parsed ${parsed.name} disagrees with ${slug} aggregate`;
          }
        }
      } catch (error) { unparsed += 1; reason = error instanceof Error ? error.message : String(error); }
    } else if (/^missions\/[^/]+\/CP-[^/]+\.md$/.test(name)) {
      const preserved = nonstandardCheckpoints.get(name);
      if (preserved?.sha256 === sha256 && preserved.content === content) {
        classification = 'retained external artifact';
        reason = 'Full nonstandard checkpoint preserved outside the retired workflow tree';
      } else {
        unparsed += 1;
        reason = 'Nonstandard checkpoint has no verified preservation artifact';
      }
    } else if (name.endsWith('/MISSION.md')) {
      const preserved = missionDocuments.get(name);
      if (isLegacyMissionTemplate(content)) {
        classification = 'obsolete';
        reason = 'Placeholder scaffold has no contract; typed Mission state remains authoritative';
      } else if (preserved?.sha256 === sha256 && preserved.content === content) {
        const mission = missions.get(name.split('/')[1]);
        const parsed = parseLegacyMissionDocument(content);
        const missing = [
          parsed.brief && !mission?.brief ? 'brief' : null,
          parsed.successCriteria?.length && !mission?.successCriteria?.length ? 'success criteria' : null,
          parsed.declaredGates?.length && !mission?.declaredGates?.length ? 'gates' : null,
          parsed.predictedNelBucket && !mission?.predictedNelBucket ? 'NEL prediction' : null,
          parsed.reproductionTest && !mission?.reproductionTest ? 'reproduction test' : null,
          ...parsed.checkpoints.filter(cp => !mission?.checkpoints.some(recorded => recorded.name === cp.name))
            .map(cp => cp.name),
        ].filter(Boolean);
        if (missing.length) {
          verificationFailures += 1;
          reason = `Valid typed fields absent from Mission: ${missing.join(', ')}`;
        } else {
          classification = 'retained external artifact';
          const superseded = [
            parsed.brief && mission?.brief && !isDeepStrictEqual(parsed.brief, mission.brief) ? 'brief' : null,
            parsed.successCriteria && mission?.successCriteria?.length
              && !isDeepStrictEqual(parsed.successCriteria, mission.successCriteria) ? 'success criteria' : null,
            parsed.declaredGates && mission?.declaredGates?.length
              && !isDeepStrictEqual(parsed.declaredGates, mission.declaredGates) ? 'gates' : null,
            parsed.predictedNelBucket && mission?.predictedNelBucket !== parsed.predictedNelBucket ? 'NEL prediction' : null,
            parsed.reproductionTest && mission?.reproductionTest !== parsed.reproductionTest ? 'reproduction test' : null,
          ].filter(Boolean);
          reason = superseded.length
            ? `Historical text queryable through status; current Mission supersedes ${superseded.join(', ')}`
            : 'Historical text queryable through status; valid typed fields represented by Mission';
        }
      } else {
        unparsed += 1; reason = 'Mission document has no verified preservation artifact';
      }
    } else if (name.includes('/review-events/')) {
      const slug = name.split('/')[1];
      const dir = path.join(rootDir, 'missions', slug, 'review-events');
      const filenames = fs.readdirSync(dir).filter(file => file.endsWith('.md')).sort(compareCodeUnits);
      const exported = readExportedReviewEvents(slug, rootDir);
      const index = filenames.indexOf(path.basename(name));
      const recorded = missions.get(slug)?.review?.reviewEvents[index];
      if (index < 0 || exported.length !== filenames.length) {
        unparsed += 1; reason = 'Review event export did not parse one event per file';
      } else if (recorded && isDeepStrictEqual(recorded, exported[index])) {
        classification = 'identical Mission'; reason = `Parsed review event matches ${slug} aggregate at position ${index}`;
      } else { verificationFailures += 1; reason = `Review event differs from ${slug} aggregate at position ${index}`; }
    } else if (name.endsWith('/review-state.json')) {
      try {
        const state = JSON.parse(content) as Record<string, unknown>;
        const slug = name.split('/')[1];
        const mission = missions.get(slug);
        if (!mission?.review || !state || typeof state !== 'object') {
          verificationFailures += 1; reason = `Review state has no ${slug} aggregate counterpart`;
        } else {
          const current = reviewStateDataFrom(mission.review) as Record<string, unknown>;
          const fields = ['reviewer', 'implementer', 'round', 'startedAt', 'phase', 'disposition'];
          const changed = fields.filter(field => (state[field] ?? null) !== (current[field] ?? null));
          const metadata = state.metadata as Record<string, unknown> | undefined;
          const launches = stageLaunchWindowsFrom(metadata?.recordedStageLaunches);
          if (changed.length === 0 && isDeepStrictEqual(launches, mission.review.stageLaunches)) {
            classification = 'identical Mission'; reason = `Review state and launch history match ${slug} aggregate`;
          } else if (mission.status === 'done'
            && reviewStateDiscrepancies.get(name)?.sha256 === sha256
            && reviewStateDiscrepancies.get(name)?.content === content) {
            classification = 'retained external artifact';
            reason = `Closed Mission ${slug} has a distinct historical review snapshot preserved outside the retired tree`;
          } else {
            verificationFailures += 1;
            reason = `Review state differs from ${slug} aggregate (${[...changed, ...(!isDeepStrictEqual(launches, mission.review.stageLaunches) ? ['stage launches'] : [])].join(', ')})`;
          }
        }
      } catch { unparsed += 1; reason = 'Review state is invalid JSON'; }
    } else if (name.endsWith('/nel-record.json')) {
      try {
        const record = JSON.parse(content) as { slug?: string; actualNel?: number; actualBucket?: string; predictedBucket?: string };
        const slug = name.split('/')[1];
        const mission = missions.get(slug);
        if (record.slug !== slug || !Number.isInteger(record.actualNel) || Number(record.actualNel) < 0
          || classifyNelBucket(Number(record.actualNel)).label !== record.actualBucket
          || !['Small', 'Medium', 'Large', 'Unknown'].includes(String(record.predictedBucket))) {
          unparsed += 1; reason = 'NEL record identity, bucket, or measurement is invalid';
        } else if (mission && mission.netEngineeringLines === record.actualNel
          && (record.predictedBucket === 'Unknown' || mission.predictedNelBucket === record.predictedBucket)) {
          classification = 'identical Mission'; reason = `NEL measurement and prediction match ${slug} aggregate`;
        } else { verificationFailures += 1; reason = `NEL record differs from ${slug} aggregate`; }
      } catch { unparsed += 1; reason = 'NEL record is invalid JSON'; }
    } else if (retainedArtifacts.get(name)?.sha256 === sha256
      && retainedArtifacts.get(name)?.content === content) {
      classification = 'retained external artifact'; reason = 'Full historical artifact preserved outside the retired workflow tree';
    } else if (name === 'backlog.md') {
      unparsed += 1; reason = 'Root backlog document has no verified retained artifact';
    } else if (name.startsWith('missions/') && name.includes('/artifacts/')) {
      classification = 'retained external artifact'; reason = 'Mission artifact retained in repository';
    }
    findings.push({ path: name, classification, reason, sha256 });
  }
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
