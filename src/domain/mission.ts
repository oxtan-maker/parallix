import { failureReason as reason, type FailureReason } from './failure-reason.js';
import type { AgentFamily } from './agents.js';
import type { CheckpointData } from './checkpoint.js';
import type { ExternalTaskRef } from './external-task.js';
import type { RepositoryId } from './repository.js';
import type { Review } from './review.js';
import type { MissionBrief } from './mission-brief.js';
import type { NelBucketLabel } from './net-engineering-lines.js';
import { toCanonicalUtcInstant } from './instant.js';
import type { DefectProvenance } from './defect-provenance.js';

export type MissionId = string & { readonly __brand: 'MissionId' };
export type MissionSlug = MissionId;

const MISSION_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+$/;

export function missionId(value: string): MissionId {
  if (typeof value !== 'string' || !MISSION_SLUG_PATTERN.test(value)) {
    throw new Error(`Invalid mission slug: ${JSON.stringify(value)}`);
  }
  return value as MissionId;
}

export const missionSlug = missionId;

/**
 * The one grammar for the DB-owned `px-` namespace (task-2468, PX-0045): a
 * counter-minted `px-<NNNN>` and the wave child `px-<NNNN>.<NN>` that `px split`
 * mints from a `px-` parent. It is kept as a source string so
 * `isMissionSlugCandidate` composes the same grammar instead of restating it.
 * The child position is the one-based, zero-padded slot that
 * `convertMissionToWave` emits for `0 < position < 100`, so `.00` is not an
 * identity and a nested `px-<NNNN>.<NN>.<NN>` is deliberately absent:
 * `convertMissionToWave` refuses a dotted parent, so a wave child is never a
 * wave parent.
 */
const PX_IDENTITY_SOURCE = 'px-\\d{4,}(?:\\.(?:0[1-9]|[1-9][0-9]))?';
const PX_IDENTITY_PATTERN = new RegExp(`^${PX_IDENTITY_SOURCE}$`, 'i');
const MISSION_SLUG_CANDIDATE_PATTERN = new RegExp(`^(?:(?:task|adhoc)-[a-z0-9][a-z0-9.-]*|${PX_IDENTITY_SOURCE})$`, 'i');

/**
 * A DB-owned Mission identity is in the `px-` namespace (task-2468, PX-0045):
 * either a counter-minted `px-<NNNN>` whose slug, mission id, branch, and
 * worktree suffix all derive from a repository-scoped counter, or the wave
 * child `px-<NNNN>.<NN>` that `px split` minted from a `px-` parent. Both are
 * born in the operator store and own no Backlog task file. Unlike
 * `isMissionSlugCandidate`, this recognizes only the DB-owned namespace — the
 * `task-` and legacy `adhoc-` backings are intentionally excluded — so callers
 * can tell a DB-authoritative identity from a file-backed one without a
 * filesystem read.
 *
 * @param {unknown} value
 */
export function isDbOwnedPxIdentity(value: unknown): boolean {
  return typeof value === 'string' && PX_IDENTITY_PATTERN.test(value.trim());
}

/** The aggregate-backed decision for whether a Mission owns a Backlog mirror. */
export type BacklogMirrorOwnership =
  | { readonly kind: 'none'; readonly authority: 'mission'; readonly reason: 'db-owned-px' | 'wave-child' }
  | { readonly kind: 'required'; readonly authority: 'backlog' };

/**
 * Decide Backlog mirror ownership from persisted Mission facts.
 *
 * Counter-minted `px-*` Missions are DB-owned by identity. Wave children are
 * DB-owned because the persisted aggregate names the parent that minted them;
 * their dotted spelling is deliberately irrelevant. Every other Mission keeps
 * the strict Backlog-mirror contract.
 */
export function backlogMirrorOwnership(
  mission: Pick<MissionData, 'id' | 'waveParentId'>,
): BacklogMirrorOwnership {
  if (isDbOwnedPxIdentity(mission.id)) {
    return { kind: 'none', authority: 'mission', reason: 'db-owned-px' };
  }
  if (mission.waveParentId !== null && mission.waveParentId !== undefined) {
    return { kind: 'none', authority: 'mission', reason: 'wave-child' };
  }
  return { kind: 'required', authority: 'backlog' };
}

/**
 * Whether a value is an attempted reference into the `px-` namespace rather
 * than a valid identity (PX-0045): a single whitespace-free token that starts
 * with `px-<digits>.` but is not a valid child identity. An interface uses this
 * to refuse a malformed or nested child reference instead of letting it fall
 * through to free-text intake, which mints an unrelated counter identity and
 * drafts the wrong Mission. It is deliberately broader than
 * `isDbOwnedPxIdentity` in digit count — `px-41.01` and `px-041.01` are
 * mis-typed child references, not free text — and deliberately narrower in
 * shape: the whole value must be one token, so free text that merely starts
 * with a dotted id (`px-0041.01 fix the parent link`) keeps its preserved
 * free-text intake. It recognizes the attempt, never a stored Mission; a zero
 * position (`px-0041.00`) is an attempt too, because `convertMissionToWave`
 * numbers children from `01`.
 *
 * @param {unknown} value
 */
export function isPxIdentityReference(value: unknown): boolean {
  return typeof value === 'string' && /^px-\d+\.\S*$/i.test(value.trim());
}

/**
 * A legacy free-text identity (`parallix-adhoc-<…>`) minted before the
 * DB-owned `px-<NNNN>` scheme (task-2706). These records carry no
 * repository-scoped counter, so the migration rewrites them to a counter-owned
 * `px-<NNNN>` id. Recognized only here so the migration targets the legacy
 * namespace precisely and never touches a `task-` or existing `px-` id.
 *
 * @param {unknown} value
 */
