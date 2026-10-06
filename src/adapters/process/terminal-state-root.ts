import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Private state root for tmux terminal hosting (TASK-2643).
 *
 * Holds one tmux socket per repository and Mission plus each run's host and
 * pane scripts. It is owner-only (0700) and Bubblewrap masks it with a tmpfs,
 * so a confined agent can neither reach another run's tmux server nor read the
 * launch environment written for its own pane. The root is preferably under
 * `$XDG_RUNTIME_DIR`, which is per-user and short enough for socket paths.
 */
export function terminalStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const [preferred, fallback] = terminalStateRootCandidates(env);
  if (!fallback) { return preferred; }
  try { fs.accessSync(path.dirname(preferred), fs.constants.W_OK); return preferred; } catch { return fallback; }
}

/**
 * A deliberately short private root for Unix-domain sockets when an operator's
 * configured state path cannot fit one.  Socket names are compacted by the
 * caller, but host scripts and retained state continue to use the configured
 * root whenever its socket path is portable.
 */
export function terminalSocketFallbackRoot(env: NodeJS.ProcessEnv = process.env): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const root = terminalStateRoot(env);
  const scope = createHash('sha256').update(root).digest('hex').slice(0, 12);
  return path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', `px-t-${uid}`, scope);
}

/** The configured root, or `$XDG_RUNTIME_DIR` with the per-user temp dir as its fallback. */
function terminalStateRootCandidates(env: NodeJS.ProcessEnv): string[] {
  if (env.PARALLIX_TERMINAL_STATE_DIR) { return [path.resolve(env.PARALLIX_TERMINAL_STATE_DIR)]; }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  // macOS TMPDIR (and coverage fixtures) can exceed Unix socket path limits.
  const tempBase = Buffer.byteLength(os.tmpdir()) > 40 && process.platform !== 'win32' ? '/tmp' : os.tmpdir();
  const temp = path.join(tempBase, `parallix-terminal-${uid}`);
  const runtime = env.XDG_RUNTIME_DIR;
  return runtime && path.isAbsolute(runtime) ? [path.join(runtime, 'parallix-terminal'), temp] : [temp];
}

/**
 * Create `dir` (and parents under the root) owner-only, refusing a directory
 * another user owns or can write: a shared socket directory would let another
 * account attach to or drive an agent's terminal.
 */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // lstat: a pre-planted symlink in a shared temp dir must not redirect sockets.
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory()) { throw new Error(`terminal state path ${dir} is not a directory`); }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== null && stat.uid !== uid) {
    throw new Error(`terminal state directory ${dir} is owned by uid ${stat.uid}, not ${uid}`);
  }
  if ((stat.mode & 0o077) !== 0) { fs.chmodSync(dir, 0o700); }
}

/** Every existing state root to mask inside the sandbox; empty when none was created. */
export function existingTerminalStateRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([...terminalStateRootCandidates(env), terminalSocketFallbackRoot(env)])].filter(root => {
    try { return fs.statSync(root).isDirectory(); } catch { return false; }
  });
}
