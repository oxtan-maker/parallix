/**
 * Review Adapter
 *
 * This module is the only review-facing provider boundary. Review code calls
 * this adapter instead of importing Forgejo or product-config directly.
 */

const os = require('os');
const path = require('path');
const { resolveReviewAdapter, isForgejoReviewEnabled } = require('../core/product-config');
const { loadAdapterConfig } = require('../core/product-config');
const forgejo = require('../tools/forgejo');

const NOOP_PR_STATUS = Object.freeze({
  exists: false,
  raw: 'Forgejo PR: skipped (review provider is not forgejo).',
});

function getReviewProvider(rootDir = process.cwd()) {
  return resolveReviewAdapter(rootDir).provider || null;
}

function isEnabled(rootDir = process.cwd()) {
  return isForgejoReviewEnabled(rootDir);
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

function resolveArtifactDir(rootDir = process.cwd()) {
  const review = loadAdapterConfig(rootDir).review || {};
  const configured = typeof review.tmpDir === 'string' && review.tmpDir.trim()
    ? review.tmpDir.trim()
    : null;
  if (!configured) {
    return os.tmpdir();
  }
  return path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured);
}

function withForgejo(rootDir, liveFn, noopValue) {
  return isEnabled(rootDir) ? liveFn() : noopValue;
}

function getPrStatus(branch, rootDir = process.cwd(), options = {}) {
  return withForgejo(rootDir, () => forgejo.getPrStatus(branch, rootDir, options), NOOP_PR_STATUS);
}

function readToken(user, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  return isEnabled(rootDir) ? forgejo.readToken(user) : null;
}

async function getLatestReviewForPr(prNumber, reviewerUser, sinceIso, token, options = {}) {
  if (!token) {return null;}
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.getLatestReviewForPr(prNumber, reviewerUser, sinceIso, token, options), null);
}

async function getLatestDispositionForPr(prNumber, implementerUser, sinceIso, token, options = {}) {
  if (!token) {return null;}
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.getLatestDispositionForPr(prNumber, implementerUser, sinceIso, token, options), null);
}

function postComment(branch, token, body, options = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.postComment(branch, token, body, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}

function postReview(branch, token, outcome, summary, options = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.postReview(branch, token, outcome, summary, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}

function createPr(branch, user, token, options = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.createPr(branch, user, token, options), { ok: true, skipped: true, url: null });
}

function forgejoAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', options = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.forgejoAvailable(url, options), false);
}

function providerAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', options = {}) {
  return forgejoAvailable(url, options);
}

async function getComments(branch, token, options = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.getComments(branch, token, options), []);
}

function closePr(branch, token, user, options = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.closePr(branch, token, user, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}

function resolveForgejoUser(explicitUser) {
  return explicitUser || process.env.FORGEJO_USER || null;
}

function resolveReviewUser(explicitUser) {
  return resolveForgejoUser(explicitUser);
}

function getPrAuthor(branch, token, options = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.getPrAuthor(branch, token, options), null);
}

module.exports = {
  getReviewProvider,
  isEnabled,
  isProviderEnabled,
  isNoop,
  isForgejoProvider,
  resolveArtifactDir,
  getPrStatus,
  readToken,
  getLatestReviewForPr,
  getLatestDispositionForPr,
  postComment,
  postReview,
  createPr,
  forgejoAvailable,
  providerAvailable,
  getComments,
  closePr,
  resolveForgejoUser,
  resolveReviewUser,
  getPrAuthor,
};
