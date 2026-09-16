/**
 * Application-owned ports for the integrate workflow (TASK-2512).
 *
 * The modules under `src/application/integrate/` sequence `px integrate`
 * against the interfaces below and nothing else (ADR 0037, ADR 0051). Each
 * port names only the operations the workflow actually performs; the CLI
 * adapter (`src/adapters/cli/commands/integrate.ts`) binds them to the
 * concrete mechanisms at call time.
 *
 * | Port               | Mechanism it stands in for                                                  |
 * |--------------------|-----------------------------------------------------------------------------|
 * | `process`          | process termination for the terminal exit code                              |
 * | `fileSystem`       | `node:fs` existence and symlink checks                                      |
 * | `git`              | `adapters/git/git` — command runner, current branch, rebase state           |
 * | `backlog`          | `adapters/backlog/backlog` — task files, status, classification             |
 * | `stateMap`         | `adapters/config/state-map` — virtual/actual lifecycle names                |
 * | `forgejo`          | `adapters/forgejo/forgejo` — PR status, review decision, tokens, sync-merged |
 * | `github`           | `adapters/github/github-pr` — GitHub PR submission/observation              |
 * | `missionPaths`     | `adapters/filesystem/mission-utils` — mission dirs, worktrees, branches     |
 * | `verification`     | `adapters/verification/verification` — command naming and tree proofs      |
 * | `agents`           | `adapters/agents/*`, `review-loop` — launch, selection, fallback, matrix     |
 * | `productConfig`    | `adapters/config/product-config` — review provider, integration mode        |
 * | `review`           | `adapters/review/*` — review state, submit-for-review, reviewer login       |
 * | `rebase`           | `adapters/rebase/rebase-workflow-adapter` — the shared `px rebase` port     |
 * | `gates`            | `adapters/config/repository-gates`, `integrate-gates`, `integrate-gate-rebound` |
 * | `checkout`         | `integrate-conflict` — stash, noise patch, conflict and squash helpers      |
 * | `landing`          | `integrate-post` — abort signal, hooks, stats, closeout, worktree cleanup   |
 */
import type { MissionStore } from '../domain-ports.js';
import type { ReboundContext } from '../rebound-kernel.js';
import type { RebaseWorkflowPort } from './rebase-workflow.js';

export interface IntegrateCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type IntegrateGitRunner = (_args: string[]) => IntegrateCommandResult;

export interface IntegrateTaskResolution {
  readonly ok: boolean;
  readonly taskFile?: string;
  readonly reason?: string;
  readonly matches?: string[];
}

export interface IntegrateProcessPort {
  /** Terminal exit; the application never calls the runtime directly. */
  terminate(_code: number): void;
}

export interface IntegrateFileSystemPort {
  existsSync(_target: string): boolean;
  isSymbolicLink(_target: string): boolean;
}

export interface IntegrateGitPort {
  git: IntegrateGitRunner;
  getCurrentBranch(): string;
  detectRebaseState(_rootDir: string): { inProgress: boolean; rebaseHead?: string | null; unmergedFiles: string[] };
}

export interface IntegrateBacklogPort {
  resolveTaskFile(_slug: string, _rootDir: string): IntegrateTaskResolution;
  setTaskStatus(_taskFile: string, _status: string): boolean;
  completeTask(_slug: string, _rootDir: string): unknown;
  getTaskAssignee(_taskFile: string): string | null;
  getTaskClassification(_taskFile: string): string | null;
  classificationFromLabels(_labels: readonly string[]): string | null;
  classificationLabels(): Iterable<string>;
  transitionTask(_slug: string, _status: string): unknown;
}

export interface IntegrateStateMapPort {
  toVirtual(_actualState: string, _map?: Record<string, unknown>): string;
  toActual(_virtualState: string, _map?: Record<string, unknown>): string | null;
}

