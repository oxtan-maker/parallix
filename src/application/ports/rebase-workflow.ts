/** Application-owned ports for the rebase workflow (TASK-2332.12).
 *
 * Every external dependency the rebase policy needs — Git, agents, Forgejo,
 * Backlog, review state, product configuration, mission filesystem layout and
 * verification formatting — is declared here as a port method. Concrete
 * implementations are supplied by `src/adapters/rebase/rebase-workflow-adapter.ts`
 * and, through it, by the composition root. The application layer never imports
 * an adapter module directly.
 */

export interface GitCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (_args: string[], _options?: Record<string, unknown>) => GitCommandResult;

export interface RebaseStateSnapshot {
  inProgress: boolean;
  rebaseHead?: string | null;
  unmergedFiles: string[];
}

export interface MissionConflictClassification {
  ok: boolean;
  error?: string;
  conflictFiles: string[];
  missionSpecificFiles: string[];
  sharedFiles: string[];
}

export interface AgentLaunchResult {
  agent: string;
  result: { status: number };
}

// --- pre-review rebase result contract (TASK-2377.02) ---------------------
// The pre-review rebase runs the workflow in-process and reports *typed*
// evidence. Failure class follows the failing git operation and the inner
// failing check, never a regex over combined subprocess output.

/** Git operation the pre-review rebase was performing when it failed. */
export type PreReviewRebaseOperation = 'commit' | 'rebase' | 'push';

/**
 * Verification-gate evidence. Field names match `PreReviewGateResult` so the
 * review loop can consume gate failures from either source unchanged.
 */
export interface PreReviewRebaseGateEvidence {
  area: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

/** Git hook evidence: the hook identity comes from the failing git operation. */
export interface PreReviewRebaseHookEvidence {
  /** `pre-commit`, `pre-push`, `post-commit`, or the generic `hook`. */
  hook: string;
  output: string;
}

/** Discriminated pre-review rebase failure. */
export type PreReviewRebaseFailure =
  | { kind: 'hook'; operation: PreReviewRebaseOperation; hook: PreReviewRebaseHookEvidence; bounceRequests: number }
  | { kind: 'gate'; operation: PreReviewRebaseOperation; gate: PreReviewRebaseGateEvidence }
  | { kind: 'conflict'; operation: 'rebase'; sharedFiles: string[] }
  | { kind: 'unsafe-worktree'; operation: 'commit'; unsafeFiles: string[] }
  | { kind: 'other'; operation: PreReviewRebaseOperation; output: string };

/** Result returned by `rebaseBeforeReviewRound`. */
export interface PreReviewRebaseResult {
  ok: boolean;
  sharedFileConflicts: boolean;
  hookFailure: boolean;
  /** Raw hook output, retained so existing prompt builders keep working. */
  hookOutput?: string;
  failure?: PreReviewRebaseFailure;
}

/** Loosened shape accepted from injected pre-review rebase seams. */
export type PreReviewRebaseOutcome = { ok: boolean } & Partial<PreReviewRebaseResult>;

/** Complete external surface of the rebase workflow. */
export interface RebaseWorkflowPort {
  // --- git adapter -------------------------------------------------------
  git: GitRunner;
  detectRebaseState(_root: string): RebaseStateSnapshot;
  getCurrentBranch(_root: string): string;

  // --- mission filesystem adapter ---------------------------------------
  /** Working directory the command was launched from. */
  cwd(): string;
  inferSlug(_explicitSlug?: string): string | null;
  findMissionDir(_slug: string, _root: string): string | null;
  findMissionArea(_missionDir: string): string;
  resolveWorktree(_slug: string, _options: { cwd: string }): string | null;
  conventionalWorktreePath(_slug: string, _root: string): string;
  missionBranchName(_slug: string, _root: string): string;
  resolveMissionBaseBranch(_slug: string, _root: string, _options: { gitFn: GitRunner }): string;
  /**
   * Repository-relative prefix that marks a conflicted path as mission-owned.
   * Kept as its own port method because the pre-extraction command resolved it
   * from the real mission layout even when the `findMissionDir` seam was
   * overridden; routing it separately preserves that behavior exactly.
   */
  missionConflictPathPrefix(_slug: string, _worktreePath: string): string;
  /** Base branch shown in the conflict-resolution prompt (never throws). */
  resolvePromptBaseBranch(_slug: string, _worktreePath: string, _gitFn?: GitRunner): string;

