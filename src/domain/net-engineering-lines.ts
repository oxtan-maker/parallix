/**
 * Net Engineering Lines (NEL) policy and the handoff record derived from it.
 *
 * The bucket terciles are the empirical thresholds recorded in ADR 0047. They
 * live in the domain because the classification is a rule, not a persistence or
 * Git concern: computing the raw line count from a diff stays in the Git
 * adapter, while what a count *means* is decided here.
 *
 * ADR 0053 keeps `Mission.netEngineeringLines` as the authoritative Mission
 * field and keeps large generated artifacts (diffs, logs, captures) outside the
 * database. `ArtifactReference` is the checked shape of "reference, not blob":
 * it carries a locator and a size, and rejects embedded artifact content.
 */

import type { Mission, MissionId } from './mission.js';

export const BUCKET_SMALL_MAX = 80;
export const BUCKET_MEDIUM_MAX = 235;

export type NelBucketLabel = 'Small' | 'Medium' | 'Large';

export interface NelBucket {
  readonly label: NelBucketLabel;
  readonly min: number;
  readonly max: number;
}

export class NelRuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NelRuleViolation';
  }
}

/** Classify a NEL count into its ADR 0047 bucket. */
export function classifyNelBucket(nel: number): NelBucket {
  if (nel <= BUCKET_SMALL_MAX) {
    return { label: 'Small', min: 0, max: BUCKET_SMALL_MAX };
  }
  if (nel <= BUCKET_MEDIUM_MAX) {
    return { label: 'Medium', min: BUCKET_SMALL_MAX + 1, max: BUCKET_MEDIUM_MAX };
  }
  return { label: 'Large', min: BUCKET_MEDIUM_MAX + 1, max: Infinity };
}

export type ArtifactKind = 'file' | 'git-range' | 'url';

/** A pointer to material the owning tool keeps; never the material itself. */
export interface ArtifactReference {
  readonly kind: ArtifactKind;
  /** Single-line locator: a repo-relative path, a Git range, or a URL. */
  readonly location: string;
  /** Observed size of the referenced material, or null when unmeasured. */
  readonly byteSize: number | null;
}

/** A locator stays short and single-line; anything larger is content. */
const MAX_LOCATION_LENGTH = 1024;

export function artifactReference(
  kind: ArtifactKind,
  location: string,
  byteSize: number | null = null,
): ArtifactReference {
  const normalized = location.trim();
  if (normalized.length === 0) {
    throw new NelRuleViolation('Artifact reference requires a location');
  }
  if (/[\r\n\0]/.test(normalized)) {
    throw new NelRuleViolation(
      'Artifact reference must be a locator, not embedded artifact content',
    );
  }
  if (normalized.length > MAX_LOCATION_LENGTH) {
    throw new NelRuleViolation(
      `Artifact reference exceeds ${MAX_LOCATION_LENGTH} characters; store a reference, not the artifact`,
    );
  }
  if (byteSize !== null && (!Number.isInteger(byteSize) || byteSize < 0)) {
    throw new NelRuleViolation(`Artifact size must be a non-negative integer; got ${byteSize}`);
  }
  return { kind, location: normalized, byteSize };
}

/**
 * The structured NEL data a handoff reports.
 *
 * Every field is derived from the Mission aggregate plus the intake-time
 * prediction: nothing here is a second stored authority. `reviewRounds` comes
 * from the review conversation the Mission already owns.
 */
export interface MissionNelRecord {
  readonly missionId: MissionId;
  readonly predictedBucket: NelBucketLabel | 'Unknown';
  readonly netEngineeringLines: number;
  readonly actualBucket: NelBucketLabel;
  readonly reviewRounds: number;
  readonly capturedAt: string;
  /** Large generated evidence stays referenced, never inlined. */
  readonly artifacts: readonly ArtifactReference[];
}

export interface MissionNelRecordInput {
  readonly predictedBucket?: NelBucketLabel | 'Unknown';
  readonly capturedAt: string;
  readonly artifacts?: readonly ArtifactReference[];
  /**
   * Round count observed by the caller's review surface. Omit it to derive the
   * count from the Mission's own review conversation; a supplied value must
   * still be a positive integer.
   */
  readonly reviewRounds?: number;
}

/** Derive the reported NEL record from a Mission whose NEL is recorded. */
export function missionNelRecord(
  mission: Mission,
  input: MissionNelRecordInput,
): MissionNelRecord {
  if (mission.netEngineeringLines === null) {
    throw new NelRuleViolation(
      `Mission ${mission.id} has no recorded NEL to report`,
    );
  }
  if (!input.capturedAt.trim()) {
    throw new NelRuleViolation(`Mission ${mission.id} requires an actual capture time`);
  }
  if (input.reviewRounds !== undefined
    && (!Number.isInteger(input.reviewRounds) || input.reviewRounds < 1)) {
    throw new NelRuleViolation(
      `Review round count must be a positive integer; got ${input.reviewRounds}`,
    );
  }
  return {
    missionId: mission.id,
    predictedBucket: input.predictedBucket ?? 'Unknown',
    netEngineeringLines: mission.netEngineeringLines,
    actualBucket: classifyNelBucket(mission.netEngineeringLines).label,
    reviewRounds: input.reviewRounds
      ?? (mission.review === null ? 1 : Math.max(1, mission.review.rounds.length)),
    capturedAt: input.capturedAt,
    artifacts: input.artifacts ?? [],
  };
}
