import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveParallixHome } from '../storage/storage.js';

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

/** Parallix's operator state, needed by agents invoking `px` from a sandbox. */
export function parallixStateHome(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return resolveParallixHome({ ensureDir: true, configuration });
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
export function claudeProjectDir(worktree: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  const mangled = path.resolve(worktree).replace(/[^A-Za-z0-9]/g, '-');
  return path.join(configuration.storage.homeDirectory || os.homedir(), '.claude', 'projects', mangled);
}

export function claudeConfigDir(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return path.join(configuration.storage.homeDirectory || os.homedir(), '.claude');
}

export function claudeCredentialsPath(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return path.join(claudeConfigDir(configuration), '.credentials.json');
}

/**
 * The Parallix-owned directory a sandboxed Claude sees as `~/.claude`. Shared
 * by every sandboxed Claude launch so the CLI's OAuth refresh lock, created
 * there, serialises token rotations across concurrent missions.
 */
export function claudeConfigCellDir(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return path.join(parallixStateHome(configuration), 'claude-config-cell');
}

/** Claude's auto-memory for one worktree; stays read-only in the sandbox. */
export function claudeProjectMemoryDir(worktree: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return path.join(claudeProjectDir(worktree, configuration), 'memory');
}

export function claudeSessionEnvDir(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return path.join(configuration.storage.homeDirectory || os.homedir(), '.claude', 'session-env');
}

/** The operator state root that Codex links into a worktree-local CODEX_HOME. */
export function originatingCodexStateRoot(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return configuration.agents.codexHome || path.join(configuration.storage.homeDirectory || os.homedir(), '.codex');
}

export function codexAuthPath(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  const authPath = path.join(originatingCodexStateRoot(configuration), 'auth.json');
  try { return fs.realpathSync(authPath); }
  catch { return authPath; }
}

function xdgDir(configured: string | undefined, fallback: string, leaf: string, configuration: ParallixConfiguration): string {
  const base = configured && path.isAbsolute(configured) ? configured : path.join(configuration.storage.homeDirectory || os.homedir(), fallback);
  return path.join(base, leaf);
}

/**
 * opencode and pi (the two configurable custom runners) are host-home based:
 * neither launcher overrides `HOME` or a state-dir variable, so their state
 * lives in the operator's home rather than under the worktree.
 */
export function opencodeStateHomes(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string[] {
  return [
    xdgDir(configuration.storage.xdgDataHome, '.local/share', 'opencode', configuration),
    xdgDir(configuration.storage.xdgConfigHome, '.config', 'opencode', configuration),
    xdgDir(configuration.storage.xdgCacheHome, '.cache', 'opencode', configuration),
  ];
}

export function piStateHomes(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string[] {
  return [path.join(configuration.storage.homeDirectory || os.homedir(), '.pi')];
}
