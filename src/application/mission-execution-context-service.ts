import type { ApplicationOutcome } from './contracts.js';
import { completed, failure } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { isLoaded, loadForCommand, missingCapability, storeEvidence, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import { missionExecutionContext, renderExecutionContextForLaunch, type MissionExecutionContext } from '../domain/mission-execution-context.js';

export interface WriteMissionExecutionContextRequest extends MissionCommandRequest { readonly context: MissionExecutionContext; }
export interface ReadMissionExecutionContextResult { readonly context: MissionExecutionContext; readonly version: MissionVersion; }

/** Application-owned context read/write; no mission document path enters this boundary. */
export class MissionExecutionContextService {
  constructor(private readonly _store: MissionStore) {}
  async write(request: WriteMissionExecutionContextRequest): Promise<ApplicationOutcome<ReadMissionExecutionContextResult>> {
    const guard = missingCapability<ReadMissionExecutionContextResult>(request, 'mission:context'); if (guard) {return guard;}
    let context: MissionExecutionContext;
    try { context = missionExecutionContext(request.context); } catch (error) { return failure('validation', error instanceof Error ? error.message : 'invalid execution context'); }
    const loaded = await loadForCommand<ReadMissionExecutionContextResult>(this._store, request); if (!isLoaded(loaded)) {return loaded;}
    try { const version = await this._store.save({ ...loaded.mission, executionContext: context }, loaded.version); return completed({ context, version }, [storeEvidence(request.missionId, 'execution-context', 'bounded execution context recorded')]); } catch (error) { return writeFailure(error); }
  }
  async read(request: MissionCommandRequest): Promise<ApplicationOutcome<ReadMissionExecutionContextResult>> {
    const guard = missingCapability<ReadMissionExecutionContextResult>(request, 'mission:context'); if (guard) {return guard;}
    const loaded = await loadForCommand<ReadMissionExecutionContextResult>(this._store, request); if (!isLoaded(loaded)) {return loaded;}
    return loaded.mission.executionContext ? completed({ context: loaded.mission.executionContext, version: loaded.version }) : failure('unavailable', `mission ${request.missionId} has no execution context`);
  }
}

/**
 * Re-exported so the execute adapters consume the application-owned boundary
 * rather than importing the domain render helper directly: the render step
 * stays part of the context read contract, not a presentation detail.
 */
export { renderExecutionContextForLaunch };
