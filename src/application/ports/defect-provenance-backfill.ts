import type { DefectProvenance } from '../../domain/defect-provenance.js';
import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';

export interface DefectProvenanceBackfillEntry {
  readonly missionId: MissionId;
  readonly provenance: DefectProvenance;
}

export interface DefectProvenanceBackfillRequest {
  readonly repositoryId: RepositoryId;
  readonly entries: readonly DefectProvenanceBackfillEntry[];
  /** Explicit authorization to replace a target that already has provenance. */
  readonly replaceExisting?: boolean;
}

export type DefectProvenanceBackfillDisposition =
  | 'attributed'
  | 'external-or-pre-mission'
  | 'unresolved'
  | 'already-populated'
  | 'failed';

export interface DefectProvenanceBackfillRow {
  readonly missionId: MissionId;
  readonly completedAt: string;
  readonly disposition: DefectProvenanceBackfillDisposition;
  readonly reason?: string;
}

export interface DefectProvenanceBackfillReport {
  readonly mode: 'preview' | 'apply';
  readonly committed: boolean;
  readonly targeted: number;
  readonly attributed: number;
  readonly externalOrPreMission: number;
  readonly unresolved: number;
  readonly alreadyPopulated: number;
  readonly failed: number;
  readonly applied: number;
  readonly rows: readonly DefectProvenanceBackfillRow[];
}

export interface DefectProvenanceBackfillStore {
  previewDefectProvenanceBackfill(_request: DefectProvenanceBackfillRequest): Promise<DefectProvenanceBackfillReport>;
  applyDefectProvenanceBackfill(_request: DefectProvenanceBackfillRequest): Promise<DefectProvenanceBackfillReport>;
}
