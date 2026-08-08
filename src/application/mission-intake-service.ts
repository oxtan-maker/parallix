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
import type { MissionTransitionStore, MissionVersion } from './domain-ports.js';
import { isDuplicateLaneEvent, lifecycleLaneEvent } from './lifecycle-lane-event.js';
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
  /** Occurrence time recorded on the entry lane event; defaults to now. */
  readonly occurredAt?: string;
  /** Supplying the same key twice records the entry event once. */
  readonly idempotencyKey?: string;
  readonly capabilities: ReadonlySet<Capability>;
}

export interface MissionIntakeResult {
  readonly mission: Mission;
  readonly version: MissionVersion;
}

export class MissionIntakeService {
  constructor(private readonly _store: MissionTransitionStore) {}

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

    // Entry into the first lane is a lifecycle step, so it carries the same
    // lane event every later transition does. Without it a mission that has
    // never moved has no recorded entry time at all, and backlog age cannot be
    // derived from the event stream.
    const event = lifecycleLaneEvent({
      mission,
      from: null,
      trigger: 'intake',
      agent: mission.assignee ?? 'unknown',
      occurredAt: request.occurredAt ?? new Date().toISOString(),
      idempotencyKey: request.idempotencyKey,
    });
    try {
      // `null` expected version is the insert contract: a second intake of the
      // same identity is refused as a conflict rather than overwriting.
      const version = await this._store.saveWithTransition(mission, null, event);
      return completed({ mission, version }, [this.evidence(mission)]);
    } catch (error) {
      if (isDuplicateLaneEvent(error)) {
        return failure('conflict', (error as Error).message);
      }
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
