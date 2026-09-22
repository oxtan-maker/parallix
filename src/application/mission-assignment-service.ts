/** Explicit assignment set/clear operations; assignment is not a generic Mission patch. */

import type { ApplicationOutcome } from './contracts.js';
import { completed } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { isLoaded, loadForCommand, missingCapability, storeEvidence, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import type { AgentFamily } from '../domain/agents.js';

export interface SetMissionAssignmentRequest extends MissionCommandRequest { readonly assignee: AgentFamily | null; }
export interface MissionAssignmentResult { readonly assignee: AgentFamily | null; readonly version: MissionVersion; }

export class MissionAssignmentService {
  constructor(private readonly _store: MissionStore) {}

  async set(request: SetMissionAssignmentRequest): Promise<ApplicationOutcome<MissionAssignmentResult>> {
    const guard = missingCapability<MissionAssignmentResult>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<MissionAssignmentResult>(this._store, request); if (!isLoaded(loaded)) { return loaded; }
    try {
      const version = await this._store.save({ ...loaded.mission, assignee: request.assignee }, loaded.version);
      return completed({ assignee: request.assignee, version }, [storeEvidence(request.missionId, 'assignment', request.assignee ? `assigned to ${request.assignee}` : 'assignment cleared')]);
    } catch (error) { return writeFailure(error); }
  }
}
