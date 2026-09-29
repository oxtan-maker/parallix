// TASK-2517 CP-3: close a mission whose squash already landed on the base branch
// but whose aggregate is stranded in `active`/`review`.
//
// The `px recover <slug>` command reconciles the Backlog task vs. the mission
// aggregate split; it never closes a stranded mission to `done`. This is the
// complementary closeout: the payload is already delivered, so there is no
// remote effect left to perform — recover the lane through the authoritative
// recovery that owns the timestamps, close it to `done`, and remove the
// worktree and local branch. Every effect is a tested integration port, so the
// closeout performs zero new remote side effects.
import * as fmt from '../presentation/cli-format.js';
import { missionId } from '../../domain/mission.js';
import type { IntegrateLandingPort, IntegrateCheckoutPort } from '../ports/integrate-workflow.js';
import { completeLandedCloseout } from './landed-closeout.js';

/** @param {string[]} messages */
function fail(createAbort: () => Error, ...messages: string[]): never {
  messages.forEach((message) => fmt.log.fail(message));
  throw createAbort();
}

/**
 * @param {string} slug
 * @param {any} missionServices
 * @param {string} rootDir
 */
export async function recoverLandedIntegration(
  slug: string,
  missionServices: any,
  rootDir: string,
  {
    findSquashCommit,
    recoverMissionForIntegration,
    persistLandedIntegrationOrAbort,
    recordPostIntegrationStatsOrAbort,
    closeLandedIntegrationOrAbort,
    cleanupMissionWorktree,
    runPostIntegrateHookOrAbort,
    createAbort,
    baseBranch,
    hasIntegrationMeasurement,
    hasCleanupArtifacts,
  }: {
    findSquashCommit: IntegrateCheckoutPort['findExistingSquashCommit'];
    recoverMissionForIntegration: (_context: any, _opts: { missionServices: any; missionLoad: any }) => Promise<{ status: string }>;
    persistLandedIntegrationOrAbort: IntegrateLandingPort['persistLandedIntegrationOrAbort'];
    recordPostIntegrationStatsOrAbort: IntegrateLandingPort['recordPostIntegrationStatsOrAbort'];
    closeLandedIntegrationOrAbort: IntegrateLandingPort['closeLandedIntegrationOrAbort'];
    cleanupMissionWorktree: IntegrateLandingPort['cleanupMissionWorktree'];
    runPostIntegrateHookOrAbort: IntegrateLandingPort['runPostIntegrateHookOrAbort'];
    createAbort: () => Error;
    baseBranch: string;
    hasIntegrationMeasurement?: (_slug: string, _rootDir: string) => boolean;
    hasCleanupArtifacts?: (_slug: string, _rootDir: string) => boolean;
  },
): Promise<void> {
  const landedCommit = findSquashCommit(rootDir, slug);
  if (!landedCommit) {
    fail(createAbort, `No landed squash commit found for ${slug}; nothing to recover.`);
  }
  const missionLoad = await missionServices.store.load(missionId(slug));
  if (missionLoad.kind !== 'found') {
    fail(createAbort, `Mission ${missionId(slug)} is unavailable for closeout.`);
  }
  const alreadyClosed = typeof missionLoad.mission.closedAt === 'string';
  const alreadyMeasured = alreadyClosed && hasIntegrationMeasurement
    ? hasIntegrationMeasurement(slug, rootDir) : false;
  const artifactsRemain = alreadyClosed && hasCleanupArtifacts
    ? hasCleanupArtifacts(slug, rootDir) : false;
  if (alreadyClosed && alreadyMeasured && !artifactsRemain) { return; }
  if (alreadyClosed && !artifactsRemain && hasCleanupArtifacts && !alreadyMeasured) {
    fail(createAbort, `Mission ${slug} is closed with no cleanup artifacts but lacks integration statistics; recovery cannot prove whether its post-integrate hook ran.`);
  }
  // The payload is already delivered, so the stored approved round is the
  // authority for recovery even when its provider is no longer reachable.
  const context = { slug, approval: { ok: true, providerDisabled: true }, missionStatus: undefined };
  const restored = await recoverMissionForIntegration(context, { missionServices, missionLoad });
  if (restored.status !== 'integration' && restored.status !== 'done') {
    fail(
      createAbort,
      `Mission ${slug} is ${restored.status}; integration requires an authoritative approved Review before closeout.`,
    );
  }
  await completeLandedCloseout({
    slug, landedCommit, missionServices, baseWorktree: rootDir, baseBranch, variant: 'variant-b-resumed',
    ...(alreadyClosed && artifactsRemain ? { legacyClosedRecovery: { skipStats: alreadyMeasured } } : {}),
    landing: {
      createAbort, persistLandedIntegrationOrAbort, recordPostIntegrationStatsOrAbort,
      cleanupMissionWorktree, runPostIntegrateHookOrAbort, closeLandedIntegrationOrAbort,
    },
  });
}
