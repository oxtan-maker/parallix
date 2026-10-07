/**
 * Legacy dependency import: resolve each legacy dependency to an imported
 * Mission and record it, reporting the ones that cannot be resolved.
 */

import { missionId, type MissionId } from '../../domain/mission.js';
import { CONTEXT_CAPABILITY, OBSOLETE_LEGACY_DEPENDENCIES, type MissionImportServices } from './legacy-import-types.js';

export interface DependencyCandidate {
  readonly sourceId: string;
  readonly id: MissionId;
  readonly entries: readonly string[];
  /** True when this run created the Mission; false when it already existed. */
  readonly imported: boolean;
}

/**
 * Record each record's dependencies once every record in this run has its
 * Mission.
 *
 * Resolving during import would make the outcome depend on the order the
 * records happen to be read in: a reference to a record imported later would
 * resolve to nothing, and the record would be already materialized by the time
 * anything could retry it. This pass runs after all of them, so only a
 * reference that truly names no Mission is reported.
 *
 * Which records it writes to is what keeps a rerun idempotent:
 *
 *   * A Mission this run imported gets the references its legacy record states.
 *   * A Mission that already existed is written only when one of its references
 *     names a Mission this run imported — the one case where the reference could
 *     not have been recorded before. An unchanged rerun therefore writes
 *     nothing, so a dependency an operator removed with `px depends remove`
 *     stays removed.
 *   * Either way, a Mission that already has dependencies recorded is left
 *     alone: the import never overwrites a recorded list.
 */
export async function recordDependencies(
  services: MissionImportServices,
  records: readonly DependencyCandidate[],
  dryRun: boolean,
  unresolved: string[],
  obsolete: string[],
  conflicts: string[],
): Promise<void> {
  const importedNow = new Set(records.filter((record) => record.imported).map((record) => record.id));
  for (const record of records.filter(candidate => candidate.entries.length > 0)) {
    // A legacy file may name the same predecessor twice; that is one dependency,
    // not a record the domain's duplicate rule should refuse outright.
    const resolved = new Set<MissionId>();
    for (const entry of record.entries) {
      const candidate = await resolveDependency(services, entry, record.id);
      if (candidate === null) {
        if (OBSOLETE_LEGACY_DEPENDENCIES.has(entry.toUpperCase())) {
          obsolete.push(`${record.sourceId}: dependency ${entry} is obsolete; retained in pinned task body`);
        } else {
          unresolved.push(`${record.sourceId}: dependency ${entry} resolves to no Mission`);
        }
        continue;
      }
      resolved.add(candidate);
    }
    const dependencies = [...resolved];
    if (dryRun || dependencies.length === 0) { continue; }
    if (!record.imported && !dependencies.some((dependency) => importedNow.has(dependency))) {
      continue;
    }
    const read = await services.store.load(record.id);
    if (read.kind !== 'found' || (read.mission.dependencies ?? []).length > 0) { continue; }
    const written = await services.dependencies.setDependencies({
      operationId: `import-legacy:${record.id}:dependencies`,
      missionId: record.id,
      dependencies,
      capabilities: CONTEXT_CAPABILITY,
    });
    // A refused write is a refusal to report, not a silent loss: the references
    // resolved, so dropping them here would lose material the file states.
    if (written.status !== 'completed') {
      conflicts.push(
        `${record.sourceId}: dependencies ${dependencies.join(', ')} were refused `
        + `(${written.error?.message ?? written.status})`,
      );
    }
  }
}

/**
 * The Mission a legacy `dependencies` entry names, or null when the reference
 * resolves to nothing: not a Mission slug, this Mission itself, or an id no
 * Mission holds.
 */
async function resolveDependency(
  services: MissionImportServices,
  entry: string,
  owner: MissionId,
): Promise<MissionId | null> {
  let candidate: MissionId;
  try { candidate = missionId(entry.trim().toLowerCase()); } catch { return null; }
  if (candidate === owner) { return null; }
  const read = await services.store.load(candidate);
  return read.kind === 'found' ? candidate : null;
}
