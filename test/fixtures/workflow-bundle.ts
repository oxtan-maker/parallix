import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { caseRoot } from './case-root.js';
import { checkoutTestTmpdir } from '../lib/test-tmpdir.js';

/**
 * Immutable test-only entry; never added to the production CLI bundle.
 *
 * The compiled entry is an immutable asset, so it follows the same lifetime as
 * tsx's per-checkout compile cache (see `test/fixtures/case-root.ts` and
 * `test/lib/test-tmpdir.ts`): shared by every worker of a checkout and reused
 * across runs, never mutated by a case. Compiling it costs about 130 ms of CPU
 * when the machine is idle and about a second under gate load, which is spent
 * again by every suite that starts a real owner or observer process.
 *
 * The cache key fingerprints every file the bundle can contain. `packages:
 * 'external'` keeps dependencies out of the bundle, and the measured input
 * closure is `src/**`, `test/fixtures/**` and `package.json`, so any source
 * edit changes the key and the next call rebuilds into a fresh directory.
 */
const BUNDLE_INPUT_ROOTS = ['src', 'test/fixtures'];
const BUNDLE_INPUT_FILES = ['package.json', 'tsconfig.json'];
const BUNDLE_CACHE_DIR = 'workflow-child-bundle';
/** Bounded so branch switching cannot grow the shared cache without limit. */
const BUNDLE_CACHE_KEEP = 3;

const BUNDLE_OPTIONS = {
  outExtension: { '.js': '.mjs' }, entryNames: 'workflow-child',
  // Each real owner/observer loads this entry independently. Compact the
  // immutable fixture to avoid repeatedly parsing the full source graph.
  // Lazy host chunks keep Fastify out of observer and worker startup.
  bundle: true, splitting: true, minify: true, platform: 'node', format: 'esm', packages: 'external',
} as const;

function listFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); } else if (entry.isFile()) { found.push(full); }
    }
  };
  if (fs.existsSync(root)) { walk(root); }
  return found.sort();
}

function bundleCacheKey(checkout: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(BUNDLE_OPTIONS)).update('\0').update(checkout).update('\0');
  for (const root of BUNDLE_INPUT_ROOTS) {
    for (const file of listFiles(path.join(checkout, root))) {
      hash.update(path.relative(checkout, file)).update('\0').update(String(fs.statSync(file).size)).update('\0').update(fs.readFileSync(file)).update('\0');
    }
  }
  for (const name of BUNDLE_INPUT_FILES) {
    const file = path.join(checkout, name);
    if (fs.existsSync(file)) { hash.update(name).update('\0').update(fs.readFileSync(file)).update('\0'); }
  }
  return hash.digest('hex').slice(0, 24);
}

/** Keep the newest entries; a stale key is only ever left by an older run. */
function pruneBundleCache(cacheRoot: string): void {
  try {
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({ name: entry.name, mtime: fs.statSync(path.join(cacheRoot, entry.name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime);
    for (const entry of entries.slice(BUNDLE_CACHE_KEEP)) {
      fs.rmSync(path.join(cacheRoot, entry.name), { recursive: true, force: true });
    }
  } catch { /* a concurrent worker may prune the same entry first */ }
}

/** Build into a case-owned directory, then publish it atomically into the cache. */
async function buildSharedBundle(checkout: string, cacheRoot: string, shared: string): Promise<void> {
  const owned = caseRoot('workflow-child-bundle-');
  try {
    await build({ ...BUNDLE_OPTIONS, entryPoints: [path.join(checkout, 'test/fixtures/workflow-owner-child.ts')], outdir: owned.root,
      banner: { js: `import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(${JSON.stringify(path.join(checkout, 'package.json'))});` },
      nodePaths: [path.join(checkout, 'node_modules')],
    });
    // External dependencies resolve from the checkout rather than the private temp root.
    for (const name of ['node_modules', 'config', 'prompts', 'templates', 'data', 'scripts', 'package.json']) {
      fs.symlinkSync(path.join(checkout, name), path.join(owned.root, name));
    }
    fs.symlinkSync(path.join(checkout, 'src/adapters/sqlite/migrations'), path.join(owned.root, 'migrations'), 'dir');
    try {
      fs.mkdirSync(cacheRoot, { recursive: true });
      fs.renameSync(owned.root, shared);
    } catch {
      // Another worker published the same immutable bundle first; use its copy.
      fs.rmSync(owned.root, { recursive: true, force: true });
    }
    pruneBundleCache(cacheRoot);
  } catch (error) {
    owned.dispose();
    throw error;
  }
}

export async function bundleWorkflowChild() {
  const checkout = process.cwd();
  const cacheRoot = path.join(checkoutTestTmpdir(checkout), BUNDLE_CACHE_DIR);
  const shared = path.join(cacheRoot, bundleCacheKey(checkout));
  const entry = path.join(shared, 'workflow-child.mjs');
  if (!fs.existsSync(entry)) { await buildSharedBundle(checkout, cacheRoot, shared); }
  // Each owner/observer is already isolated in its own process; match the
  // runner's finite compiler pool rather than multiplying host-sized pools.
  return { cli: { command: process.execPath, args: ['--v8-pool-size=1', entry] }, close() {} };
}
