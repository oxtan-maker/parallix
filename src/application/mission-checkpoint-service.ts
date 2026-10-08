/**
 * Checkpoint use case.
 *
 * Checkpoint evidence is nested Mission data (ADR 0053, "`CheckpointData` and
 * `GoalCheckRow` ... Authoritative as nested Mission data"). The request carries
 * domain values only: no mission-directory path, no `CP-N.md` filename to open,
 * and no SQL. Whichever authority is selected translates the same
 * `CheckpointData` into its own storage shape.
 */

import type { ApplicationOutcome, Capability } from './contracts.js';
import { completed, failure } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import {
  isLoaded,
  loadForCommand,
  missingCapability,
  storeEvidence,
  writeFailure,
  type MissionCommandRequest,
} from './mission-command-support.js';
import {
  assertGoalCheckRows,
  finalGoalCheckShortfall,
  isHandoffReadyCheckpoint,
  planCheckpoint,
  recordCheckpoint,
  type CheckpointData,
  type GoalCheckRow,
} from '../domain/checkpoint.js';
import type { Mission } from '../domain/mission.js';
import { findUnverifiableRecordedRow, type EvidenceFileSystemPort } from './static-evidence.js';

const REQUIRED_CAPABILITY: Capability = 'checkpoint:record';

export interface RecordCheckpointRequest extends MissionCommandRequest {
  readonly checkpoint: CheckpointData;
}

export interface RecordCheckpointResult {
  readonly mission: Mission;
  readonly version: MissionVersion;
  readonly checkpoint: CheckpointData;
  /** True when this write replaced a same-named checkpoint. */
  readonly replaced: boolean;
}

export interface PlanCheckpointRequest extends MissionCommandRequest {
  readonly name: string;
  /** What the checkpoint delivers. Omitted on `unplan`. */
  readonly description?: string;
}

export interface PlanCheckpointResult {
  readonly checkpoints: readonly CheckpointData[];
  readonly version: MissionVersion;
}

export interface ReadCheckpointsRequest extends MissionCommandRequest {
  /** Return one named checkpoint (e.g. `CP-2`) instead of all of them. */
  readonly name?: string;
}

export interface ReadCheckpointsResult {
  readonly version: MissionVersion;
  readonly checkpoints: readonly CheckpointData[];
  readonly goalCheck: readonly GoalCheckRow[];
}

/**
 * Evidence references resolve against the Mission's repository checkout.
 * Recording applies the reference semantics handoff applies, so an evidence
 * row handoff would refuse is refused when it is written. Without it (or
 * without a resolvable checkout) recording checks only the row shape and
 * handoff remains the check.
 */
export interface CheckpointEvidenceReferences {
  readonly fileSystem: EvidenceFileSystemPort;
  rootFor(_missionId: Mission['id']): string | null;
}

export class MissionCheckpointService {
  constructor(
    private readonly _store: MissionStore,
    private readonly _evidence?: CheckpointEvidenceReferences,
  ) {}

  /** Plan a checkpoint: a name and what it delivers, with no evidence yet. */
  async plan(request: PlanCheckpointRequest): Promise<ApplicationOutcome<PlanCheckpointResult>> {
    return this.replan(request, (checkpoints, missionId) => planCheckpoint(checkpoints, {
      missionId, name: request.name, description: request.description ?? '',
    }));
  }

  /** Drop a planned checkpoint. Evidence already recorded is never dropped this way. */
  async unplan(request: PlanCheckpointRequest): Promise<ApplicationOutcome<PlanCheckpointResult>> {
    return this.replan(request, (checkpoints) => {
      const target = checkpoints.find((checkpoint) => checkpoint.name === request.name);
      if (!target) { throw new Error(`Checkpoint ${request.name} is not planned`); }
      if (target.goalCheck.length > 0) { throw new Error(`Checkpoint ${request.name} already has recorded evidence`); }
      return checkpoints.filter((checkpoint) => checkpoint !== target);
    });
  }

  private async replan(
    request: PlanCheckpointRequest,
    change: (_checkpoints: readonly CheckpointData[], _missionId: Mission['id']) => CheckpointData[],
  ): Promise<ApplicationOutcome<PlanCheckpointResult>> {
    const guard = missingCapability<PlanCheckpointResult>(request, 'mission:context');
    if (guard) { return guard; }
    const loaded = await loadForCommand<PlanCheckpointResult>(this._store, request);
    if (!isLoaded(loaded)) { return loaded; }
    let checkpoints: CheckpointData[];
    try { checkpoints = change(loaded.mission.checkpoints, loaded.mission.id); } catch (error) {
      return failure('validation', error instanceof Error ? error.message : 'checkpoint plan rejected');
    }
    try {
      const version = await this._store.save({ ...loaded.mission, checkpoints } as Mission, loaded.version);
      return completed({ checkpoints, version }, [storeEvidence(loaded.mission.id, `checkpoint-plan:${request.name}`, `${checkpoints.length} checkpoint(s) planned`)]);
    } catch (error) {
      return writeFailure<PlanCheckpointResult>(error);
    }
  }

