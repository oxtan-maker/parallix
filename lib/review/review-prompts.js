"use strict";
/**
 * Assemble review and act-on-review prompts for the autonomous review loop.
 * Owned by the Node workflow harness (ADR 0037 / task-089).
 *
 * Node-invoked agent prompts read from parallix/prompts/*.md templates
 * (same pattern as active.js / draft.js). Dry-run output uses the exact
 * prompt that a real agent receives, preventing policy drift.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMPT_ENTRYPOINTS = void 0;
exports.reviewEntrypoint = reviewEntrypoint;
exports.actOnReviewEntrypoint = actOnReviewEntrypoint;
exports.buildReviewPrompt = buildReviewPrompt;
exports.buildActOnReviewPrompt = buildActOnReviewPrompt;
exports.buildCompactReviewPrompt = buildCompactReviewPrompt;
exports.buildCompactActOnReviewPrompt = buildCompactActOnReviewPrompt;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const mission_utils_js_1 = require("../core/mission-utils.js");
const package_root_js_1 = require("../core/package-root.js");
const review_artifacts_js_1 = require("./review-artifacts.js");
const REVIEW_PROMPT_PATH = path.join((0, package_root_js_1.packageRoot)(__dirname), 'prompts', 'review.md');
const ACT_ON_REVIEW_PROMPT_PATH = path.join((0, package_root_js_1.packageRoot)(__dirname), 'prompts', 'act-on-review.md');
exports.PROMPT_ENTRYPOINTS = {
    codex: { review: '$review all', actOnReview: '$act-on-review' },
    claude: { review: '/review all', actOnReview: '/act-on-review' },
    vibe: { review: '$review all', actOnReview: '/act-on-review' },
    custom: { review: '$review all', actOnReview: '/act-on-review' },
    autonomous: { review: '$review all', actOnReview: '/act-on-review' }
};
/** @param {string} agent */
function reviewEntrypoint(agent) {
    const entry = exports.PROMPT_ENTRYPOINTS[agent];
    if (!entry) {
        throw new Error(`Unknown agent family for review entrypoint: ${agent}`);
    }
    return entry.review;
}
/** @param {string} agent */
function actOnReviewEntrypoint(agent) {
    const entry = exports.PROMPT_ENTRYPOINTS[agent];
    if (!entry) {
        throw new Error(`Unknown agent family for act-on-review entrypoint: ${agent}`);
    }
    return entry.actOnReview;
}
/**
 * @param {string} slug
 * @param {string} [repoRoot]
 * @param {string} [missionPathOverride]
 * @returns {string}
 */
function resolveMissionPath(slug, repoRoot, missionPathOverride) {
    if (missionPathOverride) {
        return missionPathOverride;
    }
    const root = repoRoot || process.cwd();
    try {
        return (0, mission_utils_js_1.missionPathForSlug)(root, slug);
    }
    catch {
        const year = (0, mission_utils_js_1.getMissionYear)(slug, root);
        return path.join(root, 'docs', 'missions', String(year), slug, 'MISSION.md');
    }
}
/** @param {string} [repoRoot] */
function resolvePrimaryBranch(repoRoot) {
    try {
        return (0, mission_utils_js_1.getPrimaryBranch)(repoRoot || process.cwd());
    }
    catch {
        return 'main';
    }
}
/**
 * @param {{reviewer: string, branch: string, implementer: string, focus?: string, attempt: number, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, actualReviewer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }) {
    return buildCompactReviewPrompt({ reviewer, branch, implementer, focus, attempt, actualReviewer, repoRoot, missionPath: missionPathOverride, reviewBaseline });
}
/**
 * @param {{implementer: string, branch: string, attempt: number, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome = '?', actualImplementer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }) {
    return buildCompactActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome, actualImplementer, repoRoot, missionPath: missionPathOverride, reviewBaseline });
}
/**
 * @param {{reviewer: string, branch: string, implementer: string, focus?: string, attempt: number, actualReviewer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildCompactReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, actualReviewer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }) {
    const slug = branch.replace(/^mission\//, '');
    const finalReviewer = actualReviewer || reviewer;
    const year = (0, mission_utils_js_1.getMissionYear)(slug, repoRoot || process.cwd());
    const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
    const primaryBranch = resolvePrimaryBranch(repoRoot);
    const artifactDir = (0, review_artifacts_js_1.resolveArtifactDir)(repoRoot || process.cwd());
    const template = fs.readFileSync(REVIEW_PROMPT_PATH, 'utf8');
    return template
        .replaceAll('{{branch}}', branch)
        .replaceAll('{{reviewer}}', finalReviewer)
        .replaceAll('{{implementer}}', implementer)
        .replaceAll('{{focus}}', focus)
        .replaceAll('{{attempt}}', String(attempt))
        .replaceAll('{{slug}}', slug)
        .replaceAll('{{missionPath}}', missionPath)
        .replaceAll('{{artifactDir}}', artifactDir)
        .replaceAll('{{primaryBranch}}', primaryBranch)
        .replaceAll('{{reviewBaseline}}', reviewBaseline || primaryBranch)
        .replaceAll('YYYY', year)
        .replaceAll('{{review_entrypoint}}', reviewEntrypoint(finalReviewer));
}
/**
 * @param {{implementer: string, branch: string, attempt: number, reviewOutcome?: string, actualImplementer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildCompactActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome = '?', actualImplementer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }) {
    const slug = branch.replace(/^mission\//, '');
    const finalImplementer = actualImplementer || implementer;
    const year = (0, mission_utils_js_1.getMissionYear)(slug, repoRoot || process.cwd());
    const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
    const primaryBranch = resolvePrimaryBranch(repoRoot);
    const artifactDir = (0, review_artifacts_js_1.resolveArtifactDir)(repoRoot || process.cwd());
    const template = fs.readFileSync(ACT_ON_REVIEW_PROMPT_PATH, 'utf8');
    return template
        .replaceAll('{{branch}}', branch)
        .replaceAll('{{implementer}}', finalImplementer)
        .replaceAll('{{attempt}}', String(attempt))
        .replaceAll('{{slug}}', slug)
        .replaceAll('{{missionPath}}', missionPath)
        .replaceAll('{{artifactDir}}', artifactDir)
        .replaceAll('{{primaryBranch}}', primaryBranch)
        .replaceAll('{{reviewBaseline}}', reviewBaseline || primaryBranch)
        .replaceAll('{{review_outcome}}', reviewOutcome)
        .replaceAll('YYYY', year)
        .replaceAll('{{act_on_review_entrypoint}}', actOnReviewEntrypoint(finalImplementer));
}
