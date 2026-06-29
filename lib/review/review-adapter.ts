/**
 * Review Adapter
 *
 * This module is the only review-facing provider boundary. Review code calls
 * this adapter instead of importing Forgejo or product-config directly.
 */

import * as os from 'os';
import * as path from 'path';
import { resolveReviewAdapter, isForgejoReviewEnabled, loadAdapterConfig } from '../core/product-config.js';
import * as forgejo from '../tools/forgejo.js';

const NOOP_PR_STATUS = Object.freeze({
  exists: false,
  raw: 'Forgejo PR: skipped (review provider is not forgejo).',
});

export function getReviewProvider(rootDir = process.cwd()): string | null {
  return resolveReviewAdapter(rootDir).provider || null;
}

export function isEnabled(rootDir = process.cwd()): boolean {
  return isForgejoReviewEnabled(rootDir);
}

export function isProviderEnabled(rootDir = process.cwd()): boolean {
  return isEnabled(rootDir);
}

export function isNoop(rootDir = process.cwd()): boolean {
  const provider = getReviewProvider(rootDir);
  return provider === null || provider === 'none';
}

export function isForgejoProvider(rootDir = process.cwd()): boolean {
  return isEnabled(rootDir);
}

/** @param {string} [rootDir] */
export function resolveArtifactDir(rootDir = process.cwd()): string {
  const review = (loadAdapterConfig(rootDir).review || {}) as { tmpDir?: string };
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withForgejo(rootDir: string, liveFn: () => any, noopValue: any): any {
  return isEnabled(rootDir) ? liveFn() : noopValue;
}

/**
 * @param {string} branch
 * @param {string} [rootDir]
 * @param {{[key: string]: any}} [options]
 * @returns {*}
 */
export function getPrStatus(branch: string, rootDir = process.cwd(), options: { [key: string]: any } = {}) {
  return withForgejo(rootDir, () => forgejo.getPrStatus(branch, rootDir, options), NOOP_PR_STATUS);
}

/**
 * @param {string} user
 * @param {{rootDir?: string}} [options]
 * @returns {string|null}
 */
export function readToken(user: string, options: { rootDir?: string } = {}): string | null {
  const rootDir = options.rootDir || process.cwd();
  return isEnabled(rootDir) ? forgejo.readToken(user) : null;
}

/**
 * @param {number} prNumber
 * @param {string} reviewerUser
 * @param {string} sinceIso
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {Promise<*|null>}
 */
export async function getLatestReviewForPr(prNumber: number, reviewerUser: string, sinceIso: string, token: string, options: { rootDir?: string; [key: string]: any } = {}) {
  if (!token) {return null;}
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
export async function getLatestDispositionForPr(prNumber: number, implementerUser: string, sinceIso: string, token: string, options: { rootDir?: string; [key: string]: any } = {}) {
  if (!token) {return null;}
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.getLatestDispositionForPr(prNumber, implementerUser, sinceIso, token, options), null);
}

/**
 * @param {string} branch
 * @param {string} token
 * @param {string} body
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
export function postComment(branch: string, token: string, body: string, options: { rootDir?: string; [key: string]: any } = {}) {
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
export function postReview(branch: string, token: string, outcome: string, summary: string, options: { rootDir?: string; [key: string]: any } = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.postReview(branch, token, outcome, summary, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}

/**
 * @param {string} branch
 * @param {string} user
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
export function createPr(branch: string, user: string, token: string, options: { rootDir?: string; [key: string]: any } = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.createPr(branch, user, token, options), { ok: true, skipped: true, url: null });
}

/**
 * @param {string} [url]
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
export function forgejoAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', /** @type {{rootDir?: string, [key: string]: any}} */ options: { rootDir?: string; [key: string]: any } = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.forgejoAvailable(url, options as { request?: Function; timeout?: number }), false);
}

/**
 * @param {string} [url]
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
export function providerAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', options: { rootDir?: string; [key: string]: any } = {}) {
  return forgejoAvailable(url, options);
}

/**
 * @param {string} branch
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {Promise<*>}
 */
export async function getComments(branch: string, token: string, options: { rootDir?: string; [key: string]: unknown } = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.getComments(branch, token, options), []);
}

/**
 * @param {string} branch
 * @param {string} token
 * @param {string} user
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*}
 */
export function closePr(branch: string, token: string, user: string, /** @type {{rootDir?: string, [key: string]: any}} */ options: { rootDir?: string; [key: string]: any } = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => ((forgejo as any).closePr as Function)(branch, token, user, options), { ok: true, skipped: true, reason: 'review-provider-disabled' });
}

/** @param {string} explicitUser */
export function resolveForgejoUser(explicitUser: string): string | null {
  return explicitUser || process.env.FORGEJO_USER || null;
}

/** @param {string} explicitUser */
export function resolveReviewUser(explicitUser: string): string | null {
  return resolveForgejoUser(explicitUser);
}

/**
 * @param {string} branch
 * @param {string} token
 * @param {{rootDir?: string, [key: string]: any}} [options]
 * @returns {*|null}
 */
export function getPrAuthor(branch: string, token: string, options: { rootDir?: string; [key: string]: any } = {}) {
  return withForgejo(options.rootDir || process.cwd(), () => forgejo.getPrAuthor(branch, token, options), null);
}
