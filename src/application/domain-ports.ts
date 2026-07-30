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

/** Persistence ports belong to the application layer; the domain stays store-agnostic. */
export interface MissionStore {
  load(_id: MissionId): Promise<MissionLoadResult>;
  /**
   * Insert when expectedVersion is null, otherwise compare-and-swap the exact
   * aggregate revision returned by load().
   */
  save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion>;
}

/**
 * A Mission store that can commit a lifecycle transition and the event that
 * describes it as one unit (ADR 0053 transaction rule 1).
 *
 * Both the SQLite adapter and the compatibility adapter satisfy this port; the
 * use cases never learn which one they hold.
 */
export interface MissionTransitionStore extends MissionStore {
  saveWithTransition(
    _mission: Mission,
    _expectedVersion: MissionVersion,
    _event: LaneTransitionEvent,
  ): Promise<MissionVersion>;
}

/**
 * Durable recording of the structured NEL report produced at handoff.
 *
 * The record itself is derived Mission data. The port exists so the use case
 * never learns whether the selected authority writes a compatibility JSON
 * document or a database row, and so a stale expected version is still refused.
 */
export interface MissionNelRecorder {
  recordNel(
    _record: MissionNelRecord,
  ): Promise<MissionNelRecordReceipt>;
}

/** Where the recorded NEL report landed. A reference, never the payload. */
export interface MissionNelRecordReceipt {
  /** Locator of the durable record, e.g. a document path or a row identity. */
  readonly reference: string;
  /** Authority that accepted the write. */
  readonly authority: 'compatibility' | 'sqlite';
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