  // --- agents adapter ----------------------------------------------------
  startAgent(_step: string, _options: Record<string, unknown>): Promise<AgentLaunchResult>;
  // Production contract (launcher-selection.ts): `selectAgent(step, options)`
  // where `options.exclude` is a Set of families to skip. Called with policy
  // key `active` (config/agents.json key that owns implementation work) and an
  // exclusion for the pinned/blocked implementer, so eligibility is read from
  // config/agents.json (an unknown key falls back to all workflow families) and
  // the blocked family is never re-selected (F1). Throws on pool
  // exhaustion/unavailability; the caller treats that as no replacement (F2).
  selectAgent(_step: string, _options?: { exclude?: Set<string>; worktree?: string }): string | null;
  // Real launcher-status contract: probe a *selected* agent. An absent launcher
  // returns { supported: false }, so only a supported family is launchable.
  workflowLauncherStatus(_agent: string, _worktree?: string): { supported: boolean; agent: string | null };
  applyAgentFallback(_options: Record<string, unknown>): Promise<unknown>;

  // --- forgejo adapter ---------------------------------------------------
  createPr(_branch: string, _user: string, _token: string, _options: Record<string, unknown>): { ok: boolean; error?: string };
  readToken(_user: string): string | null;
  resolveForgejoUser(_user: string | null): string | null;
  fetchReviewBranch(..._args: unknown[]): unknown;

  // --- backlog adapter ---------------------------------------------------
  resolveTaskFile(_slug: string, _root: string): { ok: boolean; taskFile?: string; task?: unknown };
  getTaskImplementer(_task: unknown): string | null;
  transitionTask(_slug: string, _status: string, _options: Record<string, unknown>): Promise<unknown> | unknown;

  // --- review adapter ----------------------------------------------------
  resolveReviewIdentity(_slug: string, _root: string): { forgejoUser?: string | null };
  readReviewState(_slug: string, _worktree: string, _missionStore?: unknown): unknown;
  writeReviewState(_slug: string, _state: unknown, _worktree: string, _missionStore?: unknown): unknown;
  /** Persist-or-throw wrapper around `writeReviewState`. */
  persistReviewState(_slug: string, _state: unknown, _worktree: string, _missionStore?: unknown): Promise<unknown>;

  // --- product configuration adapter ------------------------------------
  isForgejoReviewEnabled(_root: string): boolean;

  // --- verification adapter ---------------------------------------------
  formatVerificationCommand(_area: string, _root: string): string;

  // --- integrate application contract (TASK-2332.07) --------------------
  resolveConflictsForMission(_slug: string, _area: string, _options: { worktreePathOverride?: string }): MissionConflictClassification;

  // --- runtime seams -----------------------------------------------------
  /** Mission persistence services for the selected root; absent for callers that did not compose them. */
  missionServices?: ((_root: string) => Promise<{ store: unknown }>) | null;
  /**
   * Hook-failure interception seam (TASK-2377.05). Return `false` to decline the
   * in-child rebound-kernel bounce; the pre-review path installs a recorder that
   * captures the hook evidence because the review loop owns that budget. Left
   * unset by the CLI, where the kernel performs the bounce.
   */
  onHookFailure?: (
    _classification: { hookType: string | null },
    _output: string,
  ) => Promise<boolean> | boolean;
  exit(_code: number): void;
}
