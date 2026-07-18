"use strict";
/**
 * Review Adapter
 *
 * This module is the only review-facing provider boundary. Review code calls
 * this adapter instead of importing Forgejo or product-config directly.
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
exports.getReviewProvider = getReviewProvider;
exports.isEnabled = isEnabled;
exports.isProviderEnabled = isProviderEnabled;
exports.isNoop = isNoop;
exports.isForgejoProvider = isForgejoProvider;
exports.resolveArtifactDir = resolveArtifactDir;
exports.getPrStatus = getPrStatus;
exports.readToken = readToken;
exports.getLatestReviewForPr = getLatestReviewForPr;
exports.getLatestDispositionForPr = getLatestDispositionForPr;
exports.postComment = postComment;
exports.postReview = postReview;
exports.createPr = createPr;
exports.forgejoAvailable = forgejoAvailable;
exports.providerAvailable = providerAvailable;
exports.getComments = getComments;
exports.closePr = closePr;
exports.resolveForgejoUser = resolveForgejoUser;
exports.resolveReviewUser = resolveReviewUser;
exports.getPrAuthor = getPrAuthor;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const product_config_js_1 = require("../core/product-config.js");
const forgejo = __importStar(require("../tools/forgejo.js"));
const NOOP_PR_STATUS = Object.freeze({
    exists: false,
    raw: 'Forgejo PR: skipped (review provider is not forgejo).',
});
function getReviewProvider(rootDir = process.cwd()) {
    return (0, product_config_js_1.resolveReviewAdapter)(rootDir).provider || null;
}
function isEnabled(rootDir = process.cwd()) {
    return (0, product_config_js_1.isForgejoReviewEnabled)(rootDir);
}
function isProviderEnabled(rootDir = process.cwd()) {
    return isEnabled(rootDir);
}
function isNoop(rootDir = process.cwd()) {
    const provider = getReviewProvider(rootDir);
    return provider === null || provider === 'none';
}
function isForgejoProvider(rootDir = process.cwd()) {
    return isEnabled(rootDir);
}
/** @param {string} [rootDir] */
function resolveArtifactDir(rootDir = process.cwd()) {
    const review = ((0, product_config_js_1.loadAdapterConfig)(rootDir).review || {});
    const configured = typeof review.tmpDir === 'string' && review.tmpDir.trim()
        ? review.tmpDir.trim()
        : null;
    if (!configured) {
        return os.tmpdir();
    }
    return path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured);
}
/**
 * @param {string} rootDir
 * @param {Function} liveFn
 * @param {*} noopValue
 * @returns {*}
 */
function withForgejo(rootDir, liveFn, noopValue) {
    return isEnabled(rootDir) ? liveFn() : noopValue;
}
/**
 * @param {string} branch
 * @param {string} [rootDir]
 * @param {{[key: string]: any}} [options]
 * @returns {*}
 */
function getPrStatus(branch, rootDir = process.cwd(), options = {}) {
    return withForgejo(rootDir, () => forgejo.getPrStatus(branch, rootDir, options), NOOP_PR_STATUS);
}
/**
 * @param {string} user
 * @param {{rootDir?: string}} [options]
 * @returns {string|null}
 */
function readToken(user, options = {}) {
    const rootDir = options.rootDir || process.cwd();
    return isEnabled(rootDir) ? forgejo.readToken(user, rootDir) : null;
}
/**
 * @param {number} prNumber
 * @param {string} reviewerUser
 * @param {string} sinceIso
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {Promise<*|null>}
 */
async function getLatestReviewForPr(prNumber, reviewerUser, sinceIso, token, options = {}) {
    if (!token) {
        return null;
    }
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.getLatestReviewForPr(prNumber, reviewerUser, sinceIso, token, options), null);
}
/**
 * @param {number} prNumber
 * @param {string} implementerUser
 * @param {string} sinceIso
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {Promise<*|null>}
 */
async function getLatestDispositionForPr(prNumber, implementerUser, sinceIso, token, options = {}) {
    if (!token) {
        return null;
    }
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.getLatestDispositionForPr(prNumber, implementerUser, sinceIso, token, options), null);
}
/**
 * @param {string} branch
 * @param {string} token
 * @param {string} body
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
function postComment(branch, token, body, options = {}) {
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.postComment(branch, token, body, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}
/**
 * @param {string} branch
 * @param {string} token
 * @param {string} outcome
 * @param {string} summary
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
function postReview(branch, token, outcome, summary, options = {}) {
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.postReview(branch, token, outcome, summary, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}
/**
 * @param {string} branch
 * @param {string} user
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
function createPr(branch, user, token, options = {}) {
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.createPr(branch, user, token, options), { ok: true, skipped: true, url: null });
}
/**
 * @param {string} [url]
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
function forgejoAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', /** @type {{rootDir?: string, [key: string]: any}} */ options = {}) {
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.forgejoAvailable(url, options), false);
}
/**
 * @param {string} [url]
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
function providerAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', options = {}) {
    return forgejoAvailable(url, options);
}
/**
 * @param {string} branch
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {Promise<*>}
 */
async function getComments(branch, token, options = {}) {
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.getComments(branch, token, options), []);
}
/**
 * @param {string} branch
 * @param {string} token
 * @param {string} user
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
function closePr(branch, token, user, /** @type {{rootDir?: string, [key: string]: any}} */ options = {}) {
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.closePr(branch, token, user, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}
/** @param {string} explicitUser */
function resolveForgejoUser(explicitUser) {
    return explicitUser || process.env.FORGEJO_USER || null;
}
/** @param {string} explicitUser */
function resolveReviewUser(explicitUser) {
    return resolveForgejoUser(explicitUser);
}
/**
 * @param {string} branch
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*|null}
 */
function getPrAuthor(branch, token, options = {}) {
    return withForgejo(options.rootDir || process.cwd(), () => forgejo.getPrAuthor(branch, token, options), null);
}
