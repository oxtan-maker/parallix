import type { MissionTransitionStore } from './domain-ports.js';
import { failure, completed, type ApplicationOutcome } from './contracts.js';
import { lifecycleLaneEvent } from './lifecycle-lane-event.js';
import { writeFailure } from './mission-command-support.js';
import type { Mission, MissionId } from '../domain/mission.js';

export interface LifecycleRecoveryResult {
  readonly taskStatus: string;
  readonly aggregateStatus: string;
  readonly action: 'none' | 'recover-to-active' | 'refused-integrated';
  readonly recovered: Mission | null;
}

/** Reopens only the proven interrupted `active` task / `done` aggregate split. */
export async function recoverMissionLifecycle(input: {
  readonly missionId: MissionId;
  readonly taskStatus: string | null;
  readonly actor: string;
  readonly occurredAt: string;
  readonly store: MissionTransitionStore;
}): Promise<ApplicationOutcome<LifecycleRecoveryResult>> {
  const loaded = await input.store.load(input.missionId);
  if (loaded.kind !== 'found') { return failure('unavailable', `Mission ${input.missionId} is unavailable for lifecycle recovery`); }
  const taskStatus = input.taskStatus ?? 'unavailable';
  const aggregateStatus = loaded.mission.status;
  if (taskStatus !== 'active' || aggregateStatus !== 'done') {
    return completed({ taskStatus, aggregateStatus, action: 'none', recovered: null });
  }
  if (!input.store.findTransitions) {
    return failure('unavailable', `Lifecycle conflict: task ${taskStatus}, aggregate ${aggregateStatus}. Recovery history is unavailable.`);
  }
  const transitions = await input.store.findTransitions(input.missionId);
  if (transitions.some(({ trigger }) => trigger === 'integrate')) {
    return completed({ taskStatus, aggregateStatus, action: 'refused-integrated', recovered: null });
  }
  const recovered = { ...loaded.mission, status: 'active' as const, closedAt: null };
  try {
    await input.store.saveWithTransition(recovered, loaded.version, lifecycleLaneEvent({
      mission: recovered,
      from: 'done',
      trigger: 'recover-active',
      agent: input.actor,
      occurredAt: input.occurredAt,
    }));
  } catch (error) {
    return writeFailure(error);
  }
  return completed({ taskStatus, aggregateStatus, action: 'recover-to-active', recovered });
}
