/** Application-owned ports for CLI workflow execution. Concrete implementations
 * are supplied only by the composition root. */

import type { MissionActivity } from '../projections/mission-activity.js';

// ---------------------------------------------------------------------------
// Status workflow port
// ---------------------------------------------------------------------------

/** Rebase diagnostics collected for a worktree. */
export interface StatusRebaseInfo {
  /** True when a rebase is in progress. */
  readonly inProgress: boolean;
  /** True when HEAD is detached during rebase. */
  readonly detached: boolean;
  /** List of files with merge conflicts. */
  readonly unmergedFiles: readonly string[];
}

/** A stale mission worktree detected during status scan. */
export interface StatusStaleWorktree {
  /** Mission slug. */
  readonly slug: string;
  /** Absolute path of the worktree. */
  readonly path: string;
  /** Branch ref. */
  readonly branch: string | null;
  /** Task status of the mission. */
  readonly taskStatus: string;
  /** Suggested cleanup command. */
  readonly cleanupCommand: string;
}

/** Agent launcher entry in the status matrix. */
export interface StatusAgentEntry {
  /** Agent family name. */
  readonly agent: string;
  /** Whether the launcher is supported. */
  readonly supported: boolean;
  /** Eligibility for draft step. */
  readonly draftEligible: boolean;
  /** Eligibility for active step. */
  readonly activeEligible: boolean;
}

/** Review round from mission card history. */
export interface StatusReviewRound {
  /** Round number. */
  readonly number: number;
  /** Reviewer agent. */
  readonly reviewer: string;
  /** Implementer agent. */
  readonly implementer: string;
  /** Disposition verdict. */
  readonly disposition: string;
  /** Review comment. */
  readonly comment?: string;
  /** Finding summaries. */
  readonly findingSummaries: readonly string[];
  /** Fixes applied. */
  readonly fixes: readonly string[];
  /** Pushbacks raised. */
  readonly pushbacks: readonly string[];
}

/** Mission-specific data returned by status projection. */
export interface StatusMissionData {
  /** Backlog status string. */
  readonly backlogStatus: string;
  /** Last checkpoint name (e.g. CP-2.md). */
  readonly checkpoint?: string;
  /** Last checkpoint description. */
  readonly checkpointDescription?: string;
  /** Current review phase. */
  readonly reviewPhase?: string;
  /** Current review round. */
  readonly reviewRound?: number;
  /** Current review disposition. */
  readonly reviewDisposition?: string;
  /** A local self-review awaits an external formal approval. */
  readonly approvalOwed?: boolean;
  /** Review history rounds. */
  readonly reviewHistory: readonly StatusReviewRound[];
  /**
   * The mission's activity in the shared read model the TUI renders from.
   * Absent or `null` when the board projection could not supply one, in which
   * case `px status` states nothing about activity rather than guessing.
   * Carrying the projection rather than pre-rendered text is what keeps
   * `px status` and the agent strip from drifting into contradicting each other.
   */
  readonly activity?: MissionActivity | null;
}

/** Forgejo PR state for a mission branch. */
export interface StatusPrInfo {
  /** Whether a PR exists. */
  readonly exists: boolean;
  /** PR number (when exists). */
  readonly number?: number;
  /** PR state string. */
  readonly state?: string;
  /** Raw error message (when unavailable). */
  readonly raw?: string;
}

/** Complete status data returned by the status use case. */
export interface StatusResult {
  /** Current git branch name. */
  readonly branch: string;
  /** Current worktree path. */
  readonly worktree: string;
  /** Rebase info for the current worktree (null if not in rebase). */
  readonly rebaseInfo: StatusRebaseInfo | null;
  /** Mission slug (null if no slug inferred). */
  readonly slug: string | null;
  /** Mission data from board projection (null if no mission). */
  readonly missionData: StatusMissionData | null;
  /** Forgejo PR info (null if no mission). */
  readonly prInfo: StatusPrInfo | null;
  /** Stale worktrees found (only when no explicit slug). */
  readonly staleWorktrees: readonly StatusStaleWorktree[];
  /** Stale worktree rebase info keyed by worktree path. */
  readonly staleWorktreeRebase: Record<string, StatusRebaseInfo | null>;
  /** Agent launcher matrix. */
  readonly agentMatrix: readonly StatusAgentEntry[];
  /** WORKFLOW_AGENT env override (if set). */
  readonly agentOverride?: string;
  /** Last three commit messages. */
  readonly lastThreeCommits: readonly string[];
  /** Count of uncommitted files. */
  readonly uncommittedCount: number;
}

/** Port that supplies board projection data for status. */
export interface StatusBoardPort {
  /** Build board projection and return mission card data. Returns null if no mission found. */
  getMissionData(_slug: string, _rootDir: string): Promise<StatusMissionData | null>;
  /** Infer mission slug from explicit input or current context. Returns null if not inferable. */
  inferSlug(_explicit?: string): string | null;
}

