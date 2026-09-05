/**
 * Mission lifecycle use case: activation and every transition this boundary owns.
 *
 * The domain decides (`decideMission`), the repository port persists, and the
 * lane-transition event commits with the state change it describes. SQL and
 * files decide nothing here (ADR 0053, "Application use cases decide domain
 * transitions").
 */

import type { ApplicationOutcome, Capability, DurableEvidence } from './contracts.js';
import { completed, failure } from './contracts.js';
import type { MissionTransitionStore, MissionVersion } from './domain-ports.js';
import { isDuplicateLaneEvent, isReplayedLaneEvent } from './lifecycle-lane-event.js';
import {
  decisionFailure,
  isLoaded,
  loadForCommand,
  missingCapability,
  storeEvidence,
  writeFailure,
  type MissionCommandRequest,
} from './mission-command-support.js';
import type { AgentFamily } from '../domain/agents.js';
import { triggerFromTransition, type LaneTransitionEvent } from '../domain/board-event.js';
import type { Mission, MissionStatus } from '../domain/mission.js';
import { decideMission, type MissionCommand } from '../domain/mission-workflow.js';

const REQUIRED_CAPABILITY: Capability = 'mission:transition';

export interface MissionTransitionRequest extends MissionCommandRequest {
  readonly command: MissionCommand;
  /** Actor recorded on the lane event; the launcher family for an activation. */
  readonly actor: string;
  readonly occurredAt: string;
  /** Supplying the same key twice records the transition once. */
  readonly idempotencyKey?: string;
}

export interface MissionTransitionResult {
  readonly mission: Mission;
  readonly version: MissionVersion;
  readonly from: MissionStatus;
  readonly to: MissionStatus;
  /** False when the decision left the recorded lane unchanged. */
  readonly laneChanged: boolean;
}

export interface MissionActivationRequest extends MissionCommandRequest {
  readonly agent: AgentFamily;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
}

export class MissionLifecycleService {
  constructor(private readonly _store: MissionTransitionStore) {}

  /** Activation is the transition this mission's `active` path uses. */
  async activate(
    request: MissionActivationRequest,
  ): Promise<ApplicationOutcome<MissionTransitionResult>> {
    return this.transition({
      ...request,
      command: { type: 'activate', agent: request.agent },
      actor: request.agent,
    });
  }

  async transition(
    request: MissionTransitionRequest,
  ): Promise<ApplicationOutcome<MissionTransitionResult>> {
    const guard = missingCapability<MissionTransitionResult>(request, REQUIRED_CAPABILITY);
    if (guard) {
      return guard;
    }
    if (!request.occurredAt.trim()) {
      return failure('validation', 'transition requires an actual occurrence time');
    }

    const loaded = await loadForCommand<MissionTransitionResult>(this._store, request);
    if (!isLoaded(loaded)) {
      return loaded;
    }
    const { mission, version } = loaded;
    const from = mission.status;

    let decided: Mission;
    try {
      decided = decideMission(mission, request.command);
    } catch (error) {
      return decisionFailure<MissionTransitionResult>(error);
    }

    const event = this.laneEvent(decided, from, request);
    try {
      const nextVersion = event === null
        ? await this._store.save(decided, version)
        : await this._store.saveWithTransition(decided, version, event);
      return completed(
        {
          mission: decided,
          version: nextVersion,
          from,
          to: decided.status,
          laneChanged: event !== null,
        },
        [this.evidence(decided, from, request)],
      );
    } catch (error) {
      if (!isDuplicateLaneEvent(error)) {
        return writeFailure<MissionTransitionResult>(error);
      }
      // The store refused the lane event, which rolls its transaction back and
      // discards the aggregate write with it. When the event already recorded
      // under this key describes exactly this transition — a retried handoff
      // reusing `handoff-${slug}` — the history is already complete and only
      // the state is missing, so the aggregate is saved on its own rather than
      // reported as a conflict. Anything else, including a stale expected
      // version, stays a conflict.
      if (event === null || !await isReplayedLaneEvent(this._store, event)) {
        return failure('conflict', (error as Error).message);
      }
      try {
        const replayedVersion = await this._store.save(decided, version);
        return completed(
          {
            mission: decided,
            version: replayedVersion,
            from,
            to: decided.status,
            laneChanged: false,
          },
          [this.evidence(decided, from, request)],
        );
      } catch (replayError) {
        return writeFailure<MissionTransitionResult>(replayError);
      }
    }
  }

  /**
   * A lane event exists only for a transition the state machine owns and only
   * when the recorded lane actually moves. An idempotent re-activation of an
   * already-active mission therefore saves the aggregate without inventing a
   * second history entry.
   */
  private laneEvent(
    decided: Mission,
    from: MissionStatus,
    request: MissionTransitionRequest,
  ): LaneTransitionEvent | null {
    if (decided.status === from) {
      return null;
    }
    const trigger = triggerFromTransition(from, decided.status);
    if (trigger === null) {
      return null;
    }
    return {
      missionId: decided.id,
      repositoryId: decided.repositoryId,
      from,
      to: decided.status,
      trigger,
      agent: request.actor,
      occurredAt: request.occurredAt,
      idempotencyKey: request.idempotencyKey
        ?? `${decided.id}:${trigger}:${request.occurredAt}`,
    };
  }

  private evidence(
    decided: Mission,
    from: MissionStatus,
    request: MissionTransitionRequest,
  ): DurableEvidence {
    return storeEvidence(
      decided.id,
      request.command.type,
      `${from} -> ${decided.status} recorded by ${request.actor}`,
    );
  }
}
