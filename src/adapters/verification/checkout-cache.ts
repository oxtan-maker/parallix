import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHECKOUT_CACHE_OWNER_FILE = '.parallix-checkout-cache.json';
const CHECKOUT_CACHE_ROOT = /^px-tmp-[a-f0-9]{12}$/;
const MANAGED_ROOT = /^(?:parallix-test-tmp-|px-tmp-)[a-f0-9]{12}$/;

export interface CheckoutCacheIdentity {
  readonly checkoutPath: string;
  readonly checkoutGitDir: string | null;
  readonly repositoryGitDir: string | null;
}

export interface CheckoutCacheOwner extends CheckoutCacheIdentity {
  readonly kind: 'parallix-checkout-cache';
  readonly version: 1;
  readonly cacheRoot: string;
  readonly owner: { readonly pid: number; readonly startId: string | null };
}

function resolvedExistingPath(target: string): string {
  try { return fs.realpathSync(target); } catch { return path.resolve(target); }
}

function gitDirectory(checkoutPath: string): string | null {
  const dotGit = path.join(checkoutPath, '.git');
  try {
    const stat = fs.lstatSync(dotGit);
    if (stat.isDirectory() && !stat.isSymbolicLink()) { return fs.realpathSync(dotGit); }
    if (!stat.isFile() || stat.isSymbolicLink()) { return null; }
    const match = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    return match ? resolvedExistingPath(path.resolve(checkoutPath, match[1])) : null;
  } catch { return null; }
}

function commonGitDirectory(checkoutGitDir: string | null): string | null {
  if (checkoutGitDir === null) { return null; }
  try {
    const common = fs.readFileSync(path.join(checkoutGitDir, 'commondir'), 'utf8').trim();
    return resolvedExistingPath(path.resolve(checkoutGitDir, common));
  } catch { return checkoutGitDir; }
}

export function checkoutCacheIdentity(executionRoot: string): CheckoutCacheIdentity {
  const checkoutPath = resolvedExistingPath(executionRoot);
  const checkoutGitDir = gitDirectory(checkoutPath);
  return { checkoutPath, checkoutGitDir, repositoryGitDir: commonGitDirectory(checkoutGitDir) };
}

function unmanagedBase(base: string): string {
  const resolvedBase = path.resolve(base);
  const parts = resolvedBase.split(path.sep);
  const managedRoot = parts.findIndex((part, index) => MANAGED_ROOT.test(part)
    && parts.slice(index + 1).every(child => MANAGED_ROOT.test(child) || /^coverage-scratch-[a-zA-Z0-9]+$/.test(child)));
  return managedRoot < 0 ? resolvedBase
    : parts.slice(0, managedRoot).join(path.sep) || path.parse(resolvedBase).root;
}

export function checkoutCacheRoot(executionRoot: string, base: string = os.tmpdir()): string {
  const identity = checkoutCacheIdentity(executionRoot);
  const id = crypto.createHash('sha256').update(identity.checkoutPath).digest('hex').slice(0, 12);
  return path.join(unmanagedBase(base), `px-tmp-${id}`);
}

function ownedDirectory(directory: string): boolean {
  const stat = fs.lstatSync(directory);
  const uid = process.getuid?.();
  return stat.isDirectory() && !stat.isSymbolicLink() && (uid === undefined || stat.uid === uid);
}

function ownerRecord(identity: CheckoutCacheIdentity, cacheRoot: string, owner: CheckoutCacheOwner['owner']): CheckoutCacheOwner {
  return {
    kind: 'parallix-checkout-cache', version: 1, cacheRoot: path.resolve(cacheRoot), ...identity,
    owner,
  };
}

function sameIdentity(owner: CheckoutCacheOwner, identity: CheckoutCacheIdentity, cacheRoot: string): boolean {
  return owner.kind === 'parallix-checkout-cache' && owner.version === 1
    && owner.cacheRoot === path.resolve(cacheRoot)
    && owner.checkoutPath === identity.checkoutPath
    && owner.checkoutGitDir === identity.checkoutGitDir
    && owner.repositoryGitDir === identity.repositoryGitDir;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isProcessOwner(value: unknown): value is CheckoutCacheOwner['owner'] {
  if (typeof value !== 'object' || value === null) { return false; }
  const owner = value as Partial<CheckoutCacheOwner['owner']>;
  return Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 && isNullableString(owner.startId);
}

export function isCheckoutCacheOwner(value: unknown): value is CheckoutCacheOwner {
  if (typeof value !== 'object' || value === null) { return false; }
  const owner = value as Partial<CheckoutCacheOwner>;
  return owner.kind === 'parallix-checkout-cache' && owner.version === 1
    && typeof owner.cacheRoot === 'string' && typeof owner.checkoutPath === 'string'
    && isNullableString(owner.checkoutGitDir) && isNullableString(owner.repositoryGitDir)
    && isProcessOwner(owner.owner);
}

function readOwner(cacheRoot: string): CheckoutCacheOwner | null {
  try {
    const file = path.join(cacheRoot, CHECKOUT_CACHE_OWNER_FILE);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid?.() !== undefined && stat.uid !== process.getuid?.())) { return null; }
    const owner: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isCheckoutCacheOwner(owner) ? owner : null;
  } catch { return null; }
}

function writeOwner(cacheRoot: string, owner: CheckoutCacheOwner): void {
  const file = path.join(cacheRoot, CHECKOUT_CACHE_OWNER_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(owner), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function ensureCheckoutCache(
  executionRoot: string,
  base: string = os.tmpdir(),
  owner: CheckoutCacheOwner['owner'] = { pid: process.pid, startId: null },
): string {
  const identity = checkoutCacheIdentity(executionRoot);
  const cacheRoot = checkoutCacheRoot(identity.checkoutPath, base);
  fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  if (!CHECKOUT_CACHE_ROOT.test(path.basename(cacheRoot)) || !ownedDirectory(cacheRoot)) {
    throw new Error(`Unsafe checkout temporary directory ${cacheRoot}: expected a directory owned by uid ${process.getuid?.()}`);
  }
  const existing = readOwner(cacheRoot);
  if (existing !== null && !sameIdentity(existing, identity, cacheRoot)) {
    throw new Error(`Unsafe checkout temporary directory ${cacheRoot}: durable checkout identity does not match`);
  }
  writeOwner(cacheRoot, ownerRecord(identity, cacheRoot, owner));
  return cacheRoot;
}

/** Idempotently retire only the cache durably attributed to this checkout. */
export function retireCheckoutCache(executionRoot: string, base: string = os.tmpdir()): boolean {
  const identity = checkoutCacheIdentity(executionRoot);
  const cacheRoot = checkoutCacheRoot(identity.checkoutPath, base);
  if (!fs.existsSync(cacheRoot)) { return true; }
  try {
    const cacheParent = path.dirname(cacheRoot);
    if (!CHECKOUT_CACHE_ROOT.test(path.basename(cacheRoot)) || !ownedDirectory(cacheRoot)
      || fs.realpathSync(cacheParent) !== fs.realpathSync(unmanagedBase(base))
      || fs.realpathSync(cacheRoot) !== path.join(fs.realpathSync(cacheParent), path.basename(cacheRoot))) { return false; }
    const owner = readOwner(cacheRoot);
    if (owner === null || !sameIdentity(owner, identity, cacheRoot)) { return false; }
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    return !fs.existsSync(cacheRoot);
  } catch { return false; }
}

export function readCheckoutCacheOwner(cacheRoot: string): CheckoutCacheOwner | null {
  return readOwner(cacheRoot);
}
