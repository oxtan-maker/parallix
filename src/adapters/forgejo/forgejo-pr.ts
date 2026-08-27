import { spawnSync } from 'child_process';
import { getPrimaryBranch, resolveMissionBaseBranch } from '../filesystem/mission-utils.js';
import { getTaskImplementer, findTaskFile } from '../backlog/backlog.js';
import * as verification from '../verification/verification.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { DEFAULT_FORGEJO_USER, DISPOSITION_PATTERN, readToken, resolveForgejoAuth, resolveForgejoHome, resolveForgejoSettings, resolveForgejoUser } from './forgejo-auth.js';
import { forgejoApi, forgejoApiAsync, codexSandboxHint } from './forgejo-api.js';
import { git } from '../git/git.js';
import { syncPrimaryBaseline, ensureRemoteBaseBranch, fetchReviewBranch, buildCreatePrPushArgs, cLocaleEnv, deleteReviewRef, isStaleInfoPushRejection } from './forgejo-git.js';

const noopLog = () => {};

/**
 * @param {string} branch
 * @param {{status?: number, statusCode?: number}} [apiErr]
 * @returns {string}
 */
function formatPrLookupFailure(branch: string, apiErr: { status?: number, statusCode?: number }): string {
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
function getPrStatus(branch: string, rootDir?: string, options: any = {}) {
  /** @type {{forgejoUser?: string, token?: string, apiCall?: Function}} */
  const {
    forgejoUser,
    token: providedToken,
    apiCall = forgejoApi
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const { token } = resolveForgejoAuth({ forgejoUser, token: providedToken, rootDir });
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
 * @param {{rootDir?: string, apiCall?: Function, log?: Function, force?: boolean, forceWithLease?: boolean, verificationArea?: string, captureVerifiedTreeProofFn?: Function, assertVerifiedTreeProofFn?: Function}} [options]
 * @returns {{ok: boolean, url?: string|null, error?: string|null, prNumber?: number}}
 */
function createPr(branch: string, user: string, token: string, options: any = {}): { ok: boolean, url?: string | null, error?: string | null, prNumber?: number, gateFailure?: { area: string; command: string; cwd: string; exitCode: number | null; stdout: string; stderr: string; transient?: boolean } } {
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
  const ownerToken = repoOwner ? readToken(repoOwner, rootDir) : null;
  const gitUser = ownerToken && repoOwner ? repoOwner : user;
  const gitToken = ownerToken || token;
  const apiUser = user;
  const apiToken = token;
  const resolvedVerificationArea = verificationArea || verification.resolveVerificationAdapter(rootDir).defaultArea;
  const authenticatedGitFetch = /** @param {string} branchName @param {string} dir @param {{user?: string, token?: string}} [options] */ (branchName: string, dir: string, options: any = {}) => fetchReviewBranch(branchName, dir, {
    ...options,
    user: gitUser,
    token: gitToken,
  });

  const proofResult = captureVerifiedTreeProofFn(resolvedVerificationArea, rootDir);
  if (!proofResult.ok) {
    return {
      ok: false,
      error: proofResult.error || 'failed to verify publish tree',
      ...(proofResult.command && proofResult.cwd ? {
        gateFailure: {
          area: resolvedVerificationArea,
          command: proofResult.command,
          cwd: proofResult.cwd,
          exitCode: proofResult.exitCode ?? null,
          stdout: proofResult.stdout || '',
          stderr: proofResult.stderr || '',
          ...(verification.isTransientVerificationFailure(proofResult) ? { transient: true } : {}),
        },
      } : {}),
    };
  }
  if (proofResult.proof && proofResult.proof.branch && proofResult.proof.branch !== branch) {
    return { ok: false, error: `verification proof branch ${proofResult.proof.branch} does not match branch being published ${branch}` };
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
    return { ok: false, error: (pushArgsResult as {ok: boolean, pushArgs: string[], error?: string}).error };
  }
  let pushArgs = (pushArgsResult as {ok: boolean, pushArgs: string[], error?: string}).pushArgs || [];
  let pushResult = git(pushArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: cLocaleEnv() });
  if (pushResult.stdout) {process.stdout.write(pushResult.stdout);}
  if (pushResult.stderr) {process.stderr.write(pushResult.stderr);}

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
        return { ok: false, error: (pushArgsResult as {ok: boolean, pushArgs: string[], error?: string}).error };
      }
      pushArgs = (pushArgsResult as {ok: boolean, pushArgs: string[], error?: string}).pushArgs || [];
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
    const apiErr = (existingPrLookup as any)._apiError || {};
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
function getPrNumber(branch: string, token: string | null, options: any = {}): number | null | { _apiError?: object, _notFound?: boolean } {
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
function getPrAuthor(branch: string, token: string, options: any = {}): string | null {
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
function resolvePrAccess(branch: string, token: string | null, options: any = {}): { prNumber?: number, token?: string, _apiError?: object, _notFound?: boolean } | null {
  const {
    apiCall = forgejoApi,
    pageSize = 50,
    maxPages = 50,
    slug = null,
    onlyOpen = false,
    forgejoUser,
    rootDir = process.cwd()
  } = options;

  let lastApiError: { status?: number, statusCode?: number, error?: string, stderr?: string|null } | null = null;
  let sawSuccessfulLookup = false;

  /** @param {string} state @param {string} t */
  const searchInState = (state: string, t: string) => {
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
  const doLookup = (t: string) => {
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
    const taskFile = findTaskFile(slug, rootDir);
    const implementer = taskFile ? getTaskImplementer(taskFile) : null;
    const repoOwner = resolveForgejoSettings(rootDir).repo.split('/')[0] || null;
    const candidates = [implementer, repoOwner, DEFAULT_FORGEJO_USER].filter((u): u is string => Boolean(u) && u !== currentUser);

    for (const user of candidates) {
      triedUsers.push(user);
      const fallbackToken = readToken(user, rootDir);
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
    fmt.log.info(`Current environment: FORGEJO_URL=${settings.url}, FORGEJO_REPO=${settings.repo}, FORGEJO_HOME=${resolveForgejoHome(rootDir)}`);
    if (lastApiError) {
      const err = lastApiError as { status?: number, error?: string, stderr?: string };
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
function listOpenPrsForSlug(baseSlug: string, token: string, options: any = {}): Array< { number: number, title: string, html_url: string, head: string } > {
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
function isApiErrorResult(result: { _apiError?: object, _notFound?: boolean }): boolean {
  return Boolean(result && typeof result === 'object' && result._apiError && result._notFound === true);
}

/**
 * @param {string} user
 * @param {string} token
 * @param {string} rootDir
 * @returns {string}
 */
function authenticatedReviewUrl(user: string, token: string, rootDir?: string) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
  const url = new URL(forgejoUrl);
  const protocol = url.protocol;
  const host = url.host; // includes port if present

  return `${protocol}//${user}:${token}@${host}/${forgejoRepo}.git`;
}


/** @param {string} rootDir @returns {string|null} */
function reviewRemoteUrl(rootDir?: string) {
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
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
function getLatestReview(branch: string, reviewerUser: string, sinceIso: string, token: string, options: any = {}): { state: string, submittedAt: string } | null {
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
    .filter(/** @param {{user?: {login?: string}, submitted_at?: string, created_at?: string, state?: string}} r */ (r: any) => {
      const user = (r.user || {}).login;
      const submittedAt = r.submitted_at || r.created_at || '';
      const submitted = submittedAt ? new Date(submittedAt).getTime() : 0;
      return user === reviewerUser && submitted >= since;
    })
    .map(/** @param {{state?: string, submitted_at?: string, created_at?: string}} r */ (r: any) => ({ state: r.state, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a: any, b: any) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

/**
 * @param {string} branch
 * @param {{forgejoUser?: string, token?: string, apiCall?: Function, rootDir?: string, reviewerUser?: string}} [options]
 * @returns {{ok: boolean, error?: string, reviewState?: string|null, prNumber?: number, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, reviewerApproved?: boolean, reviewerApprovedAt?: string, raw?: string}}
 */
function getLatestReviewDecision(branch: string, options: any = {}): { ok: boolean, error?: string, reviewState?: string | null, prNumber?: number, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, reviewerApproved?: boolean, reviewerApprovedAt?: string, raw?: string } {
  /** @type {{forgejoUser?: string, token?: string, apiCall?: Function, rootDir?: string, reviewerUser?: string}} */
  const {
    forgejoUser,
    token: providedToken,
    apiCall = forgejoApi,
    rootDir = process.cwd(),
    reviewerUser
  } = options;

  const slugMatch = branch.match(/^mission\/(task-\d+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  const { token } = resolveForgejoAuth({ forgejoUser, token: providedToken, rootDir });
  if (!token) {
    return { ok: false, error: 'missing-token', reviewState: null };
  }

  const prAccess = resolvePrAccess(branch, token, { apiCall, slug, forgejoUser, rootDir });
  if (prAccess && isApiErrorResult(prAccess)) {
    const apiErr = (prAccess as any)._apiError || {};
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
    .map(/** @param {{user?: {login?: string}, state?: string, submitted_at?: string, created_at?: string, dismissed?: boolean}} review */ (review: any) => ({
      user: (review.user || {}).login || '?',
      state: review.state || '',
      submittedAt: review.submitted_at || review.created_at || '',
      dismissed: !!review.dismissed
    }))
    .filter(/** @param {{state: string, submittedAt: string, dismissed: boolean}} review */ (review: any) => review.state && review.submittedAt && !review.dismissed)
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a: any, b: any) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  if (reviews.length === 0) {
    return { ok: true, prNumber, reviewState: null, defaultUserApproved: false };
  }

  // Find the latest formal decision overall
  const formalReviews = reviews.filter(/** @param {{state: string}} r */ (r: any) => r.state === 'APPROVED' || r.state === 'REQUEST_CHANGES');

  const finalState = formalReviews.length > 0
    ? formalReviews[formalReviews.length - 1].state
    : reviews[reviews.length - 1].state;

  // TASK-2379: the override is a real provider decision; carry its own
  // authoritative timestamp so recovery can persist it as a ReviewerDecision
  // at that time. Review round 1 (F2): the approval stays valid only while
  // the default user's own latest non-dismissed formal review is APPROVED —
  // a later REQUEST_CHANGES by the same user supersedes it, and recovery
  // must not persist a retracted approval as an authoritative decision.
  const defaultUserFormal = formalReviews
    .filter(/** @param {{user: string, state: string}} r */ (r: any) => r.user === defaultUserLogin);
  const latestDefaultUserFormal = defaultUserFormal.length > 0
    ? defaultUserFormal[defaultUserFormal.length - 1]
    : null;
  const defaultUserApproved = latestDefaultUserFormal !== null && latestDefaultUserFormal.state === 'APPROVED';
  const defaultUserApprovedAt = defaultUserApproved && latestDefaultUserFormal
    ? latestDefaultUserFormal.submittedAt
    : undefined;

  // TASK-2420: recovery must also recognize an APPROVED posted by the
  // assigned/configured reviewer (e.g. qwen), not only the repo default user
  // ('human'). The assigned reviewer's login is resolved deterministically from
  // the recorded Review round identity (see resolveForgejoUserForIntegration),
  // never from caller-supplied context, so it cannot be forged (fail-closed,
  // ADR 0048). The reviewer approval rides alongside defaultUserApproved as a
  // separate field, attached only when the caller asks for the assigned
  // reviewer (reviewerUser), so the whole-object shape callers that compare it
  // whole stays byte-identical to the pre-TASK-2420 result. The same
  // supersedes rule applies: a later REQUEST_CHANGES by the same assigned
  // reviewer retracts the approval, exactly as for the default user.
  const decision: { ok: boolean, prNumber?: number, reviewState: string, defaultUserApproved: boolean, defaultUserApprovedAt?: string, reviewerApproved?: boolean, reviewerApprovedAt?: string } = {
    ok: true,
    prNumber,
    reviewState: finalState,
    defaultUserApproved,
  };
  // The override carries its own authoritative timestamp; the property stays
  // absent (not `undefined`) when there is no default-user approval, keeping
  // the pre-TASK-2379 result shape for callers that compare it whole.
  if (defaultUserApprovedAt) {
    decision.defaultUserApprovedAt = defaultUserApprovedAt;
  }
  if (reviewerUser) {
    const reviewerFormal = formalReviews.filter((r: any) => r.user === reviewerUser);
    const latestReviewerFormal = reviewerFormal.length > 0 ? reviewerFormal[reviewerFormal.length - 1] : null;
    const reviewerApproved = latestReviewerFormal !== null && latestReviewerFormal.state === 'APPROVED';
    decision.reviewerApproved = reviewerApproved;
    if (reviewerApproved && latestReviewerFormal) {
      // Present only when the assigned reviewer actually holds a standing
      // approval; absent otherwise so callers can distinguish "not asked"
      // (undefined) from "asked, no approval" (false).
      decision.reviewerApprovedAt = latestReviewerFormal.submittedAt;
    }
  }
  return decision;
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
function getLatestDisposition(branch: string, implementerUser: string, sinceIso: string, token: string, options: any = {}): string | null {
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
    .filter(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c: any) => {
      const user = (c.user || {}).login;
      const createdStr = c.created_at || '';
      const created = createdStr ? new Date(createdStr).getTime() : 0;
      const body = c.body || '';
      return user === implementerUser && created >= since && DISPOSITION_PATTERN.test(body);
    })
    .map(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c: any) => {
      const match = DISPOSITION_PATTERN.exec(c.body || '');
      return { disposition: match ? match[1] : null, createdAt: c.created_at || '' };
    })
    .filter(/** @param {{disposition: string|null}} e */ (e: any) => e.disposition)
    .sort(/** @param {{createdAt: string}} a @param {{createdAt: string}} b */ (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1].disposition : null;
}


async function getLatestReviewForPr(prNumber: number, reviewerUser: string, sinceIso: string, token: string, options: any = {}) {
  /** @type {{apiCall?: Function}} */
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall('GET', `/pulls/${prNumber}/reviews`, token);
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, submitted_at?: string, created_at?: string, state?: string}} r */ (r: any) => {
      const user = (r.user || {}).login;
      const submittedAt = r.submitted_at || r.created_at || '';
      const submitted = submittedAt ? new Date(submittedAt).getTime() : 0;
      return user === reviewerUser && submitted >= since;
    })
    .map(/** @param {{state?: string, submitted_at?: string, created_at?: string}} r */ (r: any) => ({ state: r.state, submittedAt: r.submitted_at || r.created_at || '' }))
    .sort(/** @param {{submittedAt: string}} a @param {{submittedAt: string}} b */ (a: any, b: any) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}


async function getLatestDispositionForPr(prNumber: number, implementerUser: string, sinceIso: string, token: string, options: any = {}) {
  /** @type {{apiCall?: Function}} */
  const {
    apiCall = forgejoApiAsync
  } = options;

  const result = await apiCall('GET', `/issues/${prNumber}/comments`, token);
  if (!result.ok || !Array.isArray(result.data)) {return null;}

  const since = new Date(sinceIso).getTime();

  const eligible = result.data
    .filter(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c: any) => {
      const user = (c.user || {}).login;
      const createdAt = c.created_at || '';
      const created = createdAt ? new Date(createdAt).getTime() : 0;
      const body = c.body || '';
      return user === implementerUser && created >= since && DISPOSITION_PATTERN.test(body);
    })
    .map(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c: any) => {
      const match = DISPOSITION_PATTERN.exec(c.body || '');
      return { disposition: match ? match[1] : null, createdAt: c.created_at || '' };
    })
    .filter(/** @param {{disposition: string|null}} e */ (e: any) => e.disposition)
    .sort(/** @param {{createdAt: string}} a @param {{createdAt: string}} b */ (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return eligible.length > 0 ? eligible[eligible.length - 1].disposition : null;
}

/**
 * Post a comment on the Forgejo PR for a given branch.
 *
 * @param {string} branch  - Mission branch (e.g. 'mission/architecture migration')
 * @param {string} token   - Forgejo PAT
 * @param {string} body    - Comment body (markdown)
 * @returns {{ ok: boolean, data: any, status: number|null, error?: string, raw?: string }}
 */
function postComment(branch: string, token: string, body: string, options: any = {}): { ok: boolean, data: any, status: number | null, error?: string, raw?: string } {
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
 * @param {string} branch   - Mission branch (e.g. 'mission/architecture migration')
 * @param {string} token    - Forgejo PAT
 * @param {string} outcome  - 'approve' | 'request-changes' | 'comment'
 * @param {string} summary  - Review summary text
 * @returns {{ ok: boolean, data: any, status: number|null, error?: string, raw?: string }}
 */
function postReview(branch: string, token: string, outcome: string, summary: string, options: any = {}): { ok: boolean, data: any, status: number | null, error?: string, raw?: string } {
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

  const event = /** @type {'APPROVED'|'REQUEST_CHANGES'|'COMMENT'|undefined} */ (REVIEW_OUTCOME_MAP[outcome as keyof typeof REVIEW_OUTCOME_MAP]);
  if (!event) {return { ok: false, data: null, status: null, error: `unsupported-outcome: ${outcome}` };}

  /** @type {{body: string, event: string, commit_id?: string|null}} */
  const payload: any = { body: summary, event };
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
 * Retrieve all comments (issue, review, and inline) for a given branch.
 *
 * @param {string} branch  - Mission branch
 * @param {string} token   - Forgejo PAT
 * @param {object} [options]
 * @param {Function} [options.apiCall] - Forgejo API function, injectable for tests
 * @param {Function} [options.log]     - Logger, injectable for tests
 * @returns {any[]|null} - Array of comment objects sorted by creation time, or null if comments could not be fetched
 */
function getCommentsSync(branch: string, token: string, options: any = {}): any[] | null {
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
    logger(`getComments API error resolving PR for ${branch}: status=${((prAccess as any)._apiError || {}).status || 0}`);
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
  issueComments.forEach(/** @param {{user?: {login?: string}, created_at?: string, body?: string}} c */ (c: any) => {
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
      inlineRes.data.forEach(/** @param {{user?: {login?: string}, created_at?: string, body?: string, path?: string, line?: number, original_line?: number}} c */ (c: any) => {
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

  return allComments.sort(/** @param {{created: string}} a @param {{created: string}} b */ (a: any, b: any) => a.created.localeCompare(b.created));
}


async function getComments(branch: string, token: string, options: any = {}) {
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
    const apiErr = (prNumber as any)._apiError || {};
    fmt.log.warn(`API error resolving PR for ${fmt.branch(branch)}: status=${(apiErr as {status?: number}).status || 0}${((apiErr as {status?: number}).status || 0) === 7 ? ` (${codexSandboxHint()})` : ''}`);
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
export { getLatestReviewDecision };
export { getLatestDisposition };
export { getLatestDispositionForPr };
export { postComment };
export { REVIEW_OUTCOME_MAP };
export { postReview };
export { getCommentsSync };
export { getComments };
export { closePr };
