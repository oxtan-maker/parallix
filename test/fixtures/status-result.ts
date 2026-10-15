import type { StatusMissionData, StatusResult } from '../../src/application/ports/cli-workflows.js';

/** Complete read facts; cases override only the status fields they exercise. */
export function statusMissionData(overrides: Partial<StatusMissionData> = {}): StatusMissionData {
  return { backlogStatus: 'active', reviewHistory: [], ...overrides };
}

export function statusResult(overrides: Partial<StatusResult> = {}): StatusResult {
  return {
    branch: 'mission/task-fixture', worktree: '/fixture', rebaseInfo: null,
    slug: 'task-fixture', missionData: null, prInfo: null, staleWorktrees: [],
    staleWorktreeRebase: {}, agents: [], lastThreeCommits: [], uncommittedCount: 0,
    ...overrides,
  };
}
