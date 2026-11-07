export interface OperationalHistoryEntry {
  readonly id?: number;
  readonly eventType: string;
  readonly eventData: string;
  readonly createdAt: string;
}

export interface OperationLogSummary {
  readonly operationId?: string;
  readonly sequence?: number;
  readonly id: number;
  readonly eventType: string;
  readonly createdAt: string;
  readonly message: string | null;
  readonly agent: string | null;
  /** The whole payload, present only when it is not a JSON object. */
  readonly rawData: string | null;
}

/** Minimal rebound-repair identity used by statistics; retained transcripts stay behind the adapter. */
export interface ReboundRepairHistoryEntry {
  readonly missionId: string;
  readonly occurrenceId: string;
  readonly reasonKind: string;
  readonly area: string | null;
  readonly agent: string;
  readonly durationMs?: number | null;
  readonly occurredAt: string;
}

export interface OperationalHistoryRepository {
  findAll(): Promise<readonly OperationalHistoryEntry[]>;
  /** Selected analytical event families without loading unrelated retained payloads. */
  findByTypes?(_types: readonly string[]): Promise<readonly OperationalHistoryEntry[]>;
  /** Minimal first observation for legacy Missions with no lane-transition history. */
  findEarliestForMissions?(_missionIds: readonly string[], _repositoryId: string): Promise<readonly OperationalHistoryEntry[]>;
  /** Minimal rebound identities for all Missions, without loading retained repair transcripts. */
  findReboundRepairs?(): Promise<readonly ReboundRepairHistoryEntry[]>;
  /**
   * The newest `limit` entries in ascending id order, reduced to what the board
   * log shows: the JSON payload's `message` and `agent`, or the raw text when
   * the payload is not a JSON object. Payloads can be megabytes (repair
   * transcripts), so they are never carried whole.
   */
  findRecentLogEntries?(_limit: number): Promise<readonly OperationLogSummary[]>;
  findByType(_type: string): Promise<readonly OperationalHistoryEntry[]>;
  findByTypeForMission?(_type: string, _missionId: string): Promise<readonly OperationalHistoryEntry[]>;
  append(_entry: OperationalHistoryEntry): Promise<void>;
  clear(): Promise<void>;
}

export interface BoardLaneEventEntry {
  readonly id?: number;
  readonly repositoryId: string;
  readonly missionId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly trigger: string;
  readonly agent: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
}

/** Read-only lifecycle history shape consumed by application projections. */
export type LifecycleHistoryEntry = BoardLaneEventEntry;

export interface BoardLaneEventRepository {
  append(_entry: BoardLaneEventEntry): Promise<boolean>;
  findByMissionId(_missionId: string): Promise<readonly BoardLaneEventEntry[]>;
  findAll(): Promise<readonly BoardLaneEventEntry[]>;
  findByRepositoryId(_repositoryId: string): Promise<readonly BoardLaneEventEntry[]>;
  clear(): Promise<void>;
}
