import {
  closeMission,
  type Mission,
  type MissionData,
  type MissionStatus,
  type OpenMission,
} from '../../domain/mission.js';

/** Adapter-neutral mission data read from one committed repository view. */
export type BacklogMissionRecord = MissionData & {
  readonly status: MissionStatus;
  /** Original raw status from backlog file (e.g. "ready", "approved").
   * Optional for backward compatibility; defaults to mapped status when absent. */
  readonly rawStatus?: string;
};

/** Map current persisted and virtual Backlog vocabulary into domain states. */
export function missionStatusFromBacklog(value: string): MissionStatus | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ready' || normalized === 'refined') { return 'refined'; }
  if (
    normalized === 'approved'
    || normalized === 'ready-for-integration'
    || normalized === 'integration'
  ) {
    return 'integration';
  }
  if (['backlog', 'active', 'review', 'done'].includes(normalized)) {
    return normalized as MissionStatus;
  }
  return null;
}

/**
 * Facts a task-authority adapter must reconcile before exposing a Mission.
 * For the Backlog/Git adapter, `integrationBase` is main (or the recorded
 * feature base), and `completionRecorded` means the committed task is `done`
 * in the completed-task store.
 */
export type IntegrationBaseRead =
  | { readonly kind: 'found'; readonly mission: BacklogMissionRecord; readonly completionRecorded: boolean }
  | { readonly kind: 'missing' }
  | { readonly kind: 'conflict' };

export type MissionWorktreeRead =
  | { readonly kind: 'found'; readonly mission: BacklogMissionRecord }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

export interface BacklogMissionSnapshot {
  readonly integrationBase: IntegrationBaseRead;
  readonly missionWorktree: MissionWorktreeRead;
  readonly closedAt: string | null;
}

export type BacklogMissionMaterializationFailure =
  | 'integration-base-missing'
  | 'integration-base-conflict'
  | 'identity-conflict'
  | 'worktree-unreadable'
  | 'completion-conflict'
  | 'closure-before-worktree-removal'
  | 'closure-time-missing';

export type BacklogMissionMaterializationResult =
  | {
    readonly kind: 'found';
    readonly mission: Mission;
    readonly contentSource: 'integration-base' | 'mission-worktree';
  }
  | {
    readonly kind: 'unavailable';
    readonly reason: BacklogMissionMaterializationFailure;
  };

function openMission(
  record: BacklogMissionRecord,
  status: MissionStatus,
  assignee = record.assignee,
): OpenMission {
  return { ...record, status, assignee, closedAt: null };
}

function sameMission(left: BacklogMissionRecord, right: BacklogMissionRecord): boolean {
  return left.id === right.id && left.repositoryId === right.repositoryId;
}

/**
 * Lifecycle and assignment come from the committed integration-base view.
 * While work is open, the mission worktree may provide newer descriptive and
 * evidence fields. Once integration is done, the merged base view provides all
 * content and closure waits for worktree removal.
 */
export function materializeBacklogMission(
  snapshot: BacklogMissionSnapshot,
): BacklogMissionMaterializationResult {
  if (snapshot.integrationBase.kind === 'missing') {
    return { kind: 'unavailable', reason: 'integration-base-missing' };
  }
  if (snapshot.integrationBase.kind === 'conflict') {
    return { kind: 'unavailable', reason: 'integration-base-conflict' };
  }
  const base = snapshot.integrationBase.mission;

  if ((base.status === 'done') !== snapshot.integrationBase.completionRecorded) {
    return { kind: 'unavailable', reason: 'completion-conflict' };
  }

  if (
    snapshot.missionWorktree.kind === 'found'
    && !sameMission(base, snapshot.missionWorktree.mission)
  ) {
    return { kind: 'unavailable', reason: 'identity-conflict' };
  }

  if (base.status === 'done') {
    const integrated = openMission(base, 'done');
    if (snapshot.missionWorktree.kind !== 'absent') {
      if (snapshot.closedAt !== null) {
        return { kind: 'unavailable', reason: 'closure-before-worktree-removal' };
      }
      return { kind: 'found', mission: integrated, contentSource: 'integration-base' };
    }
    if (!snapshot.closedAt?.trim()) {
      return { kind: 'unavailable', reason: 'closure-time-missing' };
    }
    return {
      kind: 'found',
      mission: closeMission(integrated, snapshot.closedAt),
      contentSource: 'integration-base',
    };
  }

  if (snapshot.closedAt !== null) {
    return { kind: 'unavailable', reason: 'completion-conflict' };
  }

  if (snapshot.missionWorktree.kind === 'unreadable') {
    return { kind: 'unavailable', reason: 'worktree-unreadable' };
  }
  const content = snapshot.missionWorktree.kind === 'found'
    ? snapshot.missionWorktree.mission
    : base;
  if (!sameMission(base, content)) {
    return { kind: 'unavailable', reason: 'identity-conflict' };
  }
  return {
    kind: 'found',
    mission: openMission(content, base.status, base.assignee),
    contentSource: snapshot.missionWorktree.kind === 'found'
      ? 'mission-worktree'
      : 'integration-base',
  };
}
