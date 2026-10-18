import type { AgentFamily } from '../../domain/agents.js';
import { parseAgentRunId } from '../../domain/agent-run.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { MissionTerminalScope, MissionHistoryStorePort } from '../ports/mission-terminal.js';
import { getRun, observeRunExecution, type RunSummary } from '../run-history.js';
import { MAX_RUNS_PER_MISSION, runCaptureKind } from '../run-history-types.js';

/** One current metadata/probe reading, never a cached positive or workflow state. */
export interface ProviderExecutionFacts {
  readonly observedAt: string;
  readonly complete: boolean;
  readonly invocations: readonly { readonly runId: string; readonly operationId: string | null; readonly family: AgentFamily }[];
  readonly limitations: readonly string[];
  readonly recordedOperationIds?: readonly string[];
}
export interface ProviderExecutionReader {
  observe(_scope: MissionTerminalScope, _currentOperationId?: string): ProviderExecutionFacts;
}
export const unknownExecution = (): ProviderExecutionFacts => ({ observedAt: new Date().toISOString(), complete: false, invocations: [], limitations: ['Provider execution could not be observed'] });

/** Read only owned metadata, with existing invocation identity and process-start probes. */
export function observeProviderExecution(store: MissionHistoryStorePort, identity: MissionTerminalScope, currentOperationId?: string): ProviderExecutionFacts {
  const invocations: ProviderExecutionFacts['invocations'][number][] = [];
  const limitations: string[] = [];
  const recordedOperationIds = new Set<string>();
  const supervisors = new Map<number, boolean>();
  const isAlive = (pid: number) => {
    if (!supervisors.has(pid)) { supervisors.set(pid, store.isAlive(pid)); }
    return supervisors.get(pid)!;
  };
  let probeLimited = false;
  const executionAlive = boundedExecutionProbe(store, () => { probeLimited = true; });
  try {
    const runs = readProviders(store, identity, limitations, isAlive);
    // Stable sort retains recency within each priority: current owner, live supervisor, history.
    const priority = (run: RunSummary) => run.record.operationId === currentOperationId && currentOperationId !== undefined
      ? 2 : Number(isAlive(run.record.supervisorPid));
    runs.sort((left, right) => priority(right) - priority(left));
    for (const run of runs) {
      probeLimited = false;
      const execution = observeRunExecution(run.record, run.state, { executionAlive });
      collectInvocation({ ...run, execution }, invocations, recordedOperationIds, limitations, currentOperationId, isAlive);
      if (probeLimited && potentiallyCurrent(run, currentOperationId, isAlive)) { limitations.push(`${run.record.runId}: provider execution probe budget reached`); }
    }
  } catch { limitations.push('Provider execution probe failed'); }
  return { observedAt: new Date().toISOString(), complete: limitations.length === 0, invocations, limitations, recordedOperationIds: [...recordedOperationIds] };
}

function readProviders(store: MissionHistoryStorePort, identity: MissionTerminalScope, limitations: string[], isAlive: (_pid: number) => boolean): RunSummary[] {
  const seen = new Set<string>();
  const runs: RunSummary[] = [];
  for (const { runId, location } of providerRecords(store, identity, limitations)) {
    if (seen.has(runId)) { continue; }
    let coordinator = false;
    const result = getRun({ runsDir: location.runsDir, fs: store.fs, isAlive, acceptRecord: record => {
      if (store.attribute(identity, record, location).kind !== 'attributed') { return false; }
      coordinator = runCaptureKind(record) === 'coordinator';
      return !coordinator;
    } }, runId);
    if (coordinator) { seen.add(runId); continue; }
    if (!result.ok || !result.run) { limitations.push(`${runId}: unreadable run metadata`); continue; }
    seen.add(runId);
    runs.push(result.run);
  }
  return runs;
}

/** Coordinator history is not execution evidence. Merge locations before recency ordering. */
function providerRecords(store: MissionHistoryStorePort, identity: MissionTerminalScope, limitations: string[]) {
  const candidates = store.locations(identity).flatMap(location => {
    const names = store.fs.inspectDirs?.(location.runsDir) ?? { ok: true as const, names: store.fs.listDirs(location.runsDir) };
    if (!names.ok) { limitations.push('Run metadata directory unavailable'); return []; }
    return names.names.flatMap(runId => {
      const parsed = parseAgentRunId(runId);
      return parsed && parsed.family !== 'parallix'
        ? [{ runId, location, startedAtMs: Number.parseInt(runId.slice(runId.lastIndexOf('-') + 1), 36) }] : [];
    });
  });
  return candidates.sort((left, right) => right.startedAtMs - left.startedAtMs);
}

