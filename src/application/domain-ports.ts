import type { AgentFamily } from '../domain/agents.js';
import type { AgentSelectionSnapshot } from '../domain/agents.js';
import type { LaneTransitionEvent } from '../domain/board-event.js';
import type { Mission, MissionId } from '../domain/mission.js';
import type { MissionNelRecord } from '../domain/net-engineering-lines.js';
import type { SessionMarker, SessionRole } from '../domain/session.js';

export type MissionVersion = number & { readonly __brand: 'MissionVersion' };

export function missionVersion(value: number): MissionVersion {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid Mission version: ${value}`);
  }
  return value as MissionVersion;
}

export type MissionLoadResult =
  | { readonly kind: 'found'; readonly mission: Mission; readonly version: MissionVersion }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface MissionTransitionHistoryEntry {
  readonly trigger: string;
  /**
   * The identity of the recorded transition, when the store keeps it. Only the
   * lane the mission left, the lane it entered, and the key the writer supplied
   * are needed to tell a replayed transition from a genuine collision under the
   * same idempotency key; a store that records no history omits them.
   */
  readonly fromStatus?: string | null;
  readonly toStatus?: string;
  readonly idempotencyKey?: string;
}

/** Persistence ports belong to the application layer; the domain stays store-agnostic. */
export interface MissionStore {
  load(_id: MissionId): Promise<MissionLoadResult>;
  /** Read the mission aggregates owned by one repository. */
  loadByRepository?(_repositoryId: import('../domain/repository.js').RepositoryId): Promise<readonly Mission[]>;
  /**
   * Insert when expectedVersion is null, otherwise compare-and-swap the exact
   * aggregate revision returned by load().
   */
  save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion>;
  /**
   * Resolve once no store operation is in flight.
   *
   * Composition awaits this before closing the database so a write that a
   * command left running cannot fail against a closed handle. Stores that
   * cannot have work in flight may omit it.
   */
  drain?(): Promise<void>;
  /**
   * Retire one mission's lifecycle rows. Irreversible, scoped to the single id,
   * and never applied to recorded usage: a cancelled mission still cost what it
   * cost. Stores with no cancellation authority omit it.
   */
  cancel?(_id: MissionId): Promise<void>;
}

/**
 * A Mission store that can commit a lifecycle transition and the event that
 * describes it as one unit (ADR 0053 transaction rule 1).
 *
 * Both the SQLite adapter and the compatibility adapter satisfy this port; the
 * use cases never learn which one they hold.
 */
export interface MissionTransitionStore extends MissionStore {
  /**
   * `expectedVersion` follows the `save()` contract: `null` inserts, a value
   * compare-and-swaps. Mission intake is a lifecycle step like any other — the
   * insert and the lane event that records entry into `backlog` commit as one
   * unit rather than through a plain `save()` that leaves no history.
   */
  saveWithTransition(
    _mission: Mission,
    _expectedVersion: MissionVersion | null,
    _event: LaneTransitionEvent,
  ): Promise<MissionVersion>;
  /** Durable lane history, used only to refuse recovery after integration. */
  findTransitions?(_missionId: MissionId): Promise<readonly MissionTransitionHistoryEntry[]>;
}

/**
 * Durable recording of the structured NEL report produced at handoff.
 *
 * The record itself is derived Mission data. The port returns only the durable
 * reference the use case needs, and stale expected versions remain refused.
 */
export interface MissionNelRecorder {
  recordNel(
    _record: MissionNelRecord,
  ): Promise<MissionNelRecordReceipt>;
}

/** The durable reference for a recorded NEL report, never the payload. */
export interface MissionNelRecordReceipt {
  /** Locator of the durable record. */
  readonly reference: string;
}

/** A write refused because the caller's expected revision is no longer current. */
export class MissionStaleVersion extends Error {
  readonly disposition = 'stale-write' as const;

  constructor(
    readonly missionId: MissionId,
    readonly expectedVersion: MissionVersion | null,
    readonly actualVersion: MissionVersion | null,
  ) {
    super(
      `Stale write: mission ${missionId} expected version ` +
      `${expectedVersion ?? 'missing'}, found ${actualVersion ?? 'missing'}`,
    );
    this.name = 'MissionStaleVersion';
  }
}

/** True for any adapter-reported stale-write refusal, whichever store raised it. */
export function isStaleWrite(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { disposition?: string }).disposition === 'stale-write';
}

export interface AgentSelectionSnapshotPort {
  load(): Promise<AgentSelectionSnapshot>;
}

// ---------------------------------------------------------------------------
// Session marker port
// ---------------------------------------------------------------------------

/**
 * Application port for session marker operations.
 *
 * Exposes checked session marker behavior to callers (agent launchers, commands)
 * without exposing the SQLite adapter or file-based sessions module directly.
 * Domain `SessionMarker` types flow through this port; the adapter layer handles
 * the storage conversion.
 */
export interface SessionMarkerPort {
  /**
   * Find the session marker for a (mission, role) pair.
   * Returns `null` when no marker exists.
   */
  find(_missionId: MissionId, _role: SessionRole): Promise<SessionMarker | null>;

  /**
   * Save (upsert) a session marker. Idempotent for the same (mission, role).
   */
  save(_marker: SessionMarker): Promise<void>;

  /**
   * Remove the session marker for a (mission, role) pair.
   */
  delete(_missionId: MissionId, _role: SessionRole): Promise<void>;

  /**
   * Determine whether the given agent family should resume using the stored marker.
   * Returns `true` only when mission, role, and agent family all match the recorded marker.
   */
  shouldResume(_missionId: MissionId, _role: SessionRole, _agent: AgentFamily): Promise<boolean>;
}