/** Port that supplies git state for status. */
export interface StatusGitPort {
  /** Get current branch name. */
  getCurrentBranch(): string;
  /** Get rebase info for a worktree. Returns null if not in rebase. */
  getRebaseInfo(_rootDir: string): StatusRebaseInfo | null;
  /** Get last three commit messages. */
  getLastThreeCommits(): readonly string[];
  /** Get count of uncommitted files. */
  getUncommittedCount(): number;
}

/** Port that supplies Forgejo PR info for status. */
export interface StatusPrPort {
  /** Get PR info for a branch. */
  getPrInfo(_branch: string): StatusPrInfo | null;
}

/** Port that supplies agent launcher matrix for status. */
export interface StatusAgentPort {
  /** Get agent launcher matrix entries. */
  getAgentMatrix(): readonly StatusAgentEntry[];
  /** Get WORKFLOW_AGENT env override (if set). */
  getAgentOverride(): string | undefined;
}

/** Port that supplies stale worktree detection for status. */
export interface StatusStaleWorktreesPort {
  /** Find stale mission worktrees. Returns empty array when explicit slug provided. */
  findStaleWorktrees(_explicitSlug: string | null, _rootDir: string): readonly StatusStaleWorktree[];
  /** Get rebase info for each stale worktree. */
  getStaleWorktreeRebase(_staleWorktrees: readonly StatusStaleWorktree[]): Record<string, StatusRebaseInfo | null>;
}

/** Port that supplies all data the status use case needs (legacy, for backward compatibility). */
export interface StatusWorkflowPort {
  /** Gather complete status data for the given slug and root directory. */
  getStatus(_slug: string | null, _rootDir: string): Promise<StatusResult>;
}

// ---------------------------------------------------------------------------
// Checkpoint workflow — focused ports
// ---------------------------------------------------------------------------

/** Verification gate result from the port. */
export interface CheckpointVerificationResult {
  /** Exit code from verification process. */
  readonly exitCode: number;
  /** Verification area that was checked. */
  readonly area: string;
  /** Command used to run verification. */
  readonly command: string;
}

/** Port that runs the verification gate for a checkpoint. */
export interface CheckpointVerificationPort {
  /** Run verification gate for the given area, root directory, and mission directory.
   * Persists gate result to operator-local observation. */
  runVerification(_area: string, _rootDir: string, _missionDir: string): Promise<CheckpointVerificationResult>;
}

/** Port that handles git operations for checkpoint (stage, commit, ignored check). */
export interface CheckpointGitPort {
  /** Stage all tracked changes in the given root directory. */
  stage(_rootDir: string): void;
  /** Check for ignored source files in the given root directory. */
  findIgnoredSourceFiles(_rootDir: string): readonly string[];
  /** Commit checkpoint with the given message and body. */
  commit(_rootDir: string, _message: string, _body: string): Promise<number>;
}

/** Port that records lifecycle operations for checkpoint.
 * This is non-blocking operator telemetry — a failure to record does not
 * abort the checkpoint. Authorization decisions are handled separately. */
export interface CheckpointLifecyclePort {
  /** Record a checkpoint lifecycle operation (fire-and-forget telemetry). */
  recordCheckpoint(_slug: string, _cpName: string, _agent: string | null): Promise<void>;
}

/** Port that authorizes lifecycle transitions before commit.
 * A rejection aborts the checkpoint and prevents any git effect. */
export interface CheckpointLifecycleAuthorizationPort {
  /** Check if the checkpoint lifecycle transition is allowed.
   * Returns rejection reason string if disallowed, null if authorized. */
  checkLifecycleTransition(_slug: string, _cpName: string, _agent: string | null): Promise<string | null>;
}

/** Port that resolves mission context for checkpoint. */
export interface CheckpointMissionPort {
  /** Infer the mission slug from explicit input or current context. Returns null if not inferable. */
  inferSlug(_explicit?: string): string | null;
  /** Resolve the worktree path for a slug. Returns null if no worktree found. */
  resolveWorktree(_slug: string, _cwd: string): string | null;
  /** Resolve the mission directory for a slug. Returns null if not found. */
  resolveMission(_slug: string, _rootDir: string): Promise<{ missionDir: string; area: string } | null>;
  /** Resolve task file and assignee for a slug. */
  resolveTaskAssignee(_slug: string, _rootDir: string): Promise<string | null>;
}

/** Successful checkpoint outcome. */
export interface CheckpointSuccess {
  readonly ok: true;
  /** Checkpoint name that was committed. */
  readonly checkpointName: string;
  /** Next action recorded in commit body. */
  readonly nextAction: string;
  /** Resolved mission slug. */
  readonly slug: string;
}

