import type { ParallixConfiguration } from '../../application/ports/configuration.js';

/**
 * Wire contract for the Forgejo REST endpoints this adapter consumes.
 *
 * Fields are optional because the adapter degrades safely when a Forgejo
 * deployment omits one; every consumer must treat a missing field as unknown
 * rather than assume a value. Keeping the shape here is what lets the API
 * boundary return `unknown`-free results instead of `any`.
 */
export type ForgejoUser = {
  id?: number;
  login?: string | null;
  type?: string | null;
};

export type ForgejoGitRef = {
  ref?: string;
  label?: string;
  sha?: string;
  repo?: { name?: string; owner?: ForgejoUser } | null;
};

export type ForgejoPullRequest = {
  id?: number;
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  merged?: boolean;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: ForgejoUser | null;
  head?: ForgejoGitRef | null;
  base?: ForgejoGitRef | null;
};

export type ForgejoReview = {
  id?: number;
  state?: string;
  body?: string;
  dismissed?: boolean;
  submitted_at?: string;
  created_at?: string;
  updated_at?: string;
  user?: ForgejoUser | null;
};

export type ForgejoIssueComment = {
  id?: number;
  body?: string;
  created_at?: string;
  updated_at?: string;
  user?: ForgejoUser | null;
};

export type ForgejoReviewComment = ForgejoIssueComment & {
  path?: string;
  line?: number;
  original_line?: number;
};

/** Result envelope shared by the synchronous (curl) and asynchronous transports. */
export type ForgejoApiResult<T = unknown> = {
  ok: boolean;
  data: T | null;
  status: number | null;
  statusCode: number | null;
  stderr: string | null;
  error: string | null;
};

export type ForgejoApiOptions = {
  rootDir?: string;
  timeout?: number;
  configuration?: ParallixConfiguration;
};

/**
 * Injectable transport port. Tests substitute a recording double; production
 * supplies `forgejoApi` or `forgejoApiAsync`. The generic parameter names the
 * endpoint's response payload so callers never receive `any`.
 */
export type ForgejoApiCall = {
  <T = unknown>(
    method: string,
    apiPath: string,
    token: string | undefined,
    body?: unknown,
    options?: ForgejoApiOptions
  ): ForgejoApiResult<T>;
};

export type ForgejoAsyncApiCall = {
  <T = unknown>(
    method: string,
    apiPath: string,
    token: string | undefined,
    body?: unknown,
    options?: ForgejoApiOptions
  ): Promise<ForgejoApiResult<T>>;
};

/**
 * Failure envelope returned by the PR-lookup paths when every lookup failed.
 * Both keys are required so the success shape is never assignable to it, which
 * keeps `isApiErrorResult` narrowing usable on either side of the branch.
 */
export type ForgejoPrLookupFailure = { _apiError: ForgejoApiError; _notFound: true };

/** Logger seam shared by the Forgejo adapters; `fmt.log.*` satisfies it. */
export type ForgejoLogFn = (message: string) => unknown;

/** The `_apiError` envelope `resolvePrAccess` returns when every lookup failed. */
export type ForgejoApiError = {
  status?: number | null;
  statusCode?: number | null;
  error?: string | null;
  stderr?: string | null;
};
