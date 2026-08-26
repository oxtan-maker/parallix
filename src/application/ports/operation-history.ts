export interface OperationalHistoryEntry {
  readonly id?: number;
  readonly eventType: string;
  readonly eventData: string;
  readonly createdAt: string;
}

export interface OperationalHistoryRepository {
  findAll(): Promise<readonly OperationalHistoryEntry[]>;
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
