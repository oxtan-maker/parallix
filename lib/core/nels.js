/**
 * Net Engineering Lines (NEL) computation.
 *
 * Computes NEL from `git diff --numstat -w` for a given diff range,
 * excluding workflow/process bookkeeping, documentation, and generated files
 * per ADR 0047.
 *
 * Bucket thresholds (empirical terciles from task-1355 data, n=29):
 * - Small:  0–80 NEL  (11% rework rate)
 * - Medium: 81–235 NEL (22% rework rate)
 * - Large:  235+ NEL  (73% rework rate)
 *
 * This module is purely observational — no enforcement, gates, or blocks.
 *
 * @module lib/core/nels
 */

const { spawnSync } = require('child_process');

// ---------- exclusion globs (ADR 0047) ----------
// Each entry is a minimatch-compatible pattern. Patterns are checked in order;
// the first match wins.

const EXCLUSION_PATTERNS = [
  'missions/**',        // workflow/process bookkeeping
  'backlog/**',         // workflow/process bookkeeping
  'review-*',           // workflow/process bookkeeping
  'CP-*',               // workflow/process bookkeeping
  '**/*.md',            // documentation
  'docs/**',            // documentation
  'package-lock.json',  // generated/vendored
  'coverage/**',        // generated/vendored
  '*lock*',             // lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, Gemfile.lock, etc.)
  '*.lock',             // additional lockfile safety net
];

/**
 * Bucket constants derived from ADR 0047 empirical terciles.
 */
const BUCKET_SMALL_MAX = 80;
const BUCKET_MEDIUM_MAX = 235;

/**
 * Classify NEL count into a bucket label.
 *
 * @param {number} nel
 * @returns {{ label: 'Small' | 'Medium' | 'Large', min: number, max: number }}
 */
function classifyBucket(nel) {
  if (nel <= BUCKET_SMALL_MAX) {
    return { label: 'Small', min: 0, max: BUCKET_SMALL_MAX };
  }
  if (nel <= BUCKET_MEDIUM_MAX) {
    return { label: 'Medium', min: BUCKET_SMALL_MAX + 1, max: BUCKET_MEDIUM_MAX };
  }
  return { label: 'Large', min: BUCKET_MEDIUM_MAX + 1, max: Infinity };
}

/**
 * Check whether a file path matches any exclusion pattern.
 *
 * @param {string} filePath - Relative file path from repo root
 * @returns {boolean}
 */
function isExcluded(filePath) {
  // Normalize to forward slashes
  const normalized = filePath.replace(/\\/g, '/');

  for (const pattern of EXCLUSION_PATTERNS) {
    if (patternMatches(normalized, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple glob matcher supporting *, **, and literal segments.
 * Does not require a full minimatch dependency — keeps this module light.
 *
 * @param {string} str
 * @param {string} pattern
 * @returns {boolean}
 */
function patternMatches(str, pattern) {
  // Convert minimatch-style glob to regex
  // Escape regex special chars except * and ?
  let regexStr = '';
  let i = 0;
  const pLen = pattern.length;

  while (i < pLen) {
    const ch = pattern[i];
    if (ch === '*') {
      if (i + 1 < pLen && pattern[i + 1] === '*') {
        // ** matches everything including /
        if (i + 2 < pLen && pattern[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
          continue;
        } else {
          regexStr += '.*';
          i += 2;
          continue;
        }
      } else {
        regexStr += '[^/]*';
        i += 1;
        continue;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regexStr += '\\' + ch;
    } else {
      regexStr += ch;
    }
    i++;
  }

  const re = new RegExp('^' + regexStr + '$');
  return re.test(str);
}

/**
 * Compute Net Engineering Lines (NEL) from a git diff range.
 *
 * Runs `git diff --numstat -w <range>` and sums insertions+deletions
 * for files not matching exclusion globs from ADR 0047.
 *
 * @param {string} range - Git diff range, e.g. `main..HEAD` or `HEAD~1..HEAD`
 * @param {{ cwd?: string }} [options]
 * @returns {number} Total NEL count (insertions + deletions, whitespace-ignored)
 */
function computeNEL(range, options = {}) {
  const cwd = options.cwd || process.cwd();

  const result = spawnSync('git', ['diff', '--numstat', '-w', range], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024, // 50 MB
  });

  if (result.status !== 0) {
    // Git error, empty diff, or uncomputable — return 0
    return 0;
  }

  const stdout = result.stdout || '';
  const lines = stdout.split('\n').filter(line => line.trim().length > 0);

  let total = 0;

  for (const line of lines) {
    // numstat format: <insertions>\t<deletions>\t<filename>
    // Binary files show: -\t-\t<filename>
    const parts = line.split('\t');
    if (parts.length < 3) { continue; }

    const adds = parts[0];
    const dels = parts[1];
    const filePath = parts.slice(2).join('\t');

    // Skip binary files
    if (adds === '-' || dels === '-') { continue; }

    // Apply exclusion globs
    if (isExcluded(filePath)) { continue; }

    const addsNum = parseInt(adds, 10) || 0;
    const delsNum = parseInt(dels, 10) || 0;

    total += addsNum + delsNum;
  }

  return total;
}

/**
 * Compute NEL and return the full NEL record including bucket classification.
 *
 * @param {string} range - Git diff range
 * @param {{ cwd?: string }} [options]
 * @returns {{ nel: number, bucket: { label: string, min: number, max: number } }}
 */
function computeNELRecord(range, options) {
  const nel = computeNEL(range, options);
  return { nel, bucket: classifyBucket(nel) };
}

module.exports = {
  computeNEL,
  computeNELRecord,
  classifyBucket,
  isExcluded,
  EXCLUSION_PATTERNS,
  BUCKET_SMALL_MAX,
  BUCKET_MEDIUM_MAX,
};
