import type {
  DefectProvenanceBackfillEntry,
  DefectProvenanceBackfillReport,
  DefectProvenanceBackfillStore,
} from './ports/defect-provenance-backfill.js';
import type { RepositoryId } from '../domain/repository.js';

/** Typed application owner for historical defect-provenance preview and apply. */
export class DefectProvenanceBackfillService {
  constructor(
    private readonly store: DefectProvenanceBackfillStore,
    private readonly repositoryId: RepositoryId,
  ) {}

  preview(entries: readonly DefectProvenanceBackfillEntry[], replaceExisting = false): Promise<DefectProvenanceBackfillReport> {
    return this.store.previewDefectProvenanceBackfill({ repositoryId: this.repositoryId, entries, replaceExisting });
  }

  apply(entries: readonly DefectProvenanceBackfillEntry[], replaceExisting = false): Promise<DefectProvenanceBackfillReport> {
    return this.store.applyDefectProvenanceBackfill({ repositoryId: this.repositoryId, entries, replaceExisting });
  }
}
