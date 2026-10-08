export interface OperationalHistoryEntry {
  readonly id?: number;
  readonly eventType: string;
  readonly eventData: string;
  readonly createdAt: string;
}

export interface OperationLogSummary {
  readonly id: number;
  readonly eventType: string;
  readonly createdAt: string;
  readonly message: string | null;
  readonly agent: string | null;
  /** The whole payload, present only when it is not a JSON object. */
  readonly rawData: string | null;
}

export interface OperationalHistoryRepository {
  findAll(): Promise<readonly OperationalHistoryEntry[]>;
  /**
   * The newest `limit` entries in ascending id order, reduced to what the board
   * log shows: the JSON payload's `message` and `agent`, or the raw text when
   * the payload is not a JSON object. Payloads can be megabytes (repair
   * transcripts), so they are never carried whole.
   */
  findRecentLogEntries?(_limit: number): Promise<readonly OperationLogSummary[]>;
  findByType(_type: string): Promise<readonly OperationalHistoryEntry[]>;
  findByTypeForMission?(_type: string, _missionId: string): Promise<readonly OperationalHistoryEntry[]>;
  /** Latest facts per mission for the board's bounded current-work read. */
  findLatestByTypePerMission?(_type: string, _limitPerMission: number): Promise<readonly OperationalHistoryEntry[]>;
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

export interface BoardLaneEventRepository {
  append(_entry: BoardLaneEventEntry): Promise<boolean>;
  findByMissionId(_missionId: string): Promise<readonly BoardLaneEventEntry[]>;
  findAll(): Promise<readonly BoardLaneEventEntry[]>;
  findByRepositoryId(_repositoryId: string): Promise<readonly BoardLaneEventEntry[]>;
  clear(): Promise<void>;
}
