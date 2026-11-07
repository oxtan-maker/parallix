import { completed, failure, type ApplicationOutcome } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { isLoaded, loadForCommand, missingCapability, storeEvidence, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import { approveLargeMissionRiskException, convertMissionToWave, type MissionWaveChildContract } from '../domain/mission-wave.js';
import type { Mission } from '../domain/mission.js';

export interface ConvertMissionWaveRequest extends MissionCommandRequest { readonly children: readonly MissionWaveChildContract[] }
export interface MissionWaveResult { readonly parent: Mission; readonly children: readonly Mission[]; readonly version: MissionVersion }
export interface ApproveLargeMissionRiskRequest extends MissionCommandRequest {
  readonly rationale: string; readonly approvedBy: string; readonly approvedAt: string;
}

export class MissionWaveService {
  constructor(private readonly store: MissionStore) {}

  async convert(request: ConvertMissionWaveRequest): Promise<ApplicationOutcome<MissionWaveResult>> {
    const guard = missingCapability<MissionWaveResult>(request, 'mission:context'); if (guard) { return guard; }
    if (!this.store.saveWave) { return failure('capability', 'mission store cannot persist Mission waves atomically'); }
    const loaded = await loadForCommand<MissionWaveResult>(this.store, request); if (!isLoaded(loaded)) { return loaded; }
    let wave: ReturnType<typeof convertMissionToWave>;
    try { wave = convertMissionToWave(loaded.mission, request.children); }
    catch (error) { return writeFailure(error); }
    for (const child of wave.children) {
      let observed;
      try { observed = await this.store.load(child.id); }
      catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'mission store read failed'); }
      if (observed.kind === 'unavailable') { return failure('unavailable', observed.reason); }
      if (observed.kind === 'found') { return failure('conflict', `Mission wave child identity already exists: ${child.id}`); }
    }
    try {
      const saved = await this.store.saveWave(wave.parent, loaded.version, wave.children);
      return completed({ parent: wave.parent, children: wave.children, version: saved.parentVersion },
        [storeEvidence(loaded.mission.id, 'mission-wave', `${wave.children.length} child Missions created atomically`)]);
    } catch (error) { return writeFailure(error); }
  }

  async approveRiskException(request: ApproveLargeMissionRiskRequest): Promise<ApplicationOutcome<{ readonly mission: Mission; readonly version: MissionVersion }>> {
    const guard = missingCapability<{ mission: Mission; version: MissionVersion }>(request, 'mission:context'); if (guard) { return guard; }
    const loaded = await loadForCommand<{ mission: Mission; version: MissionVersion }>(this.store, request); if (!isLoaded(loaded)) { return loaded; }
    let mission: Mission;
    try { mission = approveLargeMissionRiskException(loaded.mission, request); }
    catch (error) { return writeFailure(error); }
    try {
      const version = await this.store.save(mission, loaded.version);
      return completed({ mission, version }, [storeEvidence(mission.id, 'large-mission-risk-exception', `approved by ${request.approvedBy}`)]);
    } catch (error) { return writeFailure(error); }
  }
}
