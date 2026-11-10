import type { MissionExecutionContext } from '../../src/application/ports/mission-execution-context.js';

/**
 * Checkouts as the Mission-identity resolver would have produced them, for cases
 * that vary one integration fact. Integration paths require this shape; they no
 * longer substitute a working directory.
 */
type LiveMissionExecutionContextOverrides = Partial<Omit<MissionExecutionContext, 'missionWorktree'>> & {
  readonly missionWorktree?: string;
};

export function missionExecutionContext(overrides: LiveMissionExecutionContextOverrides = {}): MissionExecutionContext & { missionWorktree: string } {
  const missionId = overrides.missionId ?? 'task-2000';
  return {
    missionId,
    missionWorktree: overrides.missionWorktree ?? `/fixture/${missionId}`,
    missionBranch: overrides.missionBranch ?? `mission/${missionId}`,
    baseWorktree: overrides.baseWorktree ?? '/fixture/main',
    baseBranch: overrides.baseBranch ?? 'main',
    ...overrides,
  };
}
