/**
 * Review Artifacts Module - Utility Functions
 * Extracted from parallix/lib/review.js for task-1201
 * Handles artifact path resolution, file I/O, and normalization.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const fmt = require('../core/fmt');
const { missionBranchName, resolveWorktree } = require('../core/mission-utils');
const { readReviewState, writeReviewState, reviewStateFile, ReviewState, resolveReviewIdentity } = require('./review-state');
const { readToken, postComment, postReview, getPrAuthor, isEnabled, resolveArtifactDir: resolveConfiguredArtifactDir } = require('./review-adapter');
const { createEvent, consumeHumanNotes, VALID_EVENT_TYPES } = require('./review-events');

// ============================================================================
// Metadata Footer
// ============================================================================

function buildMetadataFooter(slug, rootDir) {
  const state = readReviewState(slug, rootDir);
  if (!state) {return '';}
  return `\n\n---\n\`[workflow-round:${state.round}, workflow-phase:${state.phase}]\``;
}

// ============================================================================
// Artifact Path Utilities
// ============================================================================

function reviewArtifactPath(slug, artifactName, tmpDir = os.tmpdir()) {
  return path.join(tmpDir, `${slug}-${artifactName}`);
}

// Agents are instructed by parallix/prompts/*.md to write review/act-on-review
// artifacts to the resolved artifact dir ({{artifactDir}}). The consumers read
// from os.tmpdir() by default, which diverges from /tmp whenever TMPDIR is set
// (CI runners, sandboxes); under the OLD prompts that hardcoded /tmp this left
// artifacts unseen and the review loop reported "no formal review outcome".
// Resolve from the configured tmpDir first, then fall back to the /tmp path the
// old prompts advertised. The fallback is normally skipped when a caller passes
// an explicit tmpDir, so unit tests that point at their own scratch dir are
// unaffected — but the review loop opts back in via `fallbackToTmp: true` so the
// /tmp safety net still protects pre-existing/old-prompt artifacts even though
// the loop passes the resolved default dir explicitly. This is defense-in-depth:
// once the prompts substitute {{artifactDir}}, producer and consumer share one
// dir by construction and this fallback is rarely exercised.
function resolveArtifactRead(slug, artifactName, { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn }) {
  const primaryPath = reviewArtifactPath(slug, artifactName, tmpDir);
  const primaryValue = readArtifactFn(primaryPath);
  const allowTmpFallback = (!explicitTmpDir || fallbackToTmp) && tmpDir !== '/tmp';
  if (primaryValue !== null || !allowTmpFallback) {
    return { path: primaryPath, value: primaryValue };
  }
  const fallbackPath = reviewArtifactPath(slug, artifactName, '/tmp');
  const fallbackValue = readArtifactFn(fallbackPath);
  if (fallbackValue !== null) {
    return { path: fallbackPath, value: fallbackValue };
  }
  return { path: primaryPath, value: null };
}

/**
 * Resolve the directory where review artifacts (review-findings.md,
 * review-outcome.md, review-verdict.txt, round-resolution.md,
 * review-disposition.txt) are written and consumed.
 *
 * Reads `adapters.review.tmpDir` from workflow.config.json when present so a
 * downstream repo can pin a single, portable artifact location that the review
 * prompt and the consumer agree on. A relative configured value is resolved
 * against the repo root. Falls back to `os.tmpdir()` when unconfigured, which
 * preserves the historical default for every existing caller.
 *
 * @param {string} [rootDir]
 * @returns {string} absolute artifact directory
 */
function resolveArtifactDir(rootDir = process.cwd()) {
  return resolveConfiguredArtifactDir(rootDir);
}

function readArtifactFile(filePath, readFileSync = fs.readFileSync) {
  try {
    const value = readFileSync(filePath, 'utf8');
    return typeof value === 'string' ? value.trim() : '';
  } catch (_) {
    return null;
  }
}

function deleteArtifactFile(filePath, unlinkSync = fs.unlinkSync) {
  try {
    unlinkSync(filePath);
  } catch (_) {
    // Best-effort cleanup only.
  }
}

// ============================================================================
// Normalization Utilities
// ============================================================================

function normalizeReviewVerdict(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['approve', 'request-changes', 'comment'].includes(normalized) ? normalized : null;
}

function normalizeDisposition(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['CHANGES_MADE', 'PUSHBACK_ALL', 'PARKED', 'BLOCKED'].includes(normalized) ? normalized : null;
}

