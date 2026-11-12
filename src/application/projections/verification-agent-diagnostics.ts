import { agentRunModel, type RunRecord } from '../run-history-types.js';
import type { ObservationDiagnostic } from './verification-diagnostic.js';

/** Records mission-scoped identity, coverage and model gaps for retained agent runs. */
export function diagnoseAgentRuns(runs: readonly RunRecord[], diagnostics: ObservationDiagnostic[],
  repositoryId: string): void {
  const add = (run: RunRecord, kind: ObservationDiagnostic['kind'], message: string,
    recovery = 'inspect the retained run history', identity = true) =>
    diagnostics.push({ kind, state: 'absent', repositoryId, missionId: run.missionId,
      operationId: identity ? run.operationId ?? null : null, sourceId: identity ? run.sourceId ?? run.runId : run.runId,
      stage: 'agent-run', message, recovery });
  for (const run of runs) {
    if (incompleteAgentRunIdentity(run)) {
      add(run, 'identity', `Agent run identity incomplete for ${run.missionId} source ${run.sourceId ?? run.runId}`);
    }
    if (missingWaitedTreeCpu(run)) {
      add(run, 'coverage', `Agent waited-tree CPU missing for ${run.missionId} run ${run.runId}`);
    }
    if (missingAgentRunModel(run)) {
      add(run, 'model', `Concrete model identity missing for ${repositoryId}/${run.missionId} run ${run.runId}`,
        'inspect the retained run history', false);
    }
  }
}

const incompleteAgentRunIdentity = (run: RunRecord) => !run.operationId || run.operationGeneration === null
  || run.operationGeneration === undefined || !run.sourceId || !run.revision;
const missingWaitedTreeCpu = (run: RunRecord) => run.resources !== undefined && run.state === 'exited'
  && Boolean(run.execution) && run.family !== 'pi' && !run.resources.localProcessTreeCpu;
const missingAgentRunModel = (run: RunRecord) => run.resources !== undefined && run.state === 'exited'
  && run.exitCode === 0 && agentRunModel(run) === null;
