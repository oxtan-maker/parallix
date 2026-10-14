import { completed, failure, type ApplicationOutcome } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { isLoaded, loadForCommand, missingCapability, storeEvidence, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import { authorMission, type MissionAuthoringFields } from '../domain/mission-authoring.js';
import type { Mission } from '../domain/mission.js';

export interface AuthorMissionRequest extends MissionCommandRequest, MissionAuthoringFields {}
export interface AuthorMissionResult { readonly mission: Mission; readonly version: MissionVersion }

/** Validate the complete draft before one compare-and-swap aggregate save. */
export class MissionAuthoringService {
  constructor(private readonly _store: MissionStore) {}

  async author(request: AuthorMissionRequest): Promise<ApplicationOutcome<AuthorMissionResult>> {
    const guard = missingCapability<AuthorMissionResult>(request, 'mission:context');
    if (guard) { return guard; }
    const loaded = await loadForCommand<AuthorMissionResult>(this._store, request);
    if (!isLoaded(loaded)) { return loaded; }
    let mission: Mission;
    try { mission = authorMission(loaded.mission, request); } catch (error) {
      return failure('validation', error instanceof Error ? error.message : 'invalid mission authoring contract');
    }
    try {
      const version = await this._store.save(mission, loaded.version);
      return completed({ mission, version }, [storeEvidence(mission.id, 'mission-authoring', 'complete draft recorded atomically')]);
    } catch (error) { return writeFailure(error); }
  }
}
