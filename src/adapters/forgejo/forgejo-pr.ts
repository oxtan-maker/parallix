import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { spawnSync } from 'child_process';
import { getPrimaryBranch, resolveMissionBaseBranch } from '../filesystem/mission-utils.js';
import { getTaskImplementer, findTaskFile } from '../backlog/backlog.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { DEFAULT_FORGEJO_USER, DISPOSITION_PATTERN, readToken, resolveAuthorizedApproverUser, resolveForgejoAuth, resolveForgejoHome, resolveForgejoSettings, resolveForgejoUser } from './forgejo-auth.js';
import { forgejoApi, forgejoApiAsync, codexSandboxHint } from './forgejo-api.js';
import type { ForgejoApiCall, ForgejoAsyncApiCall, ForgejoApiError, ForgejoApiResult, ForgejoIssueComment, ForgejoLogFn, ForgejoPrLookupFailure, ForgejoPullRequest, ForgejoReview, ForgejoReviewComment } from './forgejo-types.js';
import { git } from '../git/git.js';
import type { ReviewRefFetch } from './forgejo-git.js';
import { syncPrimaryBaseline, ensureRemoteBaseBranch, fetchReviewBranch, buildCreatePrPushArgs, cLocaleEnv, deleteReviewRef, isStaleInfoPushRejection } from './forgejo-git.js';

type GitFetchFn = ReviewRefFetch;

/** Result of resolving a branch to a PR number, or the failure envelope. */
type PrNumberResult = number | null | ForgejoPrLookupFailure;
type PrNumberResolver = (branch: string, token: string, options: ForgejoOptions) => PrNumberResult;

/** Checked options shared by the PR adapter, including forwarded push controls. */
type ForgejoOptions = {
  configuration?: ParallixConfiguration;
  rootDir?: string;
  forgejoUser?: string | null;
  reviewIdentity?: string | null;
  token?: string;
  apiCall?: ForgejoApiCall;
  apiToken?: string;
  apiUser?: string;
  resolvePrNumber?: PrNumberResolver;
  pageSize?: number;
  maxPages?: number;
  slug?: string | null;
  onlyOpen?: boolean;
  reportNotFound?: boolean;
  base?: string;
  log?: ForgejoLogFn;
  force?: boolean;
  forceWithLease?: boolean;
  gitFetch?: GitFetchFn;
  refreshTrackingRef?: boolean;
  verificationArea?: string;
  expectedRevision?: string;
  sinceIso?: string;
  reviewerUser?: string;
  authorizedApproverUser?: string;
  user?: string;
};

/** Envelope for the comment/review mutations: the API result plus a raw diagnostic. */
type PrMutationResult = ForgejoApiResult<unknown> & { raw?: string };

/** A PR lookup that succeeded, failed through the API, or found nothing. */
type PrAccess = { prNumber: number, token?: string } | ForgejoPrLookupFailure;
type PrLookupOutcome = { prNumber: number | null, lastApiError: ForgejoApiError | null, sawSuccessfulLookup: boolean };

/** Normalised comment record returned by `getCommentsSync`. */
type ForgejoCommentRecord = {
  kind: string;
  id: string;
  reviewId?: string;
  user: string;
  isBot: boolean;
  created: string;
  updated: string;
  body: string;
  state?: string;
  dismissed?: boolean;
  location?: string;
};

const noopLog = () => {};

/**
 * @param {string} branch
 * @param {{status?: number, statusCode?: number}} [apiErr]
 * @returns {string}
 */
function formatPrLookupFailure(branch: string, apiErr: ForgejoApiError): string {
  const sandboxNote = apiErr.status === 7 ? ` (${codexSandboxHint()})` : '';
  if (apiErr.statusCode === 401 || apiErr.statusCode === 403) {
    return `failed to resolve PR for ${branch}: Forgejo authentication failed (${apiErr.statusCode})${sandboxNote}`;
  }
  if (apiErr.statusCode) {
    return `failed to resolve PR for ${branch}: Forgejo API returned HTTP ${apiErr.statusCode}${sandboxNote}`;
  }
  return `failed to resolve PR for ${branch}${sandboxNote}`;
}

/**
 * @param {string} branch
 * @param {string} [rootDir]
 * @param {{forgejoUser?: string, token?: string, apiCall?: Function}} [options]
 * @returns {{exists: boolean, error?: string, raw: string, number?: number, title?: string, state?: string, merged?: boolean, url?: string}}
 */