// ============================================================================
// Workflow Comment/Review Posting
// ============================================================================

function postWorkflowComment(slug, message, options = {}) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readTokenFn = options.readTokenFn || readToken;
  const postCommentFn = options.postCommentFn || postComment;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const rootDir = options.rootDir || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, rootDir);
  const reviewIdentity = options.reviewIdentity
    || options.forgejoUser
    || resolveReviewIdentity(slug, rootDir, { readReviewStateFn }).commentIdentityUser
    || 'human';
  const token = readTokenFn(reviewIdentity, { rootDir });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot post comment.`));
    return { ok: false };
  }

  const taggedMessage = message + buildMetadataFooterFn(slug, rootDir);
  log(fmt.status('INFO', `Posting PR comment on ${branch} as ${reviewIdentity}...`));
  const result = postCommentFn(branch, token, taggedMessage, { forgejoUser: reviewIdentity, reviewIdentity });
  if (!result.ok) {
    error(fmt.status('FAIL', `Could not post comment: ${result.error || 'API error'}`));
    return { ok: false, error: result.error || 'API error' };
  }

  log(fmt.status('PASS', `Comment posted on PR for ${branch}.`));
  return { ok: true };
}

// Build a diagnosable error string from a failed provider API result, surfacing
// the real HTTP status and response body (e.g. `422 approve your own pull is not
// allowed`) instead of masking it behind a generic "API error". Falls back to
// the result's own error/raw fields, then "API error" when nothing is present.
function describeProviderFailure(result) {
  if (!result || typeof result !== 'object') {return 'API error';}
  // Prefer the HTTP status code (statusCode) over curl's process status.
  const httpStatus = (result.statusCode !== null && Number(result.statusCode) > 0)
    ? result.statusCode
    : (result.status !== null && Number(result.status) >= 100 ? result.status : null);
  let body = null;
  if (result.data && typeof result.data === 'object') {
    body = result.data.message || JSON.stringify(result.data);
  } else if (typeof result.data === 'string' && result.data) {
    body = result.data;
  }
  const parts = [];
  if (httpStatus !== null) {parts.push(String(httpStatus));}
  if (body) {parts.push(body);}
  if (parts.length) {return parts.join(' ');}
  return result.error || result.raw || 'API error';
}

// Record a review verdict in local review-state.json / review-events without
// posting to the review provider. Used by the self-author skip path so the verdict is still
// captured even though the formal provider approval is intentionally not posted.
function recordLocalReviewVerdict(slug, outcome, options = {}) {
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const createEventFn = options.createEventFn || createEvent;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;

  const existing = readReviewStateFn(slug, worktree);
  const state = existing instanceof ReviewState
    ? existing
    : new ReviewState(slug, existing || {
        reviewer: options.reviewer,
        implementer: options.reviewer,
        round: 1,
        phase: 'reviewing',
      });
  if (outcome === 'approve') {
    state.disposition = 'APPROVED';
    try { state.transitionTo('approved'); } catch (_) {}
  } else if (outcome === 'request-changes') {
    state.disposition = 'REQUEST_CHANGES';
    try { state.transitionTo('fixing'); } catch (_) {}
  }
  writeReviewStateFn(slug, state, worktree);

  // Verdict values (approve/request-changes/comment) map 1:1 to outcome values.
  createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, { verdict: outcome }, { worktree, log, error });
}

