import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { spawnSync } from 'child_process';
import { git } from '../core/git.js';
import { getPrimaryBranch, resolveMissionBaseBranch } from '../core/mission-utils.js';
import { resolveReviewAdapter } from '../core/product-config.js';
import * as verification from '../core/verification.js';
import * as fmt from '../core/fmt.js';

const DISPOSITION_PATTERN = /Autonomous review disposition:\s*(CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED)/;

const HTTP_REQUEST_TIMEOUT = 5000;
const DEFAULT_FORGEJO_USER = 'human';
const noopLog = () => {};
const derivedRepoCache = new Map();
function codexSandboxHint() {
  return 'Codex runtime cannot reach local Forgejo from Node subprocesses. Use the repo-local Codex config/profile that allows the workflow network path.';
}
/** @param {string} rootDir @param {string} remoteName @returns {string} */
function cacheKey(rootDir: string, remoteName: string): string {
  return `${rootDir}::${remoteName}`;
}
/** @param {string} rootDir @param {string} remoteName @returns {string|null} */
function deriveRepoFromGitRemote(rootDir: string, remoteName: string): string | null {
  if (derivedRepoCache.has(cacheKey(rootDir, remoteName))) {
    return derivedRepoCache.get(cacheKey(rootDir, remoteName));
  }
  const remote = remoteName || 'origin';
  try {
    const result = spawnSync('git', ['-C', rootDir, 'remote', 'get-url', remote], {
      encoding: 'utf8',
      timeout: 2000,
    });
    if (result.status !== 0) {
      derivedRepoCache.set(cacheKey(rootDir, remote), null);
      return null;
    }
    const url = (result.stdout || '').trim();
    const match = url.match(/[:/]([^/:]+)\/([^/]+?)(\.git)?$/);
    const derived = match ? `${match[1]}/${match[2]}` : null;
    derivedRepoCache.set(cacheKey(rootDir, remote), derived);
    return derived;
  } catch (_) {
    derivedRepoCache.set(cacheKey(rootDir, remote), null);
    return null;
  }
}

/** @param {string} [explicitUser] @returns {string} */
function resolveForgejoUser(explicitUser): string {
  return explicitUser || process.env.FORGEJO_USER || DEFAULT_FORGEJO_USER;
}