function getPrStatus(branch: string, rootDir?: string, options: ForgejoOptions = {}) {
  const {
    forgejoUser,
    token: providedToken,
    apiCall = forgejoApi
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const { token } = resolveForgejoAuth({ ...({ forgejoUser, token: providedToken, rootDir }), configuration: options.configuration });
  // Don't short-circuit on missing primary token — resolvePrAccess has fallback logic
  // to try implementer and other known tokens when the primary is unavailable.
  const prAccess = resolvePrAccess(branch, token || null, { ...({ apiCall, slug, forgejoUser, rootDir }), configuration: options.configuration });
  if (prAccess && isPrAccessFailure(prAccess)) {
    const apiErr = prAccess._apiError ?? {};
    return {
      exists: false,
      error: 'api-failed',
      raw: formatPrLookupFailure(branch, apiErr)
    };
  }
  const hit = prAccess && !isPrAccessFailure(prAccess) ? prAccess : null;
  if (!hit) {
    return {
      exists: false,
      raw: `no PR found for '${branch}'`
    };
  }
  const existingPrNumber = hit.prNumber;

  const prDetails = apiCall<ForgejoPullRequest>('GET', `/pulls/${existingPrNumber}`, hit.token, undefined, { ...({ rootDir }), configuration: options.configuration });
  if (!prDetails.ok) {
    return {
      exists: false,
      error: 'api-failed',
      raw: formatPrLookupFailure(branch, prDetails)
    };
  }

  const pr = prDetails.data ?? {};
  const merged = pr.merged === true;
  const raw = `PR #${pr.number}: ${pr.title}\n  State:  ${pr.state}\n  Merged: ${merged ? 'True' : 'False'}\n  URL:    ${pr.html_url}`;

  return {
    exists: true,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    merged: merged,
    url: pr.html_url,
    // TASK-2379 review round 1 (F1): the PR's own creation time is the
    // authoritative review-entry point for recovery of a Mission that never
    // persisted its active → review transition.
    createdAt: pr.created_at || null,
    raw
  };
}

/**
 * Create a Forgejo PR for a given branch.
 * Mirrors cmd_create in the deprecated bash implementation.
 *
 * @param {string} branch   - Mission branch (e.g. 'mission/architecture migration')
 * @param {string} user     - Forgejo login
 * @param {string} token    - Forgejo PAT
 * @param {object} [options]
 * @returns {{ ok: boolean, url: string|null, error: string|null }}
 */
/**
 * @param {string} branch
 * @param {string} user
 * @param {string} token
 * @param {{rootDir?: string, apiCall?: Function, log?: Function, force?: boolean, forceWithLease?: boolean, verificationArea?: string}} [options]
 * @returns {{ok: boolean, url?: string|null, error?: string|null, prNumber?: number}}
 */
type CreatePrResult = { ok: boolean, url?: string | null, error?: string | null, prNumber?: number, gateFailure?: { area: string; command: string; cwd: string; exitCode: number | null; stdout: string; stderr: string; transient?: boolean } };

/** Run one push attempt, mirroring its output to this process's streams. */
function runPrPush(branch: string, remoteUrl: string, rootDir: string, options: ForgejoOptions) {
  const argsResult = buildCreatePrPushArgs(branch, remoteUrl, rootDir, options) as { ok: boolean, pushArgs?: string[], error?: string };
  if (!argsResult.ok) { return { failure: { ok: false, error: argsResult.error } as CreatePrResult }; }
  const result = git(argsResult.pushArgs || [], { stdio: ['ignore', 'pipe', 'pipe'], env: cLocaleEnv() });
  if (result.stdout) { process.stdout.write(result.stdout); }
  if (result.stderr) { process.stderr.write(result.stderr); }
  return { result };
}

/**
 * Push the mission branch to the review remote. A force-with-lease rejected as
 * stale is retried once against a refreshed tracking ref. Returns the failure
 * result, or null once the branch is published.
 */
function pushBranchForPr(branch: string, remoteUrl: string, rootDir: string, context: ForgejoOptions): CreatePrResult | null {
  const { force, forceWithLease, gitFetch, log = fmt.log.info } = context;
  const pushOptions = { force, forceWithLease, gitFetch };
  let attempt = runPrPush(branch, remoteUrl, rootDir, pushOptions);
  if (attempt.failure) { return attempt.failure; }

  if (attempt.result!.status !== 0 && forceWithLease && isStaleInfoPushRejection(attempt.result)) {
    log(`Stale push rejection for ${branch}; fetching and retrying...`);
    attempt = runPrPush(branch, remoteUrl, rootDir, { ...pushOptions, refreshTrackingRef: true });
    if (attempt.failure) { return attempt.failure; }
  }

  const pushResult = attempt.result!;
  if (pushResult.status === 0) { return null; }
  const pushError = (pushResult.stderr || pushResult.stdout || '').trim();
  return { ok: false, error: `git push failed with status ${pushResult.status}${pushError ? `: ${pushError}` : ''}` };
}

function prLookupFailure(apiErr: { error?: string | null; status?: number | null }): CreatePrResult {
  return { ok: false, error: `failed to check existing PR: ${(apiErr.error || 'API error')}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}` };
}

function prAuthorMismatch(prNumber: number, author: string | undefined, implementer: string | null | undefined, publicationAccount: string): CreatePrResult | null {
  if (!author || author === implementer || author === publicationAccount) { return null; }
  return { ok: false, error: `PR #${prNumber} author ${author} differs from implementer ${implementer}. PR authorship is immutable; replace the PR under the actual implementer's credentials before review.` };
}

/**
 * The open PR already on this branch, an API-failure result, or null when there
 * is none and one must be created.
 */
function existingPrForBranch(branch: string, context: ForgejoOptions): CreatePrResult | null {
  const { apiCall = forgejoApi, apiToken, apiUser, slug, rootDir, log = noopLog } = context;
  const lookup = resolvePrAccess(branch, apiToken, { ...({ apiCall, slug, onlyOpen: true, forgejoUser: apiUser, rootDir }), configuration: context.configuration });
  if (lookup && isPrAccessFailure(lookup)) {
    return prLookupFailure(lookup._apiError || {});
  }
  if (!lookup?.prNumber) { return null; }
  const details = apiCall<ForgejoPullRequest>('GET', `/pulls/${lookup.prNumber}`, lookup.token || apiToken, undefined, { ...({ rootDir }), configuration: context.configuration });
  if (!details.ok) { return null; }
  const author = details.data?.user?.login;
  // A sanctioned Parallix publication remains valid when implementer credentials
  // become available later; its immutable PR author is not the implementer identity.
  const publicationAccount = resolveForgejoSettings(rootDir, context.configuration).repo.split('/')[0];
  const mismatch = prAuthorMismatch(lookup.prNumber, author ?? undefined, apiUser, publicationAccount);
  if (mismatch) { return mismatch; }
  const url = details.data?.html_url;
  log(`PR already exists: ${url}`);
  return { ok: true, url, prNumber: lookup.prNumber };
}

function resolvePrimaryBranchOrMain(rootDir: string): string {
  try { return getPrimaryBranch(rootDir); } catch (_) { return 'main'; }
}

/**
 * Where the PR lands: a feature-branch mission targets the base branch it
 * recorded, everything else the primary branch. A mission whose MISSION.md is
 * not on disk yet has no recorded base, so it falls back to primary — which is
 * the byte-identical pre-feature-branch path.
 */
function resolvePrBase(slug: string | null, primaryBranch: string, rootDir: string): string {
  if (!slug) { return primaryBranch; }
  try {
    return resolveMissionBaseBranch(slug, rootDir) || primaryBranch;
  } catch (_) {
    return primaryBranch;
  }
}

/** Credentials used for the git side of PR creation, and the API-side identity. */
type PrCredentials = { gitUser: string; gitToken: string; apiUser: string; apiToken: string };

function resolvePrCredentials(user: string, token: string, rootDir: string, configuration?: ParallixConfiguration): PrCredentials {
  const repoOwner = resolveForgejoSettings(rootDir, configuration).repo.split('/')[0] || null;
  const ownerToken = repoOwner ? readToken(repoOwner, rootDir, configuration) : null;
  return {
    gitUser: ownerToken && repoOwner ? repoOwner : user,
    gitToken: ownerToken || token,
    apiUser: user,
    apiToken: token
  };
}

/** Mirror the local branches the PR needs onto the review remote. */
function syncPrBaseline(prBase: string, primaryBranch: string, gitUser: string, gitToken: string, rootDir: string, log: ForgejoLogFn): CreatePrResult | null {
  // Mirroring a local baseline does not introduce another verification gate.
  const syncResult = syncPrimaryBaseline(gitUser, gitToken, rootDir, { gitRunner: git });
  if (!syncResult.ok) {
    return { ok: false, error: `failed to sync primary baseline: ${syncResult.error || syncResult.stderr}` };
  }
  // 1b. Feature-branch missions target a non-primary PR base that must exist on
  // the review remote before the PR is opened. syncPrimaryBaseline only mirrors
  // the primary branch, so push the feature base branch too.
  if (prBase === primaryBranch) { return null; }
  log(`Mirroring PR base branch ${prBase} to review remote...`);
  const baseSync = ensureRemoteBaseBranch(prBase, gitUser, gitToken, rootDir);
  if (!baseSync.ok) {
    return { ok: false, error: `failed to sync PR base branch ${prBase}: ${baseSync.error || baseSync.stderr}` };
  }
  return null;
}

function createRemotePr(branch: string, prBase: string, apiToken: string, rootDir: string, apiCall: ForgejoApiCall, log: ForgejoLogFn, configuration?: ParallixConfiguration): CreatePrResult {
  // 5. Create the PR
  const title = branch.replace(/^mission\//, '').replace(/-/g, ' ');
  const prPayload = {
    title,
    head: branch,
    base: prBase
  };

  const createResult = apiCall<ForgejoPullRequest>('POST', '/pulls', apiToken, prPayload, { ...({ rootDir }), configuration: configuration });
  const createdUrl = createResult.data?.html_url;
  if (!createResult.ok || !createdUrl) {
    return { ok: false, error: `failed to create PR: ${JSON.stringify(createResult.data)}` };
  }

  log(`PR created: ${createdUrl}`);
  return { ok: true, url: createdUrl, prNumber: createResult.data?.number };
}

function createPr(branch: string, user: string, token: string, options: ForgejoOptions = {}): CreatePrResult {
  const {
    rootDir = process.cwd(),
    apiCall = forgejoApi,
    log = fmt.log.info,
    force = false,
    forceWithLease = false
  } = options;

  const primaryBranch = resolvePrimaryBranchOrMain(rootDir);
  if (branch === primaryBranch) {return { ok: false, error: `cannot create a PR from ${primaryBranch}` };}

  const slug = branch.match(/^mission\/(task-\d+)/)?.[1] ?? null;
  const prBase = resolvePrBase(slug, primaryBranch, rootDir);

  const { gitUser, gitToken, apiUser, apiToken } = resolvePrCredentials(user, token, rootDir, options.configuration);
  const authenticatedGitFetch: GitFetchFn = (branchName, dir, fetchOptions = {}) => fetchReviewBranch(branchName, dir, {
    ...fetchOptions,
    user: gitUser,
    token: gitToken,
  });

  const baselineFailure = syncPrBaseline(prBase, primaryBranch, gitUser, gitToken, rootDir, log);
  if (baselineFailure) { return baselineFailure; }

  // 2. Push the branch using authenticated URL
  const remoteUrl = authenticatedReviewUrl(gitUser, gitToken, rootDir, options.configuration);
  log(`Pushing ${branch} as Forgejo user ${gitUser}${force || forceWithLease ? ' (force-with-lease)' : ''}...`);
  const pushFailure = pushBranchForPr(branch, remoteUrl, rootDir, { force, forceWithLease, gitFetch: authenticatedGitFetch, log });
  if (pushFailure) { return pushFailure; }

  // 3/4. Reuse the open PR for this branch when there already is one.
  const existing = existingPrForBranch(branch, { ...({ apiCall, apiToken, apiUser, slug, rootDir, log }), configuration: options.configuration });
  if (existing) { return existing; }

  return createRemotePr(branch, prBase, apiToken, rootDir, apiCall, log, options.configuration);
}

/**
 * @param {string} branch
 * @param {string|null} token
 * @param {{apiCall?: Function, slug?: string|null, onlyOpen?: boolean, forgejoUser?: string, rootDir?: string}} [options]
 * @returns {number|null|{_apiError?: object, _notFound?: boolean}}
 */
function getPrNumber(branch: string, token: string | null, options: ForgejoOptions = {}): PrNumberResult {
  const resolved = resolvePrAccess(branch, token, { ...(options), configuration: options.configuration });
  if (!resolved || isPrAccessFailure(resolved)) {
    return resolved;
  }
  return resolved.prNumber ?? null;
}

/**
 * Resolve the login of the author (creator) of the PR for a given branch.
 *
 * Used to detect the self-approval case where the resolved Forgejo reviewer is
 * the same user that opened the PR — Forgejo rejects such a review with HTTP 422
 * "approve your own pull is not allowed".
 *
 * Degrades safely: returns null when the PR cannot be resolved, the API call
 * fails, or the author field is absent. Callers treat null as "unknown author"
 * (i.e. not a self-approval) and proceed with the normal Forgejo POST.
 *
 * @param {string} branch  - Mission branch (e.g. 'mission/architecture migration')
 * @param {string} token   - Forgejo PAT
 * @param {object} [options]
 * @returns {string|null} The PR author's login, or null if undeterminable.
 */
/**
 * @param {string} branch
 * @param {string} token
 * @param {{apiCall?: Function, resolvePrNumber?: Function, forgejoUser?: string, rootDir?: string}} [options]
 * @returns {string|null}
 */
function getPrAuthor(branch: string, token: string, options: ForgejoOptions = {}): string | null {
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser,
    rootDir = process.cwd()
  } = options;
  const slug = branch.match(/^mission\/(task-\d+)/)?.[1] ?? null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser, rootDir, configuration: options.configuration });
  if (isApiErrorResult(prNumber) || !prNumber) {return null;}

  const prRes = apiCall<ForgejoPullRequest>('GET', `/pulls/${prNumber}`, token, undefined, { ...({ rootDir }), configuration: options.configuration });
  if (!prRes.ok || !prRes.data || !prRes.data.user) {return null;}
  return prRes.data.user.login || null;
}

