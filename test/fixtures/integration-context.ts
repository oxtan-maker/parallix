import type { IntegrationContext } from '../../src/application/integrate/context.js';
import type { LiveMissionExecutionContextResolution } from '../../src/application/ports/mission-execution-context.js';
import { backlogMirrorOwnership, missionId } from '../../src/domain/mission.js';
import { missionExecutionContext } from './mission-execution-context.js';

/** Live-checkout resolution for landed closeout cases; restoring a stranded lane is a mutation. */
export function landedLiveExecutionContext(slug: string, missionWorktree: string, baseWorktree: string): LiveMissionExecutionContextResolution {
  return { ok: true, context: missionExecutionContext({ missionId: slug, missionWorktree, baseWorktree }) };
}

/** Complete integration facts for cases that vary one preflight or landing condition. */
export function integrationContext(overrides: Partial<IntegrationContext> = {}): IntegrationContext {
  const slug = overrides.slug ?? 'task-2000';
  const missionWorktree = overrides.missionWorktree ?? '/fixture/mission';
  const executionContext = overrides.executionContext
    ?? missionExecutionContext({ missionId: slug, missionWorktree, baseWorktree: overrides.baseWorktree ?? '/fixture/main', baseBranch: overrides.baseBranch ?? 'main' });
  return {
    slug, branch: `mission/${slug}`, currentBranch: `mission/${slug}`,
    missionDir: null, area: 'all', task: { ok: false, reason: 'missing', matches: [] },
    mirrorOwnership: backlogMirrorOwnership({ id: missionId(slug), waveParentId: null }),
    reviewState: null, missionWorktree, executionCheckout: missionWorktree, promoteBacklogOnCloseout: false,
    taskAssignee: null, forgejoUser: null, forgejoToken: null, configuredReviewer: null,
    taskAssigneeWarning: null, pr: { exists: false }, siblingPrs: [], approval: { ok: false },
    baseBranch: 'main', baseWorktree: '/fixture/main', mainBranch: 'main',
    mainDirtyEntries: [], mainDirty: false,
    ...overrides,
    executionContext,
  };
}
