import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { getPrimaryWorktree } from '../filesystem/mission-utils.js';
import { resolveReviewAdapter } from '../config/product-config.js';

const DISPOSITION_PATTERN = /Autonomous review disposition:\s*(CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED)/;
const DEFAULT_FORGEJO_USER = 'human';
const HTTP_REQUEST_TIMEOUT = 5000;
const derivedRepoCache = new Map();
let testForgejoHome: string | undefined;

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
function resolveForgejoUser(explicitUser?: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string { return explicitUser || configuration.forgejo.user || DEFAULT_FORGEJO_USER; }

/**
 * The provider login authorized to make the human integration decision.
 * Deliberately do not derive this from FORGEJO_USER: that variable selects an
 * API credential, while authority still requires an actual provider APPROVED.
 */
function resolveAuthorizedApproverUser(explicitUser?: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string | undefined {
  return explicitUser || configuration.forgejo.authorizedApprover || undefined;
}

function listGitWorktrees(rootDir: string = process.cwd()): string[] {
  try {
    const result = spawnSync('git', ['-C', rootDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 2000 });
    if (result.status !== 0) { return []; }
    return (result.stdout || '').split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length).trim()).filter(Boolean);
  } catch (_) { return []; }
}

function resolveForgejoHome(rootDir: string = process.cwd(), configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  if (configuration.forgejo.home) { return configuration.forgejo.home; }
  const directLocal = path.join(rootDir, '.forgejo-local');
  if (configuration.forgejo.nodeTestContext) {
    testForgejoHome ||= path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-test-home-')), 'missing');
    return testForgejoHome;
  }
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
    const main = getPrimaryWorktree(configuration);
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
  const forgejoHome = options.forgejoHome || resolveForgejoHome(options.rootDir || process.cwd(), options.configuration);
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedForgejoHome = normalizePathForComparison(forgejoHome);
  if (!normalizedTarget || !normalizedForgejoHome) { return false; }
  return normalizedTarget === normalizedForgejoHome || normalizedTarget.startsWith(normalizedForgejoHome + path.sep);
}

function resolveForgejoSettings(rootDir = process.cwd(), configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  const review = resolveReviewAdapter(rootDir);
  const reviewRemote = review.remote || 'review';
  return { url: configuration.forgejo.url || review.baseUrl || 'http://localhost:3300', repo: configuration.forgejo.repo || review.repo || deriveRepoFromGitRemote(rootDir, reviewRemote) || deriveRepoFromGitRemote(rootDir, 'origin') || '' };
}

/** @param {{forgejoUser?: string, token?: string}} options @returns {{forgejoUser: string, token: string|null}} */
function resolveForgejoAuth(options: { forgejoUser?: string, token?: string, rootDir?: string; configuration?: ParallixConfiguration } = {} as { forgejoUser?: string, token?: string, rootDir?: string; configuration?: ParallixConfiguration }): { forgejoUser: string, token: string | null } {
  const forgejoUser = resolveForgejoUser(options.forgejoUser, options.configuration);
  const token = options.token || readToken(forgejoUser, options.rootDir, options.configuration);
  return { forgejoUser, token };
}

/** @param {string} user @returns {string|null} */
function resolveTokenFile(user: string, rootDir: string = process.cwd(), configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string | null {
  const resolvedUser = resolveForgejoUser(user, configuration);
  const isCurrentUser = resolvedUser === resolveForgejoUser(undefined, configuration);
  const canUseDefaultTokenFile = isCurrentUser || resolvedUser === DEFAULT_FORGEJO_USER;
  const candidates = [isCurrentUser ? configuration.forgejo.tokenFile : null, path.join(resolveForgejoHome(rootDir, configuration), 'tokens', resolvedUser), canUseDefaultTokenFile ? path.join(resolveForgejoHome(rootDir, configuration), 'token') : null];
  for (const candidate of candidates) { if (candidate && fs.existsSync(candidate)) { return candidate; } }
  return null;
}

/** @param {string} user @returns {string|null} */
function readToken(user: string, rootDir: string = process.cwd(), configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string | null {
  const resolvedUser = resolveForgejoUser(user, configuration);
  if (resolvedUser === resolveForgejoUser(undefined, configuration) && configuration.forgejo.token) { return configuration.forgejo.token; }
  const tokenFile = resolveTokenFile(resolvedUser, rootDir, configuration);
  if (!tokenFile) { return null; }
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

/** @param {string} [url='http://localhost:3300'] @param {{request?: Function, timeout?: number}} [options] @returns {Promise<boolean>} */
function forgejoAvailable(url: string | undefined = undefined, options: { request?: Function; timeout?: number; configuration?: ParallixConfiguration } = {}): Promise<boolean> {
  if (options.configuration?.forgejo.unavailableForTests && !options.request) { return Promise.resolve(false); }
  const { request = http.request, timeout = HTTP_REQUEST_TIMEOUT } = options;
  const targetUrl = new URL(url ?? options.configuration?.forgejo.url ?? 'http://localhost:3300');
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

export { DEFAULT_FORGEJO_USER, DISPOSITION_PATTERN, cacheKey, deriveRepoFromGitRemote, forgejoAvailable, isForgejoPath, listGitWorktrees, normalizePathForComparison, readToken, resolveAuthorizedApproverUser, resolveForgejoAuth, resolveForgejoHome, resolveForgejoSettings, resolveForgejoUser, resolveTokenFile };