  async record(
    request: RecordCheckpointRequest,
  ): Promise<ApplicationOutcome<RecordCheckpointResult>> {
    const guard = missingCapability<RecordCheckpointResult>(request, REQUIRED_CAPABILITY);
    if (guard) {
      return guard;
    }
    if (request.checkpoint.missionId !== request.missionId) {
      return failure(
        'validation',
        `checkpoint ${request.checkpoint.name} belongs to mission `
        + `${request.checkpoint.missionId}, not ${request.missionId}`,
      );
    }
    if (!isHandoffReadyCheckpoint(request.checkpoint)) {
      return failure(
        'validation',
        `checkpoint ${request.checkpoint.name} needs a CP-N name, at least one Goal Check row, and a next action`,
      );
    }
    try { assertGoalCheckRows(request.checkpoint.goalCheck); } catch (error) {
      return failure('validation', error instanceof Error ? error.message : 'checkpoint evidence rejected');
    }
    const rootDir = this._evidence?.rootFor(request.missionId) ?? null;

    const loaded = await loadForCommand<RecordCheckpointResult>(this._store, request);
    if (!isLoaded(loaded)) {
      return loaded;
    }
    const { mission, version } = loaded;
    const replaced = mission.checkpoints.some(
      (existing) => existing.name === request.checkpoint.name,
    );

    let updated: Mission;
    try {
      updated = {
        ...mission,
        checkpoints: recordCheckpoint(mission.checkpoints, request.checkpoint),
      } as Mission;
    } catch (error) {
      return failure(
        'validation',
        error instanceof Error ? error.message : 'checkpoint evidence rejected',
      );
    }

    const evidenceFailure = await this.assertRecordableEvidence({ request, rootDir, mission, updated });
    if (evidenceFailure) {
      return evidenceFailure;
    }

    try {
      const nextVersion = await this._store.save(updated, version);
      return completed(
        {
          mission: updated,
          version: nextVersion,
          checkpoint: request.checkpoint,
          replaced,
        },
        [
          storeEvidence(
            mission.id,
            `checkpoint:${request.checkpoint.name}`,
            `${request.checkpoint.goalCheck.length} Goal Check row(s) recorded`
            + `${replaced ? ' (replaced earlier evidence)' : ''}`,
          ),
        ],
      );
    } catch (error) {
      return writeFailure<RecordCheckpointResult>(error);
    }
  }

  /**
   * Record-time evidence checks that mirror the reference semantics handoff
   * applies: an evidence row handoff would refuse is refused when it is written,
   * and a final checkpoint must carry one Goal Check row per success criterion.
   * Returns a validation failure when either check fails, or `null` when the
   * checkpoint may be recorded.
   */
  private async assertRecordableEvidence(params: {
    request: RecordCheckpointRequest;
    rootDir: string | null;
    mission: Mission;
    updated: Mission;
  }): Promise<ApplicationOutcome<RecordCheckpointResult> | null> {
    const { request, rootDir, mission, updated } = params;
    if (rootDir && this._evidence) {
      const unverifiable = findUnverifiableRecordedRow(
        this._evidence.fileSystem,
        request.checkpoint.goalCheck,
        rootDir,
      );
      if (unverifiable) {
        return failure('validation', `checkpoint ${request.checkpoint.name} rejected. ${unverifiable.message}`);
      }
    }
    const criteria = mission.successCriteria?.length ?? 0;
    const shortfall = finalGoalCheckShortfall(request.checkpoint.goalCheck, criteria);
    if (shortfall > 0 && updated.checkpoints.at(-1)?.name === request.checkpoint.name) {
      return failure(
        'validation',
        `checkpoint ${request.checkpoint.name} is the final planned checkpoint, and handoff requires one Goal Check row per success criterion: `
        + `${criteria} criteria need ${criteria} row(s), but ${request.checkpoint.goalCheck.length} were given. `
        + 'Pass one --criterion/--evidence pair per success criterion listed by `px status`.',
      );
    }
    return null;
  }

  async read(
    request: ReadCheckpointsRequest,
  ): Promise<ApplicationOutcome<ReadCheckpointsResult>> {
    const guard = missingCapability<ReadCheckpointsResult>(request, REQUIRED_CAPABILITY);
    if (guard) {
      return guard;
    }
    const loaded = await loadForCommand<ReadCheckpointsResult>(this._store, request);
    if (!isLoaded(loaded)) {
      return loaded;
    }
    const { mission, version } = loaded;
    const checkpoints = request.name === undefined
      ? mission.checkpoints
      : mission.checkpoints.filter((checkpoint) => checkpoint.name === request.name);
    if (request.name !== undefined && checkpoints.length === 0) {
      return failure('unavailable', `mission ${mission.id} has no ${request.name} evidence`);
    }
    return completed({
      version,
      checkpoints,
      goalCheck: checkpoints.flatMap((checkpoint) => checkpoint.goalCheck),
    });
  }
}
