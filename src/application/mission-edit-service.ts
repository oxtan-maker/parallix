import { completed, failure, type ApplicationOutcome } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { isLoaded, loadForCommand, missingCapability, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import { missionLabels, type Mission } from '../domain/mission.js';
import { missionBrief } from '../domain/mission-brief.js';
import { missionDependencies } from '../domain/mission-dependencies.js';
import { successCriteria, carryCompletion } from '../domain/mission-success-criteria.js';

/** Complete planning replacement; no lifecycle or execution fields cross this port. */
export interface MissionPlanningFields {
  readonly title: string;
  readonly description: string;
  readonly context: string;
  readonly labels: readonly string[];
  readonly successCriteria: readonly string[];
  readonly dependencies: readonly string[];
}
export interface MissionEditSnapshot extends MissionPlanningFields {
  readonly missionId: string;
  readonly version: MissionVersion;
}
export interface MissionEditRequest extends MissionCommandRequest, MissionPlanningFields { readonly expectedVersion: MissionVersion }

export class MissionEditService {
  constructor(private readonly _store: MissionStore) {}

  async read(request: MissionCommandRequest): Promise<ApplicationOutcome<MissionEditSnapshot>> {
    const guard = missingCapability<MissionEditSnapshot>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionEditSnapshot>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    const m = loaded.mission;
    return completed({ missionId: m.id, version: loaded.version, title: m.title,
      description: m.brief?.goal ?? m.description ?? '', context: m.brief?.why ?? '',
      labels: m.labels, successCriteria: m.successCriteria ?? [], dependencies: m.dependencies ?? [] });
  }

  async save(request: MissionEditRequest): Promise<ApplicationOutcome<{ missionId: string; version: MissionVersion }>> {
    const guard = missingCapability<{ missionId: string; version: MissionVersion }>(request, 'mission:context'); if (guard) { return guard; }
    if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 1) { return failure('validation', 'A positive expected version is required.'); }
    const loaded = await loadForCommand<{ missionId: string; version: MissionVersion }>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    const m = loaded.mission;
    // Finished missions cannot be changed through board mutations.
    if (m.status === 'done' || m.closedAt !== null) { return failure('validation', 'Finished missions cannot be edited.'); }
    try {
      const next = replacePlanning(request, m);
      const refused = await this.validateDependencies(next);
      if (refused) { return refused; }
      try {
        const version = await this._store.save(next, loaded.version);
        return completed({ missionId: m.id, version });
      } catch (error) { return writeFailure(error); }
    } catch (error) {
      return failure('validation', error instanceof Error ? error.message : 'Invalid planning fields.');
    }
  }
  private async validateDependencies(m: Mission): Promise<ApplicationOutcome<{ missionId: string; version: MissionVersion }> | null> {
    try {
      for (const id of m.dependencies ?? []) {
        const dependency = await this._store.load(id);
        if (dependency.kind === 'unavailable') { return failure('unavailable', dependency.reason); }
        if (dependency.kind !== 'found' || dependency.mission.repositoryId !== m.repositoryId || dependency.mission.status === 'done' || dependency.mission.closedAt !== null) {
          return failure('validation', `Dependency ${id} must be an unfinished mission in this repository.`);
        }
      }
      return null;
    } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Dependency read failed.'); }
  }

}

function validateFields(request: MissionEditRequest, m: Mission) {
      const title = request.title.trim();
      if (!title || title.length > 200) { throw new Error('Title is required and must be at most 200 characters.'); }
      const description = request.description.trim();
      const context = request.context.trim();
      if (context && !description) { throw new Error('Add a description or clear the context.'); }
      const labels = missionLabels(request.labels);
      if (labels.length > 16 || labels.some(label => label.length > 64)) { throw new Error('Use at most 16 labels of at most 64 characters.'); }
      const criteria = successCriteria(request.successCriteria);
      const dependencies = missionDependencies(request.dependencies, m.id);
      return { title, description, context, labels, criteria, dependencies };
}

function replacePlanning(request: MissionEditRequest, m: Mission): Mission {
  const { title, description, context, labels, criteria, dependencies } = validateFields(request, m);
  const brief = description && context ? missionBrief({ goal: description, why: context, scope: m.brief?.scope ?? null, outOfScope: m.brief?.outOfScope ?? [] }) : null;
  return { ...m, title, labels, brief, description: brief ? null : description || null,
    successCriteria: criteria, completedSuccessCriteria: carryCompletion(m.successCriteria ?? [], m.completedSuccessCriteria ?? [], criteria), dependencies };
}
