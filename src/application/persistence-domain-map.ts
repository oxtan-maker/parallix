// Checked inventory → domain resolution map.
//
// Every `ADR0053_PERSISTENCE_INVENTORY` entry classified
// `database-owned-domain-state` must resolve to exactly one of:
//
//   1. a named `src/domain` type, together with the invariant that governs it, or
//   2. an entry on the explicit technical-persistence-metadata list — schema and
//      migration identity, import identity, an idempotency key, or an opaque
//      operator setting that is deliberately NOT a domain entity.
//
// `test/persistence-domain-mapping.test.ts` enumerates the inventory and fails
// when an entry resolves to neither, to both, or to a concept the domain does
// not export. Entry ids are plain strings here on purpose: the ADR 0051
// dependency direction forbids `src/application` from importing the runtime
// module that owns the inventory, so the test performs the join instead.
//
// This module is data plus types only. It performs no IO and changes no
// persistence behavior; it is the checked statement of what already exists.

import {
  DOMAIN_CONCEPT_NAMES,
  type DomainConceptName,
} from './consumer-domain-requirements.js';

export type { DomainConceptName };

/** The rule that makes a domain concept more than a data shape. */
export interface DomainConceptInvariant {
  readonly concept: DomainConceptName;
  /** The invalid state the domain rejects. */
  readonly invariant: string;
  /** Repo-relative file where the invariant is enforced. */
  readonly fileLocation: string;
  /** 1-indexed line in `fileLocation`. */
  readonly line: number;
  /** Substring that must appear on `fileLocation:line`. */
  readonly anchor: string;
}

/**
 * One invariant per domain concept. A `database-owned-domain-state` entry may
 * only resolve to a concept that appears here, so "resolves to a domain type"
 * can never mean "resolves to a bare record shape".
 */
export const DOMAIN_CONCEPT_INVARIANTS: Readonly<
  Record<DomainConceptName, DomainConceptInvariant>
> = {
  Mission: {
    concept: 'Mission',
    invariant:
      'A mission cannot close before integration reports `done`, cannot close twice, and cannot close without an actual closure time; each violation throws MissionRuleViolation.',
    fileLocation: 'src/domain/mission.ts',
    line: 145,
    anchor: 'export function closeMission',
  },
  CheckpointData: {
    concept: 'CheckpointData',
    invariant:
      'Checkpoint evidence from another mission is rejected, and a checkpoint that is not handoff-ready cannot be recorded; a same-named checkpoint replaces rather than accumulates.',
    fileLocation: 'src/domain/checkpoint.ts',
    line: 45,
    anchor: 'export function recordCheckpoint',
  },
  Review: {
    concept: 'Review',
    invariant:
      'A reviewer decision is rejected unless the review is awaiting one, and request-changes is rejected without at least one identified finding carrying an id and summary.',
    fileLocation: 'src/domain/review.ts',
    line: 463,
    anchor: 'export function applyReviewerCommand',
  },
  MissionOutcome: {
    concept: 'MissionOutcome',
    invariant:
      'Completed statistics require a validated ClosedMission whose identity matches the outcome and whose NEL is recorded; a mismatch or missing NEL throws StatisticsRuleViolation.',
    fileLocation: 'src/domain/usage.ts',
    line: 152,
    anchor: 'export function completedMissionStatistics',
  },
  AgentRunMeasurement: {
    concept: 'AgentRunMeasurement',
    invariant:
      'Every measured dimension is a Measurement: a provider that cannot report a value yields `unavailable` with a reason, which must not be substituted with zero or an agent-family label.',
    fileLocation: 'src/domain/usage.ts',
    line: 5,
    anchor: 'export type Measurement',
  },
  KnownRepository: {
    concept: 'KnownRepository',
    invariant:
      'A repository identity is a non-empty trimmed RepositoryId; constructing one from blank input throws.',
    fileLocation: 'src/domain/repository.ts',
    line: 3,
    anchor: 'export function repositoryId',
  },
  SessionMarker: {
    concept: 'SessionMarker',
    invariant:
      'Resume is permitted only when mission, role, and agent family all match the recorded marker; a fallback to another family invalidates it.',
    fileLocation: 'src/domain/session.ts',
    line: 33,
    anchor: 'export function shouldResume',
  },
  LaneTransitionEvent: {
    concept: 'LaneTransitionEvent',
    invariant:
      'A lane transition is only recorded for a status pair the mission state machine owns; an unmodelled pair yields no trigger rather than a synthesised one.',
    fileLocation: 'src/domain/board-event.ts',
    line: 61,
    anchor: 'export function triggerFromTransition',
  },
  AgentBlock: {
    concept: 'AgentBlock',
    invariant:
      'A block is time-bounded, indefinite, or absent; an expired `until` block yields zero remaining time and therefore stops excluding its family from selection.',
    fileLocation: 'src/domain/agents.ts',
    line: 48,
    anchor: 'export function blockedForMs',
  },
} as const;

/** Why a durable value is persistence machinery rather than a domain entity. */
export type TechnicalMetadataKind =
  | 'schema-or-migration-identity'
  | 'import-identity'
  | 'idempotency-key'
  | 'opaque-operator-setting';

