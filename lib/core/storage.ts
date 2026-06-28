import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ResolveParallixHomeOptions {
  ensureDir?: boolean;
  platform?: string;
  env?: Record<string, string>;
  homedir?: () => string;
}

export interface ReadJsonResult<T = unknown> {
  ok: boolean;
  error: unknown;
  data: T | null;
}

export interface IsInitializedResult {
  isInitialized: boolean;
}

/**
 * Resolve the parallix-owned persistent-data root.
 *
 * Precedence:
 *   1. PARALLIX_HOME env var (highest priority)
 *   2. Platform-specific base:
 *      - Linux:      $HOME/.local/state/parallix
 *      - macOS:      ~/Library/Application Support/parallix
 *      - Windows:    %LOCALAPPDATA%/parallix
 *      - Fallback:   $HOME/.parallix
 *
 * This function guarantees the directory exists (creates it + parents on first
 * call with `ensureDir: true`). Read-side callers may omit ensureDir so they
 * fail gracefully when PARALLIX_HOME has never been initialized.
 */
export function resolveParallixHome(
  options: ResolveParallixHomeOptions | boolean | string = {}
): string {
  if (typeof options === 'boolean' || typeof options === 'string') {
    // Legacy shim: resolveParallixHome(true) === { ensureDir: true }
    options = { ensureDir: Boolean(options) };
  }

  const opts = options as ResolveParallixHomeOptions;
  const {
    ensureDir = false,
    platform = process.platform,
    env = process.env,
    homedir = os.homedir
  } = opts;

  let home: string;

  // --- env override (highest precedence) ---
  if (env.PARALLIX_HOME && typeof env.PARALLIX_HOME === 'string' && env.PARALLIX_HOME.trim().length > 0) {
    home = path.resolve(env.PARALLIX_HOME);
  } else if (platform === 'linux') {
    home = path.join(homedir(), '.local', 'state', 'parallix');
  } else if (platform === 'darwin') {
    home = path.join(homedir(), 'Library', 'Application Support', 'parallix');
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData && typeof localAppData === 'string' && localAppData.trim().length > 0) {
      home = path.join(localAppData.trim(), 'parallix');
    } else {
      home = path.join(homedir(), '.parallix');
    }
  } else {
    // WSL, CI, other UNIX variants
    home = path.join(homedir(), '.parallix');
  }

  home = path.resolve(home);

  if (ensureDir) {
    fs.mkdirSync(home, { recursive: true });
  }

  return home;
}

/**
 * Resolve the effective stats CSV path.
 *
 * Returns `<PARALLIX_HOME>/stats.csv` (creating PARALLIX_HOME if `ensureDir`
 * is true). Callers that pass an explicit `--csv-file` path bypass this
 * resolver entirely — the caller supplies the path before calling here.
 */
export interface ResolveStatsOptions {
  ensureDir?: boolean;
  warn?: (...args: unknown[]) => void;
}

export function resolveStatsPath(options: ResolveStatsOptions = {}): string {
  const opts = options as ResolveStatsOptions;
  const home = resolveParallixHome({ ensureDir: opts.ensureDir !== false });
  return path.join(home, 'stats.csv');
}

/**
 * Resolve the effective agent blocklist path.
 *
 * Returns `<PARALLIX_HOME>/agents.local.json`.  Callers that pass an
 * explicit `targetPath` bypass this resolver.
 */
export function resolveAgentsLocalPath(options?: ResolveParallixHomeOptions | string): string {
  if (typeof options === 'string') {
    return path.resolve(options);
  }
  const opts = options as ResolveParallixHomeOptions | undefined;
  const home = resolveParallixHome({ ensureDir: opts?.ensureDir !== false });
  return path.join(home, 'agents.local.json');
}

/**
 * Read a JSON file that lives under PARALLIX_HOME.
 *
 * Returns `{ ok: false, error }` when the file does not exist or is not
 * valid JSON — callers should treat absence as "no local overrides".
 * Malformed JSON returns `{ ok: false, error }` rather than throwing so
 * callers can decide whether this is a hard failure.
 */
export function readJson<T = unknown>(pathOrResolution: string | (() => string)): ReadJsonResult<T> {
  let filePath: string;
  if (typeof pathOrResolution === 'function') {
    filePath = pathOrResolution();
  } else {
    filePath = pathOrResolution;
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: null, data: null };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as T;
    return { ok: true, error: null, data };
  } catch (err) {
    return { ok: false, error: err, data: null };
  }
}

/**
 * Write JSON to a path under PARALLIX_HOME (or an explicit path).
 * Creates parent directories as needed.
 */
export function writeJson(filePath: string | (() => string), data: unknown): string {
  if (typeof filePath === 'function') {
    filePath = filePath();
  }
  writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return filePath;
}

export function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {fs.unlinkSync(tempPath);}
  }
}

/**
 * Check whether PARALLIX_HOME has been initialized (directory exists).
 * Does NOT create the directory.
 */
export function isInitialized(): boolean {
  const home = resolveParallixHome({ ensureDir: false });
  try {
    return fs.statSync(home).isDirectory();
  } catch {
    return false;
  }
}
