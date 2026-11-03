import type { MissionLoadResult } from '../domain-ports.js';
import type { IntegrationMissionServices } from '../ports/integration-records.js';
import type { IntegrationRecoveryContext } from './recovery.js';
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
import { reviewStatus } from '../../domain/review.js';
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
function closedRecoveryEvidence(mission: Extract<MissionLoadResult, { kind: 'found' }>['mission'], slug: string, rootDir: string, hasIntegrationMeasurement?: (slug: string, rootDir: string) => boolean, hasCleanupArtifacts?: (slug: string, rootDir: string) => boolean) {
  const alreadyClosed = typeof mission.closedAt === 'string';
  const alreadyMeasured = alreadyClosed && hasIntegrationMeasurement
    ? hasIntegrationMeasurement(slug, rootDir) : false;
  const artifactsRemain = alreadyClosed && hasCleanupArtifacts
    ? hasCleanupArtifacts(slug, rootDir) : false;
  return { alreadyClosed, alreadyMeasured, artifactsRemain };
}

function needsLandedReconciliation(mission: Extract<MissionLoadResult, { kind: 'found' }>['mission']): boolean {
  return (mission.status === 'active' || mission.status === 'review')
    && (!mission.review || reviewStatus(mission.review) !== 'approved');
}

async function restoreApprovedLaneIfRequired(
  reconcileLanded: boolean,
  slug: string,
  missionServices: IntegrationMissionServices,
  missionLoad: Extract<MissionLoadResult, { kind: 'found' }>,
  recoverMissionForIntegration: (_context: IntegrationRecoveryContext, _opts: { missionServices: IntegrationMissionServices; missionLoad: MissionLoadResult }) => Promise<{ status: string }>,
  createAbort: () => Error,
): Promise<void> {
  if (reconcileLanded) { return; }
  const context = { slug, approval: { ok: true, providerDisabled: true }, missionStatus: undefined };
  const restored = await recoverMissionForIntegration(context, { missionServices, missionLoad });
  if (restored.status !== 'integration' && restored.status !== 'done') {
    fail(
      createAbort,
      `Mission ${slug} is ${restored.status}; integration requires an authoritative approved Review before closeout.`,
    );
  }
}

export async function recoverLandedIntegration(
  slug: string,
  missionServices: IntegrationMissionServices,
  rootDir: string,
  {
    findSquashCommit,
    recoverMissionForIntegration,
    persistLandedIntegrationOrAbort,
    recordPostIntegrationStatsOrAbort,
    closeLandedIntegrationOrAbort,
    cleanupMissionWorktree,
    runPostIntegrateHookOrAbort,
    updateGraphifyRepository,
    createAbort,
    baseBranch,
    hasIntegrationMeasurement,
    hasCleanupArtifacts,
  }: {
    findSquashCommit: IntegrateCheckoutPort['findExistingSquashCommit'];
    recoverMissionForIntegration: (_context: IntegrationRecoveryContext, _opts: { missionServices: IntegrationMissionServices; missionLoad: MissionLoadResult }) => Promise<{ status: string }>;
    persistLandedIntegrationOrAbort: IntegrateLandingPort['persistLandedIntegrationOrAbort'];
    recordPostIntegrationStatsOrAbort: IntegrateLandingPort['recordPostIntegrationStatsOrAbort'];
    closeLandedIntegrationOrAbort: IntegrateLandingPort['closeLandedIntegrationOrAbort'];
    cleanupMissionWorktree: IntegrateLandingPort['cleanupMissionWorktree'];
    runPostIntegrateHookOrAbort: IntegrateLandingPort['runPostIntegrateHookOrAbort'];
    updateGraphifyRepository: IntegrateLandingPort['updateGraphifyRepository'];
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
  const { alreadyClosed, alreadyMeasured, artifactsRemain } = closedRecoveryEvidence(missionLoad.mission, slug, rootDir, hasIntegrationMeasurement, hasCleanupArtifacts);
  if (alreadyClosed && alreadyMeasured && !artifactsRemain) { return; }
  if (alreadyClosed && !artifactsRemain && hasCleanupArtifacts && !alreadyMeasured) {
    fail(createAbort, `Mission ${slug} is closed with no cleanup artifacts but lacks integration statistics; recovery cannot prove whether its post-integrate hook ran.`);
  }
  const strandedWithoutCurrentApproval = needsLandedReconciliation(missionLoad.mission);
  // A current approval still recovers through the normal lifecycle owner. A
  // later orphaned round cannot undo an already-landed Git fact, so the typed
  // integration decision below reconciles that stranded lane instead.
  await restoreApprovedLaneIfRequired(strandedWithoutCurrentApproval, slug, missionServices, missionLoad, recoverMissionForIntegration, createAbort);
  await completeLandedCloseout({
    slug, landedCommit, missionServices, baseWorktree: rootDir, baseBranch, variant: 'variant-b-resumed',
    ...(strandedWithoutCurrentApproval ? { landedRecovery: true } : {}),
    ...(alreadyClosed && artifactsRemain ? { legacyClosedRecovery: { skipStats: alreadyMeasured } } : {}),
    landing: {
      createAbort, persistLandedIntegrationOrAbort, recordPostIntegrationStatsOrAbort,
      cleanupMissionWorktree, runPostIntegrateHookOrAbort, updateGraphifyRepository, closeLandedIntegrationOrAbort,
    },
  });
}
