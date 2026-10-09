import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
/**
 * Review Polling Module
 * Polls the configured review provider for outcomes and disposition comments.
 */

import { log, status } from '../../application/presentation/cli-format.js';
import { POLL_TIMEOUT, isPollTimeout } from '../../application/ports/review-round.js';
import {
  getLatestReviewForPr,
  getLatestDispositionForPr
} from './review-adapter.js';

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_MAX_WAIT_MS = 600_000;
const POLL_PROGRESS_EVERY_MS = 30_000;

export { POLL_TIMEOUT };

/** @param {number} startMs */
function formatElapsed(startMs: number): string {
  const secs = Math.round((Date.now() - startMs) / 1000);
  return `${secs}s`;
}

/** @param {number} ms */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolvePollIntervalMs(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): number {
  return configuration.runtime.reviewPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
}

function resolvePollTimeoutMs(explicitSeconds?: number, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): number {
  if (typeof explicitSeconds === 'number' && Number.isFinite(explicitSeconds) && explicitSeconds > 0) { return explicitSeconds * 1000; }
  return configuration.runtime.reviewPollTimeoutMs ?? DEFAULT_POLL_MAX_WAIT_MS;
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
    configuration?: ParallixConfiguration;
    getLatestReviewForPrFn?: (_prNumber: number, _reviewerUser: string, _sinceIso: string, _token: string) => Promise<unknown>;
    sleepFn?: (_ms: number) => Promise<void>;
    intervalMs?: number;
    timeoutMs?: number;
    verbose?: boolean;
    label?: string;
    retryCount?: number;
    log?: (_msg: string) => void;
  } = {}
): Promise<string | typeof POLL_TIMEOUT | null> {
  const {
    getLatestReviewForPrFn = getLatestReviewForPr,
    sleepFn = delay,
    intervalMs = resolvePollIntervalMs(options.configuration),
    timeoutMs = resolvePollTimeoutMs(undefined, options.configuration),
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
    configuration?: ParallixConfiguration;
    getLatestDispositionForPrFn?: (_prNumber: number, _implementerUser: string, _sinceIso: string, _token: string) => Promise<unknown>;
    sleepFn?: (_ms: number) => Promise<void>;
    intervalMs?: number;
    timeoutMs?: number;
    verbose?: boolean;
    label?: string;
    retryCount?: number;
    log?: (_msg: string) => void;
  } = {}
): Promise<string | typeof POLL_TIMEOUT | null> {
  const {
    getLatestDispositionForPrFn = getLatestDispositionForPr,
    sleepFn = delay,
    intervalMs = resolvePollIntervalMs(options.configuration),
    timeoutMs = resolvePollTimeoutMs(undefined, options.configuration),
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
  isPollTimeout,
  pollForReview,
  pollForDisposition
};
