import os from 'node:os';
import path from 'node:path';

/**
 * Where each launcher family keeps its own state.
 *
 * Shared by the launchers themselves and by the Bubblewrap review profile, so
 * the sandbox's writable set cannot drift away from the directory a launcher
 * actually initializes into (a drift that reappears as an `EROFS` failure with
 * no failing test).
 */

export function codexHomeRoot(worktree: string): string {
  return path.join(worktree, '.workflow', 'codex-home');
}

export function qwenHomeRoot(worktree: string): string {
  return path.join(worktree, '.workflow', 'qwen-home');
}

export function vibeHomeRoot(worktree: string): string {
  return path.join(worktree, '.workflow', 'vibe-home');
}

/**
 * Claude's per-worktree transcript directory. Claude names it after the
 * working directory with every non-alphanumeric character replaced by `-`
 * (`/home/u/code/p` → `-home-u-code-p`), not after the mission slug.
 */
export function claudeProjectDir(worktree: string): string {
  const mangled = path.resolve(worktree).replace(/[^A-Za-z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', mangled);
}

function xdgDir(envVar: string, fallback: string, leaf: string): string {
  const configured = process.env[envVar];
  const base = configured && path.isAbsolute(configured) ? configured : path.join(os.homedir(), fallback);
  return path.join(base, leaf);
}

/**
 * opencode and pi (the two configurable custom runners) are host-home based:
 * neither launcher overrides `HOME` or a state-dir variable, so their state
 * lives in the operator's home rather than under the worktree.
 */
export function opencodeStateHomes(): string[] {
  return [
    xdgDir('XDG_DATA_HOME', '.local/share', 'opencode'),
    xdgDir('XDG_CONFIG_HOME', '.config', 'opencode'),
    xdgDir('XDG_CACHE_HOME', '.cache', 'opencode'),
  ];
}

export function piStateHomes(): string[] {
  return [path.join(os.homedir(), '.pi')];
}
