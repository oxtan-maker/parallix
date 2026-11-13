import type { ReviewStateData, ReviewStateWriter, ReviewStatePersistenceResult } from './review-persistence.js';
import type { MissionStore } from '../domain-ports.js';
import type { ReboundLaunchOptions } from '../rebound-kernel.js';
import type { GitContentionPort } from './git-contention.js';
import type { LiveMissionExecutionContext, MissionExecutionContextResolution } from './mission-execution-context.js';
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
  failureReason?: import('../../domain/failure-reason.js').FailureReason;
  status: number | null;
  stdout: string;
  stderr: string;
}

export type GitRunner = (_args: string[], _options?: Record<string, unknown>) => GitCommandResult;

export interface RebaseStateSnapshot {
  branch?: string | null;
  otherOperation?: string | null;
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
  result: { status?: number | null };
}

export const REBASE_OBSERVATION_STAGES = ['direct-rebase', 'pre-review-rebase', 'integration-rebase'] as const;
export type RebaseObservationStage = typeof REBASE_OBSERVATION_STAGES[number];
const REBASE_OBSERVATION_STAGE_SET: ReadonlySet<string> = new Set(REBASE_OBSERVATION_STAGES);
export function isRebaseObservationStage(stage: unknown): stage is RebaseObservationStage {
  return typeof stage === 'string' && REBASE_OBSERVATION_STAGE_SET.has(stage);
}
export const REBASE_OBSERVATION_OUTCOMES = ['running', 'no-op', 'clean', 'conflict', 'resolved', 'failed', 'inapplicable'] as const;
export type RebaseObservationOutcome = typeof REBASE_OBSERVATION_OUTCOMES[number];
export const RETAINED_REBASE_OUTCOMES = ['no-op', 'clean', 'conflict', 'resolved', 'failed'] as const;
export type RetainedRebaseOutcome = typeof RETAINED_REBASE_OUTCOMES[number];
export const TERMINAL_REBASE_OUTCOMES = ['no-op', 'clean', 'resolved', 'failed'] as const;
export type TerminalRebaseOutcome = typeof TERMINAL_REBASE_OUTCOMES[number];
const TERMINAL_REBASE_OUTCOME_SET: ReadonlySet<string> = new Set(TERMINAL_REBASE_OUTCOMES);
export function isTerminalRebaseOutcome(outcome: unknown): outcome is TerminalRebaseOutcome {
  return typeof outcome === 'string' && TERMINAL_REBASE_OUTCOME_SET.has(outcome);
}
const RETAINED_REBASE_OUTCOME_SET: ReadonlySet<string> = new Set(RETAINED_REBASE_OUTCOMES);
export function isRetainedRebaseOutcome(outcome: unknown): outcome is RetainedRebaseOutcome {
  return typeof outcome === 'string' && RETAINED_REBASE_OUTCOME_SET.has(outcome);
}
export const SUCCESSFUL_REBASE_OUTCOMES = ['no-op', 'clean', 'resolved'] as const;
export type SuccessfulRebaseOutcome = typeof SUCCESSFUL_REBASE_OUTCOMES[number];
const SUCCESSFUL_REBASE_OUTCOME_SET: ReadonlySet<string> = new Set(SUCCESSFUL_REBASE_OUTCOMES);
export function isSuccessfulRebaseOutcome(outcome: unknown): outcome is SuccessfulRebaseOutcome {
  return typeof outcome === 'string' && SUCCESSFUL_REBASE_OUTCOME_SET.has(outcome);
}
interface RebaseObservationBase {
  readonly id: string;
  readonly missionId: string;
  readonly root: string;
  readonly stage: RebaseObservationStage;
  readonly attempt: number;
  readonly baseBranch: string | null;
  readonly revisionBefore: string | null;
  readonly revisionAfter: string | null;
  readonly conflicts: readonly string[];
  readonly dependencies: readonly string[];
  readonly occurredAt: string;
}
export type RebaseObservationInput = RebaseObservationBase & (
  | { readonly outcome: Exclude<RebaseObservationOutcome, 'inapplicable'>; readonly inapplicability?: never }
  | { readonly outcome: 'inapplicable'; readonly inapplicability: string }
);

export type RebaseObservationPort = (_observation: RebaseObservationInput) => Promise<void>;
let configuredRebaseObservation: RebaseObservationPort | null = null;
let configuredRebaseObservationId: (() => string) | null = null;
let configuredRebaseObservationStage: RebaseObservationStage | null = null;
export type RebaseObservationFields = Required<Pick<RebaseWorkflowPort,
  'observeRebase' | 'newRebaseObservationId' | 'rebaseObservationStage'>>;