/** Bound provider process probes, not the number of retained historical captures. */
function boundedExecutionProbe(store: MissionHistoryStorePort, onLimit: () => void) {
  let remaining = MAX_RUNS_PER_MISSION;
  return (execution: Parameters<NonNullable<MissionHistoryStorePort['executionAlive']>>[0]): boolean | null => {
    if (remaining === 0) {
      onLimit();
      return null;
    }
    remaining--;
    return store.executionAlive?.(execution) ?? null;
  };
}

function collectInvocation(run: import('../run-history.js').RunSummary, invocations: ProviderExecutionFacts['invocations'][number][], operations: Set<string>, limitations: string[], currentOperationId: string | undefined, isAlive: (_pid: number) => boolean) {
  const { record, execution } = run;
  if (runCaptureKind(record) !== 'agent') { return; }
  if (record.operationId) { operations.add(record.operationId); }
  if (execution === 'stopped') { return; }
  if (execution === 'live' && record.family) {
    invocations.push({ runId: record.runId, operationId: record.operationId ?? null, family: record.family });
  } else if (execution === 'unknown' && potentiallyCurrent(run, currentOperationId, isAlive)
    && (record.execution !== null || record.family === 'pi' || run.state === 'interrupted' || record.state === 'exited')) {
    limitations.push(`${record.runId}: provider execution unknown`);
  }
}

function potentiallyCurrent(run: import('../run-history.js').RunSummary, currentOperationId: string | undefined, isAlive: (_pid: number) => boolean): boolean {
  return (currentOperationId !== undefined && run.record.operationId === currentOperationId)
    || isAlive(run.record.supervisorPid);
}

export function providerFamilyCount(facts: ProviderExecutionFacts, family: string): number | null {
  const count = facts.invocations.filter(run => run.family === family).length;
  return !facts.complete && count === 0 ? null : count;
}

export function readProviderExecution(reader: ProviderExecutionReader, scope: MissionTerminalScope, currentOperationId?: string): ProviderExecutionFacts {
  try { return reader.observe(scope, currentOperationId); } catch { return unknownExecution(); }
}

/** Apply one repository observation to both surfaces, independent of workflow activity. */
export function projectProviderExecution(board: import('./board.js').BoardProjection, reader: ProviderExecutionReader, operations: readonly WorkflowOperation[] = []): import('./board.js').BoardProjection {
  const owners = new Map(operations.filter(operation => operation.repositoryId === board.repositoryId).map(operation => [operation.missionId, operation.id]));
  const stages = board.stages.map(stage => ({ ...stage, cards: stage.cards.map(card => {
    return { ...card, execution: readProviderExecution(reader, { repositoryId: board.repositoryId, missionId: card.id }, owners.get(card.id)) };
  }) }));
  return projectExecutionMetrics({ ...board, stages });
}

export function projectExecutionMetrics(board: import('./board.js').BoardProjection): import('./board.js').BoardProjection {
  const facts = board.stages.flatMap(stage => stage.cards.map(card => card.execution ?? unknownExecution()));
  const all: ProviderExecutionFacts = { observedAt: new Date().toISOString(), complete: facts.every(fact => fact.complete),
    invocations: facts.flatMap(fact => fact.invocations), limitations: facts.flatMap(fact => fact.limitations) };
  const families = new Map(board.metrics.agentAvailability.map(agent => [agent.family, agent]));
  for (const run of all.invocations) { if (!families.has(run.family)) { families.set(run.family, { family: run.family, available: false, blockedForMs: 0, reason: 'Family not configured for new launches' }); } }
  return { ...board, metrics: { ...board.metrics,
    agentAvailability: [...families.values()].map(agent => ({ ...agent,
      runningSessions: providerFamilyCount(all, agent.family), executionComplete: all.complete })),
    unattributedRunningSessions: all.complete ? 0 : null,
  } };
}