/**
 * @param {string} branch
 * @param {string|null} token
 * @param {{apiCall?: Function, pageSize?: number, maxPages?: number, slug?: string|null, onlyOpen?: boolean, forgejoUser?: string, rootDir?: string, reportNotFound?: boolean}} [options]
 * @returns {{prNumber?: number, token?: string, _apiError?: object, _notFound?: boolean}|null}
 */
function findPrInState(branch: string, token: string, state: string, options: ForgejoOptions): PrLookupOutcome {
  const { apiCall = forgejoApi, pageSize = 50, maxPages = 50, rootDir } = options;
  let lastApiError: ForgejoApiError | null = null;
  let sawSuccessfulLookup = false;
  let consecutiveErrors = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = apiCall<ForgejoPullRequest[]>('GET', `/pulls?state=${state}&page=${page}&limit=${pageSize}&sort=recentupdate&direction=desc`, token, undefined, { ...({ rootDir }), configuration: options.configuration });
    if (!result.ok) {
      consecutiveErrors++;
      lastApiError = { error: result.error, status: result.status, statusCode: result.statusCode, stderr: result.stderr };
      if (consecutiveErrors >= 3) { break; }
      continue;
    }
    consecutiveErrors = 0;
    sawSuccessfulLookup = true;
    const pulls = Array.isArray(result.data) ? result.data : [];
    if (pulls.length === 0) { break; }
    const prNumber = findPrForBranch(pulls, branch);
    if (prNumber || pulls.length < pageSize) { return { prNumber, lastApiError, sawSuccessfulLookup };
    }
  }
  return { prNumber: null, lastApiError, sawSuccessfulLookup };
}

/**
 * Ask Forgejo for the branch's pull request by base and head, open or closed.
 * One request answers what paging through every pull request in every state
 * used to, which was most of the time `px status` spent (TASK-2561).
 * Returns `found` with the number, `absent` on a 404, and `unknown` for any
 * other answer, which leaves the full page scan to decide.
 */
