/**
 * Application-owned ports for the handoff workflow (TASK-2332.09).
 *
 * `HandoffCommandUseCase` sequences the complete handoff — verification, gate
 * run, rebase, NEL capture, gatekeeper pre-review, declared gates, review
 * assignment, Forgejo PR creation, lifecycle transition, checkpoint recording,
 * and backlog sync — against the interfaces below and nothing else. Concrete
 * implementations are supplied only by the composition root; the use case never
 * imports a module from `src/adapters/`, `src/git/`, `src/forgejo/`,
 * `src/backlog/`, `src/review/`, or `src/verification/`.
 *
 * Port boundary map — which adapter operations each port covers:
 *
 * | Port                        | Adapter operations it stands in for                                              |
 * |-----------------------------|----------------------------------------------------------------------------------|
 * | `HandoffFileSystemPort`     | `node:fs` reads/writes for MISSION.md, CP-N.md, task files, evidence scanning     |
 * | `HandoffGitPort`            | `src/adapters/git/git.js` — status, current branch, add/commit/fetch/push         |
 * | `HandoffMissionUtilsPort`   | `src/adapters/filesystem/mission-utils.js` — slug/worktree/mission/checkpoints    |
 * | `HandoffBacklogPort`        | `src/adapters/backlog/backlog.js` — task resolution, implementer, transition      |
 * | `HandoffForgejoPort`        | `src/adapters/forgejo/forgejo.js` — tokens, settings, PR create, tracking sha     |
 * | `HandoffReviewIdentityPort` | `src/adapters/review/review-state.js` — `resolveReviewIdentity`                   |
 * | `HandoffSetupReviewPort`    | `src/adapters/review/setup-review.js` — non-interactive review-surface bootstrap  |
 * | `HandoffRebasePort`         | `src/adapters/review/rebase.js` — `rebaseBeforeReviewRound`                       |
 * | `HandoffGatekeeperPort`     | `src/adapters/verification/gatekeeper.js` — `runGatekeeper` pre-review validation |
 * | `HandoffVerificationPort`   | `src/adapters/verification/verification.js` — gate run and reusable proofs        |
 * | `HandoffNelComputationPort` | `src/adapters/git/net-engineering-lines.js` — `computeNELRecord`                  |
 * | `HandoffDocumentWriterPort` | `src/adapters/storage/storage.js` — the JSON document writer               |
 * | `HandoffProductConfigPort`  | `src/adapters/config/product-config.js` — `isForgejoReviewEnabled`                |
 * | `HandoffAgentLaunchPort`    | `src/adapters/agents/agents.js` — `startAgent`                                    |
 * | `HandoffAgentSelectionPort` | `src/adapters/agents/agents.js` — reviewer eligibility and selection              |
 * | `HandoffProcessPort`        | `node:child_process` — declared-gate command execution                            |
 * | `HandoffMissionServicesPort`| mission service factory (checkpoints, lifecycle, store, NEL handoff recording)    |
 */

import type { PreReviewRebaseOutcome } from './rebase-workflow.js';
import type { MissionStore } from '../domain-ports.js';
import type { MissionLifecycleService } from '../mission-lifecycle-service.js';
import type { MissionCheckpointService } from '../mission-checkpoint-service.js';
import type { MissionHandoffService } from '../mission-handoff-service.js';

/** Line-oriented progress or failure output the workflow hands to a collaborator. */
export type HandoffLog = (_message: string) => void;

