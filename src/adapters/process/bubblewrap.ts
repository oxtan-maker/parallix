import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

/** Resolved filesystem permissions for one workflow-agent launch. */
export interface SandboxProfile {
  worktree: string;
  worktreeWritable: boolean;
  writable: string[];
  optionalWritable?: string[];
}

export class BubblewrapGuardError extends Error {
  code = 'BUBBLEWRAP_GUARD_FAILED';
  constructor(message: string) {
    super(`Bubblewrap guard setup failed: ${message}`);
    this.name = 'BubblewrapGuardError';
  }
}

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

function requireDirectory(dir: string, label: string): string {
  let stat: fs.Stats;
  try { stat = fs.statSync(dir); } catch { throw new BubblewrapGuardError(`${label} does not exist: ${dir}`); }
  if (!stat.isDirectory()) { throw new BubblewrapGuardError(`${label} is not a directory: ${dir}`); }
  return dir;
}

function ensureWritableDirectory(dir: string): void {
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (err) { throw new BubblewrapGuardError(`cannot create writable directory ${dir}: ${(err as Error).message}`); }
  requireDirectory(dir, 'writable directory');
  try { fs.accessSync(dir, fs.constants.W_OK); }
  catch { throw new BubblewrapGuardError(`writable directory is not writable: ${dir}`); }
}

/** True when `child` is `parent` or lives beneath it. */
function isWithin(parent: string, child: string): boolean {
  return parent === child || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/** Drop duplicate/nested mounts without widening any permitted host path. */
function dedupeMounts(dirs: string[]): string[] {
  const sorted = [...new Set(dirs)].sort((a, b) => a.length - b.length);
  return sorted.reduce<string[]>((kept, dir) => (
    kept.some(existing => isWithin(existing, dir)) ? kept : [...kept, dir]
  ), []);
}

/**
 * Build a bwrap argument array. The host root is readonly; only directories
 * specifically permitted by the workflow profile are rebound writable.
 */
export function buildBubblewrapArgs(profile: SandboxProfile, cwd: string): string[] {
  const worktree = path.resolve(profile.worktree);
  requireDirectory(worktree, 'sandbox worktree');
  const required = profile.writable.map(dir => path.resolve(dir));
  required.forEach(ensureWritableDirectory);
  const optional = (profile.optionalWritable || [])
    .map(dir => path.resolve(dir))
    .filter(dir => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
  const writable = dedupeMounts([...(profile.worktreeWritable ? [worktree] : []), ...required, ...optional]);
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent'];
  // Mount order is security-relevant: reapply a readonly worktree after a
  // broader writable path such as /tmp, then allow explicit nested paths.
  for (const dir of writable.filter(dir => !isWithin(worktree, dir))) { args.push('--bind', dir, dir); }
  args.push(profile.worktreeWritable ? '--bind' : '--ro-bind', worktree, worktree);
  for (const dir of writable.filter(dir => dir !== worktree && isWithin(worktree, dir))) { args.push('--bind', dir, dir); }
  return [...args, '--chdir', path.resolve(cwd), '--'];
}

/** Convert workflow permissions into the shared sandbox profile. */
export function resolveSandboxProfile(step: string, worktree: string, artifactDir?: string | null): SandboxProfile {
  if (step === 'review') {
    if (!artifactDir) { throw new BubblewrapGuardError('review step requires a resolved artifact directory'); }
    return { worktree, worktreeWritable: false, writable: [artifactDir], optionalWritable: ['/tmp'] };
  }
  return { worktree, worktreeWritable: true, writable: [], optionalWritable: ['/tmp'] };
}

const profileStorage = new AsyncLocalStorage<SandboxProfile>();

export function withSandboxProfile<T>(profile: SandboxProfile | null, fn: () => T): T {
  return profile ? profileStorage.run(profile, fn) : fn();
}

/** Wrap a command without shell interpolation, preserving its original argv. */
export function wrapWithBubblewrap(command: string, args: string[], cwd: string): { command: string; args: string[] } {
  const profile = profileStorage.getStore();
  if (!profile || isBubblewrapDisabled() || !isBubblewrapAvailable()) { return { command, args }; }
  return { command: BUBBLEWRAP_COMMAND, args: [...buildBubblewrapArgs(profile, cwd), command, ...args] };
}
