const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');
const git = require('../core/git');
const { getPrimaryBranch, resolveMissionBaseBranch } = require('../core/mission-utils');
const { resolveReviewAdapter } = require('../core/product-config');
const verification = require('../core/verification');
const fmt = require('../core/fmt');

const DISPOSITION_PATTERN = /Autonomous review disposition:\s*(CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED)/;

const HTTP_REQUEST_TIMEOUT = 5000;
const DEFAULT_FORGEJO_USER = 'human';
const noopLog = () => {};
const derivedRepoCache = new Map();
function codexSandboxHint() {
  return 'Codex runtime cannot reach local Forgejo from Node subprocesses. Use the repo-local Codex config/profile that allows the workflow network path.';
}
function cacheKey(rootDir, remoteName) {
  return `${rootDir}::${remoteName}`;
}
function deriveRepoFromGitRemote(rootDir, remoteName) {
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

function resolveForgejoUser(explicitUser) {
  return explicitUser || process.env.FORGEJO_USER || DEFAULT_FORGEJO_USER;
}

function resolveForgejoHome() {
  if (process.env.FORGEJO_HOME) return process.env.FORGEJO_HOME;
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

function normalizePathForComparison(targetPath) {
  if (!targetPath) return null;
  try {
    return fs.realpathSync.native(targetPath);
  } catch (_) {
    return path.resolve(targetPath);
  }
}

function isForgejoPath(targetPath, options = {}) {
  const forgejoHome = options.forgejoHome || resolveForgejoHome();
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedForgejoHome = normalizePathForComparison(forgejoHome);
  if (!normalizedTarget || !normalizedForgejoHome) return false;
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

function resolveForgejoAuth(options = {}) {
  const forgejoUser = resolveForgejoUser(options.forgejoUser);
  const token = options.token || readToken(forgejoUser);
  return { forgejoUser, token };
}

function formatPrLookupFailure(branch, apiErr = {}) {
  const sandboxNote = apiErr.status === 7 ? ` (${codexSandboxHint()})` : '';
  if (apiErr.statusCode === 401 || apiErr.statusCode === 403) {
    return `failed to resolve PR for ${branch}: Forgejo authentication failed (${apiErr.statusCode})${sandboxNote}`;
  }
  if (apiErr.statusCode) {
    return `failed to resolve PR for ${branch}: Forgejo API returned HTTP ${apiErr.statusCode}${sandboxNote}`;
  }
  return `failed to resolve PR for ${branch}${sandboxNote}`;
}

function getPrStatus(branch, rootDir = process.cwd(), options = {}) {
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
function resolveTokenFile(user) {
  const resolvedUser = resolveForgejoUser(user);
  const isCurrentUser = resolvedUser === resolveForgejoUser();
  const canUseDefaultTokenFile = isCurrentUser || resolvedUser === DEFAULT_FORGEJO_USER;
  const candidates = [
    isCurrentUser ? process.env.FORGEJO_TOKEN_FILE : null,
    path.join(resolveForgejoHome(), 'tokens', resolvedUser),
    canUseDefaultTokenFile ? path.join(resolveForgejoHome(), 'token') : null,
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Read and return the Forgejo PAT for a given user.
 *
 * @param {string} user
 * @returns {string|null}
 */
function readToken(user) {
  const resolvedUser = resolveForgejoUser(user);
  if (resolvedUser === resolveForgejoUser() && process.env.FORGEJO_TOKEN) {
    return process.env.FORGEJO_TOKEN;
  }
  const tokenFile = resolveTokenFile(resolvedUser);
  if (!tokenFile) return null;
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

/**
 * Make a JSON Forgejo API call via curl. Returns parsed JSON or null on failure.
 *
 * @param {string} method   - HTTP method (GET, POST, PATCH, ...)
 * @param {string} apiPath  - Path relative to /api/v1/repos/<repo>
 * @param {string} token    - Forgejo PAT
 * @param {object} [body]   - Optional JSON body
 * @returns {{ ok: boolean, data: any, status: number|null }}
 */
function forgejoApi(method, apiPath, token, body, options = {}) {
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
    statusCode
  };
}

function forgejoApiAsync(method, apiPath, token, body, options = {}) {
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
    const finish = (result) => {
      if (settled) return;
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
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
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
          ok: res.statusCode >= 200 && res.statusCode < 300,
          data,
          status: 0,
          statusCode: res.statusCode
        });
      });
    });

    req.on('error', (error) => {
      finish({
        ok: false,
        data: null,
        status: null,
        statusCode: null,
        stderr: error.message,
        error: ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.code) ? codexSandboxHint() : null
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
function createPr(branch, user, token, options = {}) {
  const {
    rootDir = process.cwd(),
    apiCall = forgejoApi,
    log = fmt.log.info,
    force = false,
    forceWithLease = false,
    gitFetch = fetchReviewBranch,
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
  if (branch === primaryBranch) return { ok: false, error: `cannot create a PR from ${primaryBranch}` };

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
  const authenticatedGitFetch = (branchName, dir, options = {}) => fetchReviewBranch(branchName, dir, {
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
    gitRunner: git.git
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
  let pushArgs = pushArgsResult.pushArgs;
  let pushResult = git.git(pushArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: cLocaleEnv() });
  if (pushResult.stdout) process.stdout.write(pushResult.stdout);
  if (pushResult.stderr) process.stderr.write(pushResult.stderr);

  if (pushResult.status !== 0) {
    if (forceWithLease && isStaleInfoPushRejection(pushResult)) {
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
      pushArgs = pushArgsResult.pushArgs;
      pushResult = git.git(pushArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: cLocaleEnv() });
      if (pushResult.stdout) process.stdout.write(pushResult.stdout);
      if (pushResult.stderr) process.stderr.write(pushResult.stderr);
    }
    if (pushResult.status !== 0) {
      const pushError = (pushResult.stderr || pushResult.stdout || '').trim();
      return { ok: false, error: `git push failed with status ${pushResult.status}${pushError ? `: ${pushError}` : ''}` };
    }
  }

  // 3. Check if an OPEN PR already exists for this branch
  const existingPrLookup = resolvePrAccess(branch, apiToken, { apiCall, slug, onlyOpen: true, forgejoUser: apiUser, rootDir });

  if (isApiErrorResult(existingPrLookup)) {
    const apiErr = existingPrLookup._apiError;
    return { ok: false, error: `failed to check existing PR: ${apiErr.error || 'API error'}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}` };
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

function getPrNumber(branch, token, options = {}) {
  const resolved = resolvePrAccess(branch, token, options);
  if (!resolved || isApiErrorResult(resolved)) {
    return resolved;
  }
  return resolved.prNumber;
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
function getPrAuthor(branch, token, options = {}) {
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser,
    rootDir = process.cwd()
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (isApiErrorResult(prNumber) || !prNumber) return null;

  const prRes = apiCall('GET', `/pulls/${prNumber}`, token, undefined, { rootDir });
  if (!prRes.ok || !prRes.data || !prRes.data.user) return null;
  return prRes.data.user.login || null;
}

function resolvePrAccess(branch, token, options = {}) {
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

  const doLookup = (t) => {
    const openResult = searchInState('open', t);
    if (openResult) return openResult;
    if (!onlyOpen) return searchInState('all', t);
    return null;
  };

  // 1. Try with the provided token
  let prNumber = doLookup(token);
  if (prNumber) return { prNumber, token };

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
        if (prNumber) return { prNumber, token: fallbackToken };
      }
    }
  }

  if (options.reportNotFound) {
    const curlCheck = spawnSync('curl', ['--version'], { encoding: 'utf8' });
    fmt.log.fail(`PR not found for branch '${branch}' after checking tokens for: ${triedUsers.join(', ')}`);
    const settings = resolveForgejoSettings(rootDir);
    fmt.log.info(`Current environment: FORGEJO_URL=${settings.url}, FORGEJO_REPO=${settings.repo}, FORGEJO_HOME=${resolveForgejoHome()}`);
    if (lastApiError) {
      fmt.log.warn(`API error encountered during lookup: status=${lastApiError.status}, error=${lastApiError.error || 'unknown'}`);
      if (lastApiError.stderr) {
        fmt.log.info(`API stderr: ${lastApiError.stderr}`);
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

function listOpenPrsForSlug(baseSlug, token, options = {}) {
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
      if (consecutiveErrors >= 3) break;
      continue;
    }
    consecutiveErrors = 0;
    if (!Array.isArray(result.data) || result.data.length === 0) break;

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

    if (result.data.length < pageSize) break;
  }

  return prs;
}

function isApiErrorResult(result) {
  return result && typeof result === 'object' && result._apiError && result._notFound === true;
}

function authenticatedReviewUrl(user, token, rootDir = process.cwd()) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
  const url = new URL(forgejoUrl);
  const protocol = url.protocol;
  const host = url.host; // includes port if present

  return `${protocol}//${user}:${token}@${host}/${forgejoRepo}.git`;
}

function reviewRemoteUrl(rootDir = process.cwd()) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
  if (!forgejoUrl || !forgejoRepo) return null;
  const url = new URL(forgejoUrl);
  return `${url.protocol}//${url.host}/${forgejoRepo}.git`;
}

function syncPrimaryBaseline(user, token, rootDir = process.cwd(), {
  verificationProof = null,
  assertVerifiedTreeProofFn = verification.assertVerifiedTreeProof,
  gitRunner = git.git
} = {}) {
  let primaryBranch = 'main';
  try {
    primaryBranch = getPrimaryBranch(rootDir);
  } catch (_) {
    primaryBranch = 'main';
  }

  const proofCheck = assertVerifiedTreeProofFn(verificationProof, rootDir, { gitRunner });
  if (!proofCheck.ok) {
    return { ok: false, error: proofCheck.error || 'verification-proof-mismatch' };
  }

  const primaryExists = gitRunner(['-C', rootDir, 'show-ref', '--verify', '--quiet', `refs/heads/${primaryBranch}`]);
  if (primaryExists.status !== 0) return { ok: true, skipped: true };

  const remoteUrl = authenticatedReviewUrl(user, token, rootDir);
  // Force-push: the review remote's primary branch is a server-side mirror of our
  // local primary that we intentionally overwrite to keep the review baseline in
  // sync. Without --force a diverged remote primary (rebases, amended baseline
  // commits) rejects this as a non-fast-forward, aborting the sync and breaking
  // the review loop. See missions/task-1318 "Required Forgejo fix".
  const result = gitRunner(['-C', rootDir, 'push', '--force', remoteUrl, `${primaryBranch}:${primaryBranch}`], {
    stdio: 'pipe'
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stderr: result.stderr,
    error: result.status === 0 ? null : `${result.stderr || 'git push failed'}${result.error ? ` (${codexSandboxHint()})` : ''}`
  };
}

function ensureRemoteBaseBranch(baseBranch, user, token, rootDir = process.cwd(), {
  gitRunner = git.git
} = {}) {
  // A feature-branch mission opens its PR against a non-primary base branch.
  // syncPrimaryBaseline only mirrors the primary branch, so the PR base would
  // not exist on the review remote and PR creation would fail server-side.
  // Mirror the local feature base branch here before the PR is opened.
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

function pushReviewRef(sourceRef, destinationRef, rootDir = process.cwd(), {
  force = false,
  forceWithLease = false,
  user,
  token
} = {}) {
  const remote = token
    ? authenticatedReviewUrl(user || resolveForgejoUser(), token, rootDir)
    : 'review';
  const pushArgs = ['-C', rootDir, 'push', remote];
  if (forceWithLease) {
    pushArgs.push('--force-with-lease');
  } else if (force) {
    pushArgs.push('--force');
  }
  pushArgs.push(`${sourceRef}:${destinationRef}`);
  const result = git.git(pushArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function fetchReviewBranch(branch, rootDir = process.cwd(), options = {}) {
  const { user, token } = options;
  const source = token
    ? authenticatedReviewUrl(user || resolveForgejoUser(), token, rootDir)
    : 'review';
  return git.git(['-C', rootDir, 'fetch', source, `+refs/heads/${branch}:refs/remotes/review/${branch}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Force a stable C locale so git emits its diagnostics in English. Without
    // this, a non-English operator locale (e.g. Swedish "kunde inte hitta
    // fjärr-referensen") makes isMissingRemoteRef miss the "could not find
    // remote ref" condition and a routine first push aborts with a fatal error.
    env: cLocaleEnv()
  });
}

function resolveTrackingBranchSha(branch, rootDir = process.cwd()) {
  const candidateRefs = [`refs/remotes/review/${branch}`, `refs/remotes/origin/${branch}`];
  for (const ref of candidateRefs) {
    const result = git.git(['-C', rootDir, 'rev-parse', '--verify', `${ref}^{commit}`], {
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

function buildCreatePrPushArgs(branch, remoteUrl, rootDir = process.cwd(), options = {}) {
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

function deleteReviewRef(branch, rootDir = process.cwd(), { user, token } = {}) {
  const remote = token
    ? authenticatedReviewUrl(user || resolveForgejoUser(), token, rootDir)
    : 'review';
  const result = git.git(['-C', rootDir, 'push', remote, '--delete', branch], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function verifyCommitExists(commit, rootDir = process.cwd()) {
  return git.git(['-C', rootDir, 'rev-parse', '--verify', `${commit}^{commit}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function remoteRefContainsCommit(commit, remoteRef = `refs/remotes/review/${getPrimaryBranch(process.cwd())}`, rootDir = process.cwd()) {
  return git.git(['-C', rootDir, 'merge-base', '--is-ancestor', commit, remoteRef], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

// Git diagnostics ("could not find remote ref", "stale info", "fetch first")
// are localized to the operator's locale. We parse these messages to decide
// control flow, so force a stable C locale on git calls whose stderr we
// inspect, keeping detection language-independent.
function cLocaleEnv() {
  return { ...process.env, LC_ALL: 'C', LANG: 'C' };
}

function pushOutput(result) {
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
function isMissingRemoteRef(result) {
  const output = pushOutput(result).toLowerCase();
  return output.includes('could not find remote ref')
    || output.includes("couldn't find remote ref");
}

function isStaleInfoPushRejection(result) {
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
function getLatestReview(branch, reviewerUser, sinceIso, token, options = {}) {
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (!prAccess || isApiErrorResult(prAccess)) return null;

  const result = apiCall('GET', `/pulls/${prAccess.prNumber}/reviews`, prAccess.token);
  if (!result.ok || !Array.isArray(result.data)) return null;

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(r => {
      const user = (r.user || {}).login;
      const submittedAt = r.submitted_at || r.created_at || '';
      const submitted = submittedAt ? new Date(submittedAt).getTime() : 0;
      return user === reviewerUser && submitted >= since;
    })
    .map(r => ({ state: r.state, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

function getLatestReviewDecision(branch, options = {}) {
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
  if (isApiErrorResult(prAccess)) {
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
  const prNumber = prAccess.prNumber;

  const result = apiCall('GET', `/pulls/${prNumber}/reviews`, prAccess.token);
  if (!result.ok || !Array.isArray(result.data)) {
    return { ok: false, error: 'reviews-unavailable', reviewState: null, prNumber };
  }

  // defaultUserApproved tracks whether the repo owner (always DEFAULT_FORGEJO_USER)
  // has approved, not the current CLI session user.
  const defaultUserLogin = DEFAULT_FORGEJO_USER;
  const reviews = result.data
    .map(review => ({
      user: (review.user || {}).login || '?',
      state: review.state || '',
      submittedAt: review.submitted_at || review.created_at || '',
      dismissed: !!review.dismissed
    }))
    .filter(review => review.state && review.submittedAt && !review.dismissed)
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  if (reviews.length === 0) {
    return { ok: true, prNumber, reviewState: null, defaultUserApproved: false };
  }

  // Find the latest formal decision overall
  const formalReviews = reviews.filter(r => r.state === 'APPROVED' || r.state === 'REQUEST_CHANGES');

  const finalState = formalReviews.length > 0
    ? formalReviews[formalReviews.length - 1].state
    : reviews[reviews.length - 1].state;

  const defaultUserApproved = reviews.some(r => r.user === defaultUserLogin && r.state === 'APPROVED');

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
function getLatestDisposition(branch, implementerUser, sinceIso, token, options = {}) {
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (isApiErrorResult(prAccess)) return null;
  if (!prAccess) return null;
  const prNumber = prAccess.prNumber;

  const result = apiCall('GET', `/issues/${prNumber}/comments`, prAccess.token);
  if (!result.ok || !Array.isArray(result.data)) return null;

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(c => {
      const user = (c.user || {}).login;
      const createdStr = c.created_at || '';
      const created = createdStr ? new Date(createdStr).getTime() : 0;
      const body = c.body || '';
      return user === implementerUser && created >= since && DISPOSITION_PATTERN.test(body);
    })
    .map(c => {
      const match = DISPOSITION_PATTERN.exec(c.body);
      return { disposition: match ? match[1] : null, createdAt: c.created_at || '' };
    })
    .filter(e => e.disposition)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1].disposition : null;
}

async function getLatestReviewForPr(prNumber, reviewerUser, sinceIso, token, options = {}) {
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall('GET', `/pulls/${prNumber}/reviews`, token);
  if (!result.ok || !Array.isArray(result.data)) return null;

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(r => {
      const user = (r.user || {}).login;
      const submittedAt = r.submitted_at || r.created_at || '';
      const submitted = submittedAt ? new Date(submittedAt).getTime() : 0;
      return user === reviewerUser && submitted >= since;
    })
    .map(r => ({ state: r.state, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

async function getLatestDispositionForPr(prNumber, implementerUser, sinceIso, token, options = {}) {
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall('GET', `/issues/${prNumber}/comments`, token);
  if (!result.ok || !Array.isArray(result.data)) return null;

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(c => {
      const user = (c.user || {}).login;
      const createdAt = c.created_at || '';
      const created = createdAt ? new Date(createdAt).getTime() : 0;
      const body = c.body || '';
      return user === implementerUser && created >= since && DISPOSITION_PATTERN.test(body);
    })
    .map(c => {
      const match = DISPOSITION_PATTERN.exec(c.body);
      return { disposition: match ? match[1] : null, createdAt: c.created_at || '' };
    })
    .filter(e => e.disposition)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1].disposition : null;
}

/**
 * Post a comment on the Forgejo PR for a given branch.
 *
 * @param {string} branch  - Mission branch (e.g. 'mission/task-089')
 * @param {string} token   - Forgejo PAT
 * @param {string} body    - Comment body (markdown)
 * @returns {{ ok: boolean, data: any, status: number|null }}
 */
function postComment(branch, token, body, options = {}) {
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError;
    return { ok: false, data: null, status: null, error: 'api-failed', raw: `failed to resolve PR for ${branch}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}` };
  }
  if (!prNumber) return { ok: false, data: null, status: null, error: 'pr-not-found' };
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
 * @returns {{ ok: boolean, data: any, status: number|null }}
 */
function postReview(branch, token, outcome, summary, options = {}) {
  const {
    apiCall = forgejoApi,
    resolvePrNumber = getPrNumber,
    forgejoUser
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prNumber = resolvePrNumber(branch, token, { apiCall, slug, forgejoUser });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError;
    return { ok: false, data: null, status: null, error: 'api-failed', raw: `failed to resolve PR for ${branch}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}` };
  }
  if (!prNumber) return { ok: false, data: null, status: null, error: 'pr-not-found' };

  // Resolve current head SHA for the PR to avoid submission failures if PR updated
  const prRes = apiCall('GET', `/pulls/${prNumber}`, token);
  const commit_id = (prRes.ok && prRes.data && prRes.data.head) ? prRes.data.head.sha : null;

  const event = REVIEW_OUTCOME_MAP[outcome];
  if (!event) return { ok: false, data: null, status: null, error: `unsupported-outcome: ${outcome}` };

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
function forgejoAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', options = {}) {
  const {
    request = http.request,
    timeout = HTTP_REQUEST_TIMEOUT
  } = options;
  const targetUrl = new URL(url);

  return new Promise((resolve) => {
    const req = request(targetUrl, { method: 'GET', timeout }, (res) => {
      req.destroy();
      resolve(res.statusCode !== null && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function syncMerged(branch, mergedCommit, options = {}) {
  const {
    forgejoUser,
    rootDir = process.cwd(),
    token: providedToken,
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

  const { token } = resolveForgejoAuth({ forgejoUser, token: providedToken });
  if (!token) {
    return { ok: false, error: 'missing-token' };
  }

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const prNumber = resolvePrNumber(branch, token, { slug, rootDir });
  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError;
    return {
      ok: false,
      error: 'api-failed',
      raw: `failed to resolve PR for ${branch}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}`
    };
  }
  if (!prNumber) {
    return { ok: false, error: 'pr-not-found' };
  }

  const commitResult = verifyCommit(mergedCommit, rootDir);
  if (commitResult.status !== 0) {
    return { ok: false, error: 'missing-commit' };
  }

  const verifyMergeState = (statusCode) => {
    const prDetails = apiCall('GET', `/pulls/${prNumber}`, token, undefined, { rootDir });
    if (!prDetails.ok) {
      return { ok: false, error: 'merge-verify-failed', prNumber, statusCode: prDetails.statusCode };
    }

    const pr = prDetails.data || {};
    const baseSha = pr.base ? pr.base.sha : null;
    const headSha = pr.head ? pr.head.sha : null;
    const shaMatch = (a, b) => a && b && (a === b || a.startsWith(b) || b.startsWith(a));
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

  let primaryBranch = 'main';
  try {
    primaryBranch = getPrimaryBranch(rootDir);
  } catch (_) {
    primaryBranch = 'main';
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
 * @returns {Promise<Array|null>} - Array of comment objects sorted by creation time, or null if comments could not be fetched
 */
function getCommentsSync(branch, token, options = {}) {
  const {
    apiCall = forgejoApi,
    forgejoUser,
    rootDir = process.cwd(),
    log: logger = noopLog
  } = options;
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (isApiErrorResult(prAccess)) {
    logger(`getComments API error resolving PR for ${branch}: status=${prAccess._apiError.status}`);
    return null;
  }
  if (!prAccess) return null;
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
  const allComments = [];

  // 1. Process issue comments
  issueComments.forEach(c => {
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
    if (r.stale) flags.push('stale');
    if (r.dismissed) flags.push('dismissed');
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
      inlineRes.data.forEach(c => {
        const iFlags = [];
        if (r.stale) iFlags.push('stale');
        if (r.dismissed) iFlags.push('dismissed');
        let iKind = 'inline-comment';
        if (iFlags.length > 0) iKind += ` [${iFlags.join(', ')}]`;

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

  return allComments.sort((a, b) => a.created.localeCompare(b.created));
}

async function getComments(branch, token, options = {}) {
  return getCommentsSync(branch, token, options);
}

/**
 * Close a Forgejo PR and delete the remote branch.
 * Closes a PR and performs cleanup.
 *
 * @param {string} branch  - Mission branch
 * @param {string} token   - Forgejo PAT
 * @param {string} user    - Forgejo login
 * @returns {Promise<Object>} - { ok: boolean, error: string }
 */
async function closePr(branch, token, user) {
  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;
  const rootDir = process.cwd();
  const prNumber = getPrNumber(branch, token, { slug, rootDir });

  if (isApiErrorResult(prNumber)) {
    const apiErr = prNumber._apiError;
    fmt.log.warn(`API error resolving PR for ${fmt.branch(branch)}: status=${apiErr.status}${apiErr.status === 7 ? ` (${codexSandboxHint()})` : ''}`);
    return { ok: true };
  }

  if (prNumber) {
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

module.exports = {
  getPrStatus,
  resolveForgejoUser,
  resolveForgejoHome,
  isForgejoPath,
  resolveTokenFile,
  readToken,
  forgejoApi,
  forgejoApiAsync,
  getPrNumber,
  getPrAuthor,
  listOpenPrsForSlug,
  isApiErrorResult,
  getLatestReview,
  getLatestReviewForPr,
  getLatestReviewDecision,
  getLatestDisposition,
  getLatestDispositionForPr,
  postComment,
  forgejoAvailable,
  postReview,
  syncMerged,
  pushReviewRef,
  isStaleInfoPushRejection,
  fetchReviewBranch,
  deleteReviewRef,
  verifyCommitExists,
  remoteRefContainsCommit,
  resolveTrackingBranchSha,
  resolveForgejoHome,
  deriveRepoFromGitRemote,
  resolveForgejoSettings,
  reviewRemoteUrl,
  authenticatedReviewUrl,
  syncPrimaryBaseline,
  ensureRemoteBaseBranch,
  createPr,
  getCommentsSync,
  getComments,
  closePr
};
