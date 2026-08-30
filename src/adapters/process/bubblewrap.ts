import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveCustomRunner } from '../config/product-config.js';
import {
  claudeProjectDir,
  claudeCredentialsPath,
  claudeSessionEnvDir,
  codexAuthPath,
  codexHomeRoot,
  opencodeStateHomes,
  piStateHomes,
  qwenHomeRoot,
  vibeHomeRoot
} from '../config/state-homes.js';

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
  /** Nested Git paths that must retain their own explicit writable bind. */
  gitMetadata?: string[];
  optionalWritable?: string[];
  /** Launcher state directories: create when possible, otherwise continue without persistence. */
  optionalWritableDirectories?: string[];
  /** Existing credential leaves; omitted rather than created on a first run. */
  optionalWritableFiles?: string[];
}

export class BubblewrapGuardError extends Error {
  code = 'BUBBLEWRAP_GUARD_FAILED';
  constructor(message: string) {
    super(`Bubblewrap guard setup failed: ${message}`);
    this.name = 'BubblewrapGuardError';
  }
}

type AvailabilityProbe = () => boolean;

// A linked worktree has its own metadata dir, so cache its resolved mount pair
// by absolute worktree path before spawning Git again.
const GitMetadataCache = new Map<string, string[]>();

let availabilityProbe: AvailabilityProbe | null = null;
let cachedAvailability: boolean | null = null;
let warnedUnavailable = false;

