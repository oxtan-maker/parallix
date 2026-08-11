#!/usr/bin/env node

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { generateReleaseMetadata } from './release-metadata.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const publishedBuildDir = path.join(root, 'build');

// Build into private staging directory and swap into place at the end.
// `npm pack` collects files *after* prepack returns, so a concurrent build that
// deleted build/ in place could make a pack observe an empty payload; the
// tarball would then be missing build/px.mjs. Renames are atomic, so a reader
// either sees the previous complete tree or the new one.
const buildDir = path.join(root, `.build-staging.${process.pid}`);
const output = path.join(buildDir, 'px.mjs');

// Serialize builds per checkout with an atomic mkdir lock kept outside the
// repository: two interleaving builds otherwise raced on the staging swap.
const lockDir = path.join(
  os.tmpdir(),
  `parallix-bundle-build-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 16)}.lock`,
);
const LOCK_WAIT_MS = 300_000;
const LOCK_STALE_MS = 600_000;

function acquireBuildLock(): void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'pid'), `${process.pid}\n`);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') { throw err; }
      // Reclaim a lock left behind by a killed build rather than blocking forever.
      const heldSince = fs.existsSync(lockDir) ? fs.statSync(lockDir).mtimeMs : Date.now();
      if (Date.now() - heldSince > LOCK_STALE_MS) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${LOCK_WAIT_MS / 1000}s waiting for the canonical-bundle build lock at ${lockDir}`);
      }
      // esbuild.buildSync makes this script synchronous end to end, so sleep
      // without yielding to an event loop that has nothing to run.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

acquireBuildLock();
// maxRetries absorbs the brief window where another process still holds a
// directory handle (Windows) or a stale NFS entry lingers.
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };

process.on('exit', () => {
  // A failed build must leave the previously published tree untouched.
  try { fs.rmSync(buildDir, RM_OPTIONS); } catch { /* best effort */ }
  try { fs.rmSync(lockDir, RM_OPTIONS); } catch { /* best effort */ }
});

/**
 * Replace the contents of `published` with `staging` as close to atomically as
 * the filesystem allows, one top-level entry at a time.
 *
 * The published directory itself is never renamed aside. build/sea is owned by
 * the SEA build script, and the native executable resolves its package root by
 * walking up from build/sea to build/sea/package.json on every run. Moving
 * build/ (or build/sea) out of the way for even one rename leaves that walk to
 * find build/package.json instead, and the executable then reports build/ as
 * its package root — which is how the task-2286 assets smoke failed while a
 * concurrent `npm pack` rebuilt the bundle. Publishing entry by entry keeps
 * both build/ and build/sea continuously resolvable for the whole swap.
 */
function publishTree(staging: string, published: string): void {
  const retired = `${published}.retired.${process.pid}`;
  fs.rmSync(retired, RM_OPTIONS);
  if (!fs.existsSync(published)) {
    fs.renameSync(staging, published);
    return;
  }
  fs.mkdirSync(retired, { recursive: true });

  const stagedEntries = fs.readdirSync(staging);
  const staged = new Set(stagedEntries);
  // Entries this build no longer publishes are parked, not deleted in place, so
  // a reader never observes a half-emptied directory. build/sea is not ours.
  for (const entry of fs.readdirSync(published)) {
    if (entry === 'sea' || staged.has(entry)) { continue; }
    fs.renameSync(path.join(published, entry), path.join(retired, entry));
  }
  for (const entry of stagedEntries) {
    const target = path.join(published, entry);
    // rename() overwrites a regular file atomically, so a reader sees either the
    // old or the new file. It refuses any other kind of existing destination
    // (a non-empty directory, a type change), which has to be parked first.
    const current = fs.existsSync(target) ? fs.statSync(target) : undefined;
    if (current && !(current.isFile() && fs.statSync(path.join(staging, entry)).isFile())) {
      fs.renameSync(target, path.join(retired, entry));
    }
    fs.renameSync(path.join(staging, entry), target);
  }

  fs.rmSync(retired, RM_OPTIONS);
}

fs.rmSync(buildDir, RM_OPTIONS);
fs.mkdirSync(buildDir, { recursive: true });

const bundleResult = esbuild.buildSync({
  absWorkingDir: root,
  // Not bundler configuration: the metafile is a build report. It is the
  // authoritative list of third-party modules inlined into build/px.mjs and
  // drives NOTICES, the SBOM, and the license audit (TASK-2285).
  metafile: true,
  entryPoints: ['src/entry/px.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.23',
  outfile: output,
  sourcemap: true,
  sourcesContent: true,
  legalComments: 'none',
  packages: 'bundle',
  // Ink reaches for react-devtools-core only under `DEV=true`. px never ships a
  // devtools bridge, so the package is aliased to a local no-op stub: it is not
  // a declared dependency, and marking it external would hoist it into a
  // top-level import that fails to resolve at startup.
  alias: {
    'react-devtools-core': path.join(scriptDir, 'stubs', 'react-devtools-core.mjs'),
  },
  logLevel: 'error',
  jsx: 'automatic',
  loader: {
    '.tsx': 'tsx',
  },
  banner: {
    // esbuild's ESM output delegates dynamic imports from bundled third-party
    // CommonJS packages (for example Ink's signal-exit) through `require`.
    // This is bundler interop only: do not add project-facing CJS globals here.
    js: "import { createRequire as __pxCreateRequire } from 'node:module'; const require = __pxCreateRequire(import.meta.url);",
  },
});

// TASK-2285: build/ is the self-contained npm payload root. `packageRoot()`
// walks upward from a module's own directory to the nearest package.json named
// `@magnusekdahl/parallix`, so writing that name here makes build/ — not the
// checkout or the installed package root — the asset root for build/px.mjs.
// That is what lets the published tarball ship only build/ plus release
// metadata while the declared runtime assets still resolve.
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(buildDir, 'package.json'), `${JSON.stringify({
  name: rootPackageJson.name,
  version: rootPackageJson.version,
  type: 'module',
}, null, 2)}\n`);

const RUNTIME_ASSET_KEYS = [
  'config/agents.json',
  'config/state-map.json',
  'prompts/act-on-review.md',
  'prompts/draft.md',
  'prompts/execute.md',
  'prompts/review.md',
  'templates/mission-scaffold.md',
  ...fs.readdirSync(path.join(root, 'src', 'adapters', 'sqlite', 'migrations'))
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => path.posix.join('migrations', file)),
];

// Stage every declared runtime asset under the bundle's own package root so
// `FilesystemAssetStore` reads them from build/ in the checkout, in the npm
// install, and later from the SEA payload directory (TASK-2286).
interface AssetEntry { key: string; sha256: string; }
const assets: { version: number; assets: AssetEntry[] } = { version: 1, assets: [] };
assets.assets = RUNTIME_ASSET_KEYS.map((key): AssetEntry => {
  const sourcePath = key.startsWith('migrations/')
    ? path.join(root, 'src', 'adapters', 'sqlite', key)
    : path.join(root, key);
  const contents = fs.readFileSync(sourcePath);
  const stagedPath = path.join(buildDir, key);
  fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
  fs.writeFileSync(stagedPath, contents);
  return { key, sha256: crypto.createHash('sha256').update(contents).digest('hex') };
});
fs.writeFileSync(path.join(buildDir, 'asset-manifest.json'), `${JSON.stringify(assets, null, 2)}\n`);

// NOTICES and build/sbom.json are written before the checksum manifest so that
// manifest.sha256 covers the SBOM as well as the bundle and staged assets.
// This also runs the license audit (ADR 0044 release gate 9) and throws on a
// dependency license outside the approved set.
generateReleaseMetadata(root, buildDir, bundleResult.metafile);

function collectBuildFiles(directory: string, relative = ''): string[] {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? path.posix.join(relative, entry.name) : entry.name;
    return entry.isDirectory() ? collectBuildFiles(directory, child) : [child];
  });
}

const files = collectBuildFiles(buildDir).filter(file => file !== 'manifest.sha256').sort();
const manifest = files.map(file => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(buildDir, file))).digest('hex');
  return `${digest}  ${file}`;
});
fs.writeFileSync(path.join(buildDir, 'manifest.sha256'), `${manifest.join('\n')}\n`);


// SC6: Bundle-size gate — stop rule is 5 MB. It runs before the staging swap so
// an oversized bundle never reaches build/.
const publishedOutput = path.join(publishedBuildDir, 'px.mjs');
const bundleStat = fs.statSync(output);
const bundleSizeBytes = bundleStat.size;
const bundleSizeMB = (bundleSizeBytes / (1024 * 1024)).toFixed(1);
console.log(`[bundle-size] ${publishedOutput}: ${bundleSizeBytes.toLocaleString()} bytes (${bundleSizeMB} MB)`);
const maxSizeBytes = 5 * 1024 * 1024; // 5 MB stop rule
if (bundleSizeBytes > maxSizeBytes) {
  console.error(`[bundle-size] FAIL: ${bundleSizeMB} MB exceeds ${maxSizeBytes / (1024 * 1024)} MB stop rule`);
  process.exit(1);
}
console.log(`[bundle-size] PASS: ${bundleSizeMB} MB within 5 MB stop rule`);

publishTree(buildDir, publishedBuildDir);
