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
    cleanupMissionWorktree,
    createAbort,
  }: {
    findSquashCommit: IntegrateCheckoutPort['findExistingSquashCommit'];
    recoverMissionForIntegration: (_context: any, _opts: { missionServices: any; missionLoad: any }) => Promise<{ status: string }>;
    persistLandedIntegrationOrAbort: IntegrateLandingPort['persistLandedIntegrationOrAbort'];
    cleanupMissionWorktree: IntegrateLandingPort['cleanupMissionWorktree'];
    createAbort: () => Error;
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
  // decideIntegration (integration -> done) then close (closedAt). The squash is
  // already on the base branch, so no merge, push, PR merge, or branch delete runs.
  await persistLandedIntegrationOrAbort(slug, landedCommit, missionServices, { rootDir });
  if (!cleanupMissionWorktree(slug)) {
    fail(createAbort, `Mission worktree cleanup failed for ${slug}.`);
  }
}
