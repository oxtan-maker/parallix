import type { AgentFamily } from './agents.js';
import type { CheckpointData } from './checkpoint.js';
import type { ExternalTaskRef } from './external-task.js';
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
  /** Original raw status from the backlog file (e.g. "ready", "approved").
   * Preserves the legacy `px status` output contract. Mapped status is `status` field.
   * Optional for backward compatibility; defaults to mapped status when absent. */
  readonly rawStatus?: string;
  /** Intake traceability for accepted external material (ADR 0053).
   * A reference only: it never carries external lifecycle state or content.
   * Optional for backward compatibility; `null`/absent means intake recorded none. */
  readonly externalTaskRef?: ExternalTaskRef | null;
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

/** Facts an interface must supply before Parallix owns a Mission. */
export interface MissionIntake {
  readonly id: MissionId;
  readonly repositoryId: RepositoryId;
  readonly title: string;
  readonly labels?: readonly MissionLabel[];
  readonly assignee?: AgentFamily | null;
  /** Raw vocabulary from the intake source; retained for output compatibility. */
  readonly rawStatus?: string;
  /** Optional trace back to accepted external material (never an aggregate). */
  readonly externalTaskRef?: ExternalTaskRef | null;
}

/**
 * Materialize a new Mission at intake.
 *
 * Intake owns identity, repository ownership, description, and optional
 * external traceability only. Evidence (`checkpoints`), review conversation,
 * and change size are produced by later commands, so an intake that arrives
 * carrying them is rejected rather than silently trusted.
 */
export function intakeMission(intake: MissionIntake): OpenMission {
  if (!intake.title.trim()) {
    throw new MissionRuleViolation(`Mission ${intake.id} requires a non-empty title`);
  }
  if (!intake.repositoryId.trim()) {
    throw new MissionRuleViolation(`Mission ${intake.id} requires an owning repository`);
  }
  return {
    id: intake.id,
    repositoryId: intake.repositoryId,
    title: intake.title.trim(),
    labels: intake.labels === undefined ? [] : [...new Set(intake.labels)],
    assignee: intake.assignee ?? null,
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
    status: 'backlog',
    closedAt: null,
    ...(intake.rawStatus === undefined ? {} : { rawStatus: intake.rawStatus }),
    // Absent means "intake recorded no external trace"; the field is only
    // present when a reference was actually supplied.
    ...(intake.externalTaskRef ? { externalTaskRef: intake.externalTaskRef } : {}),
  };
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
