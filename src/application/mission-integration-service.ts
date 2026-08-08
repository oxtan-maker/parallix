/** Checked integration and closure decisions over supplied, non-durable facts. */
import type { ApplicationOutcome, SourceFact } from './contracts.js';
import { completed, failure } from './contracts.js';
import type { MissionTransitionStore, MissionVersion } from './domain-ports.js';
import { isDuplicateLaneEvent, lifecycleLaneEvent } from './lifecycle-lane-event.js';
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
  /** Occurrence time recorded on the `integration -> done` event; defaults to now. */
  readonly occurredAt?: string;
  /** Supplying the same key twice records the transition once. */
  readonly idempotencyKey?: string;
  /** Agent recorded on the lane event. */
  readonly actor?: string;
}

export interface CloseMissionRequest extends MissionCommandRequest {
  readonly integration: SourceFact<{ readonly completed: boolean }>;
  /** Also the occurrence time of the closure lane event. */
  readonly closedAt: string;
  /** Supplying the same key twice records the closure once. */
  readonly idempotencyKey?: string;
  /** Agent recorded on the lane event. */
  readonly actor?: string;
}

export interface MissionDecisionResult { readonly mission: Mission; readonly version: MissionVersion; }

function requireFresh<T>(fact: SourceFact<T>, name: string): string | null {
  if (fact.status !== 'fresh' || fact.value === undefined) { return `${name} observation is required and must be fresh`; }
  return null;
}

export class MissionIntegrationService {
  constructor(private readonly _store: MissionTransitionStore) {}

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
    // `integration -> done` is the transition throughput is derived from, so it
    // is committed with its lane event rather than as a bare aggregate write.
    const event = lifecycleLaneEvent({
      mission,
      from: loaded.mission.status,
      trigger: 'integrate',
      agent: request.actor ?? mission.assignee ?? 'unknown',
      occurredAt: request.occurredAt ?? new Date().toISOString(),
      idempotencyKey: request.idempotencyKey,
    });
    try {
      const version = await this._store.saveWithTransition(mission, loaded.version, event);
      return completed({ mission, version }, [storeEvidence(mission.id, 'integrate', 'fresh Git and verification facts accepted')]);
    } catch (error) {
      if (isDuplicateLaneEvent(error)) { return failure('conflict', (error as Error).message); }
      return writeFailure(error);
    }
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
    // Closure keeps the mission in `done` but ends its last lane dwell, so it is
    // a distinct event from `integrate`: without it the final dwell of every
    // mission is open-ended.
    const event = lifecycleLaneEvent({
      mission,
      from: loaded.mission.status,
      trigger: 'close',
      agent: request.actor ?? mission.assignee ?? 'unknown',
      occurredAt: request.closedAt,
      idempotencyKey: request.idempotencyKey,
    });
    try {
      const version = await this._store.saveWithTransition(mission, loaded.version, event);
      return completed({ mission, version }, [storeEvidence(mission.id, 'close', 'fresh completed integration fact accepted')]);
    } catch (error) {
      if (isDuplicateLaneEvent(error)) { return failure('conflict', (error as Error).message); }
      return writeFailure(error);
    }
  }
}
