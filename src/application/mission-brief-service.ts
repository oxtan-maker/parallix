/**
 * Mission brief and declared-gate writes.
 *
 * Two small concepts, one service, because they share nothing but the store:
 * the brief says what the mission is for, the gates say what judges it. Neither
 * is a generic Mission patch — `setBrief` takes the brief's own fields and
 * `setGates` takes a validated command list, so there is no shape through here
 * that could carry an arbitrary field.
 *
 * Both preserve the rest of the Mission and both go through the versioned
 * store save, so a stale write is rejected rather than silently winning.
 */

import type { ApplicationOutcome } from './contracts.js';
import { completed, failure } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { isLoaded, loadForCommand, missingCapability, storeEvidence, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import { missionBrief, type MissionBrief } from '../domain/mission-brief.js';
import { declaredGates } from '../domain/mission-gates.js';
import { successCriteria } from '../domain/mission-success-criteria.js';
import { missionDependencies } from '../domain/mission-dependencies.js';
import type { NelBucketLabel } from '../domain/net-engineering-lines.js';
import type { CheckpointData } from '../domain/checkpoint.js';
import { missionLabel, type MissionId } from '../domain/mission.js';

export const MISSION_CLASSIFICATIONS = ['ai_sdlc', 'user_value', 'unknown'] as const;
export type MissionClassification = typeof MISSION_CLASSIFICATIONS[number];

/** Named partial brief update: omitted fields keep their recorded value. */
export interface UpdateMissionBriefRequest extends MissionCommandRequest {
  readonly patch: Partial<MissionBrief>;
}
export interface SetMissionGatesRequest extends MissionCommandRequest {
  readonly gates: readonly string[];
}
export interface SetSuccessCriteriaRequest extends MissionCommandRequest {
  readonly criteria: readonly string[];
}
export interface MissionSuccessCriteriaResult {
  readonly successCriteria: readonly string[];
  readonly version: MissionVersion;
}
export interface SetMissionDependenciesRequest extends MissionCommandRequest {
  /** The complete recorded list; the CLI reads, edits and writes it back. */
  readonly dependencies: readonly string[];
}
export interface MissionDependenciesResult {
  readonly dependencies: readonly MissionId[];
  readonly version: MissionVersion;
}
export interface SetPredictedNelBucketRequest extends MissionCommandRequest {
  readonly bucket: NelBucketLabel;
}
export interface MissionPredictedNelBucketResult {
  readonly predictedNelBucket: NelBucketLabel;
  readonly version: MissionVersion;
}
export interface SetReproductionTestRequest extends MissionCommandRequest {
  /** Path to the red-to-green test, or null to clear it. */
  readonly testPath: string | null;
}
export interface MissionReproductionTestResult {
  readonly reproductionTest: string | null;
  readonly version: MissionVersion;
}
export interface MissionBriefResult {
  readonly brief: MissionBrief;
  readonly version: MissionVersion;
}
export interface MissionGatesResult {
  readonly declaredGates: readonly string[];
  readonly version: MissionVersion;
}
export interface SetMissionClassificationRequest extends MissionCommandRequest { readonly classification: string; }
export interface MissionClassificationResult { readonly classification: MissionClassification; readonly version: MissionVersion; }

export class MissionBriefService {
  constructor(private readonly _store: MissionStore) {}

  /**
   * Record or refine the brief.
   *
   * A Mission with no brief is created by the first patch that supplies both
   * `goal` and `why`; there is no separate create command, because a brief with
   * a goal and a reason is already a valid brief.
   */
  async update(request: UpdateMissionBriefRequest): Promise<ApplicationOutcome<MissionBriefResult>> {
    const guard = missingCapability<MissionBriefResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionBriefResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    const current = loaded.mission.brief ?? null;
    const merged = { scope: null, outOfScope: [], ...(current ?? {}), ...request.patch } as MissionBrief;
    if (!current && (request.patch.goal === undefined || request.patch.why === undefined)) {
      return failure('validation', `mission ${request.missionId} has no brief yet; the first write must set both --goal and --why`);
    }
    let brief: MissionBrief;
    try { brief = missionBrief(merged); } catch (error) { return failure('validation', error instanceof Error ? error.message : 'invalid mission brief'); }
    try {
      const version = await this._store.save({ ...loaded.mission, brief }, loaded.version);
      return completed({ brief, version }, [storeEvidence(request.missionId, 'mission-brief', current ? 'mission brief updated' : 'mission brief recorded')]);
    } catch (error) { return writeFailure(error); }
  }

  async read(request: MissionCommandRequest): Promise<ApplicationOutcome<MissionBriefResult>> {
    const guard = missingCapability<MissionBriefResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionBriefResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    return loaded.mission.brief
      ? completed({ brief: loaded.mission.brief, version: loaded.version })
      : failure('unavailable', `mission ${request.missionId} has no recorded brief`);
  }

  /** Replace the declared gates. The caller adds or removes; the domain validates the result. */
  async setGates(request: SetMissionGatesRequest): Promise<ApplicationOutcome<MissionGatesResult>> {
    const guard = missingCapability<MissionGatesResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionGatesResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    let gates: readonly string[];
    try { gates = declaredGates(request.gates); } catch (error) { return failure('validation', error instanceof Error ? error.message : 'invalid declared gates'); }
    try {
      const version = await this._store.save({ ...loaded.mission, declaredGates: gates }, loaded.version);
      return completed({ declaredGates: gates, version }, [storeEvidence(request.missionId, 'declared-gates', `${gates.length} declared gate(s) recorded`)]);
    } catch (error) { return writeFailure(error); }
  }

  /** Replace the success criteria. The caller adds or removes; the domain validates the result. */
  async setSuccessCriteria(request: SetSuccessCriteriaRequest): Promise<ApplicationOutcome<MissionSuccessCriteriaResult>> {
    const guard = missingCapability<MissionSuccessCriteriaResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionSuccessCriteriaResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    let criteria: readonly string[];
    try { criteria = successCriteria(request.criteria); } catch (error) { return failure('validation', error instanceof Error ? error.message : 'invalid success criteria'); }
    try {
      const version = await this._store.save({ ...loaded.mission, successCriteria: criteria }, loaded.version);
      return completed({ successCriteria: criteria, version }, [storeEvidence(request.missionId, 'success-criteria', `${criteria.length} success criteria recorded`)]);
    } catch (error) { return writeFailure(error); }
  }

  /**
   * Record which Missions this Mission depends on.
   *
   * Every entry must resolve to a Mission, so a reference to something that is
   * not a Mission is refused here rather than recorded as a dangling id. The
   * domain refuses a self-reference and a duplicate. Nothing consumes the
   * result: it is recorded for the operator and the agent to read.
   */
  async setDependencies(request: SetMissionDependenciesRequest): Promise<ApplicationOutcome<MissionDependenciesResult>> {
    const guard = missingCapability<MissionDependenciesResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionDependenciesResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    let dependencies: readonly MissionId[];
    try { dependencies = missionDependencies(request.dependencies, request.missionId); } catch (error) { return failure('validation', error instanceof Error ? error.message : 'invalid mission dependencies'); }
    for (const dependency of dependencies) {
      const read = await this._store.load(dependency);
      if (read.kind === 'unavailable') { return failure('unavailable', `mission store unavailable: ${read.reason}`); }
      if (read.kind !== 'found') { return failure('validation', `dependency is not a mission: ${dependency}`); }
    }
    try {
      const version = await this._store.save({ ...loaded.mission, dependencies }, loaded.version);
      return completed({ dependencies, version }, [storeEvidence(request.missionId, 'mission-dependencies', `${dependencies.length} mission dependencies recorded`)]);
    } catch (error) { return writeFailure(error); }
  }

  async readDependencies(request: MissionCommandRequest): Promise<ApplicationOutcome<MissionDependenciesResult>> {
    const guard = missingCapability<MissionDependenciesResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionDependenciesResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    return completed({ dependencies: loaded.mission.dependencies ?? [], version: loaded.version });
  }

  /** Record the draft's predicted NEL bucket, which handoff calibrates against the measured one. */
  async setPredictedNelBucket(request: SetPredictedNelBucketRequest): Promise<ApplicationOutcome<MissionPredictedNelBucketResult>> {
    const guard = missingCapability<MissionPredictedNelBucketResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionPredictedNelBucketResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    const { bucket } = request;
    if (bucket !== 'Small' && bucket !== 'Medium' && bucket !== 'Large') {
      return failure('validation', 'predicted NEL bucket must be Small, Medium or Large');
    }
    try {
      const version = await this._store.save({ ...loaded.mission, predictedNelBucket: bucket }, loaded.version);
      return completed({ predictedNelBucket: bucket, version }, [storeEvidence(request.missionId, 'predicted-nel-bucket', `predicted NEL bucket: ${bucket}`)]);
    } catch (error) { return writeFailure(error); }
  }

  /**
   * Record the red-to-green reproduction test a bug mission declares.
   *
   * This records which test it is. It asserts nothing about that test having
   * run: `px status` reports the path so a reviewer can check it against the
   * diff, which is what a `Reproduction-Test:` line in a mission document was
   * doing before, minus the file.
   */
  async setReproductionTest(request: SetReproductionTestRequest): Promise<ApplicationOutcome<MissionReproductionTestResult>> {
    const guard = missingCapability<MissionReproductionTestResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionReproductionTestResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    const testPath = request.testPath === null ? null : request.testPath.trim();
    if (testPath !== null && (testPath.length === 0 || /[\r\n]/.test(testPath) || testPath.length > 512)) {
      return failure('validation', 'reproduction test must be a single-line path of at most 512 characters');
    }
    try {
      const version = await this._store.save({ ...loaded.mission, reproductionTest: testPath }, loaded.version);
      return completed({ reproductionTest: testPath, version }, [storeEvidence(request.missionId, 'reproduction-test', testPath ? `reproduction test recorded: ${testPath}` : 'reproduction test cleared')]);
    } catch (error) { return writeFailure(error); }
  }

  /** Replace only the classification dimension; all unrelated labels survive. */
  async setClassification(request: SetMissionClassificationRequest): Promise<ApplicationOutcome<MissionClassificationResult>> {
    const guard = missingCapability<MissionClassificationResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionClassificationResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    const classification = request.classification.trim().toLowerCase() as MissionClassification;
    if (!MISSION_CLASSIFICATIONS.includes(classification)) {
      return failure('validation', 'classification must be exactly one of ai_sdlc, user_value, or unknown');
    }
    const labels = [...loaded.mission.labels.filter(label => !MISSION_CLASSIFICATIONS.includes(String(label) as MissionClassification)), missionLabel(classification)];
    try {
      const version = await this._store.save({ ...loaded.mission, labels }, loaded.version);
      return completed({ classification, version }, [storeEvidence(request.missionId, 'mission-classification', `classification: ${classification}`)]);
    } catch (error) { return writeFailure(error); }
  }

  /** The recorded success criteria, or an empty list when none are recorded. */
  async readSuccessCriteria(request: MissionCommandRequest): Promise<ApplicationOutcome<MissionSuccessCriteriaResult>> {
    const guard = missingCapability<MissionSuccessCriteriaResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionSuccessCriteriaResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    return completed({ successCriteria: loaded.mission.successCriteria ?? [], version: loaded.version });
  }

  /** The gates handoff will run, or an empty list when none are declared. */
  async readGates(request: MissionCommandRequest): Promise<ApplicationOutcome<MissionGatesResult>> {
    const guard = missingCapability<MissionGatesResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionGatesResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    return completed({ declaredGates: loaded.mission.declaredGates ?? [], version: loaded.version });
  }
}

/**
 * What an agent is handed at launch: the brief, the gates that will judge it,
 * and where the last agent stopped.
 *
 * Rendering lives here rather than in the domain because it is a read contract
 * for one consumer — the execute launch prompt — not a rule about a Mission.
 */
export interface MissionLaunchContext {
  readonly brief: MissionBrief;
  readonly successCriteria?: readonly string[];
  /** Every checkpoint, planned or evidenced; the plan is the ones without Goal Check rows yet. */
  readonly checkpoints?: readonly CheckpointData[];
  readonly declaredGates: readonly string[];
  readonly latestCheckpoint: CheckpointData | null;
}

export function renderLaunchContext(context: MissionLaunchContext): string {
  const { brief, successCriteria: criteria = [], checkpoints = [], declaredGates: gates, latestCheckpoint } = context;
  const lines = [`Mission goal: ${brief.goal}`, `Why: ${brief.why}`];
  if (brief.scope) { lines.push(`Scope: ${brief.scope}`); }
  if (brief.outOfScope.length > 0) { lines.push(`Out of scope: ${brief.outOfScope.join('; ')}`); }
  if (criteria.length > 0) { lines.push('Success criteria:', ...criteria.map((criterion, index) => `  ${index + 1}. ${criterion}`)); }
  if (checkpoints.length > 0) {
    lines.push('Checkpoints:', ...checkpoints.map((checkpoint) => `  ${checkpoint.goalCheck.length > 0 ? '[x]' : '[ ]'} ${checkpoint.name}: ${checkpoint.firstLine ?? ''}`.trimEnd()));
    const next = checkpoints.find((checkpoint) => checkpoint.goalCheck.length === 0);
    lines.push(next ? `Next checkpoint: ${next.name}` : 'Every checkpoint has recorded evidence.');
  }
  if (gates.length > 0) { lines.push(`Declared gates: ${gates.join('; ')}`); }
  if (latestCheckpoint) {
    const first = (latestCheckpoint.firstLine ?? '').trim();
    lines.push(
      `Most recent checkpoint: ${first ? `${latestCheckpoint.name} — ${first}` : latestCheckpoint.name}`,
      'Resume from there, or start the next checkpoint if that one is complete.',
    );
  }
  return `Recorded mission state (authoritative; read it with \`px status\`, not from a file):\n${lines.join('\n')}`;
}