function resolveForgejoHome() {
  if (process.env.FORGEJO_HOME) {return process.env.FORGEJO_HOME;}
  const directLocal = path.join(process.cwd(), '.forgejo-local');

  // In test environments, we MUST NOT fall back to the real Forgejo home.
  // NODE_TEST_CONTEXT is set by node --test.
  if (process.env.NODE_TEST_CONTEXT) {
    // If the test forgot to set FORGEJO_HOME, we return a path that is
    // clearly not the real home to avoid accidental clobbering.
    return '/tmp/forgejo-test-home-missing';
  }
  if (fs.existsSync(directLocal)) {
    return directLocal;
  }
  try {
    const { getPrimaryWorktree } = require('../core/mission-utils');
    const main = getPrimaryWorktree();
    const candidates = [
      path.join(main, '.forgejo-local'),
      path.join(path.dirname(main), `${path.basename(main).toLowerCase()}-forgejo`),
      path.join(process.cwd(), '..', 'forgejo'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[0];
  } catch (_) {
    return directLocal;
  }
}

/** @param {string} targetPath @returns {string|null} */
function normalizePathForComparison(targetPath: string): string | null {
  if (!targetPath) {return null;}
  try {
    return fs.realpathSync.native(targetPath);
  } catch (_) {
    return path.resolve(targetPath);
  }
}

/**
 * @param {string} targetPath
 * @param {{forgejoHome?: string}} [options]
 * @returns {boolean}
 */
function isForgejoPath(targetPath: string, options = {}): boolean {
  const forgejoHome = options.forgejoHome || resolveForgejoHome();
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedForgejoHome = normalizePathForComparison(forgejoHome);
  if (!normalizedTarget || !normalizedForgejoHome) {return false;}
  return normalizedTarget === normalizedForgejoHome || normalizedTarget.startsWith(normalizedForgejoHome + path.sep);
}

function resolveForgejoSettings(rootDir = process.cwd()) {
  const review = resolveReviewAdapter(rootDir);
  const reviewRemote = review.remote || 'review';
  return {
    url: process.env.FORGEJO_URL || review.baseUrl || 'http://localhost:3300',
    repo: process.env.FORGEJO_REPO || review.repo || deriveRepoFromGitRemote(rootDir, reviewRemote) || deriveRepoFromGitRemote(rootDir, 'origin') || '',
  };
}

/**
 * @param {{forgejoUser?: string, token?: string}} options
 * @returns {{forgejoUser: string, token: string|null}}
 */
function resolveForgejoAuth(options: { forgejoUser?: string, token?: string } = {} as any): { forgejoUser: string, token: string | null } {
  const forgejoUser = resolveForgejoUser(options.forgejoUser);
  const token = options.token || readToken(forgejoUser);
  return { forgejoUser, token };
}

/**
 * @param {string} branch
 * @param {{status?: number, statusCode?: number}} [apiErr]
 * @returns {string}
 */
function formatPrLookupFailure(branch: string, apiErr = {}): string {
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
function getPrStatus(branch, rootDir = process.cwd(), options = {}) {
  /** @type {{forgejoUser?: string, token?: string, apiCall?: Function}} */
  const {
    forgejoUser,
    token: providedToken,
    apiCall = forgejoApi
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const { token } = resolveForgejoAuth({ forgejoUser, token: providedToken });
  // Don't short-circuit on missing primary token — resolvePrAccess has fallback logic
  // to try implementer and other known tokens when the primary is unavailable.
  const prAccess = resolvePrAccess(branch, token || null, { apiCall, slug, forgejoUser, rootDir });
  if (prAccess && typeof prAccess === 'object' && prAccess._apiError) {
    const apiErr = prAccess._apiError;
    return {
      exists: false,
      error: 'api-failed',
      raw: formatPrLookupFailure(branch, apiErr)
    };
  }
  if (!prAccess) {
    return {
      exists: false,
      raw: `no PR found for '${branch}'`
    };
  }
  const existingPrNumber = prAccess.prNumber;

  const prDetails = apiCall('GET', `/pulls/${existingPrNumber}`, prAccess.token, undefined, { rootDir });
  if (!prDetails.ok) {
    return {
      exists: false,
      error: 'api-failed',
      raw: formatPrLookupFailure(branch, prDetails)
    };
  }

  const pr = prDetails.data;
  const merged = pr.merged === true;
  const raw = `PR #${pr.number}: ${pr.title}\n  State:  ${pr.state}\n  Merged: ${merged ? 'True' : 'False'}\n  URL:    ${pr.html_url}`;

  return {
    exists: true,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    merged: merged,
    url: pr.html_url,
    raw
  };
}

/**
 * Resolve the Forgejo PAT file path for a given user.
 * Mirrors the token resolution logic in the deprecated bash implementation.
 *
 * @param {string} user  - Forgejo login (e.g. 'claude', 'codex', 'human')
 * @returns {string|null}
 */
function resolveTokenFile(user: string): string | null {
  const resolvedUser = resolveForgejoUser(user);
  const isCurrentUser = resolvedUser === resolveForgejoUser();
  const canUseDefaultTokenFile = isCurrentUser || resolvedUser === DEFAULT_FORGEJO_USER;
  const candidates = [
    isCurrentUser ? process.env.FORGEJO_TOKEN_FILE : null,
    path.join(resolveForgejoHome(), 'tokens', resolvedUser),
    canUseDefaultTokenFile ? path.join(resolveForgejoHome(), 'token') : null,
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {return candidate;}
  }

  return null;
}

/**
 * Read and return the Forgejo PAT for a given user.
 *
 * @param {string} user
 * @returns {string|null}
 */
function readToken(user: string): string | null {
  const resolvedUser = resolveForgejoUser(user);
  if (resolvedUser === resolveForgejoUser() && process.env.FORGEJO_TOKEN) {
    return process.env.FORGEJO_TOKEN;
  }
  const tokenFile = resolveTokenFile(resolvedUser);
  if (!tokenFile) {return null;}
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

/**
 * Make a JSON Forgejo API call via curl. Returns parsed JSON or null on failure.
 *
 * @param {string} method   - HTTP method (GET, POST, PATCH, ...)
 * @param {string} apiPath  - Path relative to /api/v1/repos/<repo>
 * @param {string} token    - Forgejo PAT
 * @param {object} [body]   - Optional JSON body
 * @returns {{ ok: boolean, data: any, status: number|null, statusCode: number|null, stderr: string|null, error: string|null }}
 */
/**
 * @param {string} method
 * @param {string} apiPath
 * @param {string} token
 * @param {object} [body]
 * @param {{rootDir?: string}} [options]
 * @returns {{ok: boolean, data: any, status: number|null, statusCode: number|null, stderr: string|null, error: string|null}}
 */
function forgejoApi(method: string, apiPath: string, token: string, body, options = {}): { ok: boolean, data: any, status: number | null, statusCode: number | null, stderr: string | null, error: string | null } {
  const { rootDir = process.cwd() } = options;
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
  const url = `${forgejoUrl}/api/v1/repos/${forgejoRepo}${apiPath}`;
  const args = ['-s', '-X', method,
    '-H', `Authorization: token ${token}`,
    '-H', 'Content-Type: application/json',
    '-w', '\\n%{http_code}'
  ];

  if (body) {
    args.push('--data-binary', '@-');
  }
  args.push(url);

  const result = spawnSync('curl', args, { 
    encoding: 'utf8',
    input: body ? JSON.stringify(body) : undefined
  });

  if (result.status !== 0 || !result.stdout) {
    return {
      ok: false,
      data: null,
      status: result.status,
      statusCode: null,
      stderr: result.stderr,
      error: result.status === 7 ? codexSandboxHint() : null
    };
  }

  const output = result.stdout.trim();
  const lastLineIndex = output.lastIndexOf('\n');
  const statusCodeStr = lastLineIndex === -1 ? output : output.substring(lastLineIndex + 1);
  const responseBody = lastLineIndex === -1 ? '' : output.substring(0, lastLineIndex).trim();

  const statusCode = parseInt(statusCodeStr, 10);

  let data = null;
  if (responseBody) {
    try {
      data = JSON.parse(responseBody);
    } catch (_) {
      // Not JSON
    }
  }

  return {
    ok: statusCode >= 200 && statusCode < 300,
    data,
    status: result.status,
    statusCode,
    stderr: result.stderr || null,
    error: null
  };
}

/**
 * @param {string} method
 * @param {string} apiPath
 * @param {string} token
 * @param {object} [body]
 * @param {{rootDir?: string, timeout?: number}} [options]
 * @returns {Promise<{ok: boolean, data: any, status: number|null, statusCode: number|null, stderr: string|null, error: string|null}>}
 */
async function forgejoApiAsync(method: string, apiPath: string, token: string, body, options = {}): Promise< { ok: boolean, data: any, status: number | null, statusCode: number | null, stderr: string | null, error: string | null } > {
  /** @type {{rootDir?: string, timeout?: number}} */
  const {
    rootDir = process.cwd(),
    timeout = HTTP_REQUEST_TIMEOUT
  } = options;
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);

  const url = new URL(`${forgejoUrl}/api/v1/repos/${forgejoRepo}${apiPath}`);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = /** @param {{ok: boolean, data: any, status: number|null, statusCode: number|null, stderr: string|null, error: string|null}} result */ (result) => {
      if (settled) {return;}
      settled = true;
      resolve(result);
    };

    const req = transport.request(url, {
      method,
      timeout,
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, /** @param {import('http').IncomingMessage} res */ (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', /** @param {string|Buffer} chunk */ (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        let data = null;
        if (responseBody) {
          try {
            data = JSON.parse(responseBody);
          } catch (_) {
            data = null;
          }
        }
        finish({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          data,
          status: 0,
          statusCode: res.statusCode ?? null,
          stderr: null,
          error: null
        });
      });
    });

    req.on('error', /** @param {{code?: string, message?: string}} error */ (error) => {
      finish({
        ok: false,
        data: null,
        status: null,
        statusCode: null,
        stderr: error.message || null,
        error: ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes((error as { code?: string }).code || '') ? codexSandboxHint() : null
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
      finish({
        ok: false,
        data: null,
        status: null,
        statusCode: null,
        stderr: 'request timeout',
        error: null
      });
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Create a Forgejo PR for a given branch.
 * Mirrors cmd_create in the deprecated bash implementation.
 *
 * @param {string} branch   - Mission branch (e.g. 'mission/task-089')
 * @param {string} user     - Forgejo login
 * @param {string} token    - Forgejo PAT
 * @param {object} [options]
 * @returns {{ ok: boolean, url: string|null, error: string|null }}
 */
/**
 * @param {string} branch
 * @param {string} user
 * @param {string} token
 * @param {{rootDir?: string, apiCall?: Function, log?: Function, force?: boolean, forceWithLease?: boolean, verificationArea?: string, captureVerifiedTreeProofFn?: Function, assertVerifiedTreeProofFn?: Function}} [options]
 * @returns {{ok: boolean, url?: string|null, error?: string|null, prNumber?: number}}
 */
function createPr(branch: string, user: string, token: string, options = {}): { ok: boolean, url?: string | null, error?: string | null, prNumber?: number } {
  const {
    rootDir = process.cwd(),
    apiCall = forgejoApi,
    log = fmt.log.info,
    force = false,
    forceWithLease = false,
    verificationArea = null,
    captureVerifiedTreeProofFn = verification.captureVerifiedTreeProof,
    assertVerifiedTreeProofFn = verification.assertVerifiedTreeProof
  } = options;

  let primaryBranch = 'main';
  try {
    primaryBranch = getPrimaryBranch(rootDir);
  } catch (_) {
    primaryBranch = 'main';
  }
  if (branch === primaryBranch) {return { ok: false, error: `cannot create a PR from ${primaryBranch}` };}

  // Resolve the PR base: for feature-branch missions the PR targets the recorded
  // base branch; for legacy missions it falls back to the primary branch so
  // the byte-identical regression path is preserved.
  let prBase = primaryBranch;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  if (slug) {
    try {
      const resolvedBase = resolveMissionBaseBranch(slug, rootDir);
      if (resolvedBase !== primaryBranch) {
        prBase = resolvedBase;
      }
    } catch (_) {
      // resolveMissionBaseBranch may fail if MISSION.md is not yet on disk; fall through to primary.
    }
  }

  const repoOwner = resolveForgejoSettings(rootDir).repo.split('/')[0] || null;
  const ownerToken = repoOwner ? readToken(repoOwner) : null;
  const gitUser = ownerToken && repoOwner ? repoOwner : user;
  const gitToken = ownerToken || token;
  const apiUser = user;
  const apiToken = token;
  const resolvedVerificationArea = verificationArea || verification.resolveVerificationAdapter(rootDir).defaultArea;
  const authenticatedGitFetch = /** @param {string} branchName @param {string} dir @param {{user?: string, token?: string}} [options] */ (branchName, dir, options = {}) => fetchReviewBranch(branchName, dir, {
    ...options,
    user: gitUser,
    token: gitToken,
  });

  const proofResult = captureVerifiedTreeProofFn(resolvedVerificationArea, rootDir);
  if (!proofResult.ok) {
    return { ok: false, error: proofResult.error || 'failed to verify publish tree' };
  }

  // 1. Sync primary branch baseline
  const syncResult = syncPrimaryBaseline(gitUser, gitToken, rootDir, {
    verificationProof: proofResult.proof,
    assertVerifiedTreeProofFn,
    gitRunner: git
  });
  if (!syncResult.ok) {
    return { ok: false, error: `failed to sync primary baseline: ${syncResult.error || syncResult.stderr}` };
  }

  // 1b. Feature-branch missions target a non-primary PR base that must exist on
  // the review remote before the PR is opened. syncPrimaryBaseline only mirrors
  // the primary branch, so push the feature base branch too.
  if (prBase !== primaryBranch) {
    log(`Mirroring PR base branch ${prBase} to review remote...`);
    const baseSync = ensureRemoteBaseBranch(prBase, gitUser, gitToken, rootDir);
    if (!baseSync.ok) {
      return { ok: false, error: `failed to sync PR base branch ${prBase}: ${baseSync.error || baseSync.stderr}` };
    }
  }

  // 2. Push the branch using authenticated URL
  const remoteUrl = authenticatedReviewUrl(gitUser, gitToken, rootDir);
  log(`Pushing ${branch} as Forgejo user ${gitUser}${force || forceWithLease ? ' (force-with-lease)' : ''}...`);
  let pushArgsResult = buildCreatePrPushArgs(branch, remoteUrl, rootDir, {
    force,
    forceWithLease,
    gitFetch: authenticatedGitFetch
  });
  if (!pushArgsResult.ok) {
    return { ok: false, error: pushArgsResult.error };
  }
  let pushArgs = pushArgsResult.pushArgs || [];
  let pushResult = git(pushArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: cLocaleEnv() });
  if (pushResult.stdout) {process.stdout.write(pushResult.stdout);}
  if (pushResult.stderr) {process.stderr.write(pushResult.stderr);}

  if (pushResult.status !== 0) {
    if (forceWithLease && isStaleInfoPushRejection(/** @type {{status?: number, stderr?: string, stdout?: string}} */ (pushResult))) {
      log(`Stale push rejection for ${branch}; fetching and retrying...`);
      pushArgsResult = buildCreatePrPushArgs(branch, remoteUrl, rootDir, {
        force,
        forceWithLease,
        gitFetch: authenticatedGitFetch,
        refreshTrackingRef: true
      });
      if (!pushArgsResult.ok) {
        return { ok: false, error: pushArgsResult.error };
      }
      pushArgs = pushArgsResult.pushArgs || [];
      pushResult = git(pushArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: cLocaleEnv() });
      if (pushResult.stdout) {process.stdout.write(pushResult.stdout);}
      if (pushResult.stderr) {process.stderr.write(pushResult.stderr);}
    }
    if (pushResult.status !== 0) {
      const pushError = (pushResult.stderr || pushResult.stdout || '').trim();
      return { ok: false, error: `git push failed with status ${pushResult.status}${pushError ? `: ${pushError}` : ''}` };
    }
  }

  // 3. Check if an OPEN PR already exists for this branch
  const existingPrLookup = resolvePrAccess(branch, apiToken, { apiCall, slug, onlyOpen: true, forgejoUser: apiUser, rootDir });

  if (existingPrLookup && isApiErrorResult(existingPrLookup)) {
    const apiErr = /** @type {{error?: string, status?: number}} */ (existingPrLookup._apiError || {});
    return { ok: false, error: `failed to check existing PR: ${(apiErr.error || 'API error')}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}` };
  }

  // 4. Return existing PR if already present
  if (existingPrLookup && existingPrLookup.prNumber) {
      const prDetailsToken = existingPrLookup.token || apiToken;
      const prDetails = apiCall('GET', `/pulls/${existingPrLookup.prNumber}`, prDetailsToken, undefined, { rootDir });
    if (prDetails.ok) {
      log(`PR already exists: ${prDetails.data.html_url}`);
      return { ok: true, url: prDetails.data.html_url, prNumber: existingPrLookup.prNumber };
    }
  }

  // 5. Create the PR
  const title = branch.replace(/^mission\//, '').replace(/-/g, ' ');
  const prPayload = {
    title,
    head: branch,
    base: prBase
  };

  const createResult = apiCall('POST', '/pulls', apiToken, prPayload, { rootDir });
  if (!createResult.ok || !createResult.data || !createResult.data.html_url) {
    return { ok: false, error: `failed to create PR: ${JSON.stringify(createResult.data)}` };
  }

  log(`PR created: ${createResult.data.html_url}`);
  return { ok: true, url: createResult.data.html_url, prNumber: createResult.data.number };
}

/**
 * @param {string} branch
 * @param {string|null} token
 * @param {{apiCall?: Function, slug?: string|null, onlyOpen?: boolean, forgejoUser?: string, rootDir?: string}} [options]
 * @returns {number|null|{_apiError?: object, _notFound?: boolean}}
 */
function getPrNumber(branch: string, token: string | null, options = {}): number | null | { _apiError?: object, _notFound?: boolean } {
  const resolved = resolvePrAccess(branch, token, options);
  if (!resolved || isApiErrorResult(resolved)) {
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
 * @param {string} branch  - Mission branch (e.g. 'mission/task-089')
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
function getPrAuthor(branch: string, token: string, options = {}): string | null {
  /** @type {{apiCall?: Function, resolvePrNumber?: Function, forgejoUser?: string, rootDir?: string}} */
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser,
    rootDir = process.cwd()
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (isApiErrorResult(prNumber) || !prNumber) {return null;}

  const prRes = apiCall('GET', `/pulls/${prNumber}`, token, undefined, { rootDir });
  if (!prRes.ok || !prRes.data || !prRes.data.user) {return null;}
  return prRes.data.user.login || null;
}

/**
 * @param {string} branch
 * @param {string|null} token
 * @param {{apiCall?: Function, pageSize?: number, maxPages?: number, slug?: string|null, onlyOpen?: boolean, forgejoUser?: string, rootDir?: string, reportNotFound?: boolean}} [options]
 * @returns {{prNumber?: number, token?: string, _apiError?: object, _notFound?: boolean}|null}
 */
function resolvePrAccess(branch: string, token: string | null, options = {}): { prNumber?: number, token?: string, _apiError?: object, _notFound?: boolean } {
  const {
    apiCall = forgejoApi,
    pageSize = 50,
    maxPages = 50,
    slug = null,
    onlyOpen = false,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  let lastApiError = null;
  let sawSuccessfulLookup = false;

  /** @param {string} state @param {string} t */
  const searchInState = (state, t) => {
    let consecutiveErrors = 0;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = apiCall('GET', `/pulls?state=${state}&page=${page}&limit=${pageSize}&sort=recentupdate&direction=desc`, t, undefined, { rootDir });
      if (!result.ok) {
        consecutiveErrors++;
        lastApiError = {
          error: result.error,
          status: result.status,
          statusCode: result.statusCode,
          stderr: result.stderr,
        };
        if (consecutiveErrors >= 3) {
          break;
        }
        continue;
      }
      consecutiveErrors = 0;
      sawSuccessfulLookup = true;
      if (!Array.isArray(result.data) || result.data.length === 0) {
        break;
      }

      for (const pr of result.data) {
        const head = pr.head || {};
        if (head.ref === branch || head.label === branch || (head.label && head.label.endsWith(':' + branch))) {
          return pr.number;
        }
      }

      if (result.data.length < pageSize) {
        break;
      }
    }
    return null;
  };

  /** @param {string} t */
  const doLookup = (t) => {
    const openResult = searchInState('open', t);
    if (openResult) {return openResult;}
    if (!onlyOpen) {return searchInState('all', t);}
    return null;
  };

  // 1. Try with the provided token
  let prNumber = doLookup(token || '');
  if (prNumber) {return { prNumber, token: token || undefined };}

  const currentUser = resolveForgejoUser(forgejoUser);
  const triedUsers = [currentUser];

  // 2. Fallback for slugs
  if (slug) {
    const { getTaskImplementer, findTaskFile } = require('./backlog');
    const taskFile = findTaskFile(slug, rootDir);
    const implementer = taskFile ? getTaskImplementer(taskFile) : null;
    const repoOwner = resolveForgejoSettings(rootDir).repo.split('/')[0] || null;
    const candidates = [implementer, repoOwner, DEFAULT_FORGEJO_USER].filter(u => u && u !== currentUser);

    for (const user of candidates) {
      triedUsers.push(user);
      const fallbackToken = readToken(user);
      if (fallbackToken) {
        prNumber = doLookup(fallbackToken);
        if (prNumber) {return { prNumber, token: fallbackToken };}
      }
    }
  }

  if (options.reportNotFound) {
    const curlCheck = spawnSync('curl', ['--version'], { encoding: 'utf8' });
    fmt.log.fail(`PR not found for branch '${branch}' after checking tokens for: ${triedUsers.join(', ')}`);
    const settings = resolveForgejoSettings(rootDir);
    fmt.log.info(`Current environment: FORGEJO_URL=${settings.url}, FORGEJO_REPO=${settings.repo}, FORGEJO_HOME=${resolveForgejoHome()}`);
    if (lastApiError) {
      /** @type {{status?: number, error?: string, stderr?: string|null}} */
      const err = lastApiError;
      fmt.log.warn(`API error encountered during lookup: status=${err.status || 0}, error=${err.error || 'unknown'}`);
      if (err.stderr) {
        fmt.log.info(`API stderr: ${err.stderr}`);
      }
    }
    fmt.log.info(`curl --version: ${curlCheck.status === 0 ? curlCheck.stdout.split('\n')[0] : 'failed to run curl'}`);
  }

  if (sawSuccessfulLookup) {
    return null;
  }
  if (lastApiError) {
    return { _apiError: lastApiError, _notFound: true };
  }
  return null;
}

/**
 * @param {string} baseSlug
 * @param {string} token
 * @param {{apiCall?: Function, pageSize?: number, maxPages?: number}} [options]
 * @returns {Array<{number: number, title: string, html_url: string, head: string}>}
 */
function listOpenPrsForSlug(baseSlug: string, token: string, options = {}): Array< { number: number, title: string, html_url: string, head: string } > {
  /** @type {{apiCall?: Function, pageSize?: number, maxPages?: number}} */
  const {
    apiCall = forgejoApi,
    pageSize = 50,
    maxPages = 2
  } = options;

  const prs = [];
  let consecutiveErrors = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = apiCall('GET', `/pulls?state=open&page=${page}&limit=${pageSize}&sort=recentupdate&direction=desc`, token);
    if (!result.ok) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {break;}
      continue;
    }
    consecutiveErrors = 0;
    if (!Array.isArray(result.data) || result.data.length === 0) {break;}

    for (const pr of result.data) {
      const head = pr.head || {};
      // Some refs come back directly in head.ref, others might be in head.label
      const ref = head.ref || (head.label && head.label.split(':').pop()) || '';
      
      // Match exactly mission/<baseSlug> or mission/<baseSlug>-<suffix>
      if (ref === `mission/${baseSlug}` || ref.startsWith(`mission/${baseSlug}-`)) {
        prs.push({
          number: pr.number,
          title: pr.title,
          html_url: pr.html_url,
          head: ref
        });
      }
    }

    if (result.data.length < pageSize) {break;}
  }

  return prs;
}

/** @param {{_apiError?: object, _notFound?: boolean}} result @returns {boolean} */
function isApiErrorResult(result): boolean {
  return Boolean(result && typeof result === 'object' && result._apiError && result._notFound === true);
}

/**
 * @param {string} user
 * @param {string} token
 * @param {string} rootDir
 * @returns {string}
 */
function authenticatedReviewUrl(user, token, rootDir = process.cwd()) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
  const url = new URL(forgejoUrl);
  const protocol = url.protocol;
  const host = url.host; // includes port if present

  return `${protocol}//${user}:${token}@${host}/${forgejoRepo}.git`;
}

/** @param {string} rootDir @returns {string|null} */
function reviewRemoteUrl(rootDir = process.cwd()) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
  if (!forgejoUrl || !forgejoRepo) {return null;}
  const url = new URL(forgejoUrl);
  return `${url.protocol}//${url.host}/${forgejoRepo}.git`;
}

/**
 * @param {string} user
 * @param {string} token
 * @param {string} rootDir
 * @param {{verificationProof?: object|null, assertVerifiedTreeProofFn?: Function, gitRunner?: Function}} [opts]
 * @returns {{ok: boolean, skipped?: boolean, status?: number, stderr?: string, error?: string|null}}
 */
function syncPrimaryBaseline(user, token, rootDir = process.cwd(), {
  verificationProof = null,
  assertVerifiedTreeProofFn = verification.assertVerifiedTreeProof,
  gitRunner = git
} = {}) {
  let primaryBranchName = 'main';
  try {
    primaryBranchName = getPrimaryBranch(rootDir);
  } catch (_) {
    primaryBranchName = 'main';
  }

  const proofCheck = assertVerifiedTreeProofFn(verificationProof, rootDir, { gitRunner });
  if (!proofCheck.ok) {
    return { ok: false, error: proofCheck.error || 'verification-proof-mismatch' };
  }

  const primaryExists = gitRunner(['-C', rootDir, 'show-ref', '--verify', '--quiet', `refs/heads/${primaryBranchName}`]);
  if (primaryExists.status !== 0) {return { ok: true, skipped: true };}

  const remoteUrl = authenticatedReviewUrl(user, token, rootDir);
  // Force-push: the review remote's primary branch is a server-side mirror of our
  // local primary that we intentionally overwrite to keep the review baseline in
  // sync. Without --force a diverged remote primary (rebases, amended baseline
  // commits) rejects this as a non-fast-forward, aborting the sync and breaking
  // the review loop. See missions/task-1318 "Required Forgejo fix".
  const result = gitRunner(['-C', rootDir, 'push', '--force', remoteUrl, `${primaryBranchName}:${primaryBranchName}`], {
    stdio: 'pipe'
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stderr: result.stderr,
    error: result.status === 0 ? null : `${result.stderr || 'git push failed'}${result.error ? ` (${codexSandboxHint()})` : ''}`
  };
}

/**
 * @param {string} baseBranch
 * @param {string} user
 * @param {string} token
 * @param {string} rootDir
 * @param {{gitRunner?: Function}} [opts]
 * @returns {{ok: boolean, status?: number, stderr?: string, error?: string|null}}
 */
function ensureRemoteBaseBranch(baseBranch, user, token, rootDir = process.cwd(), {
  gitRunner = git
} = {}) {
  // A feature-branch mission opens its PR against a non-primary base branch.
  // syncPrimaryBaseline only mirrors the primary branch, so the PR base would
  // not exist on the review remote and PR creation would fail server-side.
  // Mirror the local feature base branch here before the PR is opened.
  /** @type {{status: number}} */
  const exists = gitRunner(['-C', rootDir, 'show-ref', '--verify', '--quiet', `refs/heads/${baseBranch}`]);
  if (exists.status !== 0) {
    return { ok: false, error: `PR base branch ${baseBranch} does not exist locally` };
  }

  const remoteUrl = authenticatedReviewUrl(user, token, rootDir);
  // Force-push for the same reason syncPrimaryBaseline force-pushes the primary
  // branch: the review remote's copy is an intentional server-side mirror of our
  // local branch. A diverged remote (e.g. from a prior sub-mission integration)
  // would otherwise reject a fast-forward push and break PR creation.
  const result = gitRunner(['-C', rootDir, 'push', '--force', remoteUrl, `${baseBranch}:${baseBranch}`], {
    stdio: 'pipe'
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stderr: result.stderr,
    error: result.status === 0 ? null : `${result.stderr || 'git push failed'}${result.error ? ` (${codexSandboxHint()})` : ''}`
  };
}

/**
 * @param {string} sourceRef
 * @param {string} destinationRef
 * @param {string} rootDir
 * @param {{force?: boolean, forceWithLease?: boolean, user?: string, token?: string}} [opts]
 * @returns {*}
 */
function pushReviewRef(sourceRef, destinationRef, rootDir = process.cwd(), {
  force = false,
  forceWithLease = false,
  user,
  token
} = {}) {
  const remote = token
    ? authenticatedReviewUrl(user || resolveForgejoUser(), token, rootDir)
    : 'review';
  const pushArgs = /** @type {string[]} */ (['-C', rootDir, 'push', remote]);
  if (forceWithLease) {
    pushArgs.push('--force-with-lease');
  } else if (force) {
    pushArgs.push('--force');
  }
  pushArgs.push(`${sourceRef}:${destinationRef}`);
  const result = git(pushArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.stdout) {process.stdout.write(result.stdout);}
  if (result.stderr) {process.stderr.write(result.stderr);}
  return result;
}

/**
 * @param {string} branch
 * @param {string} rootDir
 * @param {{user?: string, token?: string}} options
 * @returns {*}
 */
function fetchReviewBranch(branch, rootDir = process.cwd(), options = {}) {
  const { user, token } = options;
  const source = token
    ? authenticatedReviewUrl(user || resolveForgejoUser(), token, rootDir)
    : 'review';
  return git(['-C', rootDir, 'fetch', source, `+refs/heads/${branch}:refs/remotes/review/${branch}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Force a stable C locale so git emits its diagnostics in English. Without
    // this, a non-English operator locale (e.g. Swedish "kunde inte hitta
    // fjärr-referensen") makes isMissingRemoteRef miss the "could not find
    // remote ref" condition and a routine first push aborts with a fatal error.
    env: cLocaleEnv()
  });
}

/** @param {string} branch @param {string} rootDir @returns {{ok: boolean, ref?: string, sha?: string, error?: string}} */
function resolveTrackingBranchSha(branch, rootDir = process.cwd()) {
  const candidateRefs = [`refs/remotes/review/${branch}`, `refs/remotes/origin/${branch}`];
  for (const ref of candidateRefs) {
    const result = git(['-C', rootDir, 'rev-parse', '--verify', `${ref}^{commit}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const sha = (result.stdout || '').trim();
    if (result.status === 0 && sha) {
      return { ok: true, ref, sha };
    }
  }
  return {
    ok: false,
    error: `could not resolve tracking ref for ${branch}; checked ${candidateRefs.join(' and ')}`
  };
}

/**
 * @param {string} branch
 * @param {string} remoteUrl
 * @param {string} rootDir
 * @param {{force?: boolean, forceWithLease?: boolean, gitFetch?: Function, refreshTrackingRef?: boolean}} [options]
 * @returns {{ok: boolean, pushArgs?: string[], error?: string}}
 */
function buildCreatePrPushArgs(branch, remoteUrl, rootDir = process.cwd(), options = {}) {
  /** @type {{force?: boolean, forceWithLease?: boolean, gitFetch?: Function, refreshTrackingRef?: boolean}} */
  const {
    force = false,
    forceWithLease = false,
    gitFetch = fetchReviewBranch,
    refreshTrackingRef = false
  } = options;

  const pushArgs = ['-C', rootDir, 'push'];
  if (forceWithLease) {
    if (refreshTrackingRef) {
      const refreshResult = gitFetch(branch, rootDir);
      if (refreshResult.status !== 0) {
        if (isMissingRemoteRef(refreshResult)) {
          // First push: the remote branch does not exist yet, so there is
          // nothing to clobber. Fall back to a plain push (no force-with-lease).
          pushArgs.push(remoteUrl, branch);
          return { ok: true, pushArgs };
        }
        return {
          ok: false,
          error: `failed to refresh tracking ref for ${branch}: ${pushOutput(refreshResult) || 'git fetch failed'}`
        };
      }
    }

    let trackingRefResult = resolveTrackingBranchSha(branch, rootDir);
    if (!trackingRefResult.ok && !refreshTrackingRef) {
      const fetchResult = gitFetch(branch, rootDir);
      if (fetchResult.status !== 0) {
        if (isMissingRemoteRef(fetchResult)) {
          // First push: the remote branch does not exist yet, so there is
          // nothing to clobber. Fall back to a plain push (no force-with-lease).
          pushArgs.push(remoteUrl, branch);
          return { ok: true, pushArgs };
        }
        return {
          ok: false,
          error: `failed to fetch tracking ref for ${branch}: ${pushOutput(fetchResult) || 'git fetch failed'}`
        };
      }
      trackingRefResult = resolveTrackingBranchSha(branch, rootDir);
    }
    if (!trackingRefResult.ok) {
      return trackingRefResult;
    }

    pushArgs.push(`--force-with-lease=refs/heads/${branch}:${trackingRefResult.sha}`);
  } else if (force) {
    pushArgs.push('--force-with-lease');
  }
  pushArgs.push(remoteUrl, branch);
  return { ok: true, pushArgs };
}

/**
 * @param {string} branch
 * @param {string} rootDir
 * @param {{user?: string, token?: string}} [opts]
 * @returns {*}
 */
function deleteReviewRef(branch, rootDir = process.cwd(), { user, token } = {}) {
  const remote = token
    ? authenticatedReviewUrl(user || resolveForgejoUser(), token, rootDir)
    : 'review';
  const result = git(['-C', rootDir, 'push', remote, '--delete', branch], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.stdout) {process.stdout.write(result.stdout);}
  if (result.stderr) {process.stderr.write(result.stderr);}
  return result;
}

/** @param {string} commit @param {string} rootDir @returns {*} */
function verifyCommitExists(commit, rootDir = process.cwd()) {
  return git(['-C', rootDir, 'rev-parse', '--verify', `${commit}^{commit}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** @param {string} commit @param {string} [remoteRef] @param {string} rootDir @returns {*} */
function remoteRefContainsCommit(commit, remoteRef = `refs/remotes/review/${getPrimaryBranch(process.cwd())}`, rootDir = process.cwd()) {
  return git(['-C', rootDir, 'merge-base', '--is-ancestor', commit, remoteRef], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

// Git diagnostics ("could not find remote ref", "stale info", "fetch first")
// are localized to the operator's locale. We parse these messages to decide
// control flow, so force a stable C locale on git calls whose stderr we
// inspect, keeping detection language-independent.
/** @returns {Record<string, string>} */
function cLocaleEnv(): Record<string, string> {
  return { ...process.env, LC_ALL: 'C', LANG: 'C' };
}

/** @param {{stderr?: string, stdout?: string}} result @returns {string} */
function pushOutput(result): string {
  return [result && result.stderr, result && result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim();
}

// Detects the git fetch failure that means the remote branch simply does not
// exist yet (first push of a new branch), e.g.
// "fatal: could not find remote ref refs/heads/<branch>". This must be
// distinguished from real fetch failures (auth/network), which also exit
// non-zero but do not carry this message and should still abort.
/** @param {{stderr?: string, stdout?: string}} result @returns {boolean} */
function isMissingRemoteRef(result): boolean {
  const output = pushOutput(result).toLowerCase();
  return output.includes('could not find remote ref')
    || output.includes("couldn't find remote ref");
}

/** @param {{status?: number, stderr?: string, stdout?: string}} result @returns {boolean} */
function isStaleInfoPushRejection(result): boolean {
  return result && result.status !== 0 && /\bstale info\b|\bstale ref\b|fetch first/i.test(pushOutput(result));
}


/**
 * Get formal reviews submitted by a specific reviewer after a given ISO timestamp.
 *
 * @param {string} branch       - Mission branch (e.g. 'mission/task-089')
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
function getLatestReview(branch: string, reviewerUser: string, sinceIso: string, token: string, options = {}): { state: string, submittedAt: string } {
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (!prAccess || isApiErrorResult(prAccess)) {return null;}

  const result = apiCall('GET', `/pulls/${prAccess.prNumber}/reviews`, prAccess.token);
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, submitted_at?: string, created_at?: string, state?: string}} r */ r => {
      const user = (r.user || {}).login;
      const submittedAt = r.submitted_at || r.created_at || '';
      const submitted = submittedAt ? new Date(submittedAt).getTime() : 0;
      return user === reviewerUser && submitted >= since;
    })
    .map(/** @param {{state?: string, submitted_at?: string, created_at?: string}} r */ r => ({ state: r.state, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

/**
 * @param {string} branch
 * @param {{forgejoUser?: string, token?: string, apiCall?: Function, rootDir?: string}} [options]
 * @returns {{ok: boolean, error?: string, reviewState?: string|null, prNumber?: number, defaultUserApproved?: boolean, raw?: string}}
 */
function getLatestReviewDecision(branch: string, options = {}): { ok: boolean, error?: string, reviewState?: string | null, prNumber?: number, defaultUserApproved?: boolean, raw?: string } {
  /** @type {{forgejoUser?: string, token?: string, apiCall?: Function, rootDir?: string}} */
  const {
    forgejoUser,
    token: providedToken,
    apiCall = forgejoApi,
    rootDir = process.cwd()
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const { token } = resolveForgejoAuth({ forgejoUser, token: providedToken });
  if (!token) {
    return { ok: false, error: 'missing-token', reviewState: null };
  }

  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (prAccess && isApiErrorResult(prAccess)) {
    const apiErr = /** @type {{error?: string, status?: number}} */ (prAccess._apiError || {});
    return {
      ok: false,
      error: 'api-failed',
      reviewState: null,
      raw: /** @type {string|undefined} */ (`failed to resolve PR for ${branch}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}`)
    };
  }
  if (!prAccess) {
    return { ok: false, error: 'pr-not-found', reviewState: null };
  }
  const prNumber = prAccess.prNumber;

  const result = apiCall('GET', `/pulls/${prNumber}/reviews`, prAccess.token);
  if (!result.ok || !Array.isArray(result.data)) {
    return { ok: false, error: 'reviews-unavailable', reviewState: null, prNumber };
  }

  // defaultUserApproved tracks whether the repo owner (always DEFAULT_FORGEJO_USER)
  // has approved, not the current CLI session user.
  const defaultUserLogin = DEFAULT_FORGEJO_USER;
  const reviews = result.data
    .map(/** @param {{user?: {login?: string}, state?: string, submitted_at?: string, created_at?: string, dismissed?: boolean}} review */ (review) => ({
      user: (review.user || {}).login || '?',
      state: review.state || '',
      submittedAt: review.submitted_at || review.created_at || '',
      dismissed: !!review.dismissed
    }))
    .filter(/** @param {{state: string, submittedAt: string, dismissed: boolean}} review */ (review) => review.state && review.submittedAt && !review.dismissed)
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  if (reviews.length === 0) {
    return { ok: true, prNumber, reviewState: null, defaultUserApproved: false };
  }

  // Find the latest formal decision overall
  const formalReviews = reviews.filter(/** @param {{state: string}} r */ (r) => r.state === 'APPROVED' || r.state === 'REQUEST_CHANGES');

  const finalState = formalReviews.length > 0
    ? formalReviews[formalReviews.length - 1].state
    : reviews[reviews.length - 1].state;

  const defaultUserApproved = reviews.some(/** @param {{user: string, state: string}} r */ (r) => r.user === defaultUserLogin && r.state === 'APPROVED');

  return {
    ok: true,
    prNumber,
    reviewState: finalState,
    defaultUserApproved
  };
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
function getLatestDisposition(branch: string, implementerUser: string, sinceIso: string, token: string, options = {}): string | null {
  /** @type {{apiCall?: Function, forgejoUser?: string, rootDir?: string}} */
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (prAccess && isApiErrorResult(prAccess)) {return null;}
  if (!prAccess) {return null;}
  const prNumber = prAccess.prNumber;

  const result = apiCall('GET', `/issues/${prNumber}/comments`, prAccess.token);
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

async function getLatestReviewForPr(/** @type {number} */ prNumber, /** @type {string} */ reviewerUser, /** @type {string} */ sinceIso, /** @type {string} */ token, options = {}) {
  /** @type {{apiCall?: Function}} */
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall('GET', `/pulls/${prNumber}/reviews`, token);
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, submitted_at?: string, created_at?: string, state?: string}} r */ r => {
      const user = (r.user || {}).login;
      const submittedAt = r.submitted_at || r.created_at || '';
      const submitted = submittedAt ? new Date(submittedAt).getTime() : 0;
      return user === reviewerUser && submitted >= since;
    })
    .map(/** @param {{state?: string, submitted_at?: string, created_at?: string}} r */ r => ({ state: r.state, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

async function getLatestDispositionForPr(/** @type {number} */ prNumber, /** @type {string} */ implementerUser, /** @type {string} */ sinceIso, /** @type {string} */ token, options = {}) {
  /** @type {{apiCall?: Function}} */
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall('GET', `/issues/${prNumber}/comments`, token);
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
 * @param {string} branch  - Mission branch (e.g. 'mission/task-089')
 * @param {string} token   - Forgejo PAT
 * @param {string} body    - Comment body (markdown)
 * @returns {{ ok: boolean, data: any, status: number|null, error?: string, raw?: string }}
 */
function postComment(branch: string, token: string, body: string, options = {}): { ok: boolean, data: any, status: number | null, error?: string, raw?: string } {
  /** @type {{apiCall?: Function, resolvePrNumber?: Function, forgejoUser?: string}} */
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError || {};
    return { ok: false, data: null, status: null, error: 'api-failed', raw: `failed to resolve PR for ${branch}${(apiErr.status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}` };
  }
  if (!prNumber) {return { ok: false, data: null, status: null, error: 'pr-not-found' };}
  return apiCall('POST', `/issues/${prNumber}/comments`, token, { body });
}

const REVIEW_OUTCOME_MAP = {
  'approve':          'APPROVED',
  'request-changes':  'REQUEST_CHANGES',
  'comment':          'COMMENT'
};

/**
 * Submit a formal review outcome on the Forgejo PR for a given branch.
 *
 * @param {string} branch   - Mission branch (e.g. 'mission/task-089')
 * @param {string} token    - Forgejo PAT
 * @param {string} outcome  - 'approve' | 'request-changes' | 'comment'
 * @param {string} summary  - Review summary text
 * @returns {{ ok: boolean, data: any, status: number|null, error?: string, raw?: string }}
 */
function postReview(branch: string, token: string, outcome: string, summary: string, options = {}): { ok: boolean, data: any, status: number | null, error?: string, raw?: string } {
  /** @type {{apiCall?: Function, resolvePrNumber?: Function, forgejoUser?: string}} */
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError || {};
    return { ok: false, data: null, status: null, error: 'api-failed', raw: `failed to resolve PR for ${branch}${(apiErr.status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}` };
  }
  if (!prNumber) {return { ok: false, data: null, status: null, error: 'pr-not-found' };}

  // Resolve current head SHA for the PR to avoid submission failures if PR updated
  const prRes = apiCall('GET', `/pulls/${prNumber}`, token);
  const commit_id = (prRes.ok && prRes.data && prRes.data.head) ? prRes.data.head.sha : null;

  const event = /** @type {'APPROVED'|'REQUEST_CHANGES'|'COMMENT'|undefined} */ (REVIEW_OUTCOME_MAP[/** @type {keyof typeof REVIEW_OUTCOME_MAP} */ (outcome)]);
  if (!event) {return { ok: false, data: null, status: null, error: `unsupported-outcome: ${outcome}` };}

  /** @type {{body: string, event: string, commit_id?: string|null}} */
  const payload = { body: summary, event };
  if (commit_id) {
    payload.commit_id = commit_id;
  }

  const result = apiCall('POST', `/pulls/${prNumber}/reviews`, token, payload);
  if (!result.ok && result.stderr) {
    fmt.log.info(`curl stderr: ${result.stderr}`);
  }
  return result;
}

/**
 * Check if Forgejo is reachable at the configured URL.
 * Returns true if Forgejo responds to HTTP requests within the timeout period.
 *
 * @param {string} [url='http://localhost:3300']
 * @param {object} [options]
 * @param {Function} [options.request] Injected request implementation for tests.
 * @param {number} [options.timeout=HTTP_REQUEST_TIMEOUT]
 * @returns {Promise<boolean>} True if Forgejo is reachable, false otherwise
 */
function forgejoAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', options = {}): Promise<boolean> {
  /** @type {{request?: Function, timeout?: number}} */
  const {
    request = http.request,
    timeout = HTTP_REQUEST_TIMEOUT
  } = options;
  const targetUrl = new URL(url);

  return new Promise((resolve) => {
    const req = request(targetUrl, { method: 'GET', timeout }, (/** @type {import('http').IncomingMessage} */ res) => {
      req.destroy();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function syncMerged(/** @type {string} */ branch, /** @type {string} */ mergedCommit, options = {}) {
  /** @type {{forgejoUser?: string, rootDir?: string, token?: string|null, baseBranch?: string|null, apiCall?: Function, resolvePrNumber?: Function, gitPush?: Function, gitFetch?: Function, gitContainsCommit?: Function, gitDelete?: Function, verifyCommit?: Function, log?: Function}} */
  const {
    forgejoUser,
    rootDir = process.cwd(),
    token: providedToken,
    baseBranch = null,
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    gitPush = pushReviewRef,
    gitFetch = fetchReviewBranch,
    gitContainsCommit = remoteRefContainsCommit,
    gitDelete = deleteReviewRef,
    verifyCommit = verifyCommitExists,
    log = fmt.log.info
  } = options;

  if (!branch) {
    return { ok: false, error: 'missing-branch' };
  }

  if (!mergedCommit) {
    return { ok: false, error: 'missing-merged-commit' };
  }

  const { token } = resolveForgejoAuth({ forgejoUser, token: providedToken || undefined });
  if (!token) {
    return { ok: false, error: 'missing-token' };
  }

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const prNumber = resolvePrNumber(branch, token, { slug, rootDir });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError || {};
    return {
      ok: false,
      error: 'api-failed',
      raw: `failed to resolve PR for ${branch}${(apiErr.status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}`
    };
  }
  if (!prNumber) {
    return { ok: false, error: 'pr-not-found' };
  }

  const commitResult = verifyCommit(mergedCommit, rootDir);
  if (commitResult.status !== 0) {
    return { ok: false, error: 'missing-commit' };
  }

  const verifyMergeState = (/** @type {number} */ statusCode) => {
    const prDetails = apiCall('GET', `/pulls/${prNumber}`, token, undefined, { rootDir });
    if (!prDetails.ok) {
      return { ok: false, error: 'merge-verify-failed', prNumber, statusCode: prDetails.statusCode };
    }

    const pr = prDetails.data || {};
    const baseSha = pr.base ? pr.base.sha : null;
    const headSha = pr.head ? pr.head.sha : null;
    const shaMatch = (/** @type {string|null} */ a, /** @type {string|null} */ b) => a && b && (a === b || a.startsWith(b) || b.startsWith(a));
    if (shaMatch(baseSha, mergedCommit) && shaMatch(headSha, mergedCommit)) {
      log(`PR #${prNumber} (${branch}): confirmed head/base match ${mergedCommit} (already merged)`);
      return { ok: true };
    }

    return {
      ok: false,
      error: 'merge-conflict-sha-mismatch',
      prNumber,
      statusCode,
      expected: mergedCommit,
      baseSha,
      headSha
    };
  };

  // The mission lands back onto its recorded base branch, which is the primary
  // branch (main) for normal missions but a feature branch (e.g. skunkworks) for
  // missions started from a feature branch. Pushing the squash commit anywhere
  // other than that base branch is a non-fast-forward and is rejected.
  let primaryBranch = baseBranch;
  if (!primaryBranch) {
    try {
      primaryBranch = getPrimaryBranch(rootDir);
    } catch (_) {
      primaryBranch = 'main';
    }
  }
  log(`PR #${prNumber} (${branch}): pushing landed commit ${mergedCommit} to Forgejo ${primaryBranch}...`);
  const pushMasterResult = gitPush(mergedCommit, `refs/heads/${primaryBranch}`, rootDir, { user: forgejoUser, token });
  if (pushMasterResult.status !== 0) {
    log(`PR #${prNumber} (${branch}): ${primaryBranch} push failed; checking whether review/${primaryBranch} already contains ${mergedCommit}`);
    const fetchMasterResult = gitFetch(primaryBranch, rootDir, { user: forgejoUser, token });
    const containsResult = fetchMasterResult.status === 0
      ? gitContainsCommit(mergedCommit, `refs/remotes/review/${primaryBranch}`, rootDir)
      : { status: 1 };
    if (containsResult.status === 0) {
      log(`PR #${prNumber} (${branch}): review/${primaryBranch} already contains ${mergedCommit}; continuing sync-merged closeout`);
    } else {
      return { ok: false, error: 'push-primary-failed', prNumber, raw: pushOutput(pushMasterResult) };
    }
  }

  log(`PR #${prNumber} (${branch}): updating remote branch to ${mergedCommit}...`);
  const fetchBeforePushResult = gitFetch(branch, rootDir, { user: forgejoUser, token });
  if (fetchBeforePushResult.status === 0) {
    log(`PR #${prNumber} (${branch}): refreshed review/${branch} before branch sync`);
  } else {
    log(`PR #${prNumber} (${branch}): could not refresh review/${branch}; attempting force-with-lease branch sync`);
  }

  // The squash commit is not a descendant of the mission branch tip, so a force push is required.
  let pushBranchResult = gitPush(mergedCommit, `refs/heads/${branch}`, rootDir, { forceWithLease: true, user: forgejoUser, token });
  if (isStaleInfoPushRejection(pushBranchResult)) {
    log(`PR #${prNumber} (${branch}): branch sync rejected as stale; fetching review/${branch} and retrying`);
    gitFetch(branch, rootDir, { user: forgejoUser, token });
    pushBranchResult = gitPush(mergedCommit, `refs/heads/${branch}`, rootDir, { forceWithLease: true, user: forgejoUser, token });
    if (isStaleInfoPushRejection(pushBranchResult)) {
      log(`PR #${prNumber} (${branch}): force-with-lease still stale; using force push for landed squash commit`);
      pushBranchResult = gitPush(mergedCommit, `refs/heads/${branch}`, rootDir, { force: true, user: forgejoUser, token });
    }
  }
  if (pushBranchResult.status !== 0) {
    return { ok: false, error: 'push-branch-failed', prNumber, raw: pushOutput(pushBranchResult) };
  }

  const mergePayload = {
    Do: 'manually-merged',
    MergeCommitID: mergedCommit,
    head_commit_id: mergedCommit,
    delete_branch_after_merge: true
  };
  const mergeResult = apiCall('POST', `/pulls/${prNumber}/merge`, token, mergePayload, { rootDir });
  if (!mergeResult.ok) {
    if (mergeResult.statusCode === 409 || mergeResult.statusCode === 405) {
      log(`PR #${prNumber} (${branch}): received ${mergeResult.statusCode}${mergeResult.statusCode === 405 ? ' Method Not Allowed' : ' Conflict'}, verifying remote commit state...`);
      const verificationResult = verifyMergeState(mergeResult.statusCode);
      if (!verificationResult.ok) {
        return verificationResult;
      }
    } else {
      return { ok: false, error: 'merge-api-failed', prNumber, statusCode: mergeResult.statusCode };
    }
  }

  const deleteResult = gitDelete(branch, rootDir, { user: forgejoUser, token });
  const branchDeleted = deleteResult.status === 0;
  if (branchDeleted) {
    log(`PR #${prNumber} (${branch}): remote branch deleted`);
  } else {
    log(`PR #${prNumber} (${branch}): remote branch already gone or could not be deleted after merge`);
  }

  log(`PR #${prNumber} (${branch}) marked merged at ${mergedCommit}`);
  return {
    ok: true,
    prNumber,
    branchDeleted
  };
}

/**
 * Retrieve all comments (issue, review, and inline) for a given branch.
 *
 * @param {string} branch  - Mission branch
 * @param {string} token   - Forgejo PAT
 * @param {object} [options]
 * @param {Function} [options.apiCall] - Forgejo API function, injectable for tests
 * @param {Function} [options.log]     - Logger, injectable for tests
 * @returns {any[]|null} - Array of comment objects sorted by creation time, or null if comments could not be fetched
 */
function getCommentsSync(branch: string, token: string, options = {}): any[] | null {
  /** @type {{apiCall?: Function, forgejoUser?: string, rootDir?: string, log?: Function}} */
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd(),
    log: logger = noopLog
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (prAccess && isApiErrorResult(prAccess)) {
    logger(`getComments API error resolving PR for ${branch}: status=${(/** @type {{status?: number}} */ (prAccess._apiError || {})).status || 0}`);
    return null;
  }
  if (!prAccess) {return null;}
  const prNumber = prAccess.prNumber;
  const accessToken = prAccess.token;

  const issueCommentsRes = apiCall('GET', `/issues/${prNumber}/comments`, accessToken);
  const reviewsRes = apiCall('GET', `/pulls/${prNumber}/reviews`, accessToken);

  if (!issueCommentsRes.ok || !reviewsRes.ok) {
    logger(`getComments API failure: issueCommentsRes.ok=${issueCommentsRes.ok}, reviewsRes.ok=${reviewsRes.ok}`);
    return null;
  }

  const issueComments = issueCommentsRes.data || [];
  const reviews = reviewsRes.data || [];
  const allComments = /** @type {Array<{kind: string, user: string, created: string, body: string, state?: string, location?: string}>} */ ([]);

  // 1. Process issue comments
  issueComments.forEach(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c) => {
    allComments.push({
      kind: 'issue-comment',
      user: (c.user || {}).login || '?',
      created: (c.created_at || '').substring(0, 16),
      body: (c.body || '').trim()
    });
  });

  // 2. Process reviews and their inline comments
  for (const r of reviews) {
    const flags = [];
    if (r.stale) {flags.push('stale');}
    if (r.dismissed) {flags.push('dismissed');}
    const kind = flags.length > 0 ? `review [${flags.join(', ')}]` : 'review';

    allComments.push({
      kind,
      user: (r.user || {}).login || '?',
      created: (r.submitted_at || r.created_at || '').substring(0, 16),
      body: (r.body || '').trim(),
      state: r.state || ''
    });

    // Fetch inline comments for this review
    const inlineRes = apiCall('GET', `/pulls/${prNumber}/reviews/${r.id}/comments`, accessToken);
    if (inlineRes.ok && Array.isArray(inlineRes.data)) {
      inlineRes.data.forEach(/** @param {{user?: {login?: string}, created_at?: string, body?: string, path?: string, line?: number, original_line?: number}} c */ (c) => {
        const iFlags = [];
        if (r.stale) {iFlags.push('stale');}
        if (r.dismissed) {iFlags.push('dismissed');}
        let iKind = 'inline-comment';
        if (iFlags.length > 0) {iKind += ` [${iFlags.join(', ')}]`;}

        const path = c.path || '';
        const line = c.line || c.original_line || '';
        const location = line ? `${path}:${line}` : path;

        allComments.push({
          kind: iKind,
          user: (c.user || {}).login || '?',
          created: (c.created_at || '').substring(0, 16),
          body: (c.body || '').trim(),
          location
        });
      });
    }
  }

  return allComments.sort(/** @param {{created: string}} a @param {{created: string}} b */ (a, b) => a.created.localeCompare(b.created));
}

async function getComments(/** @type {string} */ branch, /** @type {string} */ token, options = {}) {
  return getCommentsSync(branch, token, options);
}

/**
 * Close a Forgejo PR and delete the remote branch.
 * Closes a PR and performs cleanup.
 *
 * @param {string} branch  - Mission branch
 * @param {string} token   - Forgejo PAT
 * @returns {Promise<Object>} - { ok: boolean, error: string }
 */
async function closePr(branch: string, token: string): Promise<Object> {
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const rootDir = process.cwd();
  const prNumber = getPrNumber(branch, token, { slug, rootDir });

  if (prNumber && typeof prNumber === 'object' && isApiErrorResult(prNumber)) {
    const apiErr = /** @type {{status?: number}} */ (prNumber._apiError || {});
    fmt.log.warn(`API error resolving PR for ${fmt.branch(branch)}: status=${apiErr.status || 0}${(apiErr.status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}`);
    return { ok: true };
  }

  if (prNumber && typeof prNumber === 'number') {
    // Check current state
    const prDetails = forgejoApi('GET', `/pulls/${prNumber}`, token, undefined, { rootDir });
    if (prDetails.ok) {
      const pr = prDetails.data;
      if (pr.state !== 'closed' && !pr.merged) {
        const closeResult = forgejoApi('PATCH', `/pulls/${prNumber}`, token, { state: 'closed' }, { rootDir });
        if (!closeResult.ok) {
          return { ok: false, error: `failed to close PR #${prNumber}: ${JSON.stringify(closeResult.data)}` };
        }
        fmt.log.pass(`PR #${prNumber} closed.`);
      } else {
        fmt.log.info(`PR #${prNumber} is already ${pr.state}${pr.merged ? ' and merged' : ''}.`);
      }
    }
  } else {
    fmt.log.info(`No open PR found for ${fmt.branch(branch)}.`);
  }

  // Delete remote branch
  fmt.log.info(`Deleting remote branch ${fmt.branch(branch)}...`);
  const deleteResult = deleteReviewRef(branch, rootDir);
  if (deleteResult.status === 0) {
    fmt.log.pass(`Remote branch ${fmt.branch(branch)} deleted.`);
  } else {
    fmt.log.info(`Remote branch ${fmt.branch(branch)} already gone or could not be deleted.`);
  }

  return { ok: true };
}


export { getPrStatus };
export { resolveForgejoUser };
export { resolveForgejoHome };
export { isForgejoPath };
export { resolveTokenFile };
export { readToken };
export { forgejoApi };
export { forgejoApiAsync };
export { getPrNumber };
export { getPrAuthor };
export { listOpenPrsForSlug };
export { isApiErrorResult };
export { getLatestReview };
export { getLatestReviewForPr };
export { getLatestReviewDecision };
export { getLatestDisposition };
export { getLatestDispositionForPr };
export { postComment };
export { forgejoAvailable };
export { postReview };
export { syncMerged };
export { pushReviewRef };
export { isStaleInfoPushRejection };
export { fetchReviewBranch };
export { deleteReviewRef };
export { verifyCommitExists };
export { remoteRefContainsCommit };
export { resolveTrackingBranchSha };
export { deriveRepoFromGitRemote };
export { resolveForgejoSettings };
export { reviewRemoteUrl };
export { authenticatedReviewUrl };
export { syncPrimaryBaseline };
export { ensureRemoteBaseBranch };
export { createPr };
export { getCommentsSync };
export { getComments };
export { closePr };
;
