/**
 * Legacy import contract: the services, options, report shape, and the
 * classification tables that decide which legacy records can be imported.
 */

import type { Capability } from '../../application/contracts.js';
import type { MissionStore, MissionTransitionHistoryEntry } from '../../application/domain-ports.js';
import type { MissionIntakeRequest, MissionIntakeResult } from '../../application/mission-intake-service.js';
import type { MissionDependenciesResult, SetMissionDependenciesRequest } from '../../application/mission-brief-service.js';
import type { ApplicationOutcome } from '../../application/contracts.js';
import { type MissionId, type MissionStatus } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';

/** The owning system recorded on every imported Mission's `ExternalTaskRef`. */
export const LEGACY_TASK_SOURCE = 'backlog-md';

/**
 * Frontmatter keys `Mission` represents. Everything else a legacy file carries
 * (`priority`, `ordinal`, `created_date`, `milestone`, …) is reported by name
 * rather than given an invented Mission field.
 */
export const REPRESENTED_KEYS: readonly string[] = [
  'id', 'title', 'status', 'assignee', 'labels', 'dependencies',
];
/** Explicitly retired by the operator; canonical body remains in the archive. */
export const RETIRED_KEYS: readonly string[] = [
  'priority', 'references', 'ordinal', 'parent_task_id', 'documentation',
  'modified_files', 'created_date', 'updated_date', 'milestone',
  'completed_date', 'operator_note', 'mission_contract',
];

/** Lanes whose live evidence cannot be inferred from historical task files. */
export const UNIMPORTABLE_LANES: Readonly<Record<Exclude<MissionStatus, 'backlog'>, string>> = {
  refined: 'needs a recorded contract',
  active: 'needs a recorded contract',
  review: 'needs checkpoint and review evidence',
  integration: 'needs checkpoint and review evidence',
  done: 'needs checkpoint and review evidence',
};

export const INTAKE_CAPABILITY: ReadonlySet<Capability> = new Set<Capability>(['mission:intake']);
export const CONTEXT_CAPABILITY: ReadonlySet<Capability> = new Set<Capability>(['mission:context']);
export const OBSOLETE_LEGACY_DEPENDENCIES = new Set(['TASK-1233', 'TASK-1265', 'TASK-1285', 'TASK-2500']);

/** The existing Mission use cases the importer writes through; no new port. */
export interface MissionImportServices {
  readonly repositoryId: RepositoryId;
  readonly store: MissionStore & {
    findTransitions?(_missionId: MissionId): Promise<readonly MissionTransitionHistoryEntry[]>;
  };
  readonly intake: {
    execute(_request: MissionIntakeRequest): Promise<ApplicationOutcome<MissionIntakeResult>>;
  };
  /** The same use case `px depends` writes through. */
  readonly dependencies: {
    setDependencies(
      _request: SetMissionDependenciesRequest,
    ): Promise<ApplicationOutcome<MissionDependenciesResult>>;
  };
}

export interface LegacyImportOptions {
  /** Repository root holding the legacy task tree. */
  readonly rootDir: string;
  /** Report only; no Mission row is written. */
  readonly dryRun?: boolean;
  /** Refresh imported Missions without ingesting native Missions or future backlog items. */
  readonly existingOnly?: boolean;
  /** Occurrence time recorded on intake and lane events; defaults to now. */
  readonly now?: string;
  /**
   * The commit the legacy files are read at, pinned into each imported trace.
   * Defaults to the checkout's `HEAD`.
   */
  readonly commit?: string | null;
  /** One-shot, artifact-verified replacement of disputed historical CP rows. */
  readonly reconcileCheckpoints?: boolean;
}

export interface LegacyImportReport {
  /** Legacy source records found across every scanned location. */
  readonly discovered: number;
  /** Missions created, or in a dry run that would be created. */
  readonly importable: number;
  /** Legacy checkpoint files whose parsed data would be attached to a Mission. */
  readonly checkpointFilesImportable: number;
  /** Legacy ids an existing Mission already traces with agreeing material. */
  readonly alreadyMaterialized: number;
  /** Records refused because a human decision is required. */
  readonly conflicting: number;
  /** Records in a legacy lane past `backlog`, reported for TASK-2521.06. */
  readonly deferred: number;
  /** Records carrying at least one field `Mission` cannot represent. */
  readonly unrepresented: number;
  readonly dryRun: boolean;
  /** One line per refusal, naming the legacy id and the reason. */
  readonly conflicts: readonly string[];
  /** One line per deferred record, naming the legacy id, lane and reason. */
  readonly deferredRecords: readonly string[];
  /** One line per legacy dependency that resolves to no Mission. */
  readonly unresolvedDependencies: readonly string[];
  /** Proven stale links retained in the pinned source body, not current graph edges. */
  readonly obsoleteDependencies: readonly string[];
  /** One line per unrepresented field, naming the legacy id and the field. */
  readonly unrepresentedFields: readonly string[];
  /** Mission ids this run materialized, in import order. */
  readonly imported: readonly MissionId[];
}

export interface LegacyRecord {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly title: string | null;
  readonly rawStatus: string | null;
  readonly assignees: readonly string[];
  readonly labels: readonly string[];
  readonly unrepresentedKeys: readonly string[];
  /** Raw `dependencies` frontmatter entries, in the order the file lists them. */
  readonly dependencies: readonly string[];
  /** Mission-owned material only: two copies differing elsewhere still agree. */
  readonly representedMaterial: string;
}

/** Legacy locations this importer reads, from the configured task storage. */
