import { replaceSuccessCriteria } from '../../domain/mission-success-criteria.js';
/**
 * Legacy import companions: carry a legacy task's documents, review
 * launches, reviews, and NEL onto the imported Mission.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseLegacyMissionDocument } from './legacy-mission-document.js';
import { classifyNelBucket, type NelBucketLabel } from '../../domain/net-engineering-lines.js';
import { backfillReviewFromLegacyState } from '../review/review-state.js';
import { stageLaunchWindowsFrom } from '../../domain/review.js';
import { missionId, type MissionId, type Mission } from '../../domain/mission.js';
import { type MissionImportServices, type LegacyImportOptions } from './legacy-import-types.js';
import { relative, sourceMatchesCommit } from './legacy-record-source.js';

/** Fill empty typed contract fields from committed historical documents. */
export async function importLegacyMissionDocuments(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const directory = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(directory)) { return 0; }
  let changed = 0;
  const context: CompanionImportContext = { services, options, commit, conflicts };
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    changed += await importMissionDocument(context, entry, directory);
  }
  return changed;
}

/** Retain launch fingerprints omitted by older Review imports. */
export async function importLegacyReviewLaunches(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const root = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(root)) { return 0; }
  let count = 0;
  const context: CompanionImportContext = { services, options, commit, conflicts };
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    count += await importReviewLaunchFile(context, entry, root);
  }
  return count;
}

/** Reuse the existing explicit review backfill, with source pinning for this one-shot import. */
export async function importLegacyReviews(
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
export async function importLegacyNel(
  services: MissionImportServices,
  options: LegacyImportOptions,
  commit: string | null,
  conflicts: string[],
): Promise<number> {
  const root = path.join(options.rootDir, 'missions');
  if (!fs.existsSync(root)) { return 0; }
  let count = 0;
  const context: CompanionImportContext = { services, options, commit, conflicts };
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    count += await importNelFile(context, entry, root);
  }
  return count;
}

interface CompanionImportContext { services: MissionImportServices; options: LegacyImportOptions; commit: string | null; conflicts: string[]; }

async function importMissionDocument(context: CompanionImportContext, entry: fs.Dirent, directory: string): Promise<number> {
  const { services, options, commit, conflicts } = context;

  if (!entry.isDirectory()) { return 0; }
  const file = path.join(directory, entry.name, 'MISSION.md');
  if (!fs.existsSync(file)) { return 0; }
  if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, file, commit)) {
    conflicts.push(`${relative(options.rootDir, file)}: source differs from pinned Git commit`);
    return 0;
  }
  let id: MissionId;
  try { id = missionId(entry.name); } catch { return 0; }
  const read = await services.store.load(id);
  if (read.kind !== 'found' || read.mission.repositoryId !== services.repositoryId) { return 0; }
  const parsed = parseLegacyMissionDocument(fs.readFileSync(file, 'utf8'));
  const mission = read.mission;
  const values = legacyMissionDocumentValues(mission, id, parsed);
  const { brief, success, gates, predicted, reproduction, checkpoints } = values;
  if (legacyDocumentIsRepresented(mission, values)) { return 0; }

  if (options.dryRun) { return 1; }
  try {
    await services.store.save({
      ...replaceSuccessCriteria(mission, success ?? []), brief,
      declaredGates: gates, predictedNelBucket: predicted, reproductionTest: reproduction,
      checkpoints
    }, read.version);
  } catch (error) {

    conflicts.push(`${id}: historical Mission contract write refused (${error instanceof Error ? error.message : String(error)})`);

    return 0;
  }

  return 1;
}

async function importReviewLaunchFile(context: CompanionImportContext, entry: fs.Dirent, root: string): Promise<number> {
  const { services, options, commit, conflicts } = context;

  const file = path.join(root, entry.name, 'review-state.json');
  if (!fs.existsSync(file)) { return 0; }
  if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, file, commit)) {
    conflicts.push(`${relative(options.rootDir, file)}: review state differs from pinned Git commit`); return 0;
  }
  let state: { metadata?: { recordedStageLaunches?: unknown } };
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof state; }
  catch { conflicts.push(`${relative(options.rootDir, file)}: review state is invalid JSON`); return 0; }
  const launches = stageLaunchWindowsFrom(state.metadata?.recordedStageLaunches);
  if (launches.length === 0) { return 0; }
  const read = await services.store.load(missionId(entry.name));
  if (read.kind !== 'found' || !read.mission.review || read.mission.repositoryId !== services.repositoryId) {
    conflicts.push(`${relative(options.rootDir, file)}: owning Review is missing`); return 0;
  }
  if (read.mission.review.stageLaunches.length > 0) { return 0; }

  if (options.dryRun) { return 1; }
  try {
    await services.store.save({
      ...read.mission,
      review: { ...read.mission.review, stageLaunches: launches },
    }, read.version);
  } catch (error) {

    conflicts.push(`${relative(options.rootDir, file)}: launch history import refused (${error instanceof Error ? error.message : String(error)})`);

    return 0;
  }

  return 1;
}

