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
  isHandoffReadyCheckpoint,
  recordCheckpoint,
  type CheckpointData,
  type GoalCheckRow,
} from '../domain/checkpoint.js';
import type { Mission } from '../domain/mission.js';

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

export interface ReadCheckpointsRequest extends MissionCommandRequest {
  /** Return one named checkpoint (e.g. `CP-2`) instead of all of them. */
  readonly name?: string;
}

export interface ReadCheckpointsResult {
  readonly version: MissionVersion;
  readonly checkpoints: readonly CheckpointData[];
  readonly goalCheck: readonly GoalCheckRow[];
}

export class MissionCheckpointService {
  constructor(private readonly _store: MissionStore) {}

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
