import * as fmt from '../presentation/cli-format.js';
import { missionId } from '../../domain/mission.js';
import type { IntegrateLandingPort } from '../ports/integrate-workflow.js';

type CloseoutPort = Pick<IntegrateLandingPort,
  'createAbort' | 'persistLandedIntegrationOrAbort' | 'recordPostIntegrationStatsOrAbort'
  | 'cleanupMissionWorktree' | 'runPostIntegrateHookOrAbort' | 'closeLandedIntegrationOrAbort'>;

/** Finish a commit already landed on the base branch, for both normal and resumed runs. */
export async function completeLandedCloseout(options: {
  slug: string;
  landedCommit: string;
  missionServices: any;
  baseWorktree: string;
  baseBranch: string;
  variant: string;
  landing: CloseoutPort;
  afterCleanup?: () => void;
  legacyClosedRecovery?: { skipStats: boolean };
}): Promise<void> {
  const { slug, landedCommit, missionServices, baseWorktree, baseBranch, variant, landing, afterCleanup, legacyClosedRecovery } = options;
  // `done` with no `closedAt` is the durable marker that the payload already
  // landed and its delivery transition committed.  Retrying closeout must not
  // try to decide that transition a second time: the remaining effects are
  // statistics, cleanup, the hook, and administrative closure.  A fully
  // closed Mission is an idempotent no-op, including when callers explicitly
  // request recovery after a successful cleanup.
  const beforeCloseout = await missionServices.store.load(missionId(slug));
  if (beforeCloseout.kind === 'found' && typeof beforeCloseout.mission.closedAt === 'string' && !legacyClosedRecovery) { return; }
  if (beforeCloseout.kind !== 'found' || beforeCloseout.mission.status !== 'done') {
    await landing.persistLandedIntegrationOrAbort(slug, landedCommit, missionServices, { rootDir: baseWorktree });
  }
  if (!legacyClosedRecovery?.skipStats) {
    await landing.recordPostIntegrationStatsOrAbort(slug, { rootDir: baseWorktree, missionStore: missionServices.store });
  }
  // The landed payload is now durable, and this hook rebuilds and installs the
  // repository's local px. It must not be contingent on cleanup: cleanup only
  // removes delivery artifacts, while an integration that has already landed
  // must still refresh the CLI even if those artifacts cannot be removed.
  await landing.runPostIntegrateHookOrAbort(slug, { baseWorktree, baseBranch, variant });
  const cleanup = () => {
    if (!landing.cleanupMissionWorktree(slug)) {
      fmt.log.fail(`Mission worktree cleanup failed for ${slug}.`);
      throw landing.createAbort();
    }
    fmt.log.pass('Mission worktree cleaned up.');
    afterCleanup?.();
  };
  cleanup();
  await landing.closeLandedIntegrationOrAbort(slug, landedCommit, missionServices);
}
