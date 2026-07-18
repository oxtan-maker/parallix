"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewState = exports.reviewStateFile = exports.importLegacyHandler = exports.createEventHandler = exports.closeMissionPr = exports.submitReviewRound = exports.commentRound = exports.showReviewStatus = exports.pushRound = exports.readComments = exports.submitForReview = exports.verifyReview = exports.performStaticReview = exports.postStaticReviewComment = exports.formatStaticReviewSuccess = exports.formatStaticReviewFindings = exports.readTextFlag = exports.flagValue = exports.startReviewLoop = exports.persistNormalizedPhaseRepair = exports.applyAgentFallback = exports.rebaseBeforeReviewRound = exports.commitSafeMissionArtifacts = exports.maybeUpdateGraphifyBeforeReview = exports.recordStageStatsSafe = exports.consumeImplementerArtifacts = exports.consumeReviewerArtifacts = exports.postWorkflowReview = exports.postWorkflowComment = exports.normalizeDisposition = exports.normalizeReviewVerdict = exports.deleteArtifactFile = exports.readArtifactFile = exports.reviewArtifactPath = exports.buildMetadataFooter = exports.pollForDisposition = exports.pollForReview = exports.isPollTimeout = exports.formatElapsed = exports.resolvePollTimeoutMs = exports.resolvePollIntervalMs = exports.delay = exports.POLL_TIMEOUT = exports.review = void 0;
// Import from review-polling module
const review_polling_js_1 = require("./review-polling.js");
Object.defineProperty(exports, "POLL_TIMEOUT", { enumerable: true, get: function () { return review_polling_js_1.POLL_TIMEOUT; } });
Object.defineProperty(exports, "delay", { enumerable: true, get: function () { return review_polling_js_1.delay; } });
Object.defineProperty(exports, "resolvePollIntervalMs", { enumerable: true, get: function () { return review_polling_js_1.resolvePollIntervalMs; } });
Object.defineProperty(exports, "resolvePollTimeoutMs", { enumerable: true, get: function () { return review_polling_js_1.resolvePollTimeoutMs; } });
Object.defineProperty(exports, "formatElapsed", { enumerable: true, get: function () { return review_polling_js_1.formatElapsed; } });
Object.defineProperty(exports, "isPollTimeout", { enumerable: true, get: function () { return review_polling_js_1.isPollTimeout; } });
Object.defineProperty(exports, "pollForReview", { enumerable: true, get: function () { return review_polling_js_1.pollForReview; } });
Object.defineProperty(exports, "pollForDisposition", { enumerable: true, get: function () { return review_polling_js_1.pollForDisposition; } });
// Import from review-artifacts module
const review_artifacts_js_1 = require("./review-artifacts.js");
Object.defineProperty(exports, "buildMetadataFooter", { enumerable: true, get: function () { return review_artifacts_js_1.buildMetadataFooter; } });
Object.defineProperty(exports, "reviewArtifactPath", { enumerable: true, get: function () { return review_artifacts_js_1.reviewArtifactPath; } });
Object.defineProperty(exports, "readArtifactFile", { enumerable: true, get: function () { return review_artifacts_js_1.readArtifactFile; } });
Object.defineProperty(exports, "deleteArtifactFile", { enumerable: true, get: function () { return review_artifacts_js_1.deleteArtifactFile; } });
Object.defineProperty(exports, "normalizeReviewVerdict", { enumerable: true, get: function () { return review_artifacts_js_1.normalizeReviewVerdict; } });
Object.defineProperty(exports, "normalizeDisposition", { enumerable: true, get: function () { return review_artifacts_js_1.normalizeDisposition; } });
Object.defineProperty(exports, "postWorkflowComment", { enumerable: true, get: function () { return review_artifacts_js_1.postWorkflowComment; } });
Object.defineProperty(exports, "postWorkflowReview", { enumerable: true, get: function () { return review_artifacts_js_1.postWorkflowReview; } });
Object.defineProperty(exports, "consumeReviewerArtifacts", { enumerable: true, get: function () { return review_artifacts_js_1.consumeReviewerArtifacts; } });
Object.defineProperty(exports, "consumeImplementerArtifacts", { enumerable: true, get: function () { return review_artifacts_js_1.consumeImplementerArtifacts; } });
// Import from review-loop module
const review_loop_js_1 = require("./review-loop.js");
Object.defineProperty(exports, "maybeUpdateGraphifyBeforeReview", { enumerable: true, get: function () { return review_loop_js_1.maybeUpdateGraphifyBeforeReview; } });
Object.defineProperty(exports, "commitSafeMissionArtifacts", { enumerable: true, get: function () { return review_loop_js_1.commitSafeMissionArtifacts; } });
Object.defineProperty(exports, "rebaseBeforeReviewRound", { enumerable: true, get: function () { return review_loop_js_1.rebaseBeforeReviewRound; } });
Object.defineProperty(exports, "applyAgentFallback", { enumerable: true, get: function () { return review_loop_js_1.applyAgentFallback; } });
Object.defineProperty(exports, "persistNormalizedPhaseRepair", { enumerable: true, get: function () { return review_loop_js_1.persistNormalizedPhaseRepair; } });
Object.defineProperty(exports, "startReviewLoop", { enumerable: true, get: function () { return review_loop_js_1.startReviewLoop; } });
Object.defineProperty(exports, "recordStageStatsSafe", { enumerable: true, get: function () { return review_loop_js_1.recordStageStatsSafe; } });
// Import from review-commands module
const review_commands_js_1 = require("./review-commands.js");
Object.defineProperty(exports, "flagValue", { enumerable: true, get: function () { return review_commands_js_1.flagValue; } });
Object.defineProperty(exports, "readTextFlag", { enumerable: true, get: function () { return review_commands_js_1.readTextFlag; } });
Object.defineProperty(exports, "formatStaticReviewFindings", { enumerable: true, get: function () { return review_commands_js_1.formatStaticReviewFindings; } });
Object.defineProperty(exports, "formatStaticReviewSuccess", { enumerable: true, get: function () { return review_commands_js_1.formatStaticReviewSuccess; } });
Object.defineProperty(exports, "postStaticReviewComment", { enumerable: true, get: function () { return review_commands_js_1.postStaticReviewComment; } });
Object.defineProperty(exports, "performStaticReview", { enumerable: true, get: function () { return review_commands_js_1.performStaticReview; } });
Object.defineProperty(exports, "verifyReview", { enumerable: true, get: function () { return review_commands_js_1.verifyReview; } });
Object.defineProperty(exports, "submitForReview", { enumerable: true, get: function () { return review_commands_js_1.submitForReview; } });
Object.defineProperty(exports, "readComments", { enumerable: true, get: function () { return review_commands_js_1.readComments; } });
Object.defineProperty(exports, "pushRound", { enumerable: true, get: function () { return review_commands_js_1.pushRound; } });
Object.defineProperty(exports, "showReviewStatus", { enumerable: true, get: function () { return review_commands_js_1.showReviewStatus; } });
Object.defineProperty(exports, "commentRound", { enumerable: true, get: function () { return review_commands_js_1.commentRound; } });
Object.defineProperty(exports, "submitReviewRound", { enumerable: true, get: function () { return review_commands_js_1.submitReviewRound; } });
Object.defineProperty(exports, "closeMissionPr", { enumerable: true, get: function () { return review_commands_js_1.closeMissionPr; } });
Object.defineProperty(exports, "createEventHandler", { enumerable: true, get: function () { return review_commands_js_1.createEventHandler; } });
Object.defineProperty(exports, "importLegacyHandler", { enumerable: true, get: function () { return review_commands_js_1.importLegacyHandler; } });
// Import from review-state module
const review_state_js_1 = require("./review-state.js");
Object.defineProperty(exports, "reviewStateFile", { enumerable: true, get: function () { return review_state_js_1.reviewStateFile; } });
Object.defineProperty(exports, "ReviewState", { enumerable: true, get: function () { return review_state_js_1.ReviewState; } });
// ============================================================================
// Module Exports
// ============================================================================
// Set the module exports to the main review function (for backward compatibility)
// then add all other exports as properties
const _review = review_commands_js_1.review;
exports.review = _review;
// From review-polling
_review.POLL_TIMEOUT = review_polling_js_1.POLL_TIMEOUT;
_review.delay = review_polling_js_1.delay;
_review.resolvePollIntervalMs = review_polling_js_1.resolvePollIntervalMs;
_review.resolvePollTimeoutMs = review_polling_js_1.resolvePollTimeoutMs;
_review.formatElapsed = review_polling_js_1.formatElapsed;
_review.isPollTimeout = review_polling_js_1.isPollTimeout;
_review.pollForReview = review_polling_js_1.pollForReview;
_review.pollForDisposition = review_polling_js_1.pollForDisposition;
// From review-artifacts
_review.buildMetadataFooter = review_artifacts_js_1.buildMetadataFooter;
_review.reviewArtifactPath = review_artifacts_js_1.reviewArtifactPath;
_review.readArtifactFile = review_artifacts_js_1.readArtifactFile;
_review.deleteArtifactFile = review_artifacts_js_1.deleteArtifactFile;
_review.normalizeReviewVerdict = review_artifacts_js_1.normalizeReviewVerdict;
_review.normalizeDisposition = review_artifacts_js_1.normalizeDisposition;
_review.postWorkflowComment = review_artifacts_js_1.postWorkflowComment;
_review.postWorkflowReview = review_artifacts_js_1.postWorkflowReview;
_review.consumeReviewerArtifacts = review_artifacts_js_1.consumeReviewerArtifacts;
_review.consumeImplementerArtifacts = review_artifacts_js_1.consumeImplementerArtifacts;
// From review-loop
_review.recordStageStatsSafe = review_loop_js_1.recordStageStatsSafe;
_review.maybeUpdateGraphifyBeforeReview = review_loop_js_1.maybeUpdateGraphifyBeforeReview;
_review.commitSafeMissionArtifacts = review_loop_js_1.commitSafeMissionArtifacts;
_review.rebaseBeforeReviewRound = review_loop_js_1.rebaseBeforeReviewRound;
_review.applyAgentFallback = review_loop_js_1.applyAgentFallback;
_review.persistNormalizedPhaseRepair = review_loop_js_1.persistNormalizedPhaseRepair;
_review.startReviewLoop = review_loop_js_1.startReviewLoop;
// From review-commands
_review.flagValue = review_commands_js_1.flagValue;
_review.readTextFlag = review_commands_js_1.readTextFlag;
_review.formatStaticReviewFindings = review_commands_js_1.formatStaticReviewFindings;
_review.formatStaticReviewSuccess = review_commands_js_1.formatStaticReviewSuccess;
_review.postStaticReviewComment = review_commands_js_1.postStaticReviewComment;
_review.performStaticReview = review_commands_js_1.performStaticReview;
_review.verifyReview = review_commands_js_1.verifyReview;
_review.submitForReview = review_commands_js_1.submitForReview;
_review.readComments = review_commands_js_1.readComments;
_review.pushRound = review_commands_js_1.pushRound;
_review.showReviewStatus = review_commands_js_1.showReviewStatus;
_review.commentRound = review_commands_js_1.commentRound;
_review.submitReviewRound = review_commands_js_1.submitReviewRound;
_review.closeMissionPr = review_commands_js_1.closeMissionPr;
_review.createEventHandler = review_commands_js_1.createEventHandler;
_review.importLegacyHandler = review_commands_js_1.importLegacyHandler;
// From review-state
_review.reviewStateFile = review_state_js_1.reviewStateFile;
_review.ReviewState = review_state_js_1.ReviewState;
// Export the review function as the module exports (CJS-compatible)
exports.default = _review;
if (typeof module !== 'undefined') {
    module.exports = _review;
}
