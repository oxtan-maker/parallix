/**
 * Review Module - Main Entry Point
 * Refactored for task-1201: complexity reduction via service extraction
 *
 * This file now serves as a re-export hub for the extracted sub-modules:
 * - review-commands.ts (command dispatcher and CLI handlers)
 * - review-loop.ts (autonomous review loop orchestration)
 * - review-artifacts.ts (artifact handling and posting)
 * - review-polling.ts (polling utilities)
 */

// Import from review-polling module
import {
  POLL_TIMEOUT,
  delay,
  resolvePollIntervalMs,
  resolvePollTimeoutMs,
  formatElapsed,
  isPollTimeout,
  pollForReview,
  pollForDisposition
} from './review-polling.js';

// Import from review-artifacts module
import {
  buildMetadataFooter,
  reviewArtifactPath,
  readArtifactFile,
  deleteArtifactFile,
  normalizeReviewVerdict,
  normalizeDisposition,
  postWorkflowComment,
  postWorkflowReview,
  consumeReviewerArtifacts,
  consumeImplementerArtifacts
} from './review-artifacts.js';

// Import from review-loop module
import {
  maybeUpdateGraphifyBeforeReview,
  commitSafeMissionArtifacts,
  rebaseBeforeReviewRound,
  applyAgentFallback,
  persistNormalizedPhaseRepair,
  startReviewLoop,
  recordStageStatsSafe
} from './review-loop.js';

// Import from review-commands module
import {
  flagValue,
  readTextFlag,
  formatStaticReviewFindings,
  formatStaticReviewSuccess,
  postStaticReviewComment,
  performStaticReview,
  verifyReview,
  submitForReview,
  readComments,
  pushRound,
  showReviewStatus,
  commentRound,
  submitReviewRound,
  closeMissionPr,
  createEventHandler,
  importLegacyHandler,
  review
} from './review-commands.js';

// Import from review-state module
import {
  reviewStateFile,
  ReviewState
} from './review-state.js';

// ============================================================================
// Module Exports
// ============================================================================
// Set the module exports to the main review function (for backward compatibility)
// then add all other exports as properties

const _review = review as any;

// From review-polling
_review.POLL_TIMEOUT = POLL_TIMEOUT;
_review.delay = delay;
_review.resolvePollIntervalMs = resolvePollIntervalMs;
_review.resolvePollTimeoutMs = resolvePollTimeoutMs;
_review.formatElapsed = formatElapsed;
_review.isPollTimeout = isPollTimeout;
_review.pollForReview = pollForReview;
_review.pollForDisposition = pollForDisposition;

// From review-artifacts
_review.buildMetadataFooter = buildMetadataFooter;
_review.reviewArtifactPath = reviewArtifactPath;
_review.readArtifactFile = readArtifactFile;
_review.deleteArtifactFile = deleteArtifactFile;
_review.normalizeReviewVerdict = normalizeReviewVerdict;
_review.normalizeDisposition = normalizeDisposition;
_review.postWorkflowComment = postWorkflowComment;
_review.postWorkflowReview = postWorkflowReview;
_review.consumeReviewerArtifacts = consumeReviewerArtifacts;
_review.consumeImplementerArtifacts = consumeImplementerArtifacts;

// From review-loop
_review.recordStageStatsSafe = recordStageStatsSafe;
_review.maybeUpdateGraphifyBeforeReview = maybeUpdateGraphifyBeforeReview;
_review.commitSafeMissionArtifacts = commitSafeMissionArtifacts;
_review.rebaseBeforeReviewRound = rebaseBeforeReviewRound;
_review.applyAgentFallback = applyAgentFallback;
_review.persistNormalizedPhaseRepair = persistNormalizedPhaseRepair;
_review.startReviewLoop = startReviewLoop;

// From review-commands
_review.flagValue = flagValue;
_review.readTextFlag = readTextFlag;
_review.formatStaticReviewFindings = formatStaticReviewFindings;
_review.formatStaticReviewSuccess = formatStaticReviewSuccess;
_review.postStaticReviewComment = postStaticReviewComment;
_review.performStaticReview = performStaticReview;
_review.verifyReview = verifyReview;
_review.submitForReview = submitForReview;
_review.readComments = readComments;
_review.pushRound = pushRound;
_review.showReviewStatus = showReviewStatus;
_review.commentRound = commentRound;
_review.submitReviewRound = submitReviewRound;
_review.closeMissionPr = closeMissionPr;
_review.createEventHandler = createEventHandler;
_review.importLegacyHandler = importLegacyHandler;

// From review-state
_review.reviewStateFile = reviewStateFile;
_review.ReviewState = ReviewState;

// Export the review function as the module exports (CJS-compatible)
export = _review;
