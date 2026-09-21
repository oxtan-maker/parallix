import { missionId, type MissionIntake } from '../../domain/mission.js';
import { recoverMissionLifecycle } from '../../application/mission-lifecycle-recovery.js';
import * as fmt from '../../application/presentation/cli-format.js';
import type { MissionTransitionStore } from '../../application/domain-ports.js';

type RecoverDeps = {
  readonly cleanup?: (_slug: string) => boolean;
  readonly error: (_message: string) => void;
  readonly log: (_message: string) => void;
};

function cleanupLanded(slug: string, deps: RecoverDeps): boolean {
  if (!deps.cleanup || deps.cleanup(slug)) { return true; }
  deps.error(`Recovery halted: landed mission cleanup failed; retry px recover ${slug} after resolving the worktree.`);
  return false;
}

export function reportRecovery(action: string, slug: string, deps: RecoverDeps): boolean {
  if (action === 'recovered-landed') {
    deps.log('Recovery action: restored the closed aggregate of a landed mission.');
    return cleanupLanded(slug, deps);
  }
  if (action === 'recover-to-active') {
    deps.log('Recovery action: resumed active mission lifecycle.');
    return true;
  }
  if (action === 'refused-integrated') {
    if (!cleanupLanded(slug, deps)) { return false; }
    deps.error('Recovery refused: durable integration history keeps this mission closed.');
    return false;
  }
  deps.log('Recovery action: none required.');
  return true;
}

export async function recoverMissionCommand(args: readonly string[], deps: {
  readonly taskStatus: (_slug: string) => string | null;
  readonly store: MissionTransitionStore;
  readonly alreadyMerged?: (_slug: string) => Promise<boolean>;
  /** Landing proof used only when no Mission aggregate exists. */
  readonly landedIntake?: (_slug: string) => Promise<MissionIntake | null>;
  readonly cleanup?: (_slug: string) => boolean;
  readonly log?: (_message: string) => void;
  readonly error?: (_message: string) => void;
}): Promise<boolean> {
  const slug = args[0];
  if (!slug) { (deps.error ?? fmt.log.fail)('Usage: px recover <slug>'); return false; }
  const result = await recoverMissionLifecycle({
    missionId: missionId(slug.toLowerCase()), taskStatus: deps.taskStatus(slug), actor: 'operator',
    occurredAt: new Date().toISOString(), store: deps.store,
    alreadyMerged: deps.alreadyMerged ? () => deps.alreadyMerged!(slug) : undefined,
    landedIntake: deps.landedIntake ? () => deps.landedIntake!(slug) : undefined,
  });
  if (result.status !== 'completed' || !result.value) { (deps.error ?? fmt.log.fail)(result.error?.message ?? 'Lifecycle recovery failed.'); return false; }
  const { taskStatus, aggregateStatus, action } = result.value;
  const recoveryDeps = { cleanup: deps.cleanup, error: deps.error ?? fmt.log.fail, log: deps.log ?? fmt.log.info };
  recoveryDeps.log(`Lifecycle states: task ${taskStatus}; aggregate ${aggregateStatus}.`);
  return reportRecovery(action, slug, recoveryDeps);
}
