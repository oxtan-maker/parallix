import { randomUUID } from 'node:crypto';
import { verificationObservationContext } from '../adapters/verification/verification-proof-inputs.js';
import { authorizedOperationGeneration, authorizedOperationId } from '../application/ports/mission-write-authorization.js';
import { configureVerificationObservation, VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement,
  type VerificationObservationPort, type VerificationOperationContext } from '../application/ports/verification-observation.js';
import type { OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { git } from '../adapters/git/git.js';
import { extractSlugFromBranch } from '../adapters/filesystem/mission-paths.js';

/** Durable starts precede execution; one identity survives terminal snapshots. */
export function createVerificationObservation(history: OperationalHistoryRepository,
  identity: (_root: string, _mission: string) => { repositoryId: string; missionId: string | null; revision: string | null;
    configuration?: string | null; runtime?: string; profile?: VerificationMeasurement['profile'] },
  clock = () => new Date().toISOString(),
  operation: () => string | VerificationOperationContext | null = () => authorizedOperationId()): VerificationObservationPort {
  return { async begin(input) {
    const context = identity(input.root, input.mission);
    const id = randomUUID();
    const operationContext = operation();
    const operationId = typeof operationContext === 'string' ? operationContext : operationContext?.id ?? null;
    const operationGeneration = typeof operationContext === 'object' && operationContext ? operationContext.generation : null;
    const sourceId = typeof operationContext === 'object' && operationContext ? operationContext.sourceId : operationId ? id : null;
    const dependencies = input.dependencies ?? await observedGateDependencies(history, input, context.repositoryId, context.missionId);
    let value: VerificationMeasurement = { ...context,
      id, operationId, operationGeneration, sourceId, batchId: input.batchId,
      gate: input.gate, command: input.command, phase: input.phase, after: input.after,
      dependencies, plan: input.plan,
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

/** Resolve configured predecessors and the last failed same-gate attempt from durable history. */
async function observedGateDependencies(history: OperationalHistoryRepository, input: Parameters<VerificationObservationPort['begin']>[0],
  repositoryId: string, missionId: string | null): Promise<readonly string[] | null> {
  if (!history.findByType) { return null; }
  let entries: readonly import('../application/ports/operation-history.js').OperationalHistoryEntry[];
  try { entries = await history.findByType(VERIFICATION_MEASUREMENT_EVENT); } catch { return null; }
  const latest = new Map<string, VerificationMeasurement>();
  for (const entry of entries) {
    try {
      const value = JSON.parse(entry.eventData) as VerificationMeasurement;
      if (value.repositoryId === repositoryId && value.missionId === missionId) { latest.set(value.id, value); }
    } catch { /* An unreadable historical row cannot become a causal link. */ }
  }
  const ordered = [...latest.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id));
  const configured = input.after === null ? null : input.after.flatMap(gate => {
    const match = ordered.findLast(value => value.batchId === input.batchId && value.gate === gate && value.finishedAt);
    return match ? [match.id] : [];
  });
  if (configured === null) { return null; }
  const prior = ordered.findLast(value => value.gate === input.gate && value.command === input.command && value.finishedAt);
  return [...new Set([...configured, ...(prior?.result === 'failed' ? [prior.id] : [])])];
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
      }, undefined, () => {
        const id = authorizedOperationId() ?? configuration.runtime.workflowOperation;
        const generation = authorizedOperationGeneration() ?? configuration.runtime.workflowGeneration;
        return id && generation !== null && generation !== undefined
          ? { id, generation, sourceId: `${id}:${generation}` }
          : id ?? null;
      }).begin(input);
    } catch { return null; } // absent measurement must never become measured zero
  } });
}