/** Test seam: replace the `bwrap --version` probe and reset the cache. */
export function setBubblewrapProbeForTest(probe: AvailabilityProbe | null): void {
  availabilityProbe = probe;
  cachedAvailability = null;
  warnedUnavailable = false;
  GitMetadataCache.clear();
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

/**
 * Resolve the writable Git metadata mounts for one worktree: the shared common
 * dir (`--git-common-dir`) and the per-worktree git dir (`--absolute-git-dir`).
 *
 * For a linked worktree both resolve *outside* the checkout — to
 * `<repo>/.git/worktrees/<name>` and the shared `<repo>/.git` — so the worktree
 * bind alone never covers them. Returns an empty list when `worktree` is not
 * inside a Git repository: a non-repo worktree has no metadata to mount, so we
 * widen nothing. A genuine lookup miss (a repo whose git dir cannot be resolved)
 * bubbles into a `BubblewrapGuardError` rather than a broadened mount set.
 */
function resolveGitMetadataMounts(worktree: string): string[] {
  const resolvedWorktree = path.resolve(worktree);
  const cached = GitMetadataCache.get(resolvedWorktree);
  if (cached) { return [...cached]; }
  const run = (args: string[]) =>
    childProcess.spawnSync('git', ['-C', worktree, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // A busy host can push a cold git spawn past 1 s; 5 s keeps the lookup
      // useful instead of silently degrading to "no git metadata".
      timeout: 5000
    });

  const common = run(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common.error || common.status === null) {
    throw new BubblewrapGuardError(
      `cannot resolve Git common dir for ${worktree}: ${common.error?.message || 'git timed out'}`
    );
  }
  if (common.status !== 0) {
    return []; // not a Git repository — widen nothing
  }
  const commonDir = common.stdout.trim();
  if (!commonDir) {
    throw new BubblewrapGuardError(`git could not resolve the common dir for ${worktree}`);
  }

  const gitDirResult = run(['rev-parse', '--absolute-git-dir']);
  if (gitDirResult.error || gitDirResult.status === null) {
    throw new BubblewrapGuardError(
      `cannot resolve per-worktree git dir for ${worktree}: ${gitDirResult.error?.message || 'git timed out'}`
    );
  }
  if (gitDirResult.status !== 0) {
    throw new BubblewrapGuardError(
      `cannot resolve per-worktree git dir for ${worktree}: ${gitDirResult.stderr?.trim() || 'git rev-parse failed'}`
    );
  }
  const gitDir = gitDirResult.stdout.trim();
  if (!gitDir) {
    throw new BubblewrapGuardError(`git could not resolve the per-worktree git dir for ${worktree}`);
  }

  // The per-worktree dir is nested beneath the shared common dir, but both are
  // Git-resolved inputs and both keep explicit binds in the argv. This avoids a
  // `.git`-directory assumption and preserves the narrow nested grant.
  const mounts = gitDir !== commonDir ? [commonDir, gitDir] : [commonDir];
  GitMetadataCache.set(resolvedWorktree, mounts);
  return [...mounts];
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
  const optionalDirectories = (profile.optionalWritableDirectories || [])
    .map(dir => path.resolve(dir))
    .filter(dir => {
      try { ensureWritableDirectory(dir); return true; }
      catch (err) {
        fmt.log.warn(`launcher state is unavailable without a writable bind: ${(err as Error).message}`);
        return false;
      }
    });
  const optionalFiles = (profile.optionalWritableFiles || [])
    .map(file => path.resolve(file))
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
  const writable = dedupeMounts([...(profile.worktreeWritable ? [worktree] : []), ...required, ...optional, ...optionalDirectories, ...optionalFiles]);
  // `dedupeMounts` intentionally removes generic nested binds (for example an
  // artifact dir under /tmp). Git metadata is different: the common dir and
  // its per-worktree dir are both Git-resolved authorization boundaries, so
  // retain a nested explicit bind after its common-dir bind.
  const nestedGitMetadata = [...new Set((profile.gitMetadata || [])
    .map(dir => path.resolve(dir)))]
    .filter(dir => !writable.includes(dir) && required.includes(dir));
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent'];
  // Mount order is security-relevant: reapply a readonly worktree after a
  // broader writable path such as /tmp, then allow explicit nested paths.
  for (const dir of writable.filter(dir => !isWithin(worktree, dir))) { args.push('--bind', dir, dir); }
  for (const dir of nestedGitMetadata.filter(dir => !isWithin(worktree, dir))) { args.push('--bind', dir, dir); }
  args.push(profile.worktreeWritable ? '--bind' : '--ro-bind', worktree, worktree);
  for (const dir of writable.filter(dir => dir !== worktree && isWithin(worktree, dir))) { args.push('--bind', dir, dir); }
  return [...args, '--chdir', path.resolve(cwd), '--'];
}

/**
 * Resolve the launcher state homes kept writable for one family. Codex, Qwen and Vibe keep their state under the worktree's
 * git-ignored `.workflow/` (not reviewed source); Claude keeps its per-worktree
 * transcript under the host home; the custom family resolves to its configured
 * runner (opencode or pi), both of which are host-home based. Returns an empty
 * list for families the guard does not scope, so the caller keeps the plain
 * artifact-dir-only profile.
 */
function resolveLauncherStateHomes(family: string | null | undefined, worktree: string): { directories: string[], files: string[] } {
  switch (family) {
    case 'codex': return { directories: [codexHomeRoot(worktree)], files: [codexAuthPath()] };
    case 'qwen': return { directories: [qwenHomeRoot(worktree)], files: [] };
    case 'vibe': return { directories: [vibeHomeRoot(worktree)], files: [] };
    case 'claude': return { directories: [claudeSessionEnvDir(), claudeProjectDir(worktree)], files: [claudeCredentialsPath()] };
    case 'opencode': return { directories: opencodeStateHomes(), files: [] };
    case 'pi': return { directories: piStateHomes(), files: [] };
    case 'custom': return resolveLauncherStateHomes(resolveCustomRunner(worktree), worktree);
    default: return { directories: [], files: [] };
  }
}

/** Convert workflow permissions into the shared sandbox profile. */
export function resolveSandboxProfile(
  step: string,
  worktree: string,
  artifactDir?: string | null,
  family?: string | null,
): SandboxProfile {
  if (step === 'review') {
    if (!artifactDir) { throw new BubblewrapGuardError('review step requires a resolved artifact directory'); }
    const stateHomes = resolveLauncherStateHomes(family, worktree);
    return {
      worktree, worktreeWritable: false, writable: [artifactDir],
      optionalWritable: ['/tmp'], optionalWritableDirectories: stateHomes.directories, optionalWritableFiles: stateHomes.files
    };
  }
  // Implementer steps may mutate the mission branch. Grant the Git metadata that
  // resolves outside the checkout for this worktree so a confined `git add`/
  // `commit`/`rebase --continue` can lock the per-worktree index. Bounded to the
  // Git-resolved paths only — never the checkout parent or an unrelated host
  // path. Reviewer steps return above and keep Git state read-only.
  const gitMounts = resolveGitMetadataMounts(worktree);
  const stateHomes = resolveLauncherStateHomes(family, worktree);
  return {
    worktree,
    worktreeWritable: true,
    writable: gitMounts,
    gitMetadata: gitMounts,
    optionalWritable: ['/tmp'],
    optionalWritableDirectories: stateHomes.directories,
    optionalWritableFiles: stateHomes.files
  };
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