function postWorkflowReview(slug, outcome, message, options = {}) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readTokenFn = options.readTokenFn || readToken;
  const postReviewFn = options.postReviewFn || postReview;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);
  const reviewIdentity = options.reviewIdentity
    || options.forgejoUser
    || resolveReviewIdentity(slug, worktree, { readReviewStateFn }).identityUser
    || 'human';
  const token = readTokenFn(reviewIdentity, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot submit review.`));
    return { ok: false };
  }

  // Self-approval guard: Forgejo rejects a formal review when the reviewer is
  // also the PR author (HTTP 422 "approve your own pull is not allowed"). This
  // arises under the legitimate same-agent-reviewer fallback. Detect it up front
  // and skip the POST — recording the verdict locally instead of 422-ing — and
  // WARN that a different agent or human must post the formal approval. Degrade
  // safely: if the author cannot be resolved, treat it as "not self" and POST.
  const getPrAuthorFn = options.getPrAuthorFn || getPrAuthor;
  let prAuthor = null;
  try {
    prAuthor = getPrAuthorFn(branch, token, { forgejoUser: reviewIdentity, reviewIdentity, rootDir: worktree });
  } catch (_) {
    prAuthor = null;
  }
  if (prAuthor && prAuthor === reviewIdentity) {
    log(fmt.status('WARN', `Reviewer "${reviewIdentity}" is the PR author for ${branch}; skipping the provider review POST to avoid a self-approval (Forgejo rejects "approve your own pull is not allowed" with HTTP 422). Recording the "${outcome}" verdict locally in review-state.json / review-events; a different agent or a human must post the formal approval.`));
    recordLocalReviewVerdict(slug, outcome, {
      worktree,
      reviewer: reviewIdentity,
      writeReviewStateFn: options.writeReviewStateFn,
      createEventFn: options.createEventFn,
      readReviewStateFn,
      log,
      error,
    });
    return { ok: true, skipped: true, reason: 'self-author', prAuthor };
  }

  const taggedMessage = message + buildMetadataFooterFn(slug, worktree);
  log(fmt.status('INFO', `Submitting review outcome "${outcome}" on ${branch} as ${reviewIdentity}...`));
  const result = postReviewFn(branch, token, outcome, taggedMessage, { forgejoUser: reviewIdentity, reviewIdentity });
  if (!result.ok) {
    const failureDetail = describeProviderFailure(result);
    error(fmt.status('FAIL', `Could not submit review: ${failureDetail}`));
    return { ok: false, error: failureDetail };
  }

  log(fmt.status('PASS', `Review outcome "${outcome}" posted on PR for ${branch}.`));
  return { ok: true };
}

// ============================================================================
// Artifact Consumption
// ============================================================================

async function consumeReviewerArtifacts(slug, reviewer, options = {}) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const explicitTmpDir = options.tmpDir !== null && options.tmpDir !== undefined;
  const fallbackToTmp = options.fallbackToTmp === true;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = options.providerEnabled !== null && options.providerEnabled !== undefined
    ? options.providerEnabled
    : (options.forgejoEnabled !== null && options.forgejoEnabled !== undefined ? options.forgejoEnabled : isEnabled(worktree));
  const reviewStatePath = reviewStateFile(slug, worktree);

  const findingsResolved = resolveArtifactRead(slug, 'review-findings.md', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
  const outcomeResolved = resolveArtifactRead(slug, 'review-outcome.md', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
  const verdictResolved = resolveArtifactRead(slug, 'review-verdict.txt', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
  const findingsPath = findingsResolved.path;
  const outcomePath = outcomeResolved.path;
  const verdictPath = verdictResolved.path;

  const findings = findingsResolved.value;
  const outcomeMessage = outcomeResolved.value;
  const verdictRaw = verdictResolved.value;
  
  // Extract verdict from outcome message if review-verdict.txt is not provided
  // This allows a single review-outcome.md file to contain both the outcome and verdict
  let verdict = normalizeReviewVerdict(verdictRaw);
  if (!verdict && outcomeMessage) {
    // Try to extract verdict from outcome content (e.g., "Verdict: approve" or frontmatter)
    const outcomeVerdictMatch = outcomeMessage.match(/^verdict:\s*(approve|request-changes|comment)/im) ||
                               outcomeMessage.match(/Verdict:\s*(approve|request-changes|comment)/i);
    if (outcomeVerdictMatch) {
      verdict = normalizeReviewVerdict(outcomeVerdictMatch[1]);
    }
  }
  
  const hasAny = findings !== null || outcomeMessage !== null || verdictRaw !== null;

  if (!hasAny) {
    return { consumed: false };
  }
  if (!findings || !outcomeMessage) {
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.`));
    }
    return { consumed: true, ok: false };
  }
  if (!verdict) {
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.`));
    }
    return { consumed: true, ok: false };
  }

  // Get current review state for round/phase metadata
  const currentState = readReviewState(slug, worktree);
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'reviewing';

  // SC 2: Persist to repo-owned store BEFORE provider mirroring
  // This ensures durable storage even if provider publication fails
  const createEventFn = options.createEventFn || createEvent;
  const findingsEventResult = createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: findings,
    round,
    phase,
    actor: reviewer
  }, {
    worktree,
    skipGit: true,  // Let the caller handle git; we just need the file persisted
    log,
    error
  });

  if (!findingsEventResult.ok) {
    error(fmt.status('FAIL', `Failed to persist reviewer findings to repo store: ${findingsEventResult.error}`));
    return { consumed: true, ok: false };
  }

  const outcomeEventResult = createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: outcomeMessage,
    round,
    phase,
    actor: reviewer,
    verdict
  }, {
    worktree,
    skipGit: true,
    log,
    error
  });

  if (!outcomeEventResult.ok) {
    error(fmt.status('FAIL', `Failed to persist reviewer outcome to repo store: ${outcomeEventResult.error}`));
    return { consumed: true, ok: false };
  }

  log(fmt.status('INFO', `Persisted reviewer artifacts to repo store: ${findingsEventResult.path}, ${outcomeEventResult.path}`));

  // SC 6: Classify human comments before mirroring (best-effort)
  // Only read provider comments when a provider is enabled.
  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, reviewer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn,
      readTokenFn: options.readTokenFn,
      reviewIdentity: reviewer,
      worktree,
      log,
      error
    });
  }

  // Mirror to the configured review provider (SC 4) when enabled.
  if (providerEnabled) {
    // Both reviewer_findings and reviewer_outcome are mirrored
    const commentResult = postWorkflowComment(slug, findings, {
      rootDir: worktree,
      reviewIdentity: reviewer,
      readTokenFn: options.readTokenFn,
      postCommentFn: options.postCommentFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log,
      error
    });
    if (!commentResult.ok) {
      return { consumed: true, ok: false };
    }

    const reviewResult = postWorkflowReview(slug, verdict, outcomeMessage, {
      worktree,
      reviewIdentity: reviewer,
      readTokenFn: options.readTokenFn,
      postReviewFn: options.postReviewFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log,
      error
    });
    if (!reviewResult.ok) {
      return { consumed: true, ok: false };
    }
  } else {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  deleteArtifactFn(findingsPath);
  deleteArtifactFn(outcomePath);
  deleteArtifactFn(verdictPath);

  if (verdict === 'approve') {return { consumed: true, ok: true, reviewState: 'APPROVED' };}
  if (verdict === 'request-changes') {return { consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' };}
  // Defensive fallback: a stray `comment` verdict (prompts no longer offer it) cannot be
  // resolved via provider polling when the provider is disabled, so normalize it to the
  // disposition format and pass it through. inferPhaseFromDisposition() maps COMMENT -> fixing.
  if (!providerEnabled) {
    const reviewState = verdict.toUpperCase().replace(/-/g, '_');
    log(fmt.status('INFO', `Reviewer ${reviewer} produced verdict "${verdict}" with the provider disabled; normalizing to ${reviewState} for loop control.`));
    return { consumed: true, ok: true, reviewState };
  }
  log(fmt.status('WARN', `Reviewer ${reviewer} produced verdict "${verdict}". Falling back to provider polling for loop control.`));
  return { consumed: true, ok: true, reviewState: null };
}

async function consumeImplementerArtifacts(slug, implementer, options = {}) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const explicitTmpDir = options.tmpDir !== null && options.tmpDir !== undefined;
  const fallbackToTmp = options.fallbackToTmp === true;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = options.providerEnabled !== null && options.providerEnabled !== undefined
    ? options.providerEnabled
    : (options.forgejoEnabled !== null && options.forgejoEnabled !== undefined ? options.forgejoEnabled : isEnabled(worktree));
  const reviewStatePath = reviewStateFile(slug, worktree);

  const resolutionResolved = resolveArtifactRead(slug, 'round-resolution.md', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
  const dispositionResolved = resolveArtifactRead(slug, 'review-disposition.txt', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
  const resolutionPath = resolutionResolved.path;
  const dispositionPath = dispositionResolved.path;

  const resolution = resolutionResolved.value;
  const dispositionRaw = dispositionResolved.value;
  const disposition = normalizeDisposition(dispositionRaw);
  const hasAny = resolution !== null || dispositionRaw !== null;

  if (!hasAny) {
    return { consumed: false };
  }
  if (!resolution || !disposition) {
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.${statePathStr}No provider review posted (provider=none); add review-disposition.txt and a round resolution, or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.`));
    }
    return { consumed: true, ok: false };
  }

  // Get current review state for round/phase metadata
  const currentState = readReviewState(slug, worktree);
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'fixing';

  // SC 2: Persist to repo-owned store BEFORE provider mirroring
  // This ensures durable storage even if provider publication fails
  const createEventFn = options.createEventFn || createEvent;
  
  // Parse resolution content to extract structured fields if present
  // SC 5: Validate mirrored content includes required fields
  let fixedItems = [];
  let pushedBackItems = [];
  let parkedItems = [];
  let blockedReason = null;
  
  try {
    // Try to extract from frontmatter or structured content
    const fixedMatch = resolution.match(/fixed_items:\s*(\[[^\]]*\])/i);
    const pushedMatch = resolution.match(/pushed_back_items:\s*(\[[^\]]*\])/i);
    const parkedMatch = resolution.match(/parked_items:\s*(\[[^\]]*\])/i);
    const blockedMatch = resolution.match(/blocked_reason:\s*"([^"]*)"/i);
    
    if (fixedMatch) {fixedItems = JSON.parse(fixedMatch[1]);}
    if (pushedMatch) {pushedBackItems = JSON.parse(pushedMatch[1]);}
    if (parkedMatch) {parkedItems = JSON.parse(parkedMatch[1]);}
    if (blockedMatch) {blockedReason = blockedMatch[1];}
  } catch (_) {
    // If parsing fails, use empty arrays
    fixedItems = [];
    pushedBackItems = [];
    parkedItems = [];
  }

  // For BLOCKED disposition, blockedReason is required
  if (disposition === 'BLOCKED' && !blockedReason) {
    // Check if it's in the resolution content
    const match = resolution.match(/blocked.*?:\s*(.+)/i);
    if (match) {blockedReason = match[1].trim();}
  }

  const summaryEventResult = createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY, {
    content: resolution,
    round,
    phase,
    actor: implementer,
    fixedItems,
    pushedBackItems,
    parkedItems,
    ...(disposition === 'BLOCKED' && blockedReason ? { blockedReason } : {})
  }, {
    worktree,
    skipGit: true,
    log,
    error
  });

  if (!summaryEventResult.ok) {
    error(fmt.status('FAIL', `Failed to persist implementer round summary to repo store: ${summaryEventResult.error}`));
    return { consumed: true, ok: false };
  }

  const dispositionEventResult = createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: `Autonomous review disposition: ${disposition}`,
    round,
    phase,
    actor: implementer,
    disposition
  }, {
    worktree,
    skipGit: true,
    log,
    error
  });

  if (!dispositionEventResult.ok) {
    error(fmt.status('FAIL', `Failed to persist implementer disposition to repo store: ${dispositionEventResult.error}`));
    return { consumed: true, ok: false };
  }

  log(fmt.status('INFO', `Persisted implementer artifacts to repo store: ${summaryEventResult.path}, ${dispositionEventResult.path}`));

  // SC 6: Classify human comments before mirroring (best-effort)
  // Only read provider comments when a provider is enabled.
  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, implementer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn,
      readTokenFn: options.readTokenFn,
      reviewIdentity: implementer,
      worktree,
      log,
      error
    });
  }

  // Mirror to the configured review provider (SC 4) when enabled.
  if (providerEnabled) {
    // Both implementer_round_summary and implementer_disposition are mirrored
    const resolutionResult = postWorkflowComment(slug, resolution, {
      rootDir: worktree,
      reviewIdentity: implementer,
      readTokenFn: options.readTokenFn,
      postCommentFn: options.postCommentFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log,
      error
    });
    if (!resolutionResult.ok) {
      return { consumed: true, ok: false };
    }

    const dispositionResult = postWorkflowComment(slug, `Autonomous review disposition: ${disposition}`, {
      rootDir: worktree,
      reviewIdentity: implementer,
      readTokenFn: options.readTokenFn,
      postCommentFn: options.postCommentFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log,
      error
    });
    if (!dispositionResult.ok) {
      return { consumed: true, ok: false };
    }
  } else {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  deleteArtifactFn(resolutionPath);
  deleteArtifactFn(dispositionPath);

  return { consumed: true, ok: true, disposition };
}

// Module exports
module.exports = {
  buildMetadataFooter,
  reviewArtifactPath,
  resolveArtifactDir,
  readArtifactFile,
  deleteArtifactFile,
  normalizeReviewVerdict,
  normalizeDisposition,
  postWorkflowComment,
  postWorkflowReview,
  consumeReviewerArtifacts,
  consumeImplementerArtifacts
};