function findPrByBaseHead(branch: string, token: string, options: ForgejoOptions): { kind: 'found'; prNumber: number; open: boolean } | { kind: 'absent' | 'unknown' } {
  const { apiCall = forgejoApi, rootDir, base } = options;
  if (!base) { return { kind: 'unknown' }; }
  const result = apiCall<ForgejoPullRequest>('GET', `/pulls/${encodeURIComponent(base)}/${branch.split('/').map(encodeURIComponent).join('/')}`, token, undefined, { ...({ rootDir }), configuration: options.configuration });
  const pr = result.data;
  if (result.ok && pr?.number) { return { kind: 'found', prNumber: pr.number, open: pr.state === 'open' }; }
  return !result.ok && result.statusCode === 404 ? { kind: 'absent' } : { kind: 'unknown' };
}

function findPrWithToken(branch: string, token: string, onlyOpen: boolean, options: ForgejoOptions) {
  const direct = findPrByBaseHead(branch, token, { ...(options), configuration: options.configuration });
  if (direct.kind === 'found' && direct.open) {
    return { prNumber: direct.prNumber, lastApiError: null, sawSuccessfulLookup: true };
  }
  // Anything short of an open match still scans the open pull requests, which
  // are few: an open one wins over the closed one the direct lookup returned,
  // and a 404 is not proof on its own — an older Forgejo without the endpoint,
  // or a token that cannot see the repository, answers the same way. Only the
  // scan of every closed pull request, which the direct lookup covered, is skipped.
  const open = findPrInState(branch, token, 'open', { ...(options), configuration: options.configuration });
  if (open.prNumber || onlyOpen) { return open; }
  if (direct.kind === 'found') { return { ...open, prNumber: direct.prNumber, sawSuccessfulLookup: true }; }
  if (direct.kind === 'absent') { return open; }
  const all = findPrInState(branch, token, 'all', { ...(options), configuration: options.configuration });
  return {
    ...all,
    lastApiError: all.lastApiError ?? open.lastApiError,
    sawSuccessfulLookup: all.sawSuccessfulLookup || open.sawSuccessfulLookup,
  };
}

function findPrWithFallbackTokens(branch: string, slug: string | null, currentUser: string, rootDir: string, doLookup: (token: string) => number | null, triedUsers: string[], configuration?: ParallixConfiguration): { prNumber: number; token: string } | null {
  if (!slug) { return null; }
  const taskFile = findTaskFile(slug, rootDir);
  const implementer = taskFile ? getTaskImplementer(taskFile) : null;
  const repoOwner = resolveForgejoSettings(rootDir, configuration).repo.split('/')[0] || null;
  const candidates = [implementer, repoOwner, DEFAULT_FORGEJO_USER].filter((user): user is string => Boolean(user) && user !== currentUser);
  for (const user of candidates) {
    triedUsers.push(user);
    const fallbackToken = readToken(user, rootDir, configuration);
    const prNumber = fallbackToken ? doLookup(fallbackToken) : null;
    if (prNumber) { return { prNumber, token: fallbackToken! }; }
  }
  return null;
}

function reportMissingPr(branch: string, rootDir: string, triedUsers: readonly string[], lastApiError: ForgejoApiError | null, configuration?: ParallixConfiguration) {
  const curlCheck = spawnSync('curl', ['--version'], { encoding: 'utf8' });
  fmt.log.fail(`PR not found for branch '${branch}' after checking tokens for: ${triedUsers.join(', ')}`);
  const settings = resolveForgejoSettings(rootDir, configuration);
  fmt.log.info(`Current environment: FORGEJO_URL=${settings.url}, FORGEJO_REPO=${settings.repo}, FORGEJO_HOME=${resolveForgejoHome(rootDir, configuration)}`);
  if (lastApiError) {
    const err = lastApiError as { status?: number | null, error?: string | null, stderr?: string | null };
    fmt.log.warn(`API error encountered during lookup: status=${err.status || 0}, error=${err.error || 'unknown'}`);
    if (err.stderr) { fmt.log.info(`API stderr: ${err.stderr}`); }
  }
  fmt.log.info(`curl --version: ${curlCheck.status === 0 ? (curlCheck.stdout || '').split('\n')[0] : 'failed to run curl'}`);
}

function resolvePrAccess(branch: string, token: string | null | undefined, options: ForgejoOptions = {}): PrAccess | null {
  const {
    apiCall = forgejoApi,
    pageSize = 50,
    maxPages = 50,
    slug = null,
    onlyOpen = false,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  let lastApiError: ForgejoApiError | null = null;
  let sawSuccessfulLookup = false;

  const base = resolvePrBase(slug, resolvePrimaryBranchOrMain(rootDir), rootDir);
  const doLookup = (candidateToken: string) => {
    const lookup = findPrWithToken(branch, candidateToken, onlyOpen, { ...({ apiCall, pageSize, maxPages, rootDir, base }), configuration: options.configuration });
    lastApiError = lookup.lastApiError ?? lastApiError;
    sawSuccessfulLookup ||= lookup.sawSuccessfulLookup;
    return lookup.prNumber;
  };

  // 1. Try with the provided token
  let prNumber = doLookup(token || '');
  if (prNumber) {return { prNumber, token: token || undefined };}

  const currentUser = resolveForgejoUser(forgejoUser, options.configuration);
  const triedUsers = [currentUser];

  const fallback = findPrWithFallbackTokens(branch, slug, currentUser, rootDir, doLookup, triedUsers, options.configuration);
  if (fallback) { return fallback; }

  if (options.reportNotFound) {
    reportMissingPr(branch, rootDir, triedUsers, lastApiError, options.configuration);
  }

  if (sawSuccessfulLookup) {
    return null;
  }
  if (lastApiError) {
    return { _apiError: lastApiError, _notFound: true };
  }
  return null;
}

function findPrForBranch(prs: ForgejoPullRequest[], branch: string): number | null {
  const pr = prs.find(candidate => {
    const head = candidate.head || {};
    return head.ref === branch || head.label === branch || head.label?.endsWith(`:${branch}`);
  });
  return pr?.number ?? null;
}

/**
 * @param {string} baseSlug
 * @param {string} token
 * @param {{apiCall?: Function, pageSize?: number, maxPages?: number}} [options]
 * @returns {Array<{number: number, title: string, html_url: string, head: string}>}
 */
function listOpenPrsForSlug(baseSlug: string, token: string, options: ForgejoOptions = {}): Array< { number: number, title: string, html_url: string, head: string } > {
  const {
    apiCall = forgejoApi,
    pageSize = 50,
    maxPages = 2
  } = options;

  const prs: Array< { number: number, title: string, html_url: string, head: string } > = [];
  let consecutiveErrors = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = apiCall<ForgejoPullRequest[]>('GET', `/pulls?state=open&page=${page}&limit=${pageSize}&sort=recentupdate&direction=desc`, token, undefined, { ...({}), configuration: options.configuration });
    if (!result.ok) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {break;}
      continue;
    }
    consecutiveErrors = 0;
    const pulls = Array.isArray(result.data) ? result.data : [];
    if (pulls.length === 0) {break;}

    prs.push(...matchingMissionPrs(pulls, baseSlug));

    if (pulls.length < pageSize) {break;}
  }

  return prs;
}

