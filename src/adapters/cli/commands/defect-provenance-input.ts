import fs from 'node:fs';
import type { DefectProvenanceBackfillEntry } from '../../../application/ports/defect-provenance-backfill.js';
import { missionId } from '../../../domain/mission.js';

/** Read and shape the operator-supplied historical provenance file at the CLI adapter boundary. */
export function readDefectProvenanceBackfillEntries(file: string): readonly DefectProvenanceBackfillEntry[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const values = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(values)) { throw new Error('backfill input must be a JSON array or an object with an entries array'); }
  return values.map((value, index) => {
    if (!value || typeof value !== 'object') { throw new Error(`backfill entry ${index + 1} must be an object`); }
    const entry = value as { missionId?: unknown; provenance?: unknown };
    if (typeof entry.missionId !== 'string' || !entry.provenance || typeof entry.provenance !== 'object') {
      throw new Error(`backfill entry ${index + 1} requires missionId and provenance`);
    }
    return { missionId: missionId(entry.missionId), provenance: entry.provenance as DefectProvenanceBackfillEntry['provenance'] };
  });
}
