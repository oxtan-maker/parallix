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
 * | `HandoffAgentRelaunchPort`  | `src/adapters/cli/commands/active.js` — `attemptAgentRelaunch`                    |
 * | `HandoffAgentSelectionPort` | `src/adapters/agents/agents.js` — reviewer eligibility and selection              |
 * | `HandoffProcessPort`        | `node:child_process` — declared-gate command execution                            |
 * | `HandoffMissionServicesPort`| mission service factory (checkpoints, lifecycle, store, NEL handoff recording)    |
 */

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

export interface HandoffGitPort {
  git(_args: string[], _options?: Record<string, unknown>): CommandResult;
  run: Function;
  getCurrentBranch(_rootDir: string): string;
  getWorktreeStatus(_rootDir: string): string[];
}

export interface HandoffMissionUtilsPort {
  inferSlug(_explicitSlug?: string): string | undefined;
  resolveWorktree(_slug: string, _options?: { cwd?: string }): string | null;
  findMissionDir(_slug: string, _rootDir: string): string | null;
  findMissionArea(_missionDir: string): string | null;
  missionBranchName(_slug: string, _rootDir: string): string;
  findCheckpoints(_missionDir: string): string[];
  getPrimaryBranch(_rootDir: string): string | null;
}

export interface HandoffBacklogPort {
  resolveTaskFile(_slug: string, _rootDir: string): { ok: boolean; taskFile?: string; reason?: string };
  getTaskImplementer(_taskFile: string): string | null;
  transitionTask(_slug: string, _status: string, _options: Record<string, unknown>): Promise<boolean> | boolean;
}

export interface HandoffForgejoPort {
  readToken(_user: string): string | null;
  resolveForgejoSettings(_rootDir: string): { url?: string; repo?: string };
  createPr(_branch: string, _user: string, _token: string, _options: Record<string, unknown>): { ok: boolean; error?: string };
  authenticatedReviewUrl(_user: string, _token: string, _rootDir: string): string;
  resolveTrackingBranchSha(_branch: string, _rootDir: string): { ok: boolean; sha?: string; error?: string };
}

export interface HandoffReviewIdentityPort {
  resolveReviewIdentity(_slug: string, _rootDir: string, _options?: Record<string, unknown>): Promise<{ forgejoUser?: string | null }>;
}

export interface HandoffSetupReviewPort {
  bootstrapReviewSurface(_rootDir: string, _setup: Record<string, unknown>, _options: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
  apiRequest: Function;
}

export interface HandoffRebasePort {
  rebaseBeforeReviewRound(_slug: string, _options: Record<string, unknown>): Promise<{ ok: boolean; sharedFileConflicts?: boolean }>;
}

export interface GatekeeperOutcome {
  readonly ok: boolean;
  readonly posted?: boolean;
  readonly skipped?: boolean;
  readonly missing?: string[];
}

export interface HandoffGatekeeperPort {
  runGatekeeper(_slug: string, _options: Record<string, unknown>): GatekeeperOutcome;
}

export interface ProofResult {
  readonly ok: boolean;
  readonly identity?: string;
  readonly error?: string;
}

export interface HandoffVerificationPort {
  formatVerificationCommand(_area: string, _rootDir: string): string;
  createVerificationProofIdentity(_command: string, _rootDir: string): ProofResult;
  readReusableVerificationProof(_command: string, _rootDir: string): ProofResult;
  writeReusableVerificationProof(_command: string, _rootDir: string, _options?: Record<string, unknown>): ProofResult;
  runVerificationGate(_area: string, _options: Record<string, unknown>): CommandResult;
}

export interface HandoffNelComputationPort {
  computeNELRecord(_range: string, _options: { cwd: string }): { nel: number; bucket: { label: string } };
}

export interface HandoffDocumentWriterPort {
  write: Function;
}

export interface HandoffProductConfigPort {
  isForgejoReviewEnabled(_rootDir: string): boolean;
}

export interface HandoffAgentRelaunchPort {
  attemptAgentRelaunch(
    _slug: string,
    _rootDir: string,
    _reason: string,
    _agent: string,
    _options: Record<string, unknown>,
  ): Promise<{ relaunched: boolean; error?: string }>;
}

export interface HandoffAgentSelectionPort {
  eligibleAgentsForStep(_step: string, _options?: { worktree?: string }): string[];
  selectAgent(_step: string, _options?: { exclude?: Set<string>; worktree?: string }): string;
}

export interface HandoffProcessPort {
  spawnSync(_command: string, _args: string[], _options: Record<string, unknown>): CommandResult;
}

/**
 * Factory for the mission service bundle (checkpoint recording, lifecycle
 * transition, mission store reads, and NEL handoff recording). Kept as a
 * factory because each call opens a store bound to a specific worktree root.
 */
export type HandoffMissionServicesPort = (
  _rootDir: string,
  _options: Record<string, unknown>,
) => Promise<{
  checkpoints: { record(_request: Record<string, unknown>): Promise<{ status: string; error?: { message?: string } }> };
  lifecycle: { transition(_request: Record<string, unknown>): Promise<{ status: string; error?: { message?: string }; value?: { version?: number } }> };
  store: { load(_slug: string): Promise<Record<string, unknown>> };
  handoff: { recordNel(_request: Record<string, unknown>): Promise<{ status: string; error?: { message?: string } }> };
}>;

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
  readonly nel: HandoffNelComputationPort;
  readonly documentWriter: HandoffDocumentWriterPort;
  readonly productConfig: HandoffProductConfigPort;
  readonly agentRelaunch: HandoffAgentRelaunchPort;
  readonly agentSelection: HandoffAgentSelectionPort;
  readonly process: HandoffProcessPort;
  readonly missionServices?: HandoffMissionServicesPort;
}

export interface HandoffResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Set when the failure is a CLI usage error the interface layer should render. */
  readonly usage?: boolean;
  readonly reason?: string;
  readonly gatekeeperPushedBack?: boolean;
  readonly gateOutput?: { stdout: string; stderr: string };
}
