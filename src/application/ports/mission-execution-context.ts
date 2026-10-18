/**
 * The checkouts one Mission operation executes against, resolved from the
 * Mission identity rather than from the working directory of the process that
 * admitted it (a web host runs from its own checkout, usually on the primary
 * branch).
 */
export interface MissionExecutionContext {
  readonly missionId: string;
  /** The live worktree checked out on the mission branch. */
  readonly missionWorktree: string;
  /** The branch observed in `missionWorktree`; equals the mission branch. */
  readonly missionBranch: string;
  /** The receiving base checkout and branch the mission integrates into. */
  readonly baseWorktree: string;
  readonly baseBranch: string;
}

/** An unresolved context names the Mission and the fact that could not be resolved. */
export type MissionExecutionContextResolution =
  | { readonly ok: true; readonly context: MissionExecutionContext }
  | { readonly ok: false; readonly reason: string };