function matchingMissionPrs(prs: ForgejoPullRequest[], baseSlug: string) {
  const prefix = `mission/${baseSlug}`;
  return prs.flatMap((pr) => {
    const head = pr.head || {};
    const ref = head.ref || head.label?.split(':').pop() || '';
    return ref === prefix || ref.startsWith(`${prefix}-`)
      ? [{ number: pr.number as number, title: pr.title as string, html_url: pr.html_url as string, head: ref }]
      : [];
  });
}


/** Narrow the PR-lookup failure envelope, which every lookup path can return. */
function isApiErrorResult(result: unknown): result is ForgejoPrLookupFailure {
  if (!result || typeof result !== 'object') { return false; }
  const candidate = result as { _apiError?: unknown, _notFound?: unknown };
  return Boolean(candidate._apiError) && candidate._notFound === true;
}

/**
 * Narrow a resolved PR access. The parameter is the union itself, not `unknown`,
 * so the false branch keeps the success shape under the test project's
 * non-strict typecheck as well as the strict production project.
 */
function isPrAccessFailure(access: PrAccess): access is ForgejoPrLookupFailure {
  return isApiErrorResult(access);
}

/**
 * @param {string} user
 * @param {string} token
 * @param {string} rootDir
 * @returns {string}
 */
function authenticatedReviewUrl(user: string, token: string, rootDir?: string, configuration?: ParallixConfiguration) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir, configuration);
  const url = new URL(forgejoUrl);
  const protocol = url.protocol;
  const host = url.host; // includes port if present

  return `${protocol}//${user}:${token}@${host}/${forgejoRepo}.git`;
}


/** @param {string} rootDir @returns {string|null} */
function reviewRemoteUrl(rootDir?: string, configuration?: ParallixConfiguration) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir, configuration);
  if (!forgejoUrl || !forgejoRepo) {return null;}
  const url = new URL(forgejoUrl);
  return `${url.protocol}//${url.host}/${forgejoRepo}.git`;
}

/**
 * Get formal reviews submitted by a specific reviewer after a given ISO timestamp.
 *
 * @param {string} branch       - Mission branch (e.g. 'mission/architecture migration')
 * @param {string} reviewerUser - Forgejo login of the reviewer
 * @param {string} sinceIso     - ISO 8601 timestamp to filter from
 * @param {string} token        - Forgejo PAT (for reading reviews)
 * @param {object} [options]    - Optional overrides
 * @returns {{ state: string, submittedAt: string }|null}  Most recent eligible review, or null
 */
/**
 * @param {string} branch
 * @param {string} reviewerUser
 * @param {string} sinceIso
 * @param {string} token
 * @param {{apiCall?: Function, forgejoUser?: string, rootDir?: string}} [options]
 * @returns {{state: string, submittedAt: string}|null}
 */
