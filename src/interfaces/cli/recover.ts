import { missionId } from '../../domain/mission.js';
import { recoverMissionLifecycle } from '../../application/mission-lifecycle-recovery.js';
import * as fmt from '../../application/presentation/cli-format.js';
import type { MissionTransitionStore } from '../../application/domain-ports.js';

export async function recoverMissionCommand(args: readonly string[], deps: {
  readonly taskStatus: (_slug: string) => string | null;
  readonly store: MissionTransitionStore;
  readonly alreadyMerged?: (_slug: string) => Promise<boolean>;
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
  });
  if (result.status !== 'completed' || !result.value) { (deps.error ?? fmt.log.fail)(result.error?.message ?? 'Lifecycle recovery failed.'); return false; }
  const { taskStatus, aggregateStatus, action } = result.value;
  (deps.log ?? fmt.log.info)(`Lifecycle states: task ${taskStatus}; aggregate ${aggregateStatus}.`);
  if (action === 'recover-to-active') { (deps.log ?? fmt.log.info)('Recovery action: resumed active mission lifecycle.'); return true; }
  if (action === 'refused-integrated') {
    if (deps.cleanup && !deps.cleanup(slug)) {
      (deps.error ?? fmt.log.fail)(`Recovery halted: landed mission cleanup failed; retry px recover ${slug} after resolving the worktree.`);
      return false;
    }
    (deps.error ?? fmt.log.fail)('Recovery refused: durable integration history keeps this mission closed.');
    return false;
  }
  (deps.log ?? fmt.log.info)('Recovery action: none required.');
  return true;
}
