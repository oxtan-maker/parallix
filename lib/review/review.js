/**
 * Review Module - Main Entry Point
 * Refactored for task-1201: complexity reduction via service extraction
 * 
 * This file now serves as a re-export hub for the extracted sub-modules:
 * - review-commands.js (command dispatcher and CLI handlers)
 * - review-loop.js (autonomous review loop orchestration)
 * - review-artifacts.js (artifact handling and posting)
 * - review-polling.js (polling utilities)
 */

// Re-export from review-polling module
const { POLL_TIMEOUT, delay, resolvePollIntervalMs, resolvePollTimeoutMs, formatElapsed, isPollTimeout, pollForReview, pollForDisposition } = require('./review-polling');

// Re-export from review-artifacts module
const { buildMetadataFooter, reviewArtifactPath, readArtifactFile, deleteArtifactFile, normalizeReviewVerdict, normalizeDisposition, postWorkflowComment, postWorkflowReview, consumeReviewerArtifacts, consumeImplementerArtifacts } = require('./review-artifacts');

// Re-export from review-loop module
const { maybeUpdateGraphifyBeforeReview, commitSafeMissionArtifacts, rebaseBeforeReviewRound, applyAgentFallback, persistNormalizedPhaseRepair, startReviewLoop, recordStageStatsSafe } = require('./review-loop');

// Re-export from review-commands module
const {
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
} = require('./review-commands');

// ============================================================================
// Module Exports
// ============================================================================
// Set module.exports to the main review function (for backward compatibility)
// then add all other exports as properties

module.exports = review;

// From review-polling
module.exports.POLL_TIMEOUT = POLL_TIMEOUT;
module.exports.delay = delay;
module.exports.resolvePollIntervalMs = resolvePollIntervalMs;
module.exports.resolvePollTimeoutMs = resolvePollTimeoutMs;
module.exports.formatElapsed = formatElapsed;
module.exports.isPollTimeout = isPollTimeout;
module.exports.pollForReview = pollForReview;
module.exports.pollForDisposition = pollForDisposition;

// From review-artifacts
module.exports.buildMetadataFooter = buildMetadataFooter;
module.exports.reviewArtifactPath = reviewArtifactPath;
module.exports.readArtifactFile = readArtifactFile;
module.exports.deleteArtifactFile = deleteArtifactFile;
module.exports.normalizeReviewVerdict = normalizeReviewVerdict;
module.exports.normalizeDisposition = normalizeDisposition;
module.exports.postWorkflowComment = postWorkflowComment;
module.exports.postWorkflowReview = postWorkflowReview;
module.exports.consumeReviewerArtifacts = consumeReviewerArtifacts;
module.exports.consumeImplementerArtifacts = consumeImplementerArtifacts;

// From review-loop
module.exports.maybeUpdateGraphifyBeforeReview = maybeUpdateGraphifyBeforeReview;
module.exports.commitSafeMissionArtifacts = commitSafeMissionArtifacts;
module.exports.rebaseBeforeReviewRound = rebaseBeforeReviewRound;
module.exports.applyAgentFallback = applyAgentFallback;
module.exports.persistNormalizedPhaseRepair = persistNormalizedPhaseRepair;
module.exports.startReviewLoop = startReviewLoop;

// From review-commands
module.exports.flagValue = flagValue;
module.exports.readTextFlag = readTextFlag;
module.exports.formatStaticReviewFindings = formatStaticReviewFindings;
module.exports.formatStaticReviewSuccess = formatStaticReviewSuccess;
module.exports.postStaticReviewComment = postStaticReviewComment;
module.exports.performStaticReview = performStaticReview;
module.exports.verifyReview = verifyReview;
module.exports.submitForReview = submitForReview;
module.exports.readComments = readComments;
module.exports.pushRound = pushRound;
module.exports.showReviewStatus = showReviewStatus;
module.exports.commentRound = commentRound;
module.exports.submitReviewRound = submitReviewRound;
module.exports.closeMissionPr = closeMissionPr;
module.exports.createEventHandler = createEventHandler;
module.exports.importLegacyHandler = importLegacyHandler;
