import type { IntegrationContext } from '../../src/application/integrate/context.js';

/** Complete integration facts for cases that vary one preflight or landing condition. */
export function integrationContext(overrides: Partial<IntegrationContext> = {}): IntegrationContext {
  const slug = overrides.slug ?? 'task-2000';
  return {
    slug, branch: `mission/${slug}`, currentBranch: `mission/${slug}`,
    missionDir: null, area: 'all', task: { ok: false, reason: 'missing', matches: [] },
    reviewState: null, missionWorktree: '/fixture/mission', promoteBacklogOnCloseout: false,
    taskAssignee: null, forgejoUser: null, forgejoToken: null, configuredReviewer: null,
    taskAssigneeWarning: null, pr: { exists: false }, siblingPrs: [], approval: { ok: false },
    baseBranch: 'main', baseWorktree: '/fixture/main', mainBranch: 'main',
    mainDirtyEntries: [], mainDirty: false,
    ...overrides,
  };
}
