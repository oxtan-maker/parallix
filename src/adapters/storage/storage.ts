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

type AtomicWriteFileSystem = Pick<typeof fs,
  'mkdirSync' | 'existsSync' | 'statSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync' | 'chmodSync'>;

export interface AtomicWriteOptions {
  /** Mode for a new file. Replacements always preserve the destination mode. */
  mode?: number;
  /** Fault-injection seams used by focused storage tests. */
  fsModule?: AtomicWriteFileSystem;
  tempPathFactory?: (_filePath: string) => string;
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

// `resolveStatsPath` was removed by architecture migration. Statistics live in the
// measurement database resolved by
// `src/adapters/sqlite/database-path-resolver.ts`, and no runtime path
// resolves `<PARALLIX_HOME>/stats.csv` any more (ADR 0053).

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
export function writeJson(
  filePath: string | (() => string),
  data: unknown,
  options: AtomicWriteOptions = {}
): string {
  if (typeof filePath === 'function') {
    filePath = filePath();
  }
  writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, options);
  return filePath;
}

export function writeFileAtomic(
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {}
): void {
  const fsModule = options.fsModule ?? fs;
  fsModule.mkdirSync(path.dirname(filePath), { recursive: true });
  const destinationMode = fsModule.existsSync(filePath)
    ? fsModule.statSync(filePath).mode & 0o777
    : options.mode;
  const tempPath = options.tempPathFactory?.(filePath) ?? path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    fsModule.writeFileSync(tempPath, content, { encoding: 'utf8', mode: destinationMode });
    if (destinationMode !== undefined) {fsModule.chmodSync(tempPath, destinationMode);}
    fsModule.renameSync(tempPath, filePath);
  } finally {
    if (fsModule.existsSync(tempPath)) {fsModule.unlinkSync(tempPath);}
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