async function importNelFile(context: CompanionImportContext, entry: fs.Dirent, root: string): Promise<number> {
  const { services, options, commit, conflicts } = context;

  const file = path.join(root, entry.name, 'nel-record.json');
  if (!fs.existsSync(file)) { return 0; }
  const name = relative(options.rootDir, file);
  if (options.commit === undefined && !sourceMatchesCommit(options.rootDir, file, commit)) {
    conflicts.push(`${name}: NEL source differs from pinned Git commit`);
    return 0;
  }
  const parsed = readLegacyNelRecord(file, name, entry.name, conflicts);
  if (!parsed) { return 0; }
  const { record, predicted } = parsed;
  let id: MissionId;
  try { id = missionId(entry.name); }
  catch { conflicts.push(`${name}: invalid Mission identity`); return 0; }
  const read = await services.store.load(id);
  if (read.kind !== 'found' || read.mission.repositoryId !== services.repositoryId) {
    conflicts.push(`${name}: owning Mission is missing`);
    return 0;
  }
  const mission = read.mission;
  if (legacyNelConflicts(mission, record.actualNel, predicted)) {
    conflicts.push(`${name}: Mission measurement disagrees with legacy NEL record`);
    return 0;
  }
  if (legacyNelIsRepresented(mission, predicted)) { return 0; }

  if (options.dryRun) { return 1; }
  try {
    await services.store.save({
      ...mission,
      netEngineeringLines: record.actualNel as number,
      predictedNelBucket: (predicted as NelBucketLabel | null) ?? mission.predictedNelBucket,
    }, read.version);
  } catch (error) {

    conflicts.push(`${name}: NEL import refused (${error instanceof Error ? error.message : String(error)})`);

    return 0;
  }

  return 1;
}

type ParsedMissionDocument = ReturnType<typeof parseLegacyMissionDocument>;
function legacyMissionDocumentContent(mission: Mission, parsed: ParsedMissionDocument) {
  const brief = mission.brief ?? parsed.brief ?? null;
  const success = mission.successCriteria?.length ? mission.successCriteria : (parsed.successCriteria ?? mission.successCriteria ?? []);
  const gates = mission.declaredGates?.length ? mission.declaredGates : (parsed.declaredGates ?? mission.declaredGates ?? []);
  return { brief, success, gates };
}
function legacyMissionDocumentMetadata(mission: Mission, parsed: ParsedMissionDocument) {
  const predicted = mission.predictedNelBucket ?? parsed.predictedNelBucket ?? null;
  const reproduction = mission.reproductionTest ?? parsed.reproductionTest ?? null;
  return { predicted, reproduction };
}
function legacyMissionCheckpointPlan(mission: Mission, id: MissionId, parsed: ParsedMissionDocument) {
  const checkpoints = [...mission.checkpoints];
  for (const planned of parsed.checkpoints) {
    if (checkpoints.some(cp => cp.name === planned.name)) { continue; }
    checkpoints.push({
      missionId: id, name: planned.name, firstLine: planned.description,
      goalCheck: [], nextActionText: ''
    });
  }
  checkpoints.sort((a, b) => Number(a.name.slice(3)) - Number(b.name.slice(3)));
  return checkpoints;
}
function legacyMissionDocumentValues(mission: Mission, id: MissionId, parsed: ParsedMissionDocument) {
  const content = legacyMissionDocumentContent(mission, parsed);
  const metadata = legacyMissionDocumentMetadata(mission, parsed);
  return { ...content, ...metadata, checkpoints: legacyMissionCheckpointPlan(mission, id, parsed) };
}
function legacyDocumentIsRepresented(mission: Mission, values: ReturnType<typeof legacyMissionDocumentValues>): boolean {
  const { brief, success, gates, predicted, reproduction, checkpoints } = values;
  return brief === (mission.brief ?? null) && success === mission.successCriteria
    && gates === mission.declaredGates && predicted === (mission.predictedNelBucket ?? null)
    && reproduction === (mission.reproductionTest ?? null)
    && checkpoints.length === mission.checkpoints.length;
}

interface LegacyNelRecord { slug?: unknown; actualNel?: unknown; predictedBucket?: unknown; actualBucket?: unknown; }
function readLegacyNelRecord(file: string, name: string, slug: string, conflicts: string[]): { record: LegacyNelRecord; predicted: unknown } | null {
  let record: LegacyNelRecord;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof record; }
  catch { conflicts.push(`${name}: NEL record is invalid JSON`); return null; }
  if (record.slug !== slug || !Number.isInteger(record.actualNel)
    || Number(record.actualNel) < 0
    || classifyNelBucket(Number(record.actualNel)).label !== record.actualBucket) {
    conflicts.push(`${name}: NEL record has invalid identity or measurement`);
    return null;
  }
  const predicted = record.predictedBucket === 'Unknown' ? null : record.predictedBucket;
  if (predicted !== null && !['Small', 'Medium', 'Large'].includes(String(predicted))) {
    conflicts.push(`${name}: NEL prediction is invalid`);
    return null;
  }
  return { record, predicted };
}
function legacyNelConflicts(mission: Mission, actualNel: unknown, predicted: unknown): boolean {
  return (mission.netEngineeringLines !== null && mission.netEngineeringLines !== actualNel)
    || (predicted !== null && mission.predictedNelBucket !== null && mission.predictedNelBucket !== predicted);
}

function legacyNelIsRepresented(mission: Mission, predicted: unknown): boolean {
  return mission.netEngineeringLines !== null && (predicted === null || mission.predictedNelBucket !== null);
}
