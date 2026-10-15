import type { ParallixConfiguration } from '../../application/ports/configuration.js';

/**
 * Shared vocabulary for the review-setup adapter family (`px setup`,
 * `px setup-review`, `px verify-env`). These are wire/CLI contracts, not
 * migration placeholders: every field below is a value the Forgejo REST
 * surface or the wizard actually reads or writes.
 */

/** Logger seam; `fmt.log.*` satisfies it. */
export type SetupLog = (message: string) => unknown;

/** Interactive prompt seam; resolves to the trimmed answer. */
export type PromptFn = (question: string, options?: { hidden?: boolean }) => Promise<string> | string;

/** Credentials for one `curl`-backed Forgejo call. */
export type ApiRequestOptions = {
  basicAuth?: { user: string; password: string };
  token?: string;
  body?: unknown;
};

/** Normalised Forgejo HTTP result: status, parsed payload, transport error. */
export type ApiResult = {
  ok: boolean;
  statusCode: number | null;
  data: unknown;
  error: string | null;
};

/** Injectable Forgejo transport. Tests substitute a recording double. */
export type ApiRequestFn = (method: string, requestUrl: string, options?: ApiRequestOptions) => ApiResult;

/** Outcome of an idempotent "ensure" step against Forgejo or git. */
export type EnsureResult = {
  ok: boolean;
  created?: boolean;
  skipped?: boolean;
  updated?: boolean;
  error?: string;
  response?: unknown;
};

/** A created PAT plus the file it was written to. */
export type CreatedToken = { user: string; path: string };

/** A per-agent token failure that degrades to a warning, not an abort. */
export type TokenWarning = { user: string; error: string; response?: unknown };

/** Result of `createTokenWithRetries`: minted, skipped by a blank password, or failed. */
export type TokenResult =
  | { ok: true; skipped?: false; token: string }
  | { ok: true; skipped: true }
  | { ok: false; error: string; statusCode?: number | null; response?: unknown };

/** One agent's Forgejo login and the password the operator entered for it. */
export type AgentPassword = { user: string; password: string };

/** The Forgejo bootstrap input `bootstrapReviewSurface` consumes. */
export type ReviewBootstrapSetup = {
  baseUrl?: string;
  repo?: string;
  ownerLogin: string;
  ownerPassword?: string;
  agentPasswords?: readonly AgentPassword[];
  agentUsers?: readonly string[];
};

/** Knobs for the retrying token flow. */
export type TokenRetryOptions = {
  allowBlank?: boolean;
  log?: SetupLog;
  promptFn?: PromptFn;
  maxAttempts?: number;
  requestFn?: ApiRequestFn;
  scopes?: string[];
};

/** Knobs shared by the bootstrap entry points. */
export type BootstrapOptions = TokenRetryOptions & {
  interactive?: boolean;
  forgejoHome?: string;
  reviewRemoteUrlFn?: (rootDir: string) => string | null;
};

/** Owner-token phase of the bootstrap: minted owner PAT plus agent tokens. */
export type BootstrapTokens = {
  ok: true;
  ownerToken: string;
  createdTokens?: CreatedToken[];
  warnings?: TokenWarning[];
} | { ok: false; error: string };

/** What the bootstrap actually did, for the operator-facing summary. */
export type BootstrapFacts = {
  repoCreated?: boolean;
  grantedCollaborators: string[];
  createdTokens: CreatedToken[];
  warnings: TokenWarning[];
  remoteName: string;
  remoteUrl: string | null;
};

/** Answers collected by `px setup` / `px setup-review`, interactive or not. */
export type ReviewSetupAnswers = {
  productName?: string;
  reviewProvider?: string;
  tasksProvider?: string;
  tasksStorage?: string;
  missionsBaseDir?: string;
  branchPrefix?: string;
  primaryBranch?: string;
  worktreePattern?: string;
  verificationCommand?: string;
  verificationDefaultArea?: string;
  preDraftCommand?: string;
  bootstrapReview?: boolean;
  ownerLogin?: string;
  baseUrl?: string;
  reviewRepo?: string;
  reviewRemote?: string;
  ownerPassword?: string;
  agentPasswords?: readonly AgentPassword[];
  agentUsers?: readonly string[];
};

/** Knobs for the wizard and non-interactive answer collectors. */
export type SetupAnswerOptions = {
  log?: SetupLog;
  promptFn?: PromptFn;
  users?: string[];
  configuration?: ParallixConfiguration;
  loadWorkflowConfigFn?: (rootDir?: string) => { found: boolean; config: unknown };
  detectPrimaryBranchDefaultFn?: (rootDir?: string, options?: { configuredPrimaryBranch?: string | null }) => string;
  resolveForgejoSettingsFn?: (rootDir?: string, configuration?: ParallixConfiguration) => { url: string; repo: string; remote: string; baseUrl?: string };
};