function getLatestReview(branch: string, reviewerUser: string, sinceIso: string, token: string, options: ForgejoOptions = {}): { state: string, submittedAt: string } | null {
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { ...({ apiCall, slug, forgejoUser, rootDir }), configuration: options.configuration });
  if (!prAccess || isPrAccessFailure(prAccess)) {return null;}

  const result = apiCall<ForgejoReview[]>('GET', `/pulls/${prAccess.prNumber}/reviews`, prAccess.token, undefined, { ...({}), configuration: options.configuration });
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();
  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, submitted_at?: string, created_at?: string, state?: string}} r */ (r) => {
      const submittedAt = r.submitted_at || r.created_at || '';
      return (r.state === 'REQUEST_CHANGES' || r.user?.login === reviewerUser) && !!submittedAt
        && new Date(submittedAt).getTime() >= since && !r.dismissed;
    })
    .map(/** @param {{state?: string, submitted_at?: string, created_at?: string}} r */ (r) => ({ state: r.state!, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

type ReviewDecision = { ok: boolean; prNumber: number; reviewState: string | null; defaultUserApproved: boolean; defaultUserApprovedAt?: string; approvalHolders?: string[]; operatorApproved?: boolean; operatorApprovedAt?: string; reviewerApproved?: boolean; reviewerApprovedAt?: string };

type FormalReview = { user: string; state: string; submittedAt: string };

function addOperatorApproval(decision: ReviewDecision, formalReviews: FormalReview[], authorizedApproverUser?: string) {
  const operatorUser = authorizedApproverUser && authorizedApproverUser !== DEFAULT_FORGEJO_USER ? authorizedApproverUser : undefined;
  const latestOperatorFormal = operatorUser ? formalReviews.filter(review => review.user === operatorUser).at(-1) : undefined;
  const operatorApproved = !!operatorUser && decision.reviewState === 'APPROVED' && latestOperatorFormal?.state === 'APPROVED';
  if (operatorUser) {
    decision.operatorApproved = operatorApproved;
    if (operatorApproved) { decision.operatorApprovedAt = latestOperatorFormal!.submittedAt; }
  }
}

function reviewDecisionFromReviews(data: ForgejoReview[], prNumber: number, reviewerUser?: string, sinceIso?: string, authorizedApproverUser?: string) {
  const reviews = data
    .map((review) => ({ user: (review.user || {}).login || '?', state: review.state || '', submittedAt: review.submitted_at || review.created_at || '', dismissed: !!review.dismissed }))
    .filter((review) => review.state && review.submittedAt && !review.dismissed)
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  if (reviews.length === 0) { return { ok: true, prNumber, reviewState: null, defaultUserApproved: false }; }
  const allFormalReviews = reviews.filter((review) => review.state === 'APPROVED' || review.state === 'REQUEST_CHANGES');
  const formalReviews = allFormalReviews.filter((review) => !sinceIso || Date.parse(review.submittedAt) >= Date.parse(sinceIso));
  const finalState = formalReviews.at(-1)?.state ?? (sinceIso ? null : reviews.at(-1)!.state);
  const latestDefaultUserFormal = formalReviews.filter((review) => review.user === DEFAULT_FORGEJO_USER).at(-1);
  const defaultUserApproved = finalState === 'APPROVED' && latestDefaultUserFormal?.state === 'APPROVED';
  const latestByUser = new Map(allFormalReviews.map((review) => [review.user, review]));
  const approvalHolders = [...latestByUser.values()].filter((review) => review.state === 'APPROVED').map((review) => review.user);
  const decision: ReviewDecision = { ok: true, prNumber, reviewState: finalState, defaultUserApproved, approvalHolders };
  if (defaultUserApproved) { decision.defaultUserApprovedAt = latestDefaultUserFormal.submittedAt; }
  addOperatorApproval(decision, formalReviews, authorizedApproverUser);
  if (reviewerUser) {
    const latestReviewerFormal = formalReviews.filter((review) => review.user === reviewerUser).at(-1);
    decision.reviewerApproved = finalState === 'APPROVED' && latestReviewerFormal?.state === 'APPROVED';
    if (decision.reviewerApproved && latestReviewerFormal) { decision.reviewerApprovedAt = latestReviewerFormal.submittedAt; }
  }
  return decision;
}

/**
 * @param {string} branch
 * @param {{forgejoUser?: string, token?: string, apiCall?: Function, rootDir?: string, reviewerUser?: string, authorizedApproverUser?: string}} [options]
 * @returns {{ok: boolean, error?: string, reviewState?: string|null, prNumber?: number, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, operatorApproved?: boolean, operatorApprovedAt?: string, reviewerApproved?: boolean, reviewerApprovedAt?: string, raw?: string}}
 */
function getLatestReviewDecision(branch: string, options: ForgejoOptions = {}): { ok: boolean, error?: string, reviewState?: string | null, prNumber?: number, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, operatorApproved?: boolean, operatorApprovedAt?: string, reviewerApproved?: boolean, reviewerApprovedAt?: string, raw?: string } {
  /** @type {{forgejoUser?: string, token?: string, apiCall?: Function, rootDir?: string, reviewerUser?: string}} */
  const {
    forgejoUser,
    token: providedToken,
    apiCall = forgejoApi,
    rootDir = process.cwd(),
    reviewerUser,
    authorizedApproverUser,
    sinceIso,
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const { token } = resolveForgejoAuth({ ...({ forgejoUser, token: providedToken, rootDir }), configuration: options.configuration });
  if (!token) {
    return { ok: false, error: 'missing-token', reviewState: null };
  }

  const prAccess = resolvePrAccess(branch, token, { ...({ apiCall, slug, forgejoUser, rootDir }), configuration: options.configuration });
  if (prAccess && isPrAccessFailure(prAccess)) {
    const apiErr = prAccess._apiError;
    return {
      ok: false,
      error: 'api-failed',
      reviewState: null,
      raw: `failed to resolve PR for ${branch}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}`
    };
  }
  if (!prAccess) {
    return { ok: false, error: 'pr-not-found', reviewState: null };
  }
  const prNumber = prAccess.prNumber as number;

  const result = apiCall<ForgejoReview[]>('GET', `/pulls/${prNumber}/reviews`, prAccess.token, undefined, { ...({}), configuration: options.configuration });
  if (!result.ok || !Array.isArray(result.data)) {
    return { ok: false, error: 'reviews-unavailable', reviewState: null, prNumber };
  }

  return reviewDecisionFromReviews(result.data, prNumber, reviewerUser, sinceIso, resolveAuthorizedApproverUser(authorizedApproverUser, options.configuration));
}

/**
 * Get the latest autonomous-review disposition comment posted by the implementer
 * after a given ISO timestamp.
 *
 * @param {string} branch          - Mission branch
 * @param {string} implementerUser - Forgejo login of the implementer
 * @param {string} sinceIso        - ISO 8601 timestamp to filter from
 * @param {string} token           - Forgejo PAT
 * @param {object} [options]       - Optional overrides
 * @returns {string|null}  Disposition value (CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED) or null
 */
function getLatestDisposition(branch: string, implementerUser: string, sinceIso: string, token: string, options: ForgejoOptions = {}): string | null {
  /** @type {{apiCall?: Function, forgejoUser?: string, rootDir?: string}} */
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { ...({ apiCall, slug, forgejoUser, rootDir }), configuration: options.configuration });
  if (prAccess && isPrAccessFailure(prAccess)) {return null;}
  if (!prAccess) {return null;}
  const prNumber = prAccess.prNumber;

  const result = apiCall<ForgejoIssueComment[]>('GET', `/issues/${prNumber}/comments`, prAccess.token, undefined, { ...({}), configuration: options.configuration });
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();
  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c) => {
      const user = (c.user || {}).login;
      const createdStr = c.created_at || '';
      const created = createdStr ? new Date(createdStr).getTime() : 0;
      const body = c.body || '';
      return user === implementerUser && created >= since && DISPOSITION_PATTERN.test(body);
    })
    .map(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c) => {
      const match = DISPOSITION_PATTERN.exec(c.body || '');
      return { disposition: match ? match[1] : null, createdAt: c.created_at || '' };
    })
    .filter(/** @param {{disposition: string|null}} e */ (e) => e.disposition)
    .sort(/** @param {{createdAt: string}} a @param {{createdAt: string}} b */ (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1].disposition : null;
}


type AsyncReviewOptions = Omit<ForgejoOptions, 'apiCall'> & { apiCall?: ForgejoApiCall | ForgejoAsyncApiCall };

async function getLatestReviewForPr(prNumber: number, reviewerUser: string, sinceIso: string, token: string, options: AsyncReviewOptions = {}) {
  /** @type {{apiCall?: Function}} */
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall<ForgejoReview[]>('GET', `/pulls/${prNumber}/reviews`, token, undefined, { ...({}), configuration: options.configuration });
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, submitted_at?: string, created_at?: string, state?: string}} r */ (r) => {
      const submittedAt = r.submitted_at || r.created_at || '';
      return (r.state === 'REQUEST_CHANGES' || r.user?.login === reviewerUser) && !!submittedAt
        && new Date(submittedAt).getTime() >= since && !r.dismissed;
    })
    .map(/** @param {{state?: string, submitted_at?: string, created_at?: string}} r */ (r) => ({ state: r.state!, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}


async function getLatestDispositionForPr(prNumber: number, implementerUser: string, sinceIso: string, token: string, options: AsyncReviewOptions = {}) {
  /** @type {{apiCall?: Function}} */
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall<ForgejoIssueComment[]>('GET', `/issues/${prNumber}/comments`, token, undefined, { ...({}), configuration: options.configuration });
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c) => {
      const user = (c.user || {}).login;
      const createdAt = c.created_at || '';
      const created = createdAt ? new Date(createdAt).getTime() : 0;
      const body = c.body || '';
      return user === implementerUser && created >= since && DISPOSITION_PATTERN.test(body);
    })
    .map(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c) => {
      const match = DISPOSITION_PATTERN.exec(c.body || '');
      return { disposition: match ? match[1] : null, createdAt: c.created_at || '' };
    })
    .filter(/** @param {{disposition: string|null}} e */ (e) => e.disposition)
    .sort(/** @param {{createdAt: string}} a @param {{createdAt: string}} b */ (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1].disposition : null;
}

/**
 * Post a comment on the Forgejo PR for a given branch.
 *
 * @param {string} branch  - Mission branch (e.g. 'mission/architecture migration')
 * @param {string} token   - Forgejo PAT
 * @param {string} body    - Comment body (markdown)
 * @returns {{ ok: boolean, data: unknown, status: number|null, error?: string, raw?: string }}
 */
