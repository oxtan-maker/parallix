/** Checked integration and closure decisions over supplied, non-durable facts. */
import type { ApplicationOutcome, SourceFact } from './contracts.js';
import { completed, failure } from './contracts.js';
import type { MissionStore, MissionVersion } from './domain-ports.js';
import { closeMission, type Mission } from '../domain/mission.js';
import { decideMission } from '../domain/mission-workflow.js';
import {
  decisionFailure, isLoaded, loadForCommand, missingCapability, storeEvidence,
  writeFailure, type MissionCommandRequest,
} from './mission-command-support.js';

export interface ObservedIntegrationFacts {
  readonly git: SourceFact<{ readonly merged: boolean }>;
  readonly verification: SourceFact<{ readonly passed: boolean }>;
}

export interface DecideIntegrationRequest extends MissionCommandRequest {
  readonly facts: ObservedIntegrationFacts;
}

export interface CloseMissionRequest extends MissionCommandRequest {
  readonly integration: SourceFact<{ readonly completed: boolean }>;
  readonly closedAt: string;
}

export interface MissionDecisionResult { readonly mission: Mission; readonly version: MissionVersion; }

function requireFresh<T>(fact: SourceFact<T>, name: string): string | null {
  if (fact.status !== 'fresh' || fact.value === undefined) { return `${name} observation is required and must be fresh`; }
  return null;
}

export class MissionIntegrationService {
  constructor(private readonly _store: MissionStore) {}

  async decideIntegration(request: DecideIntegrationRequest): Promise<ApplicationOutcome<MissionDecisionResult>> {
    const guard = missingCapability<MissionDecisionResult>(request, 'integration:decide');
    if (guard) { return guard; }
    const git = requireFresh(request.facts.git, 'Git merge');
    const verification = requireFresh(request.facts.verification, 'Verification');
    if (git || verification) { return failure('validation', git ?? verification!); }
    if (!request.facts.git.value!.merged || !request.facts.verification.value!.passed) {
      return failure('validation', 'integration requires a merged Git observation and passing verification');
    }
    const loaded = await loadForCommand<MissionDecisionResult>(this._store, request);
    if (!isLoaded(loaded)) { return loaded; }
    let mission: Mission;
    try {
      mission = decideMission(loaded.mission, { type: 'integrate' });
    } catch (error) { return decisionFailure(error); }
    try {
      const version = await this._store.save(mission, loaded.version);
      return completed({ mission, version }, [storeEvidence(mission.id, 'integrate', 'fresh Git and verification facts accepted')]);
    } catch (error) { return writeFailure(error); }
  }

  async close(request: CloseMissionRequest): Promise<ApplicationOutcome<MissionDecisionResult>> {
    const guard = missingCapability<MissionDecisionResult>(request, 'closure:record');
    if (guard) { return guard; }
    const integration = requireFresh(request.integration, 'Integration');
    if (integration) { return failure('validation', integration); }
    if (!request.integration.value!.completed) { return failure('validation', 'closure requires a completed integration observation'); }
    const loaded = await loadForCommand<MissionDecisionResult>(this._store, request);
    if (!isLoaded(loaded)) { return loaded; }
    let mission: Mission;
    try {
      mission = closeMission(loaded.mission, request.closedAt);
    } catch (error) { return decisionFailure(error); }
    try {
      const version = await this._store.save(mission, loaded.version);
      return completed({ mission, version }, [storeEvidence(mission.id, 'close', 'fresh completed integration fact accepted')]);
    } catch (error) { return writeFailure(error); }
  }
}
