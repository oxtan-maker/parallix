/**
 * Mission intake use case.
 *
 * Intake materializes a checked `Mission` that owns its `RepositoryId` and an
 * optional trace back to the external material Parallix accepted. It writes
 * exactly one aggregate: no task-catalog record, no external lifecycle mirror
 * (ADR 0053, "External tasks and planning documents ... Excluded as aggregates").
 */

import type { ApplicationOutcome, Capability, DurableEvidence } from './contracts.js';
import { completed, failure, rejected } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { storeEvidence, writeFailure } from './mission-command-support.js';
import type { AgentFamily } from '../domain/agents.js';
import type { ExternalTaskRef } from '../domain/external-task.js';
import {
  intakeMission,
  type Mission,
  type MissionId,
  type MissionLabel,
} from '../domain/mission.js';
import type { RepositoryId } from '../domain/repository.js';

const REQUIRED_CAPABILITY: Capability = 'mission:intake';

export interface MissionIntakeRequest {
  readonly operationId: string;
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  readonly title: string;
  readonly labels?: readonly MissionLabel[];
  readonly assignee?: AgentFamily | null;
  readonly rawStatus?: string;
  /** Traceability only; the external system keeps owning the material. */
  readonly externalTaskRef?: ExternalTaskRef | null;
  readonly capabilities: ReadonlySet<Capability>;
}

export interface MissionIntakeResult {
  readonly mission: Mission;
  readonly version: MissionVersion;
}

export class MissionIntakeService {
  constructor(private readonly _store: MissionStore) {}

  async execute(
    request: MissionIntakeRequest,
  ): Promise<ApplicationOutcome<MissionIntakeResult>> {
    if (!request.operationId.trim() || !request.missionId.trim()) {
      return rejected('validation', 'operationId and missionId are required');
    }
    if (!request.capabilities.has(REQUIRED_CAPABILITY)) {
      return rejected('capability', `${REQUIRED_CAPABILITY} capability is required`);
    }

    let mission: Mission;
    try {
      mission = intakeMission({
        id: request.missionId,
        repositoryId: request.repositoryId,
        title: request.title,
        labels: request.labels,
        assignee: request.assignee ?? null,
        rawStatus: request.rawStatus,
        externalTaskRef: request.externalTaskRef ?? null,
      });
      if (request.externalTaskRef && !mission.externalTaskRef) {
        throw new Error('intake dropped the supplied external task reference');
      }
    } catch (error) {
      return writeFailure<MissionIntakeResult>(error);
    }

    const existing = await this.readExisting(request.missionId);
    if (existing !== null) {
      return existing;
    }

    try {
      // `null` expected version is the insert contract: a second intake of the
      // same identity is refused as a conflict rather than overwriting.
      const version = await this._store.save(mission, null);
      return completed({ mission, version }, [this.evidence(mission)]);
    } catch (error) {
      return writeFailure<MissionIntakeResult>(error);
    }
  }

  private async readExisting(
    missionId: MissionId,
  ): Promise<ApplicationOutcome<MissionIntakeResult> | null> {
    try {
      const read = await this._store.load(missionId);
      if (read.kind === 'found') {
        return failure('conflict', `mission ${missionId} is already recorded`);
      }
      if (read.kind === 'unavailable') {
        return failure('unavailable', read.reason);
      }
      return null;
    } catch (error) {
      return failure(
        'unavailable',
        error instanceof Error && error.message ? error.message : 'mission store read failed',
      );
    }
  }

  private evidence(mission: Mission): DurableEvidence {
    const trace = mission.externalTaskRef
      ? `${mission.externalTaskRef.source}:${mission.externalTaskRef.id}`
      : 'none';
    return storeEvidence(
      mission.id,
      'intake',
      `mission recorded for repository ${mission.repositoryId} (external trace: ${trace})`,
    );
  }
}