export interface IntegrateForgejoPort {
  getPrStatus(_branch: string, _rootDir: string, _options: Record<string, unknown>): any;
  getLatestReviewDecision(_branch: string, _options: Record<string, unknown>): any;
  syncMerged(_branch: string, _commit: string, _options: Record<string, unknown>): { ok: boolean };
  readToken(_user: string): string | null;
  resolveTokenFile(_user: string): string | null;
  listOpenPrsForSlug(_baseSlug: string, _token: string): Array<{ head: string; number?: number; html_url?: string }>;
}

export interface IntegrateGithubPort {
  submitOrObserveGithubPr(_expected: { head: string; base: string; candidateSha: string }, _rootDir: string): any;
}

export interface IntegrateMissionPathsPort {
  inferSlug(_explicitSlug?: string): string | null;
  findMissionDir(_slug: string): string | null;
  findMissionArea(_missionDir: string): string;
  missionTitle(_slug: string): string | null;
  missionBranchName(_slug: string, _rootDir?: string | null): string;
  missionDirForSlug(_rootDir: string, _slug: string): string;
  getPrimaryWorktree(): string;
  getPrimaryBranch(): string;
  conventionalWorktreePath(_slug: string): string;
  resolveMissionBaseBranch(_slug: string, _rootDir: string): string;
  resolveBaseWorktree(_slug: string, _options: { rootDir: string }): string;
  resolveWorktree(_slug: string, _options: { cwd: string }): string | null;
  findMissionDocInBranches(_slug: string, _rootDir: string): Array<{ branch: string; path: string }> | null;
  parseConflictFilesFromMergeOutput(_output: string): string[];
  softResetTrailingBacklogNoise(_rootDir: string, _git: IntegrateGitRunner): boolean;
}

export interface IntegrateVerificationPort {
  formatVerificationCommand(_area: string, _rootDir: string): string;
  captureVerifiedTreeProof(_area: string, _rootDir: string, _gitRunner: IntegrateGitRunner): { ok: boolean; proof?: any; error?: string };
  assertVerifiedTreeProof(_proof: any, _rootDir: string, _gitRunner: IntegrateGitRunner): { ok: boolean; error?: string };
}

export interface IntegrateAgentsPort {
  startAgent: ReboundContext['startAgent'];
  selectAgent(_step: string): string | null;
  workflowLauncherStatus(_agent: string, _rootDir: string): { supported: boolean; agent?: string | null } | null;
  applyAgentFallback: NonNullable<ReboundContext['applyAgentFallback']>;
  /** The autonomous review matrix, already formatted as operator lines. */
  describeReviewMatrix(): string[];
}

export interface IntegrateProductConfigPort {
  isForgejoReviewEnabled(_rootDir: string): boolean;
  resolveIntegrationMode(_rootDir: string): any;
}

export interface IntegrateReviewPort {
  readReviewState(_slug: string, _rootDir: string, _missionStore?: MissionStore | null): Promise<any> | any;
  submitForReview(_slug: string, _skipGate: boolean, _options: Record<string, unknown>): Promise<unknown>;
  resolveForgejoUser(_reviewer: string): string | null;
}

export interface IntegrateRebasePort {
  createRebaseWorkflowPort(_options: { gitFn: IntegrateGitRunner; missionServicesFn?: Function; exitFn: (_code: number) => void }): RebaseWorkflowPort;
}

export interface IntegrationGateRunResult {
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly error?: string | null;
  readonly failedGate?: any;
}

export interface IntegrationGateRoute {
  readonly route: string;
  readonly rebounds?: number;
}

export interface IntegrateGatesPort {
  loadPhaseGates(_rootDir: string, _phase: 'preIntegration'): any[];
  loadRequirePreIntegration(_rootDir: string): boolean;
  runPhaseGates(_phase: 'integration', _options: Record<string, unknown>): Promise<IntegrationGateRunResult>;
  captureFinalIntegrationTree(_rootDir: string): { ok: boolean; error?: string; rootDir?: string; commit?: string; tree?: string };
  resolveIntegrationVerificationWorktree(_slug: string, _options: { baseWorktree: string }): string;
  isIntendedPayloadAtHead(_rootDir: string, _paths: Iterable<string>, _options: { gitRunner: IntegrateGitRunner }): boolean;
  routeIntegrationGateFailure(_options: any): Promise<IntegrationGateRoute>;
}

