/**
 * Handoff use case: record change size and report the structured NEL data.
 *
 * `Mission.netEngineeringLines` is the authoritative field, so the NEL number is
 * written through the Mission repository port with the exact expected revision.
 * The reported record is then *derived* from the saved aggregate — it is not a
 * second stored authority.
 *
 * Generated evidence (diffs, gate logs, captures) is passed as
 * `ArtifactReference` locators. The use case has no way to accept artifact
 * bytes, so nothing here can become a database blob (ADR 0053, "Logs, patches,
 * captures, and large artifacts ... Reference only").
 */

import type { ApplicationOutcome, Capability, DurableEvidence } from './contracts.js';
import { completed, failure } from './contracts.js';
import type {
  MissionNelRecorder,
  MissionStore,
  MissionVersion,
} from './domain-ports.js';
import {
  isLoaded,
  loadForCommand,
  missingCapability,
  storeEvidence,
  writeFailure,
  type MissionCommandRequest,
} from './mission-command-support.js';
import type { Mission } from '../domain/mission.js';
import { recordNetEngineeringLines } from '../domain/mission.js';
import {
  missionNelRecord,
  type ArtifactReference,
  type MissionNelRecord,
  type NelBucketLabel,
} from '../domain/net-engineering-lines.js';

const REQUIRED_CAPABILITY: Capability = 'handoff:record';

export interface RecordHandoffNelRequest extends MissionCommandRequest {
  /** Measured change size; the Git adapter computes it, the domain classifies it. */
  readonly netEngineeringLines: number;
  /** Bucket predicted at refinement, when the mission contract stated one. */
  readonly predictedBucket?: NelBucketLabel | 'Unknown';
  readonly capturedAt: string;
  /** Locators for large generated evidence; never the evidence itself. */
  readonly artifacts?: readonly ArtifactReference[];
  /** Round count from the caller's review surface; derived when omitted. */
  readonly reviewRounds?: number;
}

export interface RecordHandoffNelResult {
  readonly mission: Mission;
  readonly version: MissionVersion;
  readonly record: MissionNelRecord;
  /** Where the structured record was durably recorded, when a recorder exists. */
  readonly recordReference: string | null;
}

export class MissionHandoffService {
  constructor(
    private readonly _store: MissionStore,
    private readonly _recorder?: MissionNelRecorder,
  ) {}

  async recordNel(
    request: RecordHandoffNelRequest,
  ): Promise<ApplicationOutcome<RecordHandoffNelResult>> {
    const guard = missingCapability<RecordHandoffNelResult>(request, REQUIRED_CAPABILITY);
    if (guard) {
      return guard;
    }

    const loaded = await loadForCommand<RecordHandoffNelResult>(this._store, request);
    if (!isLoaded(loaded)) {
      return loaded;
    }
    const { mission, version } = loaded;

    let updated: Mission;
    let record: MissionNelRecord;
    try {
      updated = recordNetEngineeringLines(mission, request.netEngineeringLines);
      record = missionNelRecord(updated, {
        predictedBucket: request.predictedBucket,
        capturedAt: request.capturedAt,
        artifacts: request.artifacts,
        reviewRounds: request.reviewRounds,
      });
    } catch (error) {
      return failure(
        'validation',
        error instanceof Error ? error.message : 'net engineering lines rejected',
      );
    }

    const evidence: DurableEvidence[] = [];
    let nextVersion: MissionVersion;
    try {
      nextVersion = await this._store.save(updated, version);
      evidence.push(this.nelEvidence(updated, record));
    } catch (error) {
      return writeFailure<RecordHandoffNelResult>(error);
    }

    if (!this._recorder) {
      return completed({ mission: updated, version: nextVersion, record, recordReference: null }, evidence);
    }

    // The aggregate is already durable at this point. A failed report write is
    // reported as such — with the durable evidence that exists — rather than
    // claiming a rollback that did not happen.
    try {
      const receipt = await this._recorder.recordNel(record);
      evidence.push(storeEvidence(
        updated.id,
        'handoff:nel-report',
        `structured NEL report recorded at ${receipt.reference}`,
      ));
      return completed(
        { mission: updated, version: nextVersion, record, recordReference: receipt.reference },
        evidence,
      );
    } catch (error) {
      return failure(
        'execution',
        `NEL persistence failed after the mission recorded ${record.netEngineeringLines} NEL: `
        + (error instanceof Error && error.message ? error.message : 'unknown error'),
        evidence,
      );
    }
  }

  private nelEvidence(mission: Mission, record: MissionNelRecord): DurableEvidence {
    const references = record.artifacts.length === 0
      ? 'no referenced artifacts'
      : `referenced artifacts: ${record.artifacts.map((artifact) => artifact.location).join(', ')}`;
    return storeEvidence(
      mission.id,
      'handoff:nel',
      `${record.netEngineeringLines} NEL (${record.actualBucket}); ${references}`,
    );
  }
}
