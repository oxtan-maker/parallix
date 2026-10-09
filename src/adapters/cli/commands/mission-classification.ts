import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
import { readStoredMissionLabels } from '../../sqlite/mission-classification-reader.js';
import { normalizeClassification } from './stats-normalization.js';

export type MissionClassificationResolution = {
  classification: string | null;
  taskFile: string | null;
  source: 'mission';
  error?: string;
};

/** Statistics classification comes only from the operator Mission database. */
export function resolveMissionClassification(
  slug: string,
  _rootDir = process.cwd(),
  readLabels: typeof readStoredMissionLabels = readStoredMissionLabels,
  configuration?: ParallixConfiguration,
): MissionClassificationResolution {
  const stored = readLabels(slug, { configuration });
  if (stored.kind === 'found') {
    const found = new Set(stored.labels.map(normalizeClassification).filter(Boolean));
    const classification = found.size === 1 ? String([...found][0]) : null;
    return classification
      ? { classification, taskFile: null, source: 'mission' }
      : { classification: null, taskFile: null, source: 'mission',
        error: `Missing or invalid classification for ${slug} in authoritative Mission state; expected exactly one of ai_sdlc, user_value, or unknown in the Mission labels. Fix: run px classification set --value <ai_sdlc|user_value|unknown>; a Backlog task label does not classify a stored Mission.` };
  }

  return {
    classification: null,
    taskFile: null,
    source: 'mission',
    error: stored.kind === 'missing'
      ? `Mission ${slug} is absent from the px database. Import the Mission and run px classification set before recording statistics.`
      : `Mission database unavailable for ${slug}: ${stored.reason}. Restore database access before recording statistics.`,
  };
}
