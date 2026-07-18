"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveParallixHome = resolveParallixHome;
exports.resolveStatsPath = resolveStatsPath;
exports.resolveAgentsLocalPath = resolveAgentsLocalPath;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.writeFileAtomic = writeFileAtomic;
exports.isInitialized = isInitialized;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
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
function resolveParallixHome(options = {}) {
    if (typeof options === 'boolean' || typeof options === 'string') {
        // Legacy shim: resolveParallixHome(true) === { ensureDir: true }
        options = { ensureDir: Boolean(options) };
    }
    const opts = options;
    const { ensureDir = false, platform = process.platform, env = process.env, homedir = node_os_1.default.homedir } = opts;
    let home;
    // --- env override (highest precedence) ---
    if (env.PARALLIX_HOME && typeof env.PARALLIX_HOME === 'string' && env.PARALLIX_HOME.trim().length > 0) {
        home = node_path_1.default.resolve(env.PARALLIX_HOME);
    }
    else if (platform === 'linux') {
        home = node_path_1.default.join(homedir(), '.local', 'state', 'parallix');
    }
    else if (platform === 'darwin') {
        home = node_path_1.default.join(homedir(), 'Library', 'Application Support', 'parallix');
    }
    else if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA;
        if (localAppData && typeof localAppData === 'string' && localAppData.trim().length > 0) {
            home = node_path_1.default.join(localAppData.trim(), 'parallix');
        }
        else {
            home = node_path_1.default.join(homedir(), '.parallix');
        }
    }
    else {
        // WSL, CI, other UNIX variants
        home = node_path_1.default.join(homedir(), '.parallix');
    }
    home = node_path_1.default.resolve(home);
    if (ensureDir) {
        node_fs_1.default.mkdirSync(home, { recursive: true });
    }
    return home;
}
function resolveStatsPath(options = {}) {
    const opts = options;
    const home = resolveParallixHome({ ensureDir: opts.ensureDir !== false });
    return node_path_1.default.join(home, 'stats.csv');
}
/**
 * Resolve the effective agent blocklist path.
 *
 * Returns `<PARALLIX_HOME>/agents.local.json`.  Callers that pass an
 * explicit `targetPath` bypass this resolver.
 */
function resolveAgentsLocalPath(options) {
    if (typeof options === 'string') {
        return node_path_1.default.resolve(options);
    }
    const opts = options;
    const home = resolveParallixHome({ ensureDir: opts?.ensureDir !== false });
    return node_path_1.default.join(home, 'agents.local.json');
}
/**
 * Read a JSON file that lives under PARALLIX_HOME.
 *
 * Returns `{ ok: false, error }` when the file does not exist or is not
 * valid JSON — callers should treat absence as "no local overrides".
 * Malformed JSON returns `{ ok: false, error }` rather than throwing so
 * callers can decide whether this is a hard failure.
 */
function readJson(pathOrResolution) {
    let filePath;
    if (typeof pathOrResolution === 'function') {
        filePath = pathOrResolution();
    }
    else {
        filePath = pathOrResolution;
    }
    if (!filePath || !node_fs_1.default.existsSync(filePath)) {
        return { ok: false, error: null, data: null };
    }
    try {
        const raw = node_fs_1.default.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return { ok: true, error: null, data };
    }
    catch (err) {
        return { ok: false, error: err, data: null };
    }
}
/**
 * Write JSON to a path under PARALLIX_HOME (or an explicit path).
 * Creates parent directories as needed.
 */
function writeJson(filePath, data, options = {}) {
    if (typeof filePath === 'function') {
        filePath = filePath();
    }
    writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, options);
    return filePath;
}
function writeFileAtomic(filePath, content, options = {}) {
    const fsModule = options.fsModule ?? node_fs_1.default;
    fsModule.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
    const destinationMode = fsModule.existsSync(filePath)
        ? fsModule.statSync(filePath).mode & 0o777
        : options.mode;
    const tempPath = options.tempPathFactory?.(filePath) ?? node_path_1.default.join(node_path_1.default.dirname(filePath), `.${node_path_1.default.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    try {
        fsModule.writeFileSync(tempPath, content, { encoding: 'utf8', mode: destinationMode });
        if (destinationMode !== undefined) {
            fsModule.chmodSync(tempPath, destinationMode);
        }
        fsModule.renameSync(tempPath, filePath);
    }
    finally {
        if (fsModule.existsSync(tempPath)) {
            fsModule.unlinkSync(tempPath);
        }
    }
}
/**
 * Check whether PARALLIX_HOME has been initialized (directory exists).
 * Does NOT create the directory.
 */
function isInitialized() {
    const home = resolveParallixHome({ ensureDir: false });
    try {
        return node_fs_1.default.statSync(home).isDirectory();
    }
    catch {
        return false;
    }
}
