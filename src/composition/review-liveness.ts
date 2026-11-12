import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { RunSummary } from '../application/run-history.js';
import type { ReviewLivenessReader } from '../application/projections/review-liveness.js';
import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import { WorkflowProcessAdapter } from '../adapters/process/workflow-process.js';
import { cliInvocation } from '../adapters/process/cli-invocation.js';
import { currentInvocationProcessIds, detectRunningMissionSessions, startProcessTableRead } from '../adapters/agents/running-sessions.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';
import { missionId } from '../domain/mission.js';

export const reviewLivenessSystem = { currentInvocationProcessIds, startProcessTableRead, detectRunningMissionSessions, createMissionTerminalCapability };

interface ReviewLivenessServices {
  readonly operatorState: { readonly db?: import('../adapters/sqlite/database-adapter.js').SqliteDatabaseAdapter | null };
  readonly mission?: { readonly repositoryId: import('../domain/repository.js').RepositoryId } | null;
}

const anyLive = (values: readonly (boolean | null)[]): boolean | null =>
  values.includes(true) ? true : values.includes(null) ? null : false;

function ownsCurrentReviewOperation(
  operation: Awaited<ReturnType<SqliteWorkflowOperationStore['current']>>,
  operationId: string | undefined,
  operationGeneration: number | null | undefined,
): boolean {
  return operation !== null && operation.id === operationId && operation.generation === operationGeneration
    && operation.phase === 'executing' && operation.owner?.pid === process.pid && operation.command === 'review:submit'
    && operation.operatorInvocation === true && operation.invocation?.command === 'review';
}

function isOwnedCoordinator(run: RunSummary, operation: Awaited<ReturnType<SqliteWorkflowOperationStore['current']>>): boolean {
  return operation !== null && run.record.operationId === operation.id && run.record.supervisorPid === operation.launcher?.pid;
}

/** Read existing intent, process and retained-run owners without recovery writes. */
export function createReviewLivenessReader(
  services: ReviewLivenessServices,
  root: string,
  configuration: ParallixConfiguration,
): ReviewLivenessReader {
  const db = services.operatorState.db;
  const mission = services.mission;
  const operations = db && mission ? new SqliteWorkflowOperationStore(db, mission.repositoryId) : null;
  const processes = new WorkflowProcessAdapter(cliInvocation(process.argv[1]), root, configuration);
  return async slug => {
    try {
      const current = operations ? await operations.readOnly(() => operations.current(slug)) : null;
      const owned = ownsCurrentReviewOperation(current, configuration.runtime.workflowOperation, configuration.runtime.workflowGeneration);
      const operation = owned ? null : current;
      const owners = [operation?.owner, operation?.launcher].filter(owner => owner !== null && owner !== undefined);
      const workflowLive = operations ? anyLive(await Promise.all(owners.map(owner => processes.alive(owner)))) : null;
      const table = await reviewLivenessSystem.startProcessTableRead();
      const invokingPids = reviewLivenessSystem.currentInvocationProcessIds();
      const sessions = reviewLivenessSystem.detectRunningMissionSessions({ rootDir: root, missionId: missionId(slug),
        listProcesses: () => table?.filter(entry => !invokingPids.has(entry.pid)) ?? null });
      const history = reviewLivenessSystem.createMissionTerminalCapability(root, configuration).history(slug);
      const runs = history.ok ? history.runs : [];
      const execution = history.ok && !history.unattributed.length
        ? anyLive(runs.filter(run => run.record.captureKind === 'agent').map(run => run.executionProbeUnavailable ? null : run.execution === 'live' ? true : run.execution === 'stopped' ? false : null)) : null;
      const coordinator = anyLive([sessions === null ? null : sessions.some(session => session.missionId === slug),
        runs.some(run => run.record.captureKind === 'coordinator' && run.record.supervisorPid !== process.pid && !(owned && isOwnedCoordinator(run, current)) && run.state === 'running')]);
      return {
        workflow: operation ? { id: operation.id, phase: operation.phase, reason: operation.reason } : null,
        liveness: { workflow: workflowLive, coordinator, execution, reviewer: execution },
      };
    } catch {
      return { workflow: null, liveness: { workflow: null, coordinator: null, execution: null, reviewer: null } };
    }
  };
}
