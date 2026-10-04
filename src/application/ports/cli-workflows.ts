/** Application-owned ports for CLI workflow execution. Concrete implementations
 * are supplied only by the composition root. */

import type { MissionActivity } from '../projections/mission-activity.js';
import type { AgentBlock } from '../../domain/agents.js';

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
  /** Agent family name, as configured. */
  readonly agent: string;
  /** The family's block in the operator database; `none` when it may run. */
  readonly block: AgentBlock;
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
  /** Operator withdrawal of this round's approval, if any. */
  readonly revocation?: { readonly by: string; readonly reason: string; readonly at: string } | null;
  /** The branch move that superseded this round's approval, if any. */
  readonly supersession?: { readonly revision: string; readonly by: string; readonly at: string } | null;
}

/** Mission-specific data returned by status projection. */
export interface StatusMissionData {
  /** Authoritative Mission lifecycle status. */
  readonly missionStatus?: string;
  /** Backlog status string. */
  readonly backlogStatus: string;
  /** The Mission aggregate's closure timestamp, including historical imports. */
  readonly closedAt?: string | null;
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
  /** Whether the effective approval still covers what the branch would land (TASK-2555). */
  readonly approvalCoverage?: import('../../domain/approval-coverage.js').ApprovalCoverage | null;
  /** The latest integration repair: failed gate, repair range, re-review outcome (TASK-2620). */
  readonly integrationRepair?: import('../integration-repair-review.js').IntegrationRepairFacts | null;
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
  /**
   * The recorded brief. `px status` is the one reporting surface for a Mission,
   * so it lives here rather than in a second projection command: an agent reads
   * the goal from the same place it reads lane and review state.
   *
   * Absent when the Mission has no recorded brief, which is a fact the caller
   * must see rather than an error.
   */
  readonly brief?: StatusBrief | null;
  /** The exact commands handoff runs for this Mission. */
  readonly declaredGates?: readonly string[];
  /** What must be true for the Mission to be done. */
  readonly successCriteria?: readonly string[];
  /** Zero-based positions in `successCriteria` marked complete. */
  readonly completedSuccessCriteria?: readonly number[];
  /** Missions this one depends on; recorded for readers, enforced by nothing. */
  readonly dependencies?: readonly string[];
  /** Every checkpoint in execution order, planned or evidenced, with its recorded Goal Check rows (empty while planned). */
  readonly checkpoints?: readonly StatusCheckpoint[];
  /** The draft's predicted NEL bucket, when recorded. */
  readonly predictedNelBucket?: string | null;
  /** The bug mission's declared red-to-green reproduction test, when one is recorded. */
  readonly reproductionTest?: string | null;
  /** Goal Check rows of the latest recorded checkpoint. */
  readonly goalCheck?: readonly StatusGoalCheckRow[];
  /** Next action recorded with the latest checkpoint. */
  readonly nextAction?: string | null;
  /** Optimistic-concurrency version, supplied to `--expected-version` on writes. */
  readonly version?: number | null;
  /** Mission title as recorded, so an agent identifies the mission without a file. */
  readonly title?: string | null;
  /** Recorded assignee family, or null when the Mission is unassigned. */
  readonly assignee?: string | null;
  /** Reference to the external material this Mission was accepted from. */
  readonly externalTaskRef?: { readonly source: string; readonly id: string; readonly url: string | null } | null;
  /** Full legacy task material recovered from the pinned Git artifact, when present. */
  readonly legacyTaskContent?: string | null;
  readonly legacyTaskError?: string | null;
  /** Full historical mission document; current typed fields above remain authoritative. */
  readonly legacyMissionContent?: string | null;
  readonly legacyMissionError?: string | null;
  /** Closed-mission review snapshot that differs from the current Review aggregate. */
  readonly legacyReviewStateContent?: string | null;
  readonly legacyReviewStateError?: string | null;
}

/** One Goal Check evidence row as `px status` reports it. */
/** One planned or recorded checkpoint as `px status` presents it. */
export interface StatusCheckpoint {
  readonly name: string;
  /** What the checkpoint was planned to deliver. */
  readonly description: string;
  readonly recorded: boolean;
  readonly goalCheck: readonly StatusGoalCheckRow[];
}

export interface StatusGoalCheckRow {
  readonly criterion: string;
  readonly evidence: string;
}


/** The recorded mission brief: what this mission is for. */
export interface StatusBrief {
  readonly goal: string;
  readonly why: string;
  readonly scope: string | null;
  readonly outOfScope: readonly string[];
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
  /** Null when the operator database holding agent blocks cannot be read. */
  readonly agents: readonly StatusAgentEntry[] | null;
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
  /** Resolve the mission branch name for a slug using the worktree's adapter config. */
  missionBranchName(_slug: string, _rootDir: string): string;
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
  /** Configured agent families and their operator-database blocks. */
  getAgents(): Promise<readonly StatusAgentEntry[] | null>;
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
// Integrate workflow port
// ---------------------------------------------------------------------------

export interface IntegrateWorkflowPort {
  execute(_args: string[], _options?: Record<string, unknown>): Promise<unknown> | unknown;
}

/** Adapter operations required by the stats reporting workflow. The application
 * owns the sequence; CLI and infrastructure provide these operations. */
export interface StatsWorkflowPort<Row = unknown> {
  loadMeasurements(): Promise<readonly Row[]>;
  loadMissionFlow(): Promise<readonly StatsMissionFlow[] | null>;
}

/** Lifecycle data consumed by statistics presentation without exposing a store. */
export interface StatsMissionFlow {
  readonly repo: string;
  readonly mission: string;
  readonly closedAt: string;
  readonly labels: readonly string[];
  readonly implementer?: string | null;
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
  /** Mission branch name (set once setup resolves it). */
  readonly branchName?: string;
  /** Retired compatibility field; file-free drafts leave it empty. */
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
  /** Prepare the typed contract, record base branch, bootstrap backlog task. */
  scaffold(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Materialize mission in the operator store via intake service. */
  intake(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Transition backlog task to target status. */
  transition(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Read agent config, select agent, launch draft agent, record implementer and stats. */
  launchAgent(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Normalize classification (restart agent if needed) and re-assert base branch. */
  postProcess(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Enforce draft commit safety — capture uncommitted changes. */
  commitSafety(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Final transition to 'ready' status. */
  finalTransition(_context: DraftWorkflowContext): Promise<void> | void;
}
