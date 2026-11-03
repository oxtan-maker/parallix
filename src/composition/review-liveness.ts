import type { ProductionApplicationServices } from './application-services.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { ReviewLivenessReader } from '../application/projections/review-liveness.js';
import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import { WorkflowProcessAdapter } from '../adapters/process/workflow-process.js';
import { cliInvocation } from '../adapters/process/cli-invocation.js';
import { detectRunningMissionSessions, startProcessTableRead } from '../adapters/agents/running-sessions.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';
import { missionId } from '../domain/mission.js';

export const reviewLivenessSystem = { startProcessTableRead, detectRunningMissionSessions, createMissionTerminalCapability };

const anyLive = (values: readonly (boolean | null)[]): boolean | null =>
  values.includes(true) ? true : values.includes(null) ? null : false;

/** Read existing intent, process and retained-run owners without recovery writes. */
export function createReviewLivenessReader(services: ProductionApplicationServices, root: string, configuration: ParallixConfiguration): ReviewLivenessReader {
  const db = services.operatorState.db;
  const mission = services.mission;
  const operations = db && mission ? new SqliteWorkflowOperationStore(db, mission.repositoryId) : null;
  const processes = new WorkflowProcessAdapter(cliInvocation(process.argv[1]), root, configuration);
  return async slug => {
    try {
      const operation = operations ? await operations.readOnly(() => operations.current(slug)) : null;
      const owners = [operation?.owner, operation?.launcher].filter(owner => owner !== null && owner !== undefined);
      const workflow = operations ? anyLive(await Promise.all(owners.map(owner => processes.alive(owner)))) : null;
      const table = await reviewLivenessSystem.startProcessTableRead();
      const sessions = reviewLivenessSystem.detectRunningMissionSessions({ rootDir: root, missionId: missionId(slug), listProcesses: () => table });
      const history = reviewLivenessSystem.createMissionTerminalCapability(root, configuration).history(slug);
      const runs = history.ok ? history.runs : [];
      const execution = history.ok && !history.unattributed.length
        ? anyLive(runs.filter(run => run.record.captureKind === 'agent').map(run => run.execution === 'live' ? true : run.execution === 'stopped' ? false : null)) : null;
      const coordinator = anyLive([sessions === null ? null : sessions.some(session => session.missionId === slug),
        runs.some(run => run.record.captureKind === 'coordinator' && run.record.supervisorPid !== process.pid && run.state === 'running')]);
      return { workflow, coordinator, execution, reviewer: execution };
    } catch { return { workflow: null, coordinator: null, execution: null, reviewer: null }; }
  };
}
