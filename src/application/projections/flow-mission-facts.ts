import type { LifecycleHistoryEntry } from '../ports/operation-history.js';
import type { VerificationMeasurement } from '../ports/verification-observation.js';
import type { RunRecord } from '../run-history-types.js';
import type { FlowElapsedOwnership, FlowOwnershipRow } from './flow-elapsed-ownership.js';

export interface ObservedFlowMission {
  readonly missionId: string;
  readonly diagramNodeIds: readonly string[];
  readonly diagramEdgeIds: readonly string[];
  readonly ownership: readonly FlowOwnershipRow[];
  readonly actualAgentLaunches: number | null;
  readonly agentLaunches: readonly { readonly runId: string; readonly startedAt: string;
    readonly family: string | null; readonly model: string | null }[];
  readonly observedDisqualifiers: readonly string[] | null;
}

/** Extract per-mission diagram, launch, disqualifier and ownership facts before review evidence is joined. */
export function observedFlowMissions(input: { readonly repositoryId: string;
  readonly lifecycle: readonly LifecycleHistoryEntry[]; readonly runs?: readonly RunRecord[] },
ownership: FlowElapsedOwnership | null, attempts: readonly VerificationMeasurement[],
rebases: readonly { readonly missionId: string; readonly id: string; readonly outcome: string }[]): ObservedFlowMission[] {
  const completed = input.lifecycle.filter(event => event.repositoryId === input.repositoryId && event.toStatus === 'done');
  return [...new Set(completed.map(event => event.missionId))].map(missionId => {
    const segments = ownership?.segments.filter(segment => segment.missionId === missionId) ?? [];
    const nodeIds = [...new Set(segments.map(segment => segment.id))];
    const edgeIds = [...new Set(segments.slice(1).map((segment, index) => `${segments[index]!.id}->${segment.id}`))];
    const grouped = new Map<string, FlowOwnershipRow>();
    for (const segment of segments) {
      const key = `${segment.step}\0${segment.actor}\0${segment.model ?? ''}\0${segment.state}`;
      const prior = grouped.get(key);
      grouped.set(key, prior ? { ...prior, durationMs: prior.durationMs + segment.durationMs }
        : { step: segment.step, actor: segment.actor, model: segment.model, state: segment.state, durationMs: segment.durationMs });
    }
    const runs = input.runs?.filter(run => run.repositoryId === input.repositoryId && run.missionId === missionId);
    const scopedAttempts = attempts.filter(attempt => attempt.missionId === missionId);
    const scopedRebases = rebases.filter(rebase => rebase.missionId === missionId);
    const observed = segments.length > 0 && input.runs !== undefined;
    return { missionId, diagramNodeIds: nodeIds, diagramEdgeIds: edgeIds, ownership: [...grouped.values()],
      actualAgentLaunches: runs ? new Set(runs.map(run => run.runId)).size : null,
      agentLaunches: (runs ?? []).map(run => ({ runId: run.runId, startedAt: run.startedAt,
        family: run.family, model: run.configuredModel ?? run.resources?.provider?.model ?? null })),
      observedDisqualifiers: observed ? [
        ...scopedAttempts.filter(attempt => attempt.result === 'failed').map(attempt => `gate:${attempt.id}`),
        ...scopedRebases.filter(rebase => ['conflict', 'failed'].includes(rebase.outcome)).map(rebase => `rebase:${rebase.id}:${rebase.outcome}`),
      ] : null };
  });
}
