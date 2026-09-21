import { git } from '../git/git.js';
import { getPrimaryBranch } from '../filesystem/mission-utils.js';
import * as verification from '../verification/verification.js';
import { resolveForgejoAuth, resolveForgejoUser } from './forgejo-auth.js';
import { forgejoApi, codexSandboxHint } from './forgejo-api.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { authenticatedReviewUrl, getPrNumber, isApiErrorResult } from './forgejo-pr.js';

/**
 * @param {string} user
 * @param {string} token
 * @param {string} rootDir
 * @param {{verificationProof?: object|null, assertVerifiedTreeProofFn?: Function, gitRunner?: Function}} [opts]
 * @returns {{ok: boolean, skipped?: boolean, status?: number, stderr?: string, error?: string|null}}
 */
function syncPrimaryBaseline(user: string, token: string, rootDir: string = process.cwd(), {
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

  const proofCheck = assertVerifiedTreeProofFn(verificationProof as any, rootDir, { gitRunner });
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
  // the review loop. See missions/architecture migration "Required Forgejo fix".
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
function ensureRemoteBaseBranch(baseBranch: string, user: string, token: string, rootDir: string = process.cwd(), {
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
function pushReviewRef(sourceRef: string, destinationRef: string, rootDir: string = process.cwd(), options?: { force?: boolean, forceWithLease?: boolean, forceWithLeaseRef?: string, user?: string, token?: string }) {
  const {
    force = false,
    forceWithLease = false,
    forceWithLeaseRef,
    user,
    token
  } = options || {};
  const remote = token
    ? authenticatedReviewUrl(user || resolveForgejoUser(), token, rootDir)
    : 'review';
  const pushArgs = /** @type {string[]} */ (['-C', rootDir, 'push', remote]);
  if (forceWithLease) {
    // A pinned lease (--force-with-lease=<ref>) rejects a remote SHA that changed
    // between fetch and push instead of overwriting it. A bare --force-with-lease
    // only guards against pushing when the ref is absent, so callers that know
    // the expected remote SHA (base reconciliation) pass forceWithLeaseRef.
    pushArgs.push(forceWithLeaseRef ? `--force-with-lease=${forceWithLeaseRef}` : '--force-with-lease');
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
function fetchReviewBranch(branch: string, rootDir: string = process.cwd(), options: any = {}) {
   const { user, token } = options || {};
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
function resolveTrackingBranchSha(branch: string, rootDir: string = process.cwd()) {
  const candidateRefs = [`refs/remotes/review/${branch}`];
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

function fetchTrackingBranchSha(branch: string, rootDir: string, gitFetch: Function) {
  const result = gitFetch(branch, rootDir);
  if (result.status === 0) { return resolveTrackingBranchSha(branch, rootDir); }
  if (isMissingRemoteRef(result)) { return { ok: true, firstPush: true }; }
  return { ok: false, error: `failed to fetch tracking ref for ${branch}: ${pushOutput(result) || 'git fetch failed'}` };
}

function forceWithLeaseArgument(branch: string, rootDir: string, remoteUrl: string, gitFetch: Function, refreshTrackingRef: boolean): { ok: boolean; pushArgs?: string[]; lease?: string; error?: string } {
  if (refreshTrackingRef) {
    const refreshed = gitFetch(branch, rootDir);
    if (refreshed.status !== 0) {
      if (isMissingRemoteRef(refreshed)) { return { ok: true, pushArgs: ['-C', rootDir, 'push', remoteUrl, branch] }; }
      return { ok: false, error: `failed to refresh tracking ref for ${branch}: ${pushOutput(refreshed) || 'git fetch failed'}` };
    }
  }
  let tracked = resolveTrackingBranchSha(branch, rootDir);
  if (!tracked.ok && !refreshTrackingRef) {
    const fetched: any = fetchTrackingBranchSha(branch, rootDir, gitFetch);
    if (fetched.firstPush) { return { ok: true, pushArgs: ['-C', rootDir, 'push', remoteUrl, branch] }; }
    if (!fetched.ok) { return fetched; }
    tracked = fetched;
  }
  if (!tracked.ok) { return tracked; }
  return { ok: true, lease: `--force-with-lease=refs/heads/${branch}:${tracked.sha}` };
}

/**
 * @param {string} branch
 * @param {string} remoteUrl
 * @param {string} rootDir
 * @param {{force?: boolean, forceWithLease?: boolean, gitFetch?: Function, refreshTrackingRef?: boolean}} [options]
 * @returns {{ok: boolean, pushArgs?: string[], error?: string}}
 */
function buildCreatePrPushArgs(branch: string, remoteUrl: string, rootDir: string = process.cwd(), options: any = {}) {
  /** @type {{force?: boolean, forceWithLease?: boolean, gitFetch?: Function, refreshTrackingRef?: boolean}} */
  const {
    force = false,
    forceWithLease = false,
    gitFetch = fetchReviewBranch,
    refreshTrackingRef = false
  } = options;

  const pushArgs = ['-C', rootDir, 'push'];
  if (forceWithLease) {
    const lease = forceWithLeaseArgument(branch, rootDir, remoteUrl, gitFetch, refreshTrackingRef);
    if (lease.pushArgs || !lease.ok) { return lease; }
    pushArgs.push(lease.lease!);
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
function deleteReviewRef(branch: string, rootDir: string = process.cwd(), options?: { user?: string, token?: string }) {
   const { user, token } = options || {};
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

/**
 * Reconcile Forgejo's recorded base branch with the authoritative local base
 * before the landed commit is pushed (task-2520).
 *
 * Local base is the integration authority; Forgejo is a review mirror. Three
 * outcomes:
 *   - unchanged:  Forgejo base already equals the local base (no push).
 *   - fast-forward: the Forgejo base is an ancestor of the local base, so a
 *     normal push fast-forwards it (SC1).
 *   - force-with-lease: the local base rewrote the Forgejo base (non-ancestor).
 *     A forced update is allowed only when the rewritten tree still contains
 *     every byte of the remote base — commit ancestry alone cannot prove the
 *     discarded remote history had no unique content — and it is pinned to the
 *     freshly fetched SHA with `--force-with-lease=<base>:<fetched-sha>` so a
 *     remote SHA that changes between fetch and push is rejected (Risks).
 *   - overwrite-refused: the diverged Forgejo base holds tree content absent
 *     from the local base. Abort before any force push (SC3).
 */
function reconcileForgejoBase({
  primaryBranch, rootDir, forgejoUser, token, gitFetch, gitRunner, gitPush, log
}: {
  primaryBranch: string;
  rootDir: string;
  forgejoUser: string | undefined;
  token: string | undefined;
  gitFetch: typeof fetchReviewBranch;
  gitRunner: typeof git;
  gitPush: typeof pushReviewRef;
  log: typeof fmt.log.info;
}): { ok: true, action: 'unchanged' | 'fast-forward' | 'force-with-lease', oldSha: string, newSha: string, diagnostic: string } | { ok: false, error: string, raw?: string, remoteSha?: string, localSha?: string, remoteTree?: string, localTree?: string, diagnostic: string } {
  const remoteRef = `refs/remotes/review/${primaryBranch}`;
  // Refresh our view of Forgejo's base before reading or leasing it. A stale
  // lease would let a concurrent base rewrite slip through.
  const fetchResult = gitFetch(primaryBranch, rootDir, { user: forgejoUser, token });
  if (fetchResult.status !== 0) {
    return { ok: false, error: 'forgejo-base-fetch-failed', raw: pushOutput(fetchResult), diagnostic: `Could not fetch Forgejo ${primaryBranch} to reconcile its base: ${pushOutput(fetchResult)}` };
  }
  const localSha = (gitRunner(['-C', rootDir, 'rev-parse', primaryBranch]).stdout || '').trim();
  const fetchedSha = (gitRunner(['-C', rootDir, 'rev-parse', remoteRef]).stdout || '').trim();
  if (!localSha || !fetchedSha) {
    return { ok: false, error: 'forgejo-base-sha-unresolved', diagnostic: `Could not resolve the Forgejo ${primaryBranch} base SHA to reconcile it.` };
  }
  // Already in sync: nothing to reconcile, and the landed-commit push below is a
  // fast-forward onto the current Forgejo base.
  if (fetchedSha === localSha) {
    return { ok: true, action: 'unchanged', oldSha: fetchedSha, newSha: localSha, diagnostic: 'Forgejo base already in sync' };
  }
  // Ancestor: Forgejo base fast-forwards to the local base — a normal push.
  const ancestry = gitRunner(['-C', rootDir, 'merge-base', '--is-ancestor', fetchedSha, localSha]);
  if (ancestry.status === 0) {
    log(`Forgejo ${primaryBranch} ${fetchedSha.slice(0, 12)} is an ancestor of local ${localSha.slice(0, 12)}; fast-forward push.`);
    const push = gitPush(fetchedSha, `refs/heads/${primaryBranch}`, rootDir, { user: forgejoUser, token });
    return push.status === 0
      ? { ok: true, action: 'fast-forward', oldSha: fetchedSha, newSha: localSha, diagnostic: `Fast-forwarded Forgejo ${primaryBranch} ${fetchedSha.slice(0, 12)} to local ${localSha.slice(0, 12)}` }
      : { ok: false, error: 'forgejo-base-push-failed', raw: pushOutput(push), diagnostic: pushOutput(push) };
  }
  // Diverged: the local base rewrote Forgejo's base. Force is required, but only
  // when the rewritten tree still contains every byte of the remote base.
  const remoteTree = (gitRunner(['-C', rootDir, 'rev-parse', `${fetchedSha}^{tree}`]).stdout || '').trim();
  const localTree = (gitRunner(['-C', rootDir, 'rev-parse', `${localSha}^{tree}`]).stdout || '').trim();
  if (remoteTree !== localTree) {
    return {
      ok: false,
      error: 'overwrite-refused',
      remoteSha: fetchedSha,
      localSha: localSha,
      remoteTree,
      localTree,
      raw: `Forgejo ${primaryBranch} ${fetchedSha.slice(0, 12)} diverges from local ${localSha.slice(0, 12)} and holds tree content (${remoteTree}) absent from the local base (${localTree}); refusing force push.`,
      diagnostic: `Refusing to overwrite Forgejo ${primaryBranch} ${fetchedSha.slice(0, 12)}: it holds tree content absent from local ${localSha.slice(0, 12)}. Abort before any force push.`
    };
  }
  // ponytail: the diagnostic prints the full old/new SHAs so an operator can
  // trace what the forced update replaced (SC2) without a separate lookup.
  log(`Forgejo ${primaryBranch} ${fetchedSha.slice(0, 12)} rewritten; tree-equivalent to local ${localSha.slice(0, 12)}; force-with-lease.`);
  const push = gitPush(fetchedSha, `refs/heads/${primaryBranch}`, rootDir, {
    user: forgejoUser,
    token,
    forceWithLease: true,
    forceWithLeaseRef: `${primaryBranch}:${fetchedSha}`
  });
  return push.status === 0
    ? { ok: true, action: 'force-with-lease', oldSha: fetchedSha, newSha: localSha, diagnostic: `Force-pushed Forgejo ${primaryBranch} ${fetchedSha.slice(0, 12)} (force-with-lease) to local ${localSha.slice(0, 12)}` }
    : { ok: false, error: 'forgejo-base-push-failed', raw: pushOutput(push), diagnostic: pushOutput(push) };
}

/** @param {string} commit @param {string} rootDir @returns {*} */
function verifyCommitExists(commit: string, rootDir: string = process.cwd()) {
  return git(['-C', rootDir, 'rev-parse', '--verify', `${commit}^{commit}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** @param {string} commit @param {string} [remoteRef] @param {string} rootDir @returns {*} */
function remoteRefContainsCommit(commit: string, remoteRef: string = `refs/remotes/review/${getPrimaryBranch(process.cwd())}`, rootDir: string = process.cwd()) {
  return git(['-C', rootDir, 'merge-base', '--is-ancestor', commit, remoteRef], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

// inspect, keeping detection language-independent.
/** @returns {Record<string, string>} */
function cLocaleEnv(): Record<string, string> {
  return { ...process.env, LC_ALL: 'C', LANG: 'C' };
}

/** @param {{stderr?: string, stdout?: string}} result @returns {string} */
function pushOutput(result: { stderr?: string, stdout?: string }): string {
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
function isMissingRemoteRef(result: { stderr?: string, stdout?: string }): boolean {
  const output = pushOutput(result).toLowerCase();
  return output.includes('could not find remote ref')
    || output.includes("couldn't find remote ref");
}

/** @param {{status?: number, stderr?: string, stdout?: string}} result @returns {boolean} */
function isStaleInfoPushRejection(result: { status: number | null, stderr?: string, stdout?: string }): boolean {
  return result && result.status !== 0 && /\bstale info\b|\bstale ref\b|fetch first/i.test(pushOutput(result));
}


function syncMerged(branch: string, mergedCommit: string, options: any = {}) {
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
    gitRunner = git,
    log = fmt.log.info
  } = options;

  if (!branch) {
    return { ok: false, error: 'missing-branch' };
  }

  if (!mergedCommit) {
    return { ok: false, error: 'missing-merged-commit' };
  }

  const { token } = resolveForgejoAuth({ forgejoUser, token: providedToken || undefined, rootDir });
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

  const verifyMergeState = (/** @type {number} */ statusCode: any) => {
    const prDetails = apiCall('GET', `/pulls/${prNumber}`, token, undefined, { rootDir });
    if (!prDetails.ok) {
      return { ok: false, error: 'merge-verify-failed', prNumber, statusCode: prDetails.statusCode };
    }

    const pr = prDetails.data || {};
    const baseSha = pr.base ? pr.base.sha : null;
    const headSha = pr.head ? pr.head.sha : null;
    const shaMatch = (/** @type {string|null} */ a: any, /** @type {string|null} */ b: any) => a && b && (a === b || b.startsWith(a));
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
  // Reconcile Forgejo's recorded base with the authoritative local base before
  // the landed commit is pushed (task-2520). Local base is the integration
  // authority; Forgejo is a review mirror. A rewritten or diverged local base
  // otherwise leaves Forgejo's base stale, so the landed-commit push below is a
  // non-fast-forward and fails with `push-primary-failed`. Reconcile first so
  // that push is always a fast-forward (SC1 / SC2). A content-different base is
  // refused before any force push (SC3).
  const reconcile = reconcileForgejoBase({
    primaryBranch,
    rootDir,
    forgejoUser,
    token,
    gitFetch,
    gitRunner,
    gitPush,
    log
  });
  if (!reconcile.ok) {
    log(`PR #${prNumber} (${branch}): ${reconcile.diagnostic}`);
    return reconcile;
  }
  if (reconcile.action === 'force-with-lease' || reconcile.action === 'fast-forward') {
    log(`PR #${prNumber} (${branch}): Forgejo ${primaryBranch} reconciled ${reconcile.oldSha.slice(0, 12)} → ${reconcile.newSha.slice(0, 12)} before landing landed commit.`);
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

export { syncPrimaryBaseline };
export { ensureRemoteBaseBranch };
export { pushReviewRef };
export { fetchReviewBranch };
export { resolveTrackingBranchSha };
export { buildCreatePrPushArgs };
export { deleteReviewRef };
export { verifyCommitExists };
export { remoteRefContainsCommit };
export { syncMerged };
export { cLocaleEnv };
export { pushOutput };
export { isMissingRemoteRef };
export { isStaleInfoPushRejection };
