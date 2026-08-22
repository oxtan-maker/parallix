import { spawnSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import type { MissionId } from '../../domain/mission.js';
import type { SessionRole } from '../../domain/session.js';

// ---------------------------------------------------------------------------
// Running mission sessions.
//
// Nothing durable records that an agent is running: `session_markers` stores
// the last launch per (mission, role) and is never cleared when the agent
// exits. The only honest source of "is an agent running right now" is the
// operating system — a live `px` process whose working directory is a mission
// worktree.
//
// Detection is best-effort by construction, so it reports `null` (unknown)
// rather than a number whenever the platform or the process listing does not
// support it. Callers must render unknown as unknown, never as zero.
// ---------------------------------------------------------------------------

/** One mission with a live `px` process in its worktree. */
export interface RunningMissionSession {
  readonly missionId: MissionId;
  /**
   * The session-marker role this command's launches write, or `null` when the
   * command can be running any of several roles. `px review` is the ambiguous
   * case: the same process launches the reviewer and then the act-on-review
   * implementer (`review-loop.ts` passes `role: 'reviewer'` and later
   * `role: 'implementer'`), so a live `px review` process proves nothing about
   * which family is at the keyboard right now.
   */
  readonly role: SessionRole | null;
  /** When the process started, in epoch milliseconds. */
  readonly startedAtMs: number;
  /** The mission worktree the process runs in, when it runs in one. */
  readonly worktree: string | null;
  /** The family pinned on the command line, when the command pins one. */
  readonly pinnedAgent: string | null;
}

/**
 * `px` subcommands that launch an agent, mapped to the session-marker role
 * their launches write — `null` where the running family cannot be read back
 * from a marker at all.
 *
 * `review` runs both the reviewer and the act-on-review implementer inside one
 * process. `resolve-conflict` launches without a slug or role
 * (`src/adapters/cli/commands/resolve-conflict.ts`), so it writes no marker;
 * reading the mission's `execute` marker there would report whichever family
 * last ran a different command.
 */
const AGENT_COMMAND_ROLES: Readonly<Record<string, SessionRole | null>> = Object.freeze({
  draft: 'draft',
  active: 'execute',
  execute: 'execute',
  'resolve-conflict': null,
  review: null,
});

/** A process as listed by `ps`. */
export interface ProcessEntry {
  readonly pid: number;
  /** Seconds since the process started, as reported by `ps -o etimes`. */
  readonly elapsedSeconds: number;
  readonly args: string;
}

export interface DetectRunningSessionsOptions {
  readonly rootDir: string;
  /** Process listing seam; defaults to `ps -eo pid=,args=`. */
  readonly listProcesses?: () => readonly ProcessEntry[] | null;
  /** Worktree listing seam; defaults to `git worktree list --porcelain`. */
  readonly listWorktrees?: () => ReadonlyMap<string, MissionId> | null;
  /** Working-directory resolution seam; defaults to `/proc/<pid>/cwd`. */
  readonly resolveCwd?: (_pid: number) => string | null;
  /** Clock seam, used to turn `ps` elapsed time into a start timestamp. */
  readonly now?: () => number;
}

/** Read the process table. Returns null when it cannot be read. */
function defaultListProcesses(): readonly ProcessEntry[] | null {
  const result = spawnSync('ps', ['-eo', 'pid=,etimes=,args='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') { return null; }
  const entries: ProcessEntry[] = [];
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) { continue; }
    entries.push({ pid: Number(match[1]), elapsedSeconds: Number(match[2]), args: match[3] as string });
  }
  return entries;
}

/** Map every mission worktree path to its mission id. Returns null on failure. */
function defaultListWorktrees(rootDir: string): ReadonlyMap<string, MissionId> | null {
  const result = spawnSync('git', ['-C', rootDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') { return null; }
  const worktrees = new Map<string, MissionId>();
  let path: string | null = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch ') && path) {
      const branch = line.slice('branch '.length).trim();
      const slug = /^refs\/heads\/mission\/(.+)$/.exec(branch)?.[1];
      if (slug) { worktrees.set(path, slug as MissionId); }
      path = null;
    }
  }
  return worktrees;
}

/** Resolve a process working directory, or null when the platform hides it. */
function defaultResolveCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/** The parsed `px` invocation of a process, or null when it is not one. */
export interface PxInvocation {
  readonly subcommand: string;
  /** The mission slug named on the command line, when the command names one. */
  readonly missionId: MissionId | null;
  /** The family pinned with `--agent`/`--implementer`/`--reviewer`, if any. */
  readonly pinnedAgent: string | null;
}

/** Flags that pin the family a command launches. */
const AGENT_FLAGS = Object.freeze(['--agent', '--implementer', '--reviewer']);

/**
 * Parse a `px` command line: subcommand, the mission slug it names, and any
 * pinned agent family.
 *
 * The slug comes from the command line rather than the process working
 * directory because `px draft task-2217` runs from the main repository — the
 * mission worktree is created by the command, and may not exist yet.
 */
export function parsePxInvocation(args: string): PxInvocation | null {
  const tokens = args.split(/\s+/);
  const entryIndex = tokens.findIndex((token) => /(^|\/)px(\.[cm]?[jt]s)?$/.test(token));
  if (entryIndex === -1) { return null; }

  const rest = tokens.slice(entryIndex + 1).filter((token) => token.length > 0);
  let subcommand: string | null = null;
  let mission: MissionId | null = null;
  let pinnedAgent: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (AGENT_FLAGS.includes(token)) {
      pinnedAgent = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token.startsWith('-')) { continue; }
    if (subcommand === null) { subcommand = token; continue; }
    if (mission === null && MISSION_SLUG_PATTERN.test(token)) { mission = token as MissionId; }
  }
  if (subcommand === null) { return null; }
  return { subcommand, missionId: mission, pinnedAgent };
}