/** Composition binds the installed durable observation owner once per CLI invocation. */
export function configureRebaseObservation(fields: RebaseObservationFields | null): void {
  configuredRebaseObservation = fields?.observeRebase ?? null;
  configuredRebaseObservationId = fields?.newRebaseObservationId ?? null;
  configuredRebaseObservationStage = fields?.rebaseObservationStage ?? null;
}
export function rebaseObservation(): RebaseObservationFields | null {
  return configuredRebaseObservation && configuredRebaseObservationId
    ? { observeRebase: configuredRebaseObservation, newRebaseObservationId: configuredRebaseObservationId,
      rebaseObservationStage: configuredRebaseObservationStage ?? 'direct-rebase' }
    : null;
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
  failureReason?: import('../../domain/failure-reason.js').FailureReason;
  signal?: string | null;
  area: string;
  command: string;
  exitCode: number | null;
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
  | { kind: 'other'; operation: PreReviewRebaseOperation; output: string; failureReason?: import('../../domain/failure-reason.js').FailureReason };

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
  /** Durable observation through the existing operational-history owner. */
  observeRebase?: RebaseObservationPort;
  newRebaseObservationId?: () => string;
  rebaseObservationStage?: RebaseObservationInput['stage'];
  resumeReviewAfterRepair?: (_slug: string, _root: string, _implementer: string) => Promise<void>;
  // --- git adapter -------------------------------------------------------
  git: GitRunner;
  detectRebaseState(_root: string): RebaseStateSnapshot;
  getCurrentBranch(_root: string): string;
  /**
   * Git lock contention (TASK-2830): structured failure evidence plus waiting
   * through the shared admission owner. Absent for callers that did not compose
   * it, which retain the pre-TASK-2830 diagnostic path.
   */
  gitContention?: GitContentionPort;

  // --- mission filesystem adapter ---------------------------------------
  /** Working directory the command was launched from. */
  cwd(): string;
  /** Resolve the mutation checkout/base once from Mission identity. */
  resolveExecutionContext(_slug: string, _root: string): MissionExecutionContextResolution;
  inferSlug(_explicitSlug?: string): string | null;
  findMissionDir(_slug: string, _root: string): string | null;
  findMissionArea(_missionDir: string): string;
  conventionalWorktreePath(_slug: string, _root: string): string;
  missionBranchName(_slug: string, _root: string): string;
  /**
   * Repository-relative prefix that marks a conflicted path as mission-owned.
   * Kept as its own port method because the pre-extraction command resolved it
   * from the real mission layout even when the `findMissionDir` seam was
   * overridden; routing it separately preserves that behavior exactly.
   */
  missionConflictPathPrefix(_slug: string, _worktreePath: string): string;

  // --- agents adapter ----------------------------------------------------
  startAgent(_step: string, _options: ReboundLaunchOptions): Promise<AgentLaunchResult>;
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
  applyAgentFallback(_options: { role: string; original: string; launchResult?: { agent?: string | null } | null; state?: ReviewStateData; slug: string; executionContext: LiveMissionExecutionContext; log?: (message: string) => void; writeReviewStateFn?: ReviewStateWriter }): Promise<string>;

  // --- forgejo adapter ---------------------------------------------------
  createPr(_branch: string, _user: string, _token: string, _options: Record<string, unknown>): { ok: boolean; error?: string | null; gateFailure?: Omit<PreReviewRebaseGateEvidence, 'exitCode'> & { exitCode: number | null } };
  readToken(_user: string): string | null;
  /** Publication credentials may differ from the authoritative implementer. */
  publicationCredentials?(_user: string, _root: string): { user: string; token: string | null };
  resolveForgejoUser(_user: string | null): string | null;
  fetchReviewBranch(_branch: string, _root?: string, _options?: { token?: string | null }): unknown;

  // --- backlog adapter ---------------------------------------------------
  resolveTaskFile(_slug: string, _root: string): { ok: boolean; taskFile?: string; task?: unknown };
  getTaskImplementer(_task: string): string | null;
  transitionTask(_slug: string, _status: string, _options: { rootDir?: string; log?: (message: string) => void }): Promise<unknown> | unknown;

  // --- review adapter ----------------------------------------------------
  resolveReviewIdentity(_slug: string, _root: string): { forgejoUser?: string | null } | Promise<{ forgejoUser?: string | null }>;
  readReviewState(_slug: string, _worktree: string, _missionStore?: MissionStore | null): Promise<ReviewStateData | null>;
  writeReviewState: ReviewStateWriter;
  /** Persist-or-throw wrapper around `writeReviewState`. */
  persistReviewState(_slug: string, _state: ReviewStateData, _worktree: string, _missionStore?: MissionStore | null): Promise<ReviewStatePersistenceResult>;

  // --- product configuration adapter ------------------------------------
  isForgejoReviewEnabled(_root: string): boolean;

  // --- verification adapter ---------------------------------------------
  formatVerificationCommand(_area: string, _root: string): string;

  // --- integrate application contract (TASK-2332.07) --------------------
  resolveConflictsForMission(_slug: string, _area: string, _options: { worktreePathOverride?: string }): MissionConflictClassification;

  // --- approval coverage (TASK-2555) ------------------------------------
  /**
   * Record that the completed rebase moved the branch away from the change its
   * current approval covers. Returns an operator-facing line when there is
   * something to report. Absent for callers that did not compose persistence.
   */
  recordBranchMove?: (_slug: string, _root: string, _movedFrom: string | null) => Promise<string | null>;

  // --- runtime seams -----------------------------------------------------
  /** Mission persistence services for the selected root; absent for callers that did not compose them. */
  missionServices?: ((_root: string) => Promise<{ store: Pick<MissionStore, 'load'> | null; lifecycle?: Pick<import('../mission-lifecycle-service.js').MissionLifecycleService, 'transition'> | null }>) | null;
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
  /** Current non-gate failure facts for in-process workflow callers. */
  onFailure?: (_failure: Extract<PreReviewRebaseFailure, { kind: 'other' }>) => void;
  exit(_code: number): void;
}

/** Authority required by a rebase repair, supplied by composition. */
export interface RebaseMissionServices {
  readonly store: MissionStore;
  readonly lifecycle?: Pick<import('../mission-lifecycle-service.js').MissionLifecycleService, 'transition'> | null;
}