/** Checkpoint failed at the verification gate. */
export interface CheckpointVerificationFailure {
  readonly ok: false;
  readonly reason: 'verification-failure';
  /** Verification area that failed. */
  readonly area: string;
  /** Exit code from verification. */
  readonly exitCode: number;
  /** Command to re-run verification. */
  readonly command: string;
}

/** Checkpoint rejected due to ignored source files. */
export interface CheckpointIgnoredFilesFailure {
  readonly ok: false;
  readonly reason: 'ignored-files';
  /** List of ignored source file paths. */
  readonly ignoredFiles: readonly string[];
}

/** Checkpoint commit failed. */
export interface CheckpointCommitFailure {
  readonly ok: false;
  readonly reason: 'commit-failure';
}

/** Checkpoint rejected: mission directory not found. */
export interface CheckpointMissionNotFound {
  readonly ok: false;
  readonly reason: 'mission-not-found';
  /** Slug that was looked up. */
  readonly slug: string;
}

/** Checkpoint rejected: lifecycle transition not allowed. */
export interface CheckpointLifecycleRejection {
  readonly ok: false;
  readonly reason: 'lifecycle-rejection';
  /** Rejection reason from lifecycle service. */
  readonly rejectionReason: string;
}

/** Union of all checkpoint outcomes. */
export type CheckpointResult =
  | CheckpointSuccess
  | CheckpointVerificationFailure
  | CheckpointIgnoredFilesFailure
  | CheckpointCommitFailure
  | CheckpointMissionNotFound
  | CheckpointLifecycleRejection;

/** Port that executes the complete checkpoint workflow (legacy, for backward compatibility). */
export interface CheckpointWorkflowPort {
  /** Execute checkpoint: verify, stage, commit, record lifecycle. */
  executeCheckpoint(_args: string[]): Promise<CheckpointResult>;
}

// ---------------------------------------------------------------------------
// Integrate workflow port
// ---------------------------------------------------------------------------

export interface IntegrateWorkflowPort {
  execute(_args: string[], _options?: Record<string, unknown>): Promise<unknown> | unknown;
}

/** Adapter operations required by the stats reporting workflow. The application
 * owns the sequence; CLI and infrastructure provide these operations. */
export interface StatsWorkflowPort<Row = unknown> {
  loadMeasurements(_options: Record<string, unknown>): readonly Row[];
  resolveClassification(_slug: string, _options: Record<string, unknown>): unknown;
  deriveImplementerAndFixRounds(_slug: string, _options: Record<string, unknown>): unknown;
  resolveRepositoryName(_options: Record<string, unknown>): string;
  lookupForgejo?(_slug: string, _options: Record<string, unknown>): unknown;
  backfill?(_options: Record<string, unknown>): unknown;
}

/** Context passed between draft workflow steps.
 * Carries state from preflight through commit safety. */
export interface DraftWorkflowContext {
  /** True if the workflow should stop (exitFn was called). */
  readonly exited: boolean;
  /** Normalized mission slug. */
  readonly slug: string;
  /** Primary checkout path. */
  readonly mainRepo: string;
  /** Mission worktree path. */
  readonly targetWorktree: string;
  /** Path to MISSION.md. */
  readonly missionFile: string;
  /** Recorded base branch (null if primary/detached HEAD). */
  readonly recordedBase: string | null;
  /** Synthetic task info (for adhoc missions). */
  readonly syntheticTask: unknown;
  /** Selected agent family. */
  readonly agent: string;
  /** Actual agent family (may differ from selected). */
  readonly actualAgent: string | null;
  /** Agent launch result. */
  readonly agentResult: unknown;
  /** Exit function. */
  readonly exitFn: (_code?: number) => never;
  /** Log function. */
  readonly logFn: (_msg: string) => void;
  /** Error function. */
  readonly errorFn: (_msg: string) => void;
  /** Mission services factory. */
  readonly missionServicesFn: Function;
  /** Additional options passed through. */
  readonly options: Record<string, unknown>;
}

export interface DraftWorkflowPort {
  /** Resolve slug, validate repo, baseline, config, task resolution, classification. */
  preflight(_args: string[], _options?: Record<string, unknown>): DraftWorkflowContext;
  /** Create branch, worktree, graphify workspace, gitignore. */
  setup(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Scaffold MISSION.md, record base branch, bootstrap backlog task. */
  scaffold(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Materialize mission in the operator store via intake service. */
  intake(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Transition backlog task to target status. */
  transition(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Read agent config, select agent, launch draft agent, record implementer and stats. */
  launchAgent(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Normalize classification (restart agent if needed), label sync, re-assert base branch. */
  postProcess(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Enforce draft commit safety — capture uncommitted changes. */
  commitSafety(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Final transition to 'ready' status. */
  finalTransition(_context: DraftWorkflowContext): Promise<void> | void;
}
