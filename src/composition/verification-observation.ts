import { randomUUID } from 'node:crypto';
import { verificationObservationContext } from '../adapters/verification/verification-proof-inputs.js';
import { authorizedOperationId } from '../application/ports/mission-write-authorization.js';
import { configureVerificationObservation, VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement,
  type VerificationObservationPort } from '../application/ports/verification-observation.js';
import type { OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { git } from '../adapters/git/git.js';
import { extractSlugFromBranch } from '../adapters/filesystem/mission-paths.js';

/** Durable starts precede execution; one identity survives terminal snapshots. */
export function createVerificationObservation(history: OperationalHistoryRepository,
  identity: (_root: string, _mission: string) => { repositoryId: string; missionId: string | null; revision: string | null;
    configuration?: string | null; runtime?: string; profile?: VerificationMeasurement['profile'] },
  clock = () => new Date().toISOString(), operation = () => authorizedOperationId()): VerificationObservationPort {
  return { async begin(input) {
    const context = identity(input.root, input.mission);
    let value: VerificationMeasurement = { ...context,
      id: randomUUID(), operationId: operation(), batchId: input.batchId,
      gate: input.gate, command: input.command, phase: input.phase, after: input.after, plan: input.plan,
      requestedAt: clock(), startedAt: null, finishedAt: null, result: 'running',
      failureReason: null, exitCode: null, wallMs: null, cpu: null, profile: context.profile ?? null };
    const write = () => history.append({ eventType: VERIFICATION_MEASUREMENT_EVENT,
      eventData: JSON.stringify(value), createdAt: value.finishedAt ?? value.startedAt ?? value.requestedAt });
    await write();
    return {
      async started() { value = { ...value, startedAt: clock() }; await write(); },
      async complete(result) { value = { ...value, ...result, finishedAt: clock() }; await write(); },
    };
  } };
}

export function bindVerificationObservation(configuration: ParallixConfiguration): void {
  configureVerificationObservation({ async begin(input) {
    try {
      const { initOperatorState } = await import('../adapters/sqlite/adapter-factory.js');
      const { SqliteOperationalHistoryRepository } = await import('../adapters/sqlite/operational-history-repository.js');
      const { db } = await initOperatorState({ configuration });
      return await createVerificationObservation(new SqliteOperationalHistoryRepository(db), (root, mission) => {
        const head = git(['-C', root, 'rev-parse', 'HEAD']);
        const branch = git(['-C', root, 'branch', '--show-current']).stdout.trim();
        return { repositoryId: resolveCanonicalRepositoryId(root),
          ...verificationObservationContext(root, configuration.forwardedEnvironment.PARALLIX_VERIFICATION_PROFILE_REPORT),
          missionId: mission || extractSlugFromBranch(branch, root),
          revision: head.status === 0 ? head.stdout.trim() : null };
      }, undefined, () => authorizedOperationId() ?? configuration.runtime.workflowOperation ?? null).begin(input);
    } catch { return null; } // absent measurement must never become measured zero
  } });
}
