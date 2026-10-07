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
import { missionId, type MissionId } from '../../domain/mission.js';
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
export async function importLegacyReviewLaunches(
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

