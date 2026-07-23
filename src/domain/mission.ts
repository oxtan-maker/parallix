import type { AgentFamily } from './agents.js';
import type { CheckpointData } from './checkpoint.js';
import type { RepositoryId } from './repository.js';
import type { Review } from './review.js';

export type MissionId = string & { readonly __brand: 'MissionId' };
export type MissionSlug = MissionId;

const MISSION_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

export function missionId(value: string): MissionId {
  if (typeof value !== 'string' || !MISSION_SLUG_PATTERN.test(value)) {
    throw new Error(`Invalid mission slug: ${JSON.stringify(value)}`);
  }
  return value as MissionId;
}

export const missionSlug = missionId;

export const MISSION_STATUSES = [
  'backlog',
  'refined',
  'active',
  'review',
  'integration',
  'done',
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];
export type MissionLabel = string & { readonly __brand: 'MissionLabel' };

export function missionLabel(value: string): MissionLabel {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error('Mission label cannot be empty');
  }
  return normalized as MissionLabel;
}

export function missionLabels(values: readonly string[]): readonly MissionLabel[] {
  return [...new Set(values.map(missionLabel))];
}

export interface MissionData {
  readonly id: MissionId;
  readonly repositoryId: RepositoryId;
  readonly title: string;
  /** Open-ended Backlog labels; hypotheses and bug status are independent dimensions. */
  readonly labels: readonly MissionLabel[];
  readonly assignee: AgentFamily | null;
  readonly checkpoints: readonly CheckpointData[];
  readonly review: Review | null;
  /** Captured at handoff; null until the change-size measurement exists. */
  readonly netEngineeringLines: number | null;
}

/** Includes the intentional post-integration, pre-cleanup `done` state. */
export type OpenMission = MissionData & {
  readonly status: MissionStatus;
  readonly closedAt: null;
};

export type ClosedMission = MissionData & {
  readonly status: 'done';
  readonly closedAt: string;
};

export type Mission = OpenMission | ClosedMission;

export class MissionRuleViolation extends Error {
  readonly disposition = 'human-only' as const;

  constructor(message: string) {
    super(message);
    this.name = 'MissionRuleViolation';
  }
}

export function recordNetEngineeringLines(mission: Mission, value: number): Mission {
  if (!Number.isInteger(value) || value < 0) {
    throw new MissionRuleViolation(`NEL must be a non-negative integer; got ${value}`);
  }
  return { ...mission, netEngineeringLines: value };
}

export function isClosedMission(mission: Mission): mission is ClosedMission {
  return mission.status === 'done' && mission.closedAt !== null;
}

export function closeMission(mission: Mission, closedAt: string): ClosedMission {
  if (isClosedMission(mission)) {
    throw new MissionRuleViolation(`Mission ${mission.id} is already closed`);
  }
  if (mission.status !== 'done') {
    throw new MissionRuleViolation(`Mission ${mission.id} cannot close before integration is done`);
  }
  if (!closedAt.trim()) {
    throw new MissionRuleViolation(`Mission ${mission.id} requires an actual closure time`);
  }
  return { ...mission, status: 'done', closedAt };
}

export function requireClosedMission(mission: Mission): ClosedMission {
  if (!isClosedMission(mission)) {
    throw new MissionRuleViolation(`Mission ${mission.id} is not closed`);
  }
  return mission;
}
