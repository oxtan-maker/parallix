import type { MissionTransitionStore } from './domain-ports.js';
import { failure, completed, type ApplicationOutcome } from './contracts.js';
import { lifecycleLaneEvent } from './lifecycle-lane-event.js';
import { writeFailure } from './mission-command-support.js';
import { closeMission, intakeMission, type Mission, type MissionId, type MissionIntake } from '../domain/mission.js';

export interface LifecycleRecoveryResult {
  readonly taskStatus: string;
  readonly aggregateStatus: string;
  readonly action: 'none' | 'recover-to-active' | 'refused-integrated' | 'recovered-landed';
  readonly recovered: Mission | null;
}

/**
 * Rebuild the Mission aggregate of a completed mission whose payload is proven
 * landed, when no aggregate exists at all.
 *
 * Proof is supplied by the adapter as an intake: a non-null return means the
 * task artifact is completed and the payload is squash-landed on the recorded
 * base branch. The closed aggregate is written once and read back before the
 * caller is allowed to clean anything up — a closeout that cannot be read back
 * as done leaves the stale worktree and branch untouched.
 */
async function recoverLandedMission(input: {
  readonly missionId: MissionId;
  readonly taskStatus: string;
  readonly actor: string;
  readonly occurredAt: string;
  readonly store: MissionTransitionStore;
  readonly landedIntake?: () => Promise<MissionIntake | null>;
}): Promise<ApplicationOutcome<LifecycleRecoveryResult>> {
  const { taskStatus } = input;
  if (taskStatus !== 'done' && taskStatus !== 'completed') {
    return failure('conflict', `Mission ${input.missionId} has no aggregate and its task is ${taskStatus}; recovery requires a completed task.`);
  }
  if (!input.landedIntake) {
    return failure('unavailable', `Mission ${input.missionId} is unavailable for lifecycle recovery`);
  }
  const intake = await input.landedIntake();
  if (!intake) {
    return failure('conflict', `Mission ${input.missionId} has no durable proof that its payload landed on the recorded base branch; recovery refused.`);
  }
  const mission = closeMission({ ...intakeMission(intake), status: 'done' as const }, input.occurredAt);
  try {
    await input.store.saveWithTransition(mission, null, lifecycleLaneEvent({
      mission,
      from: null,
      trigger: 'close',
      agent: input.actor,
      occurredAt: input.occurredAt,
    }));
  } catch (error) {
    return writeFailure(error);
  }
  const readBack = await input.store.load(input.missionId);
  if (readBack.kind !== 'found' || readBack.mission.status !== 'done' || !readBack.mission.closedAt) {
    return failure('unavailable', `Mission ${input.missionId} closeout could not be read back as done; cleanup was not attempted.`);
  }
  return completed({ taskStatus, aggregateStatus: 'missing', action: 'recovered-landed', recovered: readBack.mission });
}

/** Reopens only the proven interrupted `active` task / `done` aggregate split. */
export async function recoverMissionLifecycle(input: {
  readonly missionId: MissionId;
  readonly taskStatus: string | null;
  readonly actor: string;
  readonly occurredAt: string;
  readonly store: MissionTransitionStore;
  /** Authoritative branch-to-primary containment supplied by the CLI adapter. */
  readonly alreadyMerged?: () => Promise<boolean>;
  /** Landing proof for an absent aggregate; non-null means "provably landed". */
  readonly landedIntake?: () => Promise<MissionIntake | null>;
}): Promise<ApplicationOutcome<LifecycleRecoveryResult>> {
  const loaded = await input.store.load(input.missionId);
  if (loaded.kind === 'missing') {
    return recoverLandedMission({ ...input, taskStatus: input.taskStatus ?? 'unavailable' });
  }
  if (loaded.kind !== 'found') { return failure('unavailable', `Mission ${input.missionId} is unavailable for lifecycle recovery`); }
  const taskStatus = input.taskStatus ?? 'unavailable';
  const aggregateStatus = loaded.mission.status;
  if (taskStatus === 'active' && aggregateStatus === 'active' && input.alreadyMerged && await input.alreadyMerged()) {
    return completed({ taskStatus, aggregateStatus, action: 'refused-integrated', recovered: null });
  }
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