export interface CommandResult {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface DirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface HandoffFileSystemPort {
  existsSync(_target: string): boolean;
  readText(_target: string): string;
  writeText(_target: string, _content: string): void;
  listNames(_target: string): string[];
  listEntries(_target: string): DirectoryEntry[];
}

/** Process options the workflow passes to a Git invocation. */
export type HandoffGitOptions = {
  readonly stdio?: 'pipe' | 'ignore' | 'inherit' | Array<'pipe' | 'ignore' | 'inherit'>;
};

/** Runs one executable with arguments; the verification gate's process runner. */
export type HandoffCommandRunner = (_command: string, _args: string[], _options?: HandoffGitOptions) => CommandResult;

export interface HandoffGitPort {
  git(_args: string[], _options?: HandoffGitOptions): CommandResult;
  readonly run: HandoffCommandRunner;
  getCurrentBranch(_rootDir: string): string;
  getWorktreeStatus(_rootDir: string): string[];
}

export interface HandoffMissionUtilsPort {
  inferSlug(_explicitSlug?: string): string | null | undefined;
  resolveWorktree(_slug: string, _options?: { cwd?: string }): string | null;
  findMissionDir(_slug: string, _rootDir: string): string | null;
  findMissionArea(_missionDir: string): string | null;
  missionBranchName(_slug: string, _rootDir: string): string;
  findCheckpoints(_missionDir: string): string[];
  getPrimaryBranch(_rootDir: string): string | null;
}

export interface HandoffTaskTransitionOptions {
  readonly rootDir: string;
  readonly implementer?: string;
  readonly log?: HandoffLog;
}

export interface HandoffBacklogPort {
  resolveTaskFile(_slug: string, _rootDir: string): { ok: boolean; taskFile?: string; reason?: string };
  getTaskImplementer(_taskFile: string): string | null;
  transitionTask(_slug: string, _status: string, _options: HandoffTaskTransitionOptions): Promise<boolean> | boolean;
}

export interface HandoffPrOptions {
  readonly rootDir: string;
  readonly log: HandoffLog;
  readonly forceWithLease: boolean;
  readonly verificationArea: string;
}

export interface HandoffPrResult {
  readonly ok: boolean;
  readonly error?: string | null;
  readonly prNumber?: number;
  readonly url?: string | null;
  readonly gateFailure?: HandoffResult['gateFailure'];
}

export interface HandoffForgejoPort {
  readToken(_user: string): string | null;
  resolveForgejoSettings(_rootDir: string): { url?: string; repo?: string };
  createPr(_branch: string, _user: string, _token: string, _options: HandoffPrOptions): HandoffPrResult;
  authenticatedReviewUrl(_user: string, _token: string, _rootDir: string): string;
  resolveTrackingBranchSha(_branch: string, _rootDir: string): { ok: boolean; sha?: string; error?: string };
}

export interface HandoffReviewIdentityPort {
  resolveReviewIdentity(_slug: string, _rootDir: string): Promise<{ forgejoUser?: string | null }>;
}

/** Forgejo API request primitive the review-surface bootstrap authenticates with. */
export type HandoffApiRequest = (
  _method: string,
  _requestUrl: string,
  _options?: { basicAuth?: { user: string; password: string }; token?: string; body?: unknown },
) => { ok: boolean; statusCode: number | null; data: unknown; error: string | null };

/** The non-interactive bootstrap request for a missing agent token. */
export interface HandoffReviewSurfaceSetup {
  readonly baseUrl?: string;
  readonly repo?: string;
  readonly ownerLogin: string;
  readonly ownerPassword: string;
  readonly agentPasswords: ReadonlyArray<{ user: string; password: string }>;
}

export interface HandoffSetupReviewPort {
  bootstrapReviewSurface(
    _rootDir: string,
    _setup: HandoffReviewSurfaceSetup,
    _options: { interactive: false; requestFn: HandoffApiRequest; log: HandoffLog },
  ): Promise<{ ok: boolean; error?: string }>;
  readonly apiRequest: HandoffApiRequest;
}

export interface HandoffRebaseOptions {
  readonly worktree?: string;
  readonly log: HandoffLog;
  readonly error: HandoffLog;
  readonly isForgejoReviewEnabledFn: (_rootDir: string) => boolean;
}

export interface HandoffRebasePort {
  /**
   * Runs the pre-review rebase in-process and returns typed failure evidence
   * (TASK-2377.02). `ok` and `sharedFileConflicts` keep their meaning for
   * existing consumers; `failure` carries the gate or hook discriminant.
   */
  rebaseBeforeReviewRound(_slug: string, _options: HandoffRebaseOptions): Promise<PreReviewRebaseOutcome>;
}

export interface GatekeeperOutcome {
  readonly ok: boolean;
  readonly posted?: boolean;
  readonly skipped?: boolean;
  readonly missing: string[];
}

export interface HandoffGatekeeperPort {
  runGatekeeper(_slug: string, _options: { rootDir: string; log: HandoffLog; checkpointsRecorded: boolean }): GatekeeperOutcome;
}

export interface ProofResult {
  readonly ok: boolean;
  readonly identity?: string;
  readonly error?: string;
}

export interface HandoffVerificationGateOptions {
  readonly rootDir: string;
  readonly stdio: 'pipe';
  readonly runFn: HandoffCommandRunner;
}

export interface HandoffVerificationPort {
  formatVerificationCommand(_area: string, _rootDir: string): string;
  createVerificationProofIdentity(_command: string, _rootDir: string): ProofResult;
  readReusableVerificationProof(_command: string, _rootDir: string): ProofResult;
  writeReusableVerificationProof(_command: string, _rootDir: string, _options?: { expectedIdentity?: string }): ProofResult;
  runVerificationGate(_area: string, _options: HandoffVerificationGateOptions): CommandResult;
  isTransientVerificationFailure(_output: { stdout?: unknown; stderr?: unknown }): boolean;
}

export interface HandoffRepositoryGatesPort {
  loadPhaseGates(_rootDir: string, _phase: 'preHandoff' | 'preReview' | 'preIntegration'): Array<{ key: string; command: string; order: number }>;
  runPhaseGates(
    _phase: 'handoff' | 'review' | 'integration',
    _options: {
      slug: string;
      checkoutPath: string;
      gates?: Array<{ key: string; command: string; order: number }>;
      log?: HandoffLog;
      error?: HandoffLog;
    },
  ): Promise<{
    ok: boolean;
    skipped: boolean;
    executed: number;
    failedGate: { key: string; command: string; exitCode: number | null; stdout: string; stderr: string } | null;
    error: string | null;
  }>;
}

export interface HandoffNelComputationPort {
  computeNELRecord(_range: string, _options: { cwd: string }): { nel: number; bucket: { label: string } };
}

/** Atomic JSON document writer: a path (or path thunk) and the value to serialize. */
export type HandoffDocumentWriter = (_filePath: string | (() => string), _data: unknown) => string;

export interface HandoffDocumentWriterPort {
  readonly write: HandoffDocumentWriter;
}

export interface HandoffProductConfigPort {
  isForgejoReviewEnabled(_rootDir: string): boolean;
}

/**
 * Agent launch port. The handoff path launches an agent only through the
 * rebound kernel (TASK-2377.05), which owns classification, the fix prompt, the
 * budget, and the verified fix; this port supplies the launch itself.
 */
export interface HandoffAgentLaunchPort {
  startAgent(
    _step: string,
    _options: Record<string, unknown>,
  ): Promise<{ agent?: string | null; result?: { status?: number | null } | null } | null | undefined>;
}

export interface HandoffAgentSelectionPort {
  eligibleAgentsForStep(_step: string, _options?: { worktree?: string }): string[];
  selectAgent(_step: string, _options?: { exclude?: Set<string>; worktree?: string }): string;
}

export interface HandoffProcessPort {
  spawnSync(_command: string, _args: string[], _options: { cwd: string; encoding: 'utf8'; stdio: 'pipe' }): CommandResult;
}

/** Options the workflow opens a mission service bundle with. */
export interface HandoffMissionServicesOptions {
  readonly missionDir: string;
  readonly documentWriter?: HandoffDocumentWriter;
}

/**
 * The checked Mission use cases handoff drives: store reads, the lifecycle
 * transition to review, checkpoint recording, and NEL handoff recording.
 */
export interface HandoffMissionServices {
  readonly store: MissionStore;
  readonly lifecycle: MissionLifecycleService;
  readonly checkpoints: Pick<MissionCheckpointService, 'record'>;
  readonly handoff: Pick<MissionHandoffService, 'recordNel'>;
}

/**
 * Factory for the mission service bundle (checkpoint recording, lifecycle
 * transition, mission store reads, and NEL handoff recording). Kept as a
 * factory because each call opens a store bound to a specific worktree root.
 */
export type HandoffMissionServicesPort = (
  _rootDir: string,
  _options: HandoffMissionServicesOptions,
) => Promise<HandoffMissionServices>;

/**
 * The complete port bag injected into `HandoffCommandUseCase`. Every collaborator
 * the workflow needs appears here; nothing else is reachable from the use case.
 */
export interface HandoffWorkflowPorts {
  readonly fileSystem: HandoffFileSystemPort;
  readonly git: HandoffGitPort;
  readonly missionUtils: HandoffMissionUtilsPort;
  readonly backlog: HandoffBacklogPort;
  readonly forgejo: HandoffForgejoPort;
  readonly reviewIdentity: HandoffReviewIdentityPort;
  readonly setupReview: HandoffSetupReviewPort;
  readonly rebase: HandoffRebasePort;
  readonly gatekeeper: HandoffGatekeeperPort;
  readonly verification: HandoffVerificationPort;
  readonly repositoryGates: HandoffRepositoryGatesPort;
  readonly nel: HandoffNelComputationPort;
  readonly documentWriter: HandoffDocumentWriterPort;
  readonly productConfig: HandoffProductConfigPort;
  readonly agents: HandoffAgentLaunchPort;
  readonly agentSelection: HandoffAgentSelectionPort;
  readonly process: HandoffProcessPort;
  readonly missionServices?: HandoffMissionServicesPort;
}

/** NEL capture options; `captureNelFn` callers receive the same bag. */
export interface CaptureNelOptions {
  readonly rootDir: string;
  readonly missionDir: string;
  readonly log?: HandoffLog;
  readonly error: HandoffLog;
  readonly missionServicesFn?: HandoffMissionServicesPort;
  readonly documentWriterFn?: HandoffDocumentWriter;
}

export type CaptureNelResult =
  | { readonly ok: true; readonly nel: number; readonly bucket: string }
  | { readonly ok: false; readonly error: string; readonly persistenceFailed?: boolean };

/**
 * Per-invocation overrides for `performHandoff`. Each collaborator override
 * defaults to the matching port; the rest steer the bounded recovery recursion.
 */
export interface PerformHandoffOptions {
  readonly skipGate?: boolean;
  readonly worktree?: string | null;
  readonly force?: boolean;
  readonly forceWithLease?: boolean;
  readonly log?: HandoffLog;
  readonly error?: HandoffLog;
  readonly rebaseFn?: HandoffRebasePort['rebaseBeforeReviewRound'];
  readonly runVerificationGateFn?: HandoffVerificationPort['runVerificationGate'];
  readonly maxAttempts?: number;
  readonly startAgentFn?: HandoffAgentLaunchPort['startAgent'];
  readonly remainingRetries?: number;
  readonly runGatekeeperFn?: HandoffGatekeeperPort['runGatekeeper'];
  readonly captureNelFn?: (_slug: string, _options: CaptureNelOptions) => Promise<CaptureNelResult>;
  /** Authoritative review-entry timestamp when lifecycle recovery re-invokes handoff. */
  readonly occurredAt?: string;
  readonly missionServicesFn?: HandoffMissionServicesPort;
  readonly eligibleAgentsForStepFn?: HandoffAgentSelectionPort['eligibleAgentsForStep'];
  readonly selectAgentFn?: HandoffAgentSelectionPort['selectAgent'];
  readonly recoverGateFailure?: boolean;
  readonly isForgejoReviewEnabledFn?: HandoffProductConfigPort['isForgejoReviewEnabled'];
}

export interface HandoffResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Set when the failure is a CLI usage error the interface layer should render. */
  readonly usage?: boolean;
  readonly reason?: string;
  readonly gatekeeperPushedBack?: boolean;
  /** True when this handoff already used the rebound kernel for this incident. */
  readonly recoveryAttempted?: boolean;
  readonly gateOutput?: { stdout: string; stderr: string };
  /** Process evidence for a failed final verifier; never reduce this to `error`. */
  readonly gateFailure?: {
    area: string;
    command: string;
    cwd: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    transient?: boolean;
  };
}
