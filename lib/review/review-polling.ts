/**
 * Review Polling Module
 * Extracted from parallix/lib/review.js for task-1201
 * Handles polling for review outcomes and disposition comments.
 */

import { log, status } from '../core/fmt.js';
import {
  getLatestReviewForPr,
  getLatestDispositionForPr
} from './review-adapter.js';

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_MAX_WAIT_MS = 600_000;
const POLL_PROGRESS_EVERY_MS = 30_000;

export const POLL_TIMEOUT = Object.freeze({ __isPollTimeout: true });

/** @param {number} ms */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolvePollIntervalMs(): number {
  const raw = process.env.AUTONOMOUS_REVIEW_POLL_INTERVAL_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) { return DEFAULT_POLL_INTERVAL_MS; }
  return parsed;
}

/** @param {number} [explicitSeconds] */
function resolvePollTimeoutMs(explicitSeconds?: number): number {
  if (typeof explicitSeconds === 'number' && Number.isFinite(explicitSeconds) && explicitSeconds > 0) {
    return explicitSeconds * 1000;
  }
  const raw = process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) { return DEFAULT_POLL_MAX_WAIT_MS; }
  return parsed;
}

/** @param {number} startMs */
function formatElapsed(startMs: number): string {
  const secs = Math.round((Date.now() - startMs) / 1000);
  return `${secs}s`;
}

/** @param {*} result */
function isPollTimeout(result: unknown): boolean {
  return result === POLL_TIMEOUT;
}

/**
 * @param {number} prNumber
 * @param {string} reviewerUser
 * @param {string} sinceIso
 * @param {string} token
 * @param {{getLatestReviewForPrFn?: Function, sleepFn?: Function, intervalMs?: number, timeoutMs?: number, verbose?: boolean, label?: string, retryCount?: number, log?: Function}} [options]
 * @returns {Promise<string|typeof POLL_TIMEOUT|null>}
 */
async function pollForReview(
  prNumber: number,
  reviewerUser: string,
  sinceIso: string,
  token: string,
  options: {
    getLatestReviewForPrFn?: (prNumber: number, reviewerUser: string, sinceIso: string, token: string) => Promise<unknown>;
    sleepFn?: (ms: number) => Promise<void>;
    intervalMs?: number;
    timeoutMs?: number;
    verbose?: boolean;
    label?: string;
    retryCount?: number;
    log?: (msg: string) => void;
  } = {}
): Promise<string | typeof POLL_TIMEOUT | null> {
  const {
    getLatestReviewForPrFn = getLatestReviewForPr,
    sleepFn = delay,
    intervalMs = resolvePollIntervalMs(),
    timeoutMs = resolvePollTimeoutMs(),
    verbose = false,
    label = 'review',
    retryCount = 0,
    log: logger = log.plain
  } = options;
  if (!token) {
    logger(status('WARN', 'No Forgejo token — skipping review-outcome poll (manual handoff required).'));
    return null;
  }

  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastProgressAt = start;
  logger(status('INFO', `Polling Forgejo for ${label} by ${reviewerUser} on PR #${prNumber} (timeout ${Math.round(timeoutMs / 1000)}s)...`));

  while (Date.now() < deadline) {
    const review = await getLatestReviewForPrFn(prNumber, reviewerUser, sinceIso, token);
    if (review) {
      const reviewState = (review as { state: string }).state;
      if (verbose) { logger(status('INFO', `${label}: reviewer state=${reviewState} after ${formatElapsed(start)}.`)); }
      return reviewState;
    }

    const now = Date.now();
    if (verbose || now - lastProgressAt >= POLL_PROGRESS_EVERY_MS) {
      logger(status('INFO', `${label}: still waiting for ${reviewerUser}'s review... (${formatElapsed(start)} elapsed)`));
      lastProgressAt = now;
    }

    await sleepFn(intervalMs);
  }

  const isRetry = retryCount > 0;
  const logLevel = isRetry ? 'INFO' : 'WARN';
  logger(status(logLevel, `${label}: no review posted by ${reviewerUser} within ${Math.round(timeoutMs / 1000)}s.`));
  return POLL_TIMEOUT;
}

/**
 * @param {number} prNumber
 * @param {string} implementerUser
 * @param {string} sinceIso
 * @param {string} token
 * @param {{getLatestDispositionForPrFn?: Function, sleepFn?: Function, intervalMs?: number, timeoutMs?: number, verbose?: boolean, label?: string, retryCount?: number, log?: Function}} [options]
 * @returns {Promise<string|typeof POLL_TIMEOUT|null>}
 */
async function pollForDisposition(
  prNumber: number,
  implementerUser: string,
  sinceIso: string,
  token: string,
  options: {
    getLatestDispositionForPrFn?: (prNumber: number, implementerUser: string, sinceIso: string, token: string) => Promise<unknown>;
    sleepFn?: (ms: number) => Promise<void>;
    intervalMs?: number;
    timeoutMs?: number;
    verbose?: boolean;
    label?: string;
    retryCount?: number;
    log?: (msg: string) => void;
  } = {}
): Promise<string | typeof POLL_TIMEOUT | null> {
  const {
    getLatestDispositionForPrFn = getLatestDispositionForPr,
    sleepFn = delay,
    intervalMs = resolvePollIntervalMs(),
    timeoutMs = resolvePollTimeoutMs(),
    verbose = false,
    label = 'disposition',
    retryCount = 0,
    log: logger = log.plain
  } = options;
  if (!token) {
    logger(status('WARN', 'No Forgejo token — skipping disposition poll (manual handoff required).'));
    return null;
  }

  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastProgressAt = start;
  logger(status('INFO', `Polling Forgejo for ${label} by ${implementerUser} on PR #${prNumber} (timeout ${Math.round(timeoutMs / 1000)}s)...`));

  while (Date.now() < deadline) {
    const disposition = await getLatestDispositionForPrFn(prNumber, implementerUser, sinceIso, token);
    if (disposition) {
      const dispositionStr = String(disposition);
      if (verbose) { logger(status('INFO', `${label}: disposition=${dispositionStr} after ${formatElapsed(start)}.`)); }
      return dispositionStr;
    }

    const now = Date.now();
    if (verbose || now - lastProgressAt >= POLL_PROGRESS_EVERY_MS) {
      logger(status('INFO', `${label}: still waiting for ${implementerUser}'s disposition comment... (${formatElapsed(start)} elapsed)`));
      lastProgressAt = now;
    }

    await sleepFn(intervalMs);
  }

  const isRetry = retryCount > 0;
  const logLevel = isRetry ? 'INFO' : 'WARN';
  logger(status(logLevel, `${label}: no disposition comment posted by ${implementerUser} within ${Math.round(timeoutMs / 1000)}s.`));
  return POLL_TIMEOUT;
}

export {
  resolvePollIntervalMs,
  resolvePollTimeoutMs,
  formatElapsed,
  isPollTimeout,
  pollForReview,
  pollForDisposition
};
