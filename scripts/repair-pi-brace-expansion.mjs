import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pi publishes an npm-shrinkwrap.json that pins brace-expansion@5.0.9.
// npm overrides and audit fix cannot change that nested install. Keep the
// installed package and our root lockfile aligned until Pi publishes a fix.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'package-lock.json');
const nestedKey = 'node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion';
const rootKey = 'node_modules/brace-expansion';
const minimumSafeVersion = '5.0.12';

function atLeast(version, minimum) {
  const left = version.split('.').map(Number);
  const right = minimum.split('.').map(Number);
  return left[0] > right[0] ||
    (left[0] === right[0] && (left[1] > right[1] ||
      (left[1] === right[1] && left[2] >= right[2])));
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const nested = lock.packages[nestedKey];
if (nested && !atLeast(nested.version, minimumSafeVersion)) {
  const safe = lock.packages[rootKey];
  if (!safe || !atLeast(safe.version, minimumSafeVersion)) {
    throw new Error(`Pi needs brace-expansion >=${minimumSafeVersion}, but the root lockfile has ${safe?.version ?? 'none'}`);
  }
  lock.packages[nestedKey] = { ...safe, dev: nested.dev };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

const nestedDir = path.join(root, nestedKey);
const rootDir = path.join(root, rootKey);
if (existsSync(nestedDir)) {
  const installed = JSON.parse(readFileSync(path.join(nestedDir, 'package.json'), 'utf8'));
  if (!atLeast(installed.version, minimumSafeVersion)) {
    const safe = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    if (!atLeast(safe.version, minimumSafeVersion)) {
      throw new Error(`Pi needs brace-expansion >=${minimumSafeVersion}, but the root install has ${safe.version}`);
    }
    cpSync(rootDir, nestedDir, { recursive: true, force: true });
    console.log(`Repaired Pi's nested brace-expansion ${installed.version} -> ${safe.version}`);
  }
}

// npm ls reads this installation cache instead of checking package.json.
const installLockPath = path.join(root, 'node_modules/.package-lock.json');
if (existsSync(installLockPath)) {
  const installLock = JSON.parse(readFileSync(installLockPath, 'utf8'));
  const installedNested = installLock.packages[nestedKey];
  if (installedNested && !atLeast(installedNested.version, minimumSafeVersion)) {
    const safe = installLock.packages[rootKey];
    if (!safe || !atLeast(safe.version, minimumSafeVersion)) {
      throw new Error(`Pi needs brace-expansion >=${minimumSafeVersion}, but npm installed ${safe?.version ?? 'none'} at the root`);
    }
    installLock.packages[nestedKey] = { ...safe, dev: installedNested.dev };
    writeFileSync(installLockPath, `${JSON.stringify(installLock, null, 2)}\n`);
  }
}