export function isLegacyAdhocIdentity(value: unknown): boolean {
  return typeof value === 'string' && /^parallix-adhoc-.+$/i.test(value.trim());
}

/**
 * A mission slug candidate is one of three backings: `task-<…>` (a Backlog
 * task, including a dotted `task-<NNNN>.<NN>` wave child), `adhoc-<…>` (the
 * legacy free-text identity, still accepted so an existing `adhoc-*` mission
 * stays resolvable), or the DB-owned `px-` namespace: `px-<NNNN>` minted by
 * `allocateAdhocIdentity` and the `px-<NNNN>.<NN>` wave child minted by
 * `px split`. No content hash: the counter or the parent wave is the sole
 * origin, so slug, mission id, branch, and worktree suffix stay one derivable
 * identity.
 *
 * Lives in the domain layer (task-2468, F7): it is a pure predicate over a slug
 * string with no filesystem dependency, so the shared validator has no adapter
 * edge and `execute-mission-service` can import it from the domain without a
 * boundary-allowlisted application→adapter import.
 *
 * @param {unknown} value
 */
export function isMissionSlugCandidate(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    MISSION_SLUG_CANDIDATE_PATTERN.test(value.trim())
  );
}

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
  /**
   * Free text captured at creation before any brief exists. The brief stays the
   * contract: refinement still requires goal and why, and a refining agent
   * derives them from this text. Null when none was captured.
   */
  readonly description?: string | null;
  /** Open-ended Backlog labels; hypotheses and bug status are independent dimensions. */
  readonly labels: readonly MissionLabel[];
  readonly assignee: AgentFamily | null;
  readonly checkpoints: readonly CheckpointData[];
  /** What the mission is for (ADR 0053). Null until a drafting agent records it. */
  readonly brief?: MissionBrief | null;
  /** The exact commands review preparation runs for this mission. Empty until declared. */
  readonly declaredGates?: readonly string[];
  /** What must be true for the mission to be done. Empty until the draft records them. */
  readonly successCriteria?: readonly string[];
  /** Stable mission-scoped identities, parallel to successCriteria. */
  readonly successCriterionIds?: readonly string[];
  readonly nextSuccessCriterionId?: number;
  /** Zero-based positions in `successCriteria` marked complete. Empty until marked. */
  readonly completedSuccessCriteria?: readonly number[];
  /**
   * Missions this one is recorded as depending on. Read by operators and agents
   * only: no lifecycle, activation or scheduling rule consumes them.
   */
  readonly dependencies?: readonly MissionId[];
  /** A converted Mission is a planning container, never an executable delivery Mission. */
  readonly wave?: { readonly children: readonly MissionId[] } | null;
  /** The converted parent that assigned this independently deliverable child its identity. */
  readonly waveParentId?: MissionId | null;
  /** Operator authorization for accepting one Large Mission instead of a safer wave. */
  readonly largeMissionRiskException?: {
    readonly rationale: string;
    readonly approvedBy: string;
    readonly approvedAt: string;
  } | null;
  /**
   * The draft's size prediction, compared at review preparation with the measured NEL
   * bucket for the calibration ADR 0047 describes. Null until predicted.
   */
  readonly predictedNelBucket?: NelBucketLabel | null;
  /**
   * Path to the red-to-green reproduction test a bug mission declares.
   *
   * Mission state rather than a `Reproduction-Test:` line in MISSION.md: the
   * red-to-green gate is a live consumer, and a repository file was the only
   * way to reach it, which is what kept the draft prompt telling agents to
   * write one. Null for a mission with no reproduction test.
   */
  readonly reproductionTest?: string | null;
  /** Causal investigation recorded for a bug-labelled Mission. */
  readonly defectProvenance?: DefectProvenance | null;
  readonly review: Review | null;
  /** Early preparation still owes verified submission, including after a restart. */
  readonly reviewPreparationPending?: true;
  /** Captured at review preparation; null until the change-size measurement exists. */
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

  constructor(message: string, readonly failureReason: FailureReason = reason('state-machine', 'lifecycle')) {
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
  readonly description?: string | null;
  /** Raw vocabulary from the intake source; retained for output compatibility. */
  readonly rawStatus?: string;
  /** Optional trace back to accepted external material (never an aggregate). */
  readonly externalTaskRef?: ExternalTaskRef | null;
}

const BLOCK_SCALAR_TITLE = /^(?:>|\|)[-+]?\d*$/;

/** A YAML scalar header is syntax, never a usable Mission title. */
export function missionTitle(value: string, fallback: string): string {
  const title = value.trim();
  return title && !BLOCK_SCALAR_TITLE.test(title) ? title : fallback;
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
    title: missionTitle(intake.title, intake.id),
    labels: intake.labels === undefined ? [] : [...new Set(intake.labels)],
    assignee: intake.assignee ?? null,
    ...(intake.description ? { description: intake.description } : {}),
    checkpoints: [],
    brief: null,
    declaredGates: [],
    successCriteria: [],
    completedSuccessCriteria: [],
    dependencies: [],
    wave: null,
    waveParentId: null,
    largeMissionRiskException: null,
    predictedNelBucket: null,
    reproductionTest: null,
    defectProvenance: null,
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
  // Canonicalize at the domain boundary (TASK-2688): a closed Mission carries
  // the UTC ISO-8601 instant in memory and on disk, so no writer can persist an
  // explicit-offset spelling and no reader must guess a timezone.
  return { ...mission, status: 'done', closedAt: toCanonicalUtcInstant(closedAt) };
}

export function requireClosedMission(mission: Mission): ClosedMission {
  if (!isClosedMission(mission)) {
    throw new MissionRuleViolation(`Mission ${mission.id} is not closed`);
  }
  return mission;
}
