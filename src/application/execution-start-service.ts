import type { ApplicationOutcome } from './contracts.js';
import { agentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import type { WorkflowOperation } from '../domain/workflow-operation.js';
import type { MissionTransitionStore } from './domain-ports.js';
import { missionVersion } from './domain-ports.js';
import { MissionLifecycleService, type MissionTransitionResult } from './mission-lifecycle-service.js';
import { reviewReturnStage } from '../domain/review.js';

export type ExecutionStart = Pick<WorkflowOperation, 'id' | 'missionId' | 'agent' | 'originalStatus' | 'previousAssignee' | 'activationVersion'>;

/** Checked start and pre-launch compensation share the execution use-case boundary. */
export class ExecutionStartService {
  constructor(private readonly _missions: MissionTransitionStore) {}

  async start(slug: string, agent: string, id: string, expectedVersion?: number): Promise<MissionTransitionResult> {
    const loaded = await this._missions.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable`); }
    const lifecycle = new MissionLifecycleService(this._missions);
    const request = { operationId: id, missionId: loaded.mission.id,
      expectedVersion: expectedVersion === undefined ? loaded.version : missionVersion(expectedVersion),
      capabilities: new Set(['mission:transition'] as const), agent: agentFamily(agent), occurredAt: new Date().toISOString(), idempotencyKey: `${id}:activate` };
    const fixingRound = loaded.mission.status === 'review' ? loaded.mission.review?.rounds.at(-1) : undefined;
    const result = fixingRound?.phase === 'fixing'
      ? await lifecycle.transition({ ...request, actor: agent,
        command: { type: 'rebound-to-active', agent: agentFamily(agent), cause: { kind: 'review-repair' } },
        // The round that sent the work back owns the return stage: an operator
        // changes-requested round is a human-review return, as settleRequestedChanges records it.
        workflowReturn: reviewReturnStage(fixingRound) })
      : await lifecycle.activate(request);
    if (result.status !== 'completed' || !result.value) { throw new ExecutionStartRefusal(result); }
    return result.value;
  }

  async continue(start: ExecutionStart): Promise<MissionTransitionResult> {
    const loaded = await this._missions.load(start.missionId);
    if (loaded.kind !== 'found') { throw new Error(`Mission ${start.missionId} is unavailable`); }
    return { mission: loaded.mission, previousAssignee: start.previousAssignee ? agentFamily(start.previousAssignee) : null,
      version: loaded.version, from: start.originalStatus, to: loaded.mission.status, laneChanged: start.originalStatus !== loaded.mission.status };
  }

  async compensate(start: ExecutionStart): Promise<void> {
    if (start.originalStatus !== 'refined' || start.activationVersion === undefined) { return; }
    const loaded = await this._missions.load(start.missionId);
    // A later write belongs to later work. Never claim to undo it or external effects.
    if (loaded.kind !== 'found' || loaded.mission.status !== 'active' || loaded.version !== start.activationVersion) { return; }
    const result = await new MissionLifecycleService(this._missions).abortActivation({
      operationId: `${start.id}:abort`, missionId: start.missionId, expectedVersion: loaded.version,
      capabilities: new Set(['mission:transition']), assignee: start.previousAssignee ? agentFamily(start.previousAssignee) : null,
      actor: start.agent ?? 'execution', occurredAt: new Date().toISOString(),
    });
    if (result.status !== 'completed') { throw new Error(`Could not undo failed activation: ${result.error?.message ?? result.status}`); }
  }
}

export class ExecutionStartRefusal extends Error {
  constructor(readonly outcome: ApplicationOutcome<unknown>) { super(outcome.error?.message ?? 'Mission activation failed'); }
}
