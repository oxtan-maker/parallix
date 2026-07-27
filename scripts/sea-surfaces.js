'use strict';

/**
 * sea-surfaces.js — the ADR 0044 stop-and-reassess contract for the native
 * single-executable proof (TASK-2286).
 *
 * ADR 0044 ("Stop and reassess") lists the runtime surfaces that must run
 * reliably in the canonical bundle: Ink, `node:sqlite`, subprocesses, signals,
 * assets, and source maps. It also states that an implementation mission "may
 * not silently substitute another authority, runtime, or distribution model".
 *
 * This module is the single place where that rule is encoded for the SEA
 * proof. Every native smoke surface reports through `assertSurface`, which has
 * exactly one failure behavior: throw a stop-and-reassess error. There is no
 * fallback value, no degraded mode, and no substituted runtime — a caller that
 * wants to keep going has to change this file, which is a visible ADR edit.
 */

/** ADR-0044 surfaces that the native executable must prove. */
const SEA_SURFACES = Object.freeze([
  'ink',
  'sqlite',
  'assets',
  'signals',
  'git',
  'sourcemaps',
]);

/**
 * Measurement stop thresholds for the native proof.
 *
 * `binarySizeBytes` is the mission's flag-only threshold: exceeding it is
 * documented and handed to the platform-matrix phase rather than failing the
 * proof (see MISSION.md "Stop Rules"). The remaining three are hard bounds for
 * a single-executable CLI on the proving platform.
 */
const SEA_THRESHOLDS = Object.freeze({
  binarySizeBytes: 100 * 1024 * 1024,
  coldStartMs: 2000,
  idleMemoryMb: 250,
  shutdownMs: 2000,
});

/** Minimum Node major that supports SEA `mainFormat: "module"` (ADR 0044 §Packaging). */
const MINIMUM_SEA_NODE_MAJOR = 25;

/** Error raised when an ADR 0044 surface fails on the native executable. */
class SeaStopAndReassessError extends Error {
  /**
   * @param {string} surface one of SEA_SURFACES
   * @param {string} detail observed failure, quoted into the message
   */
  constructor(surface, detail) {
    super(
      `ADR 0044 stop-and-reassess: the ${surface} surface failed on the native ` +
      `single-executable build — ${detail}. ADR 0044 forbids silently substituting ` +
      'another authority, runtime, or distribution model; rewrite the ADR instead.',
    );
    this.name = 'SeaStopAndReassessError';
    this.surface = surface;
    this.detail = detail;
  }
}

/**
 * Assert an ADR 0044 surface held on the native executable.
 *
 * @param {string} surface one of SEA_SURFACES
 * @param {boolean} ok whether the surface was observed working
 * @param {string} detail observed evidence or failure description
 * @returns {true} when the surface held; otherwise throws
 * @throws {SeaStopAndReassessError} when `ok` is false
 */
function assertSurface(surface, ok, detail) {
  if (!SEA_SURFACES.includes(surface)) {
    throw new Error(`Unknown ADR 0044 surface: ${surface} (expected one of ${SEA_SURFACES.join(', ')})`);
  }
  if (ok !== true) {
    throw new SeaStopAndReassessError(surface, detail);
  }
  return true;
}

/**
 * Parse a `vX.Y.Z` string into its major number.
 *
 * @param {string} version e.g. "v26.5.0"
 * @returns {number} NaN when the string is not a Node version
 */
function nodeMajor(version) {
  const match = /^v?(\d+)\./.exec(String(version || '').trim());
  return match ? Number(match[1]) : Number.NaN;
}

/**
 * Decide whether a Node runtime may build an ESM SEA.
 *
 * @param {string} version e.g. "v24.15.0"
 * @returns {{ supported: boolean, major: number, reason: string }}
 */
function evaluateSeaRuntime(version) {
  const major = nodeMajor(version);
  if (!Number.isFinite(major)) {
    return { supported: false, major: Number.NaN, reason: `unrecognized Node version string: ${String(version)}` };
  }
  if (major < MINIMUM_SEA_NODE_MAJOR) {
    return {
      supported: false,
      major,
      reason:
        `Node ${version} does not support SEA mainFormat: "module" (requires Node ` +
        `${MINIMUM_SEA_NODE_MAJOR} or newer). ADR 0044 pins an ESM-capable SEA runtime; ` +
        'the build refuses to emit an artifact on an unsupported runtime.',
    };
  }
  return { supported: true, major, reason: `Node ${version} supports SEA mainFormat: "module"` };
}

module.exports = {
  MINIMUM_SEA_NODE_MAJOR,
  SEA_SURFACES,
  SEA_THRESHOLDS,
  SeaStopAndReassessError,
  assertSurface,
  evaluateSeaRuntime,
  nodeMajor,
};