function postComment(branch: string, token: string, body: string, options: ForgejoOptions = {}): PrMutationResult {
  /** @type {{apiCall?: Function, resolvePrNumber?: Function, forgejoUser?: string}} */
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser, rootDir: options.rootDir, configuration: options.configuration });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError;
    return { ok: false, data: null, status: null, statusCode: null, stderr: null, error: 'api-failed', raw: `failed to resolve PR for ${branch}${(apiErr.status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}` };
  }
  if (!prNumber) {return { ok: false, data: null, status: null, statusCode: null, stderr: null, error: 'pr-not-found' };}
  return apiCall('POST', `/issues/${prNumber}/comments`, token, { body }, { ...({}), configuration: options.configuration });
}

const REVIEW_OUTCOME_MAP = {
  'approve':          'APPROVED',
  'request-changes':  'REQUEST_CHANGES',
  'comment':          'COMMENT'
};

/**
 * Submit a formal review outcome on the Forgejo PR for a given branch.
 *
 * @param {string} branch   - Mission branch (e.g. 'mission/architecture migration')
 * @param {string} token    - Forgejo PAT
 * @param {string} outcome  - 'approve' | 'request-changes' | 'comment'
 * @param {string} summary  - Review summary text
 * @returns {{ ok: boolean, data: unknown, status: number|null, error?: string, raw?: string }}
 */
function reviewHead(apiCall: ForgejoApiCall, prNumber: number, token: string) {
  const prRes = apiCall<ForgejoPullRequest>('GET', `/pulls/${prNumber}`, token);
  return prRes.ok ? prRes.data?.head?.sha ?? null : null;
}

function reviewPayload(body: string, event: string, commit_id: string | null) { return commit_id ? { body, event, commit_id } : { body, event }; }

function mutationFailure(error: string): PrMutationResult { return { ok: false, data: null, status: null, statusCode: null, stderr: null, error }; }

function postReview(branch: string, token: string, outcome: string, summary: string, options: ForgejoOptions = {}): PrMutationResult {
  /** @type {{apiCall?: Function, resolvePrNumber?: Function, forgejoUser?: string}} */
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser,
    rootDir = process.cwd()
  } = options;
  const scopedApi = <T = unknown>(method: string, endpoint: string, auth: string | undefined, data?: unknown) => apiCall<T>(method, endpoint, auth, data, { ...({ rootDir }), configuration: options.configuration });
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall: scopedApi, slug, forgejoUser, rootDir, configuration: options.configuration });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError;
    return { ok: false, data: null, status: null, statusCode: null, stderr: null, error: 'api-failed', raw: `failed to resolve PR for ${branch}${(apiErr.status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}` };
  }
  if (!prNumber) {return { ok: false, data: null, status: null, statusCode: null, stderr: null, error: 'pr-not-found' };}

  const commit_id = reviewHead(scopedApi, prNumber, token);
  if (options.expectedRevision && commit_id !== options.expectedRevision) { return mutationFailure('revision-drift'); }

  const event = /** @type {'APPROVED'|'REQUEST_CHANGES'|'COMMENT'|undefined} */ (REVIEW_OUTCOME_MAP[outcome as keyof typeof REVIEW_OUTCOME_MAP]);
  if (!event) {return { ok: false, data: null, status: null, statusCode: null, stderr: null, error: `unsupported-outcome: ${outcome}` };}

  /** @type {{body: string, event: string, commit_id?: string|null}} */
  const payload = reviewPayload(summary, event, commit_id);

  const result = scopedApi('POST', `/pulls/${prNumber}/reviews`, token, payload);
  if (!result.ok && result.stderr) {
    fmt.log.info(`curl stderr: ${result.stderr}`);
  }
  return result;
}

/** Dismiss the approval recorded at (or nearest to) a round's decision time. */
function dismissApproval(branch: string, token: string, decidedAt: string, reason: string, options: ForgejoOptions = {}) {
  const { apiCall = forgejoApi, forgejoUser, rootDir = process.cwd() } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const access = resolvePrAccess(branch, token, { ...({ apiCall, slug: slugMatch?.[1] ?? null, forgejoUser, rootDir }), configuration: options.configuration });
  if (!access || isPrAccessFailure(access)) { return { ok: false, error: 'pr-not-found' }; }
  const reviews = apiCall<ForgejoReview[]>('GET', `/pulls/${access.prNumber}/reviews`, access.token, undefined, { ...({}), configuration: options.configuration });
  if (!reviews.ok || !Array.isArray(reviews.data)) { return { ok: false, error: 'reviews-unavailable' }; }
  const approval = reviews.data
    .filter((review) => review.state === 'APPROVED' && !review.dismissed && review.id)
    .sort((left, right) => Math.abs(new Date(left.submitted_at || left.created_at || 0).getTime() - new Date(decidedAt).getTime()) - Math.abs(new Date(right.submitted_at || right.created_at || 0).getTime() - new Date(decidedAt).getTime()))[0];
  if (!approval) { return { ok: false, error: 'matching-approval-not-found' }; }
  return apiCall('POST', `/pulls/${access.prNumber}/reviews/${approval.id}/dismissals`, access.token, { message: reason }, { ...({}), configuration: options.configuration });
}

/**
 * Dismiss every standing approval on a mission pull request through the review
 * dismissal API (TASK-2620). The caller acts as the dedicated `parallix` login:
 * no review is posted as another login and no finding is written.
 */
function apiStatusLabel(result: ForgejoApiError) { return result.statusCode ?? result.status ?? 'n/a'; }

function isStandingApproval(review: ForgejoReview) { return review.state === 'APPROVED' && !review.dismissed && review.id; }

function dismissStandingApprovals(branch: string, token: string, reason: string, options: ForgejoOptions = {}) {
  const { apiCall = forgejoApi, forgejoUser, rootDir = process.cwd() } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const access = resolvePrAccess(branch, token, { ...({ apiCall, slug: slugMatch?.[1] ?? null, forgejoUser, rootDir }), configuration: options.configuration });
  if (!access || isPrAccessFailure(access)) { return { ok: false, dismissed: [], errors: ['pr-not-found'] }; }
  const reviews = apiCall<ForgejoReview[]>('GET', `/pulls/${access.prNumber}/reviews`, access.token, undefined, { ...({}), configuration: options.configuration });
  if (!reviews.ok || !Array.isArray(reviews.data)) { return { ok: false, dismissed: [], errors: ['reviews-unavailable'] }; }
  const dismissed: string[] = [];
  const errors: string[] = [];
  for (const review of reviews.data.filter(isStandingApproval)) {
    const login = review.user?.login ?? `review ${review.id}`;
    const result = apiCall('POST', `/pulls/${access.prNumber}/reviews/${review.id}/dismissals`, access.token, { message: reason }, { ...({}), configuration: options.configuration });
    if (result.ok) { dismissed.push(login); }
    else { errors.push(`dismissing ${login}'s approval failed (HTTP ${apiStatusLabel(result)})`); }
  }
  return { ok: errors.length === 0, dismissed, errors };
}

/**
 * Retrieve all comments (issue, review, and inline) for a given branch.
 *
 * @param {string} branch  - Mission branch
 * @param {string} token   - Forgejo PAT
 * @param {object} [options]
 * @param {Function} [options.apiCall] - Forgejo API function, injectable for tests
 * @param {Function} [options.log]     - Logger, injectable for tests
 * @returns {ForgejoCommentRecord[]|null} - Array of comment objects sorted by creation time, or null if comments could not be fetched
 */
