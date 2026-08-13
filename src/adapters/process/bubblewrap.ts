import childProcess from 'node:child_process';
import * as fmt from '../../application/presentation/cli-format.js';

/**
 * Bubblewrap guard.
 *
 * Parallix launches agent CLIs without their vendors' restrictive sandboxes,
 * so the confinement lives here instead: one shared boundary applied at the
 * single child-process spawn seam (`spawnAndTee`).
 *
 * When `bwrap` is missing or not executable the launch continues unsandboxed
 * with one warning. When `bwrap` is present but the guard cannot be built, the
 * launch fails — an operator must be able to tell "no bubblewrap here" apart
 * from "the guard is broken".
 */

export const BUBBLEWRAP_COMMAND = 'bwrap';
export const DISABLE_ENV_VAR = 'PARALLIX_NO_BUBBLEWRAP';

type AvailabilityProbe = () => boolean;

let availabilityProbe: AvailabilityProbe | null = null;
let cachedAvailability: boolean | null = null;
let warnedUnavailable = false;

/** Test seam: replace the `bwrap --version` probe and reset the cache. */
export function setBubblewrapProbeForTest(probe: AvailabilityProbe | null): void {
  availabilityProbe = probe;
  cachedAvailability = null;
  warnedUnavailable = false;
}

function probeBubblewrap(): boolean {
  if (availabilityProbe) {return availabilityProbe();}
  try {
    const result = childProcess.spawnSync(BUBBLEWRAP_COMMAND, ['--version'], { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Whether an executable `bwrap` is present. Probed once per process; the
 * "running unsandboxed" warning is emitted at most once per process too.
 */
export function isBubblewrapAvailable(): boolean {
  if (cachedAvailability === null) {
    cachedAvailability = probeBubblewrap();
    if (!cachedAvailability && !warnedUnavailable) {
      warnedUnavailable = true;
      fmt.log.warn(
        `bubblewrap (${BUBBLEWRAP_COMMAND}) not found or not executable — the agent is running UNSANDBOXED with full filesystem access.`
      );
    }
  }
  return cachedAvailability;
}

/** True when the operator opted out via `PARALLIX_NO_BUBBLEWRAP`. */
export function isBubblewrapDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[DISABLE_ENV_VAR];
  return typeof raw === 'string' && raw.trim() !== '' && raw.trim() !== '0';
}
