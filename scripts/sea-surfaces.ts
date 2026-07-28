/**
 * sea-surfaces.ts — the ADR 0044 stop-and-reassess contract for the native
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
  readonly surface: string;
  readonly detail: string;

  constructor(surface: string, detail: string) {
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
 * Assert an ADR 0044 surface held on the native executable. The only failure
 * behavior is to throw: there is deliberately no fallback or degraded mode.
 *
 * @throws {SeaStopAndReassessError} when `ok` is not exactly true
 */
function assertSurface(surface: string, ok: boolean, detail: string): true {
  if (!SEA_SURFACES.includes(surface)) {
    throw new Error(`Unknown ADR 0044 surface: ${surface} (expected one of ${SEA_SURFACES.join(', ')})`);
  }
  if (ok !== true) {
    throw new SeaStopAndReassessError(surface, detail);
  }
  return true;
}

/** Parse a `vX.Y.Z` string into its major number; NaN when unparseable. */
function nodeMajor(version: string): number {
  const match = /^v?(\d+)\./.exec(String(version || '').trim());
  return match ? Number(match[1]) : Number.NaN;
}

interface SeaRuntimeEvaluation {
  supported: boolean;
  major: number;
  reason: string;
}

/** Decide whether a Node runtime may build an ESM SEA. */
function evaluateSeaRuntime(version: string): SeaRuntimeEvaluation {
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

export {
  MINIMUM_SEA_NODE_MAJOR,
  SEA_SURFACES,
  SEA_THRESHOLDS,
  SeaStopAndReassessError,
  assertSurface,
  evaluateSeaRuntime,
  nodeMajor,
};
export type { SeaRuntimeEvaluation };

// CJS compat: consumed via require() from the CommonJS test files.
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') {
  module.exports = {
    MINIMUM_SEA_NODE_MAJOR,
    SEA_SURFACES,
    SEA_THRESHOLDS,
    SeaStopAndReassessError,
    assertSurface,
    evaluateSeaRuntime,
    nodeMajor,
  };
}