function commentRecord(comment: ForgejoIssueComment) {
  return { id: String(comment.id ?? ''), user: comment.user?.login || '?', isBot: comment.user?.type === 'bot', created: comment.created_at || '', updated: comment.updated_at || comment.created_at || '', body: (comment.body || '').trim() };
}

function reviewRecord(review: ForgejoReview): ForgejoCommentRecord {
  return { kind: 'review', ...commentRecord(review), created: review.submitted_at || review.created_at || '', updated: review.updated_at || review.submitted_at || review.created_at || '', state: review.state || '', dismissed: Boolean(review.dismissed) };
}

function inlineCommentRecord(comment: ForgejoReviewComment, review: ForgejoReview): ForgejoCommentRecord {
  const path = comment.path || '';
  const line = comment.line || comment.original_line || '';
  return { kind: 'inline-comment', ...commentRecord(comment), reviewId: String(review.id ?? ''), state: review.state || '', dismissed: Boolean(review.dismissed), location: line ? `${path}:${line}` : path };
}

function collectPrComments(prNumber: number, accessToken: string | undefined, issueComments: ForgejoIssueComment[], reviews: ForgejoReview[], apiCall: ForgejoApiCall, configuration?: ParallixConfiguration): ForgejoCommentRecord[] {
  const allComments: ForgejoCommentRecord[] = [];

  for (const comment of issueComments) { allComments.push({ kind: 'issue-comment', ...commentRecord(comment) }); }
  for (const review of reviews) {
    allComments.push(reviewRecord(review));
    const inlineRes = apiCall<ForgejoReviewComment[]>('GET', `/pulls/${prNumber}/reviews/${review.id}/comments`, accessToken, undefined, { configuration: configuration });
    if (inlineRes.ok && Array.isArray(inlineRes.data)) {
      for (const comment of inlineRes.data) { allComments.push(inlineCommentRecord(comment, review)); }
    }
  }

  return allComments.sort(/** @param {{created: string}} a @param {{created: string}} b */ (a, b) => a.created.localeCompare(b.created));
}

function getCommentsSync(branch: string, token: string, options: ForgejoOptions = {}): ForgejoCommentRecord[] | null {
  /** @type {{apiCall?: Function, forgejoUser?: string, rootDir?: string, log?: Function}} */
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd(),
    log: logger = noopLog
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { ...({ apiCall, slug, forgejoUser, rootDir }), configuration: options.configuration });
  if (prAccess && isPrAccessFailure(prAccess)) {
    logger(`getComments API error resolving PR for ${branch}: status=${(prAccess._apiError || {}).status || 0}`);
    return null;
  }
  if (!prAccess) {return null;}
  const prNumber = prAccess.prNumber;
  const accessToken = prAccess.token;

  const issueCommentsRes = apiCall<ForgejoIssueComment[]>('GET', `/issues/${prNumber}/comments`, accessToken, undefined, { ...({}), configuration: options.configuration });
  const reviewsRes = apiCall<ForgejoReview[]>('GET', `/pulls/${prNumber}/reviews`, accessToken, undefined, { ...({}), configuration: options.configuration });

  if (!issueCommentsRes.ok || !reviewsRes.ok) {
    logger(`getComments API failure: issueCommentsRes.ok=${issueCommentsRes.ok}, reviewsRes.ok=${reviewsRes.ok}`);
    return null;
  }

  return collectPrComments(prNumber, accessToken, issueCommentsRes.data || [], reviewsRes.data || [], apiCall, options.configuration);
}


async function getComments(branch: string, token: string, options: ForgejoOptions = {}) {
  return getCommentsSync(branch, token, options);
}

/**
 * Close a Forgejo PR and delete the remote branch.
 * Closes a PR and performs cleanup.
 *
 * @param {string} branch  - Mission branch
 * @param {string} token   - Forgejo PAT
 * @returns {Promise<{ ok: boolean; error?: string }>} - { ok: boolean, error: string }
 */
function closeResolvedPr(branch: string, token: string, prNumber: number, rootDir: string): { ok: boolean; error?: string } {
  const details = forgejoApi<ForgejoPullRequest>('GET', `/pulls/${prNumber}`, token, undefined, { rootDir });
  if (!details.ok) { return { ok: true }; }
  if (details.data?.state === 'closed' || details.data?.merged) {
    fmt.log.info(`PR #${prNumber} is already ${details.data?.state}${details.data?.merged ? ' and merged' : ''}.`);
    return { ok: true };
  }
  const result = forgejoApi('PATCH', `/pulls/${prNumber}`, token, { state: 'closed' }, { rootDir });
  if (!result.ok) { return { ok: false, error: `failed to close PR #${prNumber}: ${JSON.stringify(result.data)}` }; }
  fmt.log.pass(`PR #${prNumber} closed.`);
  return { ok: true };
}

function deleteClosedPrBranch(branch: string, rootDir: string) {
  fmt.log.info(`Deleting remote branch ${fmt.branch(branch)}...`);
  const deleted = deleteReviewRef(branch, rootDir).status === 0;
  fmt.log[deleted ? 'pass' : 'info'](`Remote branch ${fmt.branch(branch)} ${deleted ? 'deleted.' : 'already gone or could not be deleted.'}`);
}

async function closePrImpl(branch: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const rootDir = process.cwd();
  const prNumber = getPrNumber(branch, token, { slug, rootDir });

  if (prNumber && typeof prNumber === 'object' && isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError;
    fmt.log.warn(`API error resolving PR for ${fmt.branch(branch)}: status=${(apiErr as {status?: number}).status || 0}${((apiErr as {status?: number}).status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}`);
    return { ok: true };
  }

  if (prNumber && typeof prNumber === 'number') {
    const result = closeResolvedPr(branch, token, prNumber, rootDir);
    if (!result.ok) { return result; }
  } else {
    fmt.log.info(`No open PR found for ${fmt.branch(branch)}.`);
  }
  deleteClosedPrBranch(branch, rootDir);
  return { ok: true };
}

async function closePr(branch: string, token: string): Promise<{ ok: boolean; error?: string }> {
  return await closePrImpl(branch, token);
}

export { formatPrLookupFailure };
export { getPrStatus };
export { createPr };
export { getPrNumber };
export { getPrAuthor };
export { resolvePrAccess };
export { listOpenPrsForSlug };
export { isApiErrorResult };
export { authenticatedReviewUrl };
export { reviewRemoteUrl };
export { getLatestReview };
export { getLatestReviewForPr };
export { dismissApproval, dismissStandingApprovals };
export { getLatestReviewDecision };
export { getLatestDisposition };
export { getLatestDispositionForPr };
export { postComment };
export { REVIEW_OUTCOME_MAP };
export { postReview };
export { getCommentsSync };
export { getComments };
export { closePr };