export interface IntegrateCheckoutPort {
  stashMainCheckoutIfNeeded(_options: { slug: string; dirtyEntries: string[]; rootDir: string }): { created?: boolean; message?: string; rootDir?: string } | null;
  restoreMainCheckoutStash(_stash: any): IntegrateCommandResult;
  maybeDropStashAfterCollision(_restoreResult: any, _rootDir: string): unknown;
  reportStashPopFailure(_slug: string, _restoreResult: any, _options: { rootDir: string }): void;
  prepareNoisePatchForSquash(_rootDir: string, _options: { gitRunner: IntegrateGitRunner }): { ok: boolean; error?: string; patchPath?: string | null; cleanup?: () => void };
  restoreNoisePatchAfterSquash(_rootDir: string, _patchPath: string, _options: { gitRunner: IntegrateGitRunner }): { ok: boolean; error?: string };
  getUnresolvedIndexConflicts(_rootDir: string): { ok: boolean; error?: string; files: string[] };
  areAllBacklogOnlyConflicts(_files: string[]): boolean;
  findExistingSquashCommit(_rootDir: string, _slug: string): string | null;
  findLandedSquashOnBaseBranch(_rootDir: string, _slug: string): string | null;
  buildConflictResolutionPrompt(_slug: string, _area: string, _options: { baseBranch: string }): string[];
  rewriteWorktreePaths(_taskFile: string, _slug: string, _options: { rootDir: string }): void;
  maybeUpdateGraphifyOnPrimary(_rootDir: string, _options: { log: (_text: string) => void }): unknown;
}

export interface IntegrateLandingPort {
  /** The error that ends a run with exit code 1 after its diagnostics were printed. */
  createAbort(): Error;
  isAbort(_error: unknown): boolean;
  classifyHookFailure(_output: string): { isHookFailure: boolean; hookType?: any };
  reportSyncMergedFailure(_syncResult: unknown): void;
  resolveForgejoUserForIntegration(_taskAssignee: string | null): { forgejoUser: string | null; warning: string | null };
  isNoMergeToAbortResult(_result: IntegrateCommandResult): boolean;
  persistLandedIntegrationOrAbort(_slug: string, _commit: string, _missionServices: any, _options: { rootDir: string }): Promise<unknown>;
  recordPostIntegrationStatsOrAbort(_slug: string, _options: { rootDir: string; missionStore: MissionStore }): Promise<unknown>;
  runPreCommitHookOrAbort(_slug: string, _options: { missionWorktree: string; baseWorktree: string; baseBranch: string; variant: string }): unknown;
  runPostIntegrateHookOrAbort(_slug: string, _options: { baseWorktree: string; baseBranch: string; variant: string }): unknown;
  cleanupMissionWorktree(_slug: string): boolean;
}

export interface IntegrateWorkflowPorts {
  readonly process: IntegrateProcessPort;
  readonly fileSystem: IntegrateFileSystemPort;
  readonly git: IntegrateGitPort;
  readonly backlog: IntegrateBacklogPort;
  readonly stateMap: IntegrateStateMapPort;
  readonly forgejo: IntegrateForgejoPort;
  readonly github: IntegrateGithubPort;
  readonly missionPaths: IntegrateMissionPathsPort;
  readonly verification: IntegrateVerificationPort;
  readonly agents: IntegrateAgentsPort;
  readonly productConfig: IntegrateProductConfigPort;
  readonly review: IntegrateReviewPort;
  readonly rebase: IntegrateRebasePort;
  readonly gates: IntegrateGatesPort;
  readonly checkout: IntegrateCheckoutPort;
  readonly landing: IntegrateLandingPort;
}