/** Mission slug shape, mirroring `missionId()` in the domain. */
const MISSION_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+$/;

/**
 * Detect which missions have a live agent-launching `px` process.
 *
 * A mission is identified by the slug on the `px` command line, and for
 * slug-less commands (`px review --continue`) by the mission worktree the
 * process runs in.
 *
 * Returns `null` when the count cannot be trusted — the process listing failed,
 * or a slug-less session was found while the worktree listing was unavailable —
 * so the caller can render "unknown" instead of inventing a zero.
 */
export function detectRunningMissionSessions(
  options: DetectRunningSessionsOptions,
): readonly RunningMissionSession[] | null {
  const nowMs = (options.now ?? Date.now)();
  const processes = (options.listProcesses ?? defaultListProcesses)();
  if (processes === null) { return null; }
  const worktrees = (options.listWorktrees ?? (() => defaultListWorktrees(options.rootDir)))();
  const resolveCwd = options.resolveCwd ?? defaultResolveCwd;

  const found = new Map<string, RunningMissionSession>();
  for (const process of processes) {
    const invocation = parsePxInvocation(process.args);
    if (invocation === null) { continue; }
    const role = AGENT_COMMAND_ROLES[invocation.subcommand];
    if (role === undefined) { continue; }

    // The command line names the mission for `px <cmd> <slug>`; the worktree
    // identifies it for slug-less forms such as `px review --continue`.
    if (invocation.missionId === null && worktrees === null) {
      // A slug-less command (`px review --continue`) can only be identified by
      // its worktree, and the worktree listing failed: the count would be short
      // by at least this session, so report unknown instead.
      return null;
    }

    // An explicit slug is only trustworthy when the process actually runs
    // inside the board repository. A same-named mission launched from a
    // different checkout must not appear on this board (SC1), so the process
    // location — not the slug alone — is the evidence. A candidate we cannot
    // attribute is ignored, never fabricated (SC3).
    if (invocation.missionId !== null) {
      const location = repoLocation(process, options.rootDir, worktrees, resolveCwd);
      if (location === 'outside') { continue; }
      // No board-root/worktree path in argv and no working directory to inspect:
      // this explicit-slug process may be local, so omitting it would make the
      // count untrustworthy. Report unknown rather than a fabricated zero (SC3).
      if (location === 'unknown') { return null; }
    }

    const worktree = worktrees === null ? null : resolveWorktree(process, worktrees, resolveCwd);
    const missionId = invocation.missionId ?? (worktree === null ? null : worktrees?.get(worktree) ?? null);
    if (missionId === null) { continue; }

    // The `px` entry runs as a shell, a parent, and a child node process; all
    // three match the same mission and subcommand and must count once.
    found.set(`${missionId}:${invocation.subcommand}`, {
      missionId,
      role,
      startedAtMs: nowMs - process.elapsedSeconds * 1000,
      worktree,
      pinnedAgent: invocation.pinnedAgent,
    });
  }
  return [...found.values()];
}

/**
 * The mission worktree a process runs in: its working directory when the
 * platform exposes one (matched on a path boundary so a CWD nested under a
 * worktree resolves to that worktree, SC2), otherwise a worktree path named in
 * its arguments (how `px` is invoked through a worktree-local `node_modules/.bin`).
 */
function resolveWorktree(
  process: ProcessEntry,
  worktrees: ReadonlyMap<string, MissionId>,
  resolveCwd: (_pid: number) => string | null,
): string | null {
  const cwd = resolveCwd(process.pid);
  if (cwd !== null) {
    // Longest matching worktree wins so sibling worktrees that share a name
    // prefix stay distinct (see the boundary check below).
    let best: string | null = null;
    for (const path of worktrees.keys()) {
      if (isContainedIn(cwd, path) && (best === null || path.length > best.length)) { best = path; }
    }
    return best;
  }
  for (const path of worktrees.keys()) {
    if (process.args.includes(`${path}/`)) { return path; }
  }
  return null;
}

/**
 * Where a process sits relative to the board repository's working set: the
 * board root or one of its mission worktrees ('inside'), somewhere else
 * ('outside', an affirmative cross-repository signal that the explicit slug is
 * not local), or nowhere observable at all ('unknown', when neither the
 * working directory nor a path in the arguments can be placed). Directory
 * boundary aware so a sibling checkout that only shares a mission slug stays
 * outside (SC1).
 */
type RepoLocation = 'inside' | 'outside' | 'unknown';

function repoLocation(
  process: ProcessEntry,
  rootDir: string,
  worktrees: ReadonlyMap<string, MissionId> | null,
  resolveCwd: (_pid: number) => string | null,
): RepoLocation {
  const roots = worktrees === null ? [rootDir] : [rootDir, ...worktrees.keys()];
  const cwd = resolveCwd(process.pid);
  if (cwd !== null) { return roots.some((root) => isContainedIn(cwd, root)) ? 'inside' : 'outside'; }
  for (const root of roots) {
    if (process.args.includes(`${root}/`)) { return 'inside'; }
  }
  return 'unknown';
}

/** True when `target` is `root` or a descendant, matched on a path boundary. */
function isContainedIn(target: string, root: string): boolean {
  if (target === root) { return true; }
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return target.startsWith(prefix);
}
