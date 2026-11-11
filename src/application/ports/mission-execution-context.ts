/**
 * The checkouts one Mission operation executes against, resolved from the
 * Mission identity rather than from the working directory of the process that
 * admitted it (a web host runs from its own checkout, usually on the primary
 * branch).
 */
export interface MissionExecutionContext {
  readonly missionId: string;
  /**
   * The live worktree checked out on the mission branch. Null only when the
   * landing is proven on the receiving base and closeout already removed the
   * mission checkout; a discovery failure never resolves to a context.
   */
  readonly missionWorktree: string | null;
  /** The branch observed in `missionWorktree`; equals the mission branch. */
  readonly missionBranch: string;
  /** The receiving base checkout and branch the mission integrates into. */
  readonly baseWorktree: string;
  readonly baseBranch: string;
}

/**
 * Proof that a Mission's squash landed on its receiving base. The resolver
 * asks for it only when the mission checkout is gone, which separates a
 * completed closeout from a checkout that was never created or was deleted.
 */
export type LandedProofReader = (_baseWorktree: string, _slug: string) => string | null;

/** An unresolved context names the Mission and the fact that could not be resolved. */
export type MissionExecutionContextResolution =
  | { readonly ok: true; readonly context: MissionExecutionContext }
  | { readonly ok: false; readonly reason: string };

/** A mutation requires the live mission checkout, not only a proven landing. */
export type LiveMissionExecutionContext = MissionExecutionContext & { readonly missionWorktree: string };

export type LiveMissionExecutionContextResolution = { readonly ok: true; readonly context: LiveMissionExecutionContext } | { readonly ok: false; readonly reason: string };

/** Validate a resolved context before any review, rebase, handoff or repair mutation. */
export function liveMissionExecutionContext(
  slug: string,
  resolution: MissionExecutionContextResolution,
): LiveMissionExecutionContextResolution {
  if (!resolution.ok) { return resolution; }
  if (resolution.context.missionId !== slug) {
    return { ok: false, reason: `Execution context for ${resolution.context.missionId} cannot mutate mission ${slug}.` };
  }
  if (!resolution.context.missionWorktree) {
    return { ok: false, reason: `Mission ${slug}: the mission checkout is unavailable after landing; no mutation is permitted.` };
  }
  return { ok: true, context: { ...resolution.context, missionWorktree: resolution.context.missionWorktree } };
}
