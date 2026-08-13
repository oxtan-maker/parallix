import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { getPrimaryWorktree } from '../filesystem/mission-utils.js';
import { resolveReviewAdapter } from '../config/product-config.js';

const DISPOSITION_PATTERN = /Autonomous review disposition:\s*(CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED)/;
const DEFAULT_FORGEJO_USER = 'human';
const HTTP_REQUEST_TIMEOUT = 5000;
const derivedRepoCache = new Map();

/** @param {string} rootDir @param {string} remoteName @returns {string} */
function cacheKey(rootDir: string, remoteName: string): string { return `${rootDir}::${remoteName}`; }
/** @param {string} rootDir @param {string} remoteName @returns {string|null} */
function deriveRepoFromGitRemote(rootDir: string, remoteName: string): string | null {
  if (derivedRepoCache.has(cacheKey(rootDir, remoteName))) { return derivedRepoCache.get(cacheKey(rootDir, remoteName)); }
  const remote = remoteName || 'origin';
  try {
    const result = spawnSync('git', ['-C', rootDir, 'remote', 'get-url', remote], { encoding: 'utf8', timeout: 2000 });
    if (result.status !== 0) { derivedRepoCache.set(cacheKey(rootDir, remote), null); return null; }
    const url = (result.stdout || '').trim();
    const match = url.match(/[:/]([^/:]+)\/([^/]+?)(\.git)?$/);
    const derived = match ? `${match[1]}/${match[2]}` : null;
    derivedRepoCache.set(cacheKey(rootDir, remote), derived);
    return derived;
  } catch (_) { derivedRepoCache.set(cacheKey(rootDir, remote), null); return null; }
}

/** @param {string} [explicitUser] @returns {string} */
function resolveForgejoUser(explicitUser?: string): string { return explicitUser || process.env.FORGEJO_USER || DEFAULT_FORGEJO_USER; }

function listGitWorktrees(rootDir: string = process.cwd()): string[] {
  try {
    const result = spawnSync('git', ['-C', rootDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 2000 });
    if (result.status !== 0) { return []; }
    return (result.stdout || '').split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length).trim()).filter(Boolean);
  } catch (_) { return []; }
}

function resolveForgejoHome(rootDir: string = process.cwd()) {
  if (process.env.FORGEJO_HOME) { return process.env.FORGEJO_HOME; }
  const directLocal = path.join(rootDir, '.forgejo-local');
  if (process.env.NODE_TEST_CONTEXT) { return '/tmp/forgejo-test-home-missing'; }
  if (fs.existsSync(directLocal)) { return directLocal; }
  const candidates: string[] = [directLocal];
  const seen = new Set<string>([directLocal]);
  const pushCandidate = (candidate?: string | null) => {
    if (!candidate) { return; }
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) { return; }
    seen.add(resolved);
    candidates.push(resolved);
  };
  try {
    const main = getPrimaryWorktree();
    pushCandidate(path.join(main, '.forgejo-local'));
    pushCandidate(path.join(path.dirname(main), `${path.basename(main).toLowerCase()}-forgejo`));
    try {
      const parentDir = path.dirname(main);
      const repoBase = path.basename(main);
      for (const entry of fs.readdirSync(parentDir)) {
        if (entry !== repoBase && !entry.startsWith(`${repoBase}-`)) { continue; }
        pushCandidate(path.join(parentDir, entry, '.forgejo-local'));
      }
    } catch (_) { /* Best-effort sibling scan only. */ }
  } catch (_) { /* Keep best-effort fallback behaviour. */ }
  for (const worktreePath of listGitWorktrees(rootDir)) { pushCandidate(path.join(worktreePath, '.forgejo-local')); }
  pushCandidate(path.join(rootDir, '..', 'forgejo'));
  for (const candidate of candidates) { if (fs.existsSync(candidate)) { return candidate; } }
  return candidates[0];
}

