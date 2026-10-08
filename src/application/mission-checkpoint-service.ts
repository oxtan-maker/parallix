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
  uncoveredCriteria,
  staleRepairCriteria,
  isHandoffReadyCheckpoint,
  planCheckpoint,
  recordCheckpoint,
  retainPriorGoalCheckRows,
  type CheckpointData,
  type GoalCheckRow,
} from '../domain/checkpoint.js';
import { currentReviewRound, openRepairFromReview } from '../domain/review.js';
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
    let merged: CheckpointData;
    try {
      // A repair records only its affected criteria: retain prior rows for the
      // other criteria so the final Goal Check table is not rewritten. Fresh
      // evidence has no prior rows to retain, so this is a no-op then.
      const prior = mission.checkpoints.find((checkpoint) => checkpoint.name === request.checkpoint.name);
      // Rows are stamped with the review round they are recorded in, so a
      // repair's fresh proof is distinguishable from rows kept from earlier rounds.
      const round = mission.review ? currentReviewRound(mission.review).number : undefined;
      const gate = openRepairFromReview(mission.review, mission.successCriteria ?? [], mission.checkpoints.flatMap((checkpoint) => checkpoint.goalCheck))?.gate;
      const stamped = round === undefined
        ? request.checkpoint
        : { ...request.checkpoint, goalCheck: request.checkpoint.goalCheck.map((row) => {
          const priorRows = mission.checkpoints.flatMap((checkpoint) => checkpoint.goalCheck)
            .filter((priorRow) => priorRow.criterion === row.criterion);
          const repairedGates = [...new Set(priorRows.flatMap((priorRow) => [
            ...(priorRow.repairedGates ?? []), ...(priorRow.repairedGate ? [priorRow.repairedGate] : []),
          ]).concat(gate ? [gate] : []))];
          return { ...row, recordedRound: round, ...(gate ? { repairedGate: gate } : {}),
            ...(repairedGates.length ? { repairedGates } : {}) };
        }) };
      merged = prior
        ? { ...stamped, goalCheck: retainPriorGoalCheckRows(prior.goalCheck, stamped.goalCheck) }
        : stamped;
      updated = {
        ...mission,
        checkpoints: recordCheckpoint(mission.checkpoints, merged),
      } as Mission;
    } catch (error) {
      return failure(
        'validation',
        error instanceof Error ? error.message : 'checkpoint evidence rejected',
      );
    }

    const evidenceFailure = await this.assertRecordableEvidence({ request, rootDir, mission, updated, merged });
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
            `${updated.checkpoints.find((checkpoint) => checkpoint.name === request.checkpoint.name)?.goalCheck.length ?? request.checkpoint.goalCheck.length} Goal Check row(s) recorded`
            + `${replaced ? ' (retained earlier evidence, updated affected criteria)' : ''}`,
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
   * and the recorded checkpoints taken together must cover every success
   * criterion. A repair checkpoint may carry only its affected criteria while
   * valid earlier evidence is retained, so the shortfall is measured across all
   * recorded checkpoints, not this one alone. Returns a validation failure when
   * either check fails, or `null` when the checkpoint may be recorded.
   */
  private async assertRecordableEvidence(params: {
    request: RecordCheckpointRequest;
    rootDir: string | null;
    mission: Mission;
    updated: Mission;
    merged: CheckpointData;
  }): Promise<ApplicationOutcome<RecordCheckpointResult> | null> {
    const { request, rootDir, mission, updated, merged } = params;
    if (rootDir && this._evidence) {
      // Validate the rows that will actually be retained (prior rows kept for a
      // repair plus the new rows), not just the submitted rows: a retained row
      // is proof the handoff later stands on, so an invalid reference must be
      // refused at record time exactly as it would be at handoff.
      const unverifiable = findUnverifiableRecordedRow(
        this._evidence.fileSystem,
        merged.goalCheck,
        rootDir,
      );
      if (unverifiable) {
        return failure('validation', `checkpoint ${request.checkpoint.name} rejected. ${unverifiable.message}`);
      }
    }
    // A repair checkpoint may carry only its affected criteria: refuse it only
    // when the recorded checkpoints taken together still leave a criterion
    // uncovered, not because this one checkpoint alone has fewer rows. Coverage
    // is distinct success-criterion identities, so a repair row for one criterion
    // does not count as evidence for another.
    if (updated.checkpoints.at(-1)?.name === request.checkpoint.name) {
      // An open repair (reviewer-requested changes or a bounceback) owes fresh
      // proof recorded in its own round; rows kept from earlier rounds are stale.
      const repair = openRepairFromReview(mission.review, mission.successCriteria ?? [], mission.checkpoints.flatMap((checkpoint) => checkpoint.goalCheck));
      const stale = repair ? staleRepairCriteria(updated.checkpoints, repair) : [];
      if (stale.length > 0) {
        return failure(
          'validation',
          `checkpoint ${request.checkpoint.name} rejected: the open repair needs fresh fix evidence recorded in this review round for ${stale.join(', ')}; only stale rows from earlier rounds remain. `
          + `Run px checkpoint record --name ${request.checkpoint.name} --criterion <affected> --evidence <verifiable> for the criteria the failure touches, then handoff.`,
        );
      }
      const uncovered = uncoveredCriteria(updated.checkpoints, mission.successCriteria ?? []);
      if (uncovered.length > 0) {
        const recordedRows = updated.checkpoints.reduce((total, cp) => total + cp.goalCheck.length, 0);
        const criteria = mission.successCriteria?.length ?? 0;
        return failure(
          'validation',
          `checkpoint ${request.checkpoint.name} is the final planned checkpoint, and handoff requires every success criterion to have a row across all recorded checkpoints: ${criteria} criteria need ${criteria} row(s), but ${recordedRows} were recorded. Uncovered criteria: ${uncovered.join(', ')}. `
          + 'Record the affected criteria; valid earlier evidence for the others is retained, and add rows for any criterion left uncovered.',
        );
      }
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