/**
 * The explicit technical-persistence-metadata list.
 *
 * Membership is a decision, not a fallback: each item states why it carries no
 * domain identity, lifecycle, or invariant, so a later mission cannot promote
 * it to an entity by schema convenience.
 */
export interface TechnicalPersistenceMetadata {
  readonly id: string;
  readonly kind: TechnicalMetadataKind;
  readonly fileLocation: string;
  readonly line: number;
  readonly anchor: string;
  readonly whyNotDomain: string;
}

export const TECHNICAL_PERSISTENCE_METADATA: readonly TechnicalPersistenceMetadata[] = [
  {
    id: 'sqlite-migration-identity',
    kind: 'schema-or-migration-identity',
    fileLocation: 'src/adapters/sqlite/migration-runner.ts',
    line: 25,
    anchor: 'export class SqliteMigrationRunner',
    whyNotDomain:
      'Ordered migration ids and their SHA-256 checksums describe the schema ledger. They have no mission, agent, or review meaning and no application command reads them as domain facts.',
  },
  {
    id: 'sqlite-import-identity',
    kind: 'import-identity',
    fileLocation: 'src/adapters/sqlite/importer.ts',
    line: 59,
    anchor: 'export class SqliteImporter',
    whyNotDomain:
      'Source path plus content digest exist to make an import idempotent. They identify a file that was read, not a domain entity, and are never surfaced to a consumer.',
  },
  {
    id: 'stage-launch-fingerprint',
    kind: 'idempotency-key',
    fileLocation: 'src/adapters/review/review-loop.ts',
    line: 64,
    anchor: 'function stageLaunchFingerprint',
    whyNotDomain:
      'An opaque token kept in review-state metadata, bounded to the last 20 per stage window, whose only use is refusing to accumulate the same measurement twice. Nothing resolves it back to a launch, so it is not an Attempt identity (see PER_LAUNCH_IDENTITY_DECISION).',
  },
  {
    id: 'ui-preferences-key-value',
    kind: 'opaque-operator-setting',
    fileLocation: 'src/adapters/sqlite/ui-preferences-repository.ts',
    line: 12,
    anchor: 'export class SqliteUIPreferencesRepository',
    whyNotDomain:
      'An opaque (key, value, updatedAt) settings store with no validation, no relationship to Mission, and no production consumer outside the adapter itself. It carries an operator display choice, not a domain rule.',
  },
] as const;

/** How one `database-owned-domain-state` inventory entry is accounted for. */
export type InventoryDomainResolution =
  | { readonly kind: 'domain-type'; readonly concept: DomainConceptName }
  | { readonly kind: 'technical-persistence-metadata'; readonly metadataId: string };

export interface TechnicalInventoryResolution {
  /** `id` of an `ADR0053_PERSISTENCE_INVENTORY` entry. */
  readonly entryId: string;
  readonly metadataId: string;
}

/**
 * The exceptional inventory entries that resolve to persistence machinery.
 *
 * Domain-owned entries do not appear here: their inventory `concept` resolves
 * directly through `DOMAIN_CONCEPT_NAMES`. Keeping only exceptions avoids
 * mirroring the executable inventory's entry-id-to-concept mapping.
 */
export const TECHNICAL_INVENTORY_RESOLUTIONS: readonly TechnicalInventoryResolution[] = [
  // UIPreferences — no domain type, and deliberately none: an opaque operator
  // setting store with no invariant and no consumer beyond its own adapter.
  { entryId: 'ui-prefs-sqlite-read', metadataId: 'ui-preferences-key-value' },
  { entryId: 'ui-prefs-sqlite-write', metadataId: 'ui-preferences-key-value' },

  // LargeArtifacts entries that are database-owned: schema and import identity.
  { entryId: 'artifacts-sqlite-importer-read', metadataId: 'sqlite-import-identity' },
  { entryId: 'artifacts-sqlite-migration-read', metadataId: 'sqlite-migration-identity' },
] as const;

/**
 * Resolve one executable-inventory entry without copying its concept here.
 *
 * The test layer owns the ADR 0051 boundary-crossing join and supplies the
 * inventory's checked `entryId` and `concept`.
 */
export function resolveInventoryEntry(
  entryId: string,
  concept: string,
): InventoryDomainResolution | undefined {
  if ((DOMAIN_CONCEPT_NAMES as readonly string[]).includes(concept)) {
    return { kind: 'domain-type', concept: concept as DomainConceptName };
  }
  const technicalResolution = TECHNICAL_INVENTORY_RESOLUTIONS.find(
    (entry) => entry.entryId === entryId,
  );
  return technicalResolution === undefined
    ? undefined
    : {
        kind: 'technical-persistence-metadata',
        metadataId: technicalResolution.metadataId,
      };
}

/** Technical-metadata item by id, or `undefined` when the id is unknown. */
export function technicalMetadata(id: string): TechnicalPersistenceMetadata | undefined {
  return TECHNICAL_PERSISTENCE_METADATA.find((item) => item.id === id);
}