/** @param {string} targetPath @returns {string|null} */
function normalizePathForComparison(targetPath: string): string | null {
  if (!targetPath) { return null; }
  let candidate = path.resolve(targetPath);
  const suffix: string[] = [];
  while (true) {
    try { return path.join(fs.realpathSync.native(candidate), ...suffix.reverse()); }
    catch (_) {
      const parent = path.dirname(candidate);
      if (parent === candidate) { return path.resolve(targetPath); }
      suffix.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

/** @param {string} targetPath @param {{forgejoHome?: string}} [options] @returns {boolean} */
function isForgejoPath(targetPath: string, options: any = {}): boolean {
  const forgejoHome = options.forgejoHome || resolveForgejoHome(options.rootDir || process.cwd());
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedForgejoHome = normalizePathForComparison(forgejoHome);
  if (!normalizedTarget || !normalizedForgejoHome) { return false; }
  return normalizedTarget === normalizedForgejoHome || normalizedTarget.startsWith(normalizedForgejoHome + path.sep);
}

function resolveForgejoSettings(rootDir = process.cwd()) {
  const review = resolveReviewAdapter(rootDir);
  const reviewRemote = review.remote || 'review';
  return { url: process.env.FORGEJO_URL || review.baseUrl || 'http://localhost:3300', repo: process.env.FORGEJO_REPO || review.repo || deriveRepoFromGitRemote(rootDir, reviewRemote) || deriveRepoFromGitRemote(rootDir, 'origin') || '' };
}

/** @param {{forgejoUser?: string, token?: string}} options @returns {{forgejoUser: string, token: string|null}} */
function resolveForgejoAuth(options: { forgejoUser?: string, token?: string, rootDir?: string } = {} as { forgejoUser?: string, token?: string, rootDir?: string }): { forgejoUser: string, token: string | null } {
  const forgejoUser = resolveForgejoUser(options.forgejoUser);
  const token = options.token || readToken(forgejoUser, options.rootDir);
  return { forgejoUser, token };
}

/** @param {string} user @returns {string|null} */
function resolveTokenFile(user: string, rootDir: string = process.cwd()): string | null {
  const resolvedUser = resolveForgejoUser(user);
  const isCurrentUser = resolvedUser === resolveForgejoUser();
  const canUseDefaultTokenFile = isCurrentUser || resolvedUser === DEFAULT_FORGEJO_USER;
  const candidates = [isCurrentUser ? process.env.FORGEJO_TOKEN_FILE : null, path.join(resolveForgejoHome(rootDir), 'tokens', resolvedUser), canUseDefaultTokenFile ? path.join(resolveForgejoHome(rootDir), 'token') : null];
  for (const candidate of candidates) { if (candidate && fs.existsSync(candidate)) { return candidate; } }
  return null;
}

/** @param {string} user @returns {string|null} */
function readToken(user: string, rootDir: string = process.cwd()): string | null {
  const resolvedUser = resolveForgejoUser(user);
  if (resolvedUser === resolveForgejoUser() && process.env.FORGEJO_TOKEN) { return process.env.FORGEJO_TOKEN; }
  const tokenFile = resolveTokenFile(resolvedUser, rootDir);
  if (!tokenFile) { return null; }
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

/** @param {string} [url='http://localhost:3300'] @param {{request?: Function, timeout?: number}} [options] @returns {Promise<boolean>} */
function forgejoAvailable(url = process.env.FORGEJO_URL || 'http://localhost:3300', options: { request?: Function, timeout?: number } = {} as { request?: Function, timeout?: number }): Promise<boolean> {
  if (process.env.PARALLIX_TEST_NO_FORGEJO === '1' && !options.request) { return Promise.resolve(false); }
  const { request = http.request, timeout = HTTP_REQUEST_TIMEOUT } = options;
  const targetUrl = new URL(url);
  return new Promise((resolve) => {
    const req = request(targetUrl, { method: 'GET', timeout }, (/** @type {import('http').IncomingMessage} */ res: any) => {
      req.destroy();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

export { DEFAULT_FORGEJO_USER, DISPOSITION_PATTERN, cacheKey, deriveRepoFromGitRemote, forgejoAvailable, isForgejoPath, listGitWorktrees, normalizePathForComparison, readToken, resolveForgejoAuth, resolveForgejoHome, resolveForgejoSettings, resolveForgejoUser, resolveTokenFile };
