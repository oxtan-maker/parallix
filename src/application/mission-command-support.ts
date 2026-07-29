/**
 * Shared plumbing for the checked Mission use cases.
 *
 * Every Mission command follows the same shape: check the requested capability,
 * read the aggregate through the repository port, let the domain decide, then
 * write with the exact expected revision. These helpers keep that sequence
 * identical across intake, lifecycle, checkpoint, and handoff so a new command
 * cannot quietly skip a guard.
 */

import type { ApplicationOutcome, Capability, DurableEvidence } from './contracts.js';
import { failure, rejected } from './contracts.js';
import type {
  MissionLoadResult,
  MissionStore,
  MissionVersion,
} from './domain-ports.js';
import { isStaleWrite } from './domain-ports.js';
import type { Mission, MissionId } from '../domain/mission.js';
import { MissionRuleViolation } from '../domain/mission.js';

/** Fields every Mission command request carries. */
export interface MissionCommandRequest {
  readonly operationId: string;
  readonly missionId: MissionId;
  readonly capabilities: ReadonlySet<Capability>;
  /**
   * The revision the caller read. `undefined` means "use the revision this
   * command just loaded"; supplying a value makes the write fail closed when
   * another writer moved the aggregate in between.
   */
  readonly expectedVersion?: MissionVersion;
}

export function missingCapability<T>(
  request: MissionCommandRequest,
  capability: Capability,
): ApplicationOutcome<T> | null {
  if (!request.operationId.trim()) {
    return rejected('validation', 'operationId is required');
  }
  if (!request.missionId.trim()) {
    return rejected('validation', 'missionId is required');
  }
  if (!request.capabilities.has(capability)) {
    return rejected('capability', `${capability} capability is required`);
  }
  return null;
}

export interface LoadedMission {
  readonly mission: Mission;
  readonly version: MissionVersion;
}

/**
 * Read the aggregate, mapping every non-success read to its typed outcome.
 * A stale expected version is refused here, before the domain runs, so a
 * command can never decide a transition from a revision it did not read.
 */
export async function loadForCommand<T>(
  store: MissionStore,
  request: MissionCommandRequest,
): Promise<LoadedMission | ApplicationOutcome<T>> {
  let read: MissionLoadResult;
  try {
    read = await store.load(request.missionId);
  } catch (error) {
    return failure('unavailable', describe(error, 'mission store read failed'));
  }
  if (read.kind === 'missing') {
    return failure('unavailable', `mission ${request.missionId} is not recorded`);
  }
  if (read.kind === 'unavailable') {
    return failure('unavailable', read.reason);
  }
  if (request.expectedVersion !== undefined && request.expectedVersion !== read.version) {
    return failure(
      'conflict',
      `mission ${request.missionId} changed since it was read: expected version `
      + `${request.expectedVersion}, found ${read.version}`,
    );
  }
  return { mission: read.mission, version: read.version };
}

export function isLoaded<T>(
  value: LoadedMission | ApplicationOutcome<T>,
): value is LoadedMission {
  return (value as LoadedMission).mission !== undefined;
}

/** Map a write or domain failure to the outcome kind its caller must see. */
export function writeFailure<T>(
  error: unknown,
  durableEvidence: readonly DurableEvidence[] = [],
): ApplicationOutcome<T> {
  if (isStaleWrite(error)) {
    return failure('conflict', describe(error, 'stale mission write refused'), durableEvidence);
  }
  if (error instanceof MissionRuleViolation) {
    return failure('validation', error.message, durableEvidence);
  }
  return failure('execution', describe(error, 'mission write failed'), durableEvidence);
}

/** Domain rule violations are validation failures, not infrastructure faults. */
export function decisionFailure<T>(error: unknown): ApplicationOutcome<T> {
  if (error instanceof MissionRuleViolation) {
    return failure('validation', error.message);
  }
  if (error instanceof Error) {
    return failure('validation', error.message);
  }
  return failure('execution', 'mission decision failed');
}

export function storeEvidence(
  missionId: MissionId,
  operation: string,
  detail: string,
): DurableEvidence {
  return { id: `${missionId}:${operation}`, source: 'mission-store', detail };
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
