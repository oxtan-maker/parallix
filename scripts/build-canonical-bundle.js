#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { generateReleaseMetadata } = require('./release-metadata.js');

const root = path.resolve(__dirname, '..');
const publishedBuildDir = path.join(root, 'build');
const publishedRollbackDir = path.join(root, 'dist');

// Build into private staging directories and swap them into place at the end.
// `npm pack` collects files *after* prepack returns, so a concurrent build that
// deleted build/ in place could make a pack observe an empty payload; the
// tarball would then be missing build/px.mjs. Renames are atomic, so a reader
// either sees the previous complete tree or the new one.
const buildDir = path.join(root, `.build-staging.${process.pid}`);
const rollbackDir = path.join(root, `.dist-staging.${process.pid}`);
const output = path.join(buildDir, 'px.mjs');

// Serialize builds per checkout with an atomic mkdir lock kept outside the
// repository: two interleaving builds otherwise raced on the staging swap.
const lockDir = path.join(
  os.tmpdir(),
  `parallix-bundle-build-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 16)}.lock`,
);
const LOCK_WAIT_MS = 300_000;
const LOCK_STALE_MS = 600_000;

function acquireBuildLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'pid'), `${process.pid}\n`);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') { throw err; }
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
  // A failed build must leave the previously published trees untouched.
  for (const staging of [buildDir, rollbackDir]) {
    try { fs.rmSync(staging, RM_OPTIONS); } catch { /* best effort */ }
  }
  try { fs.rmSync(lockDir, RM_OPTIONS); } catch { /* best effort */ }
});

/** Replace `published` with `staging` as close to atomically as the filesystem allows. */
function publishTree(staging, published) {
  const retired = `${published}.retired.${process.pid}`;
  fs.rmSync(retired, RM_OPTIONS);
  if (fs.existsSync(published)) { fs.renameSync(published, retired); }
  fs.renameSync(staging, published);
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
    'react-devtools-core': path.join(__dirname, 'stubs', 'react-devtools-core.mjs'),
  },
  logLevel: 'error',
  jsx: 'automatic',
  loader: {
    '.tsx': 'tsx',
  },
  banner: {
    js: "import { fileURLToPath as __pxFileURLToPath } from 'node:url'; import { dirname as __pxDirname } from 'node:path'; import { createRequire as __pxCreateRequire } from 'node:module'; const __filename = __pxFileURLToPath(import.meta.url); const __dirname = __pxDirname(__filename); const module = { exports: {} }; const require = __pxCreateRequire(import.meta.url);",
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
];

// Stage every declared runtime asset under the bundle's own package root so
// `FilesystemAssetStore` reads them from build/ in the checkout, in the npm
// install, and later from the SEA payload directory (TASK-2286).
const assets = { version: 1, assets: [] };
assets.assets = RUNTIME_ASSET_KEYS.map(key => {
  const contents = fs.readFileSync(path.join(root, key));
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

function collectBuildFiles(directory, relative = '') {
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

function collectTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) { return collectTypeScriptFiles(filePath); }
    return entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) ? [filePath] : [];
  });
}

function emitCommonJsTree(sourceRoot, outputRoot) {
  for (const sourcePath of collectTypeScriptFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourcePath);
    const outputPath = path.join(outputRoot, relative.replace(/\.tsx?$/, '.js'));
    const isTsx = sourcePath.endsWith('.tsx');
    const result = esbuild.transformSync(fs.readFileSync(sourcePath, 'utf8'), {
      loader: isTsx ? 'tsx' : 'ts',
      jsx: 'automatic',
      format: 'cjs',
      platform: 'node',
      target: 'node22.23',
      sourcemap: 'external',
      sourcesContent: true,
      legalComments: 'none',
      sourcefile: path.relative(root, sourcePath),
    });
    const adjustedCode = result.code
      .replace('../../../assets/runtime-assets.js', '../../assets/runtime-assets.js')
      .replace('../runtime/lib/core/package-root.js', '../lib/core/package-root.js')
      .replace('../../../package.json', '../package.json')
      .replace('../../interfaces/tui/ui-command.js', './interfaces/tui/ui-command.mjs')
      // CJS tree (dist/lib/) is shallower than source (src/platform/runtime/lib/),
      // so cross-tree imports to application/ need fewer ".." segments.
      .replace('../../../../application/active-service.js', '../../application/active-service.js')
      .replace('../../../../application/stats-backfill-service.js', '../../application/stats-backfill-service.js')
      .replace('../../../../application/contracts.js', '../../application/contracts.js')
      .replace('../../../../application/ports.js', '../../application/ports.js');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, adjustedCode, 'utf8');
    fs.writeFileSync(`${outputPath}.map`, result.map, 'utf8');
  }
}

function emitEsmTree(sourceRoot, outputRoot) {
  for (const sourcePath of collectTypeScriptFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourcePath);
    const outputPath = path.join(outputRoot, relative.replace(/\.tsx?$/, '.mjs'));
    const isTsx = sourcePath.endsWith('.tsx');
    const result = esbuild.transformSync(fs.readFileSync(sourcePath, 'utf8'), {
      loader: isTsx ? 'tsx' : 'ts',
      jsx: 'automatic',
      format: 'esm',
      platform: 'node',
      target: 'node22.23',
      sourcemap: 'external',
      sourcesContent: true,
      legalComments: 'none',
      sourcefile: path.relative(root, sourcePath),
    });
    // Convert local .js imports to .mjs for ESM resolution in dist/
    // Handles both static (from "...") and dynamic (import("...")) imports.
    // Local imports start with . or .. and end with .js (as file extension).
    let adjustedCode = result.code.replace(/["'](\.\.?\/[^"']+?)(\.js)["']/g, (match, relPath, ext) => {
      // Only convert when .js is the file extension (at end of quoted string)
      if (!match.endsWith('.js"') && !match.endsWith(".js'")) {
        return match;
      }
      return match.replace('.js', '.mjs');
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, adjustedCode, 'utf8');
    fs.writeFileSync(`${outputPath}.map`, result.map, 'utf8');
  }
}

// The CommonJS outputs remain an explicit, removable rollback shim until the
// TASK-2285 npm-package compatibility gate authorizes its deletion. esbuild is
// still the only production JavaScript emitter; TypeScript remains no-emit.
fs.rmSync(rollbackDir, RM_OPTIONS);
fs.mkdirSync(rollbackDir, { recursive: true });
// The root package is ESM after TASK-2285. The rollback tree is CommonJS .js,
// so it needs its own type marker to stay loadable (the .mjs TUI sub-modules
// below are unaffected, since .mjs is always ESM).
fs.writeFileSync(path.join(rollbackDir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
emitCommonJsTree(path.join(root, 'src', 'platform', 'runtime'), rollbackDir);
emitCommonJsTree(path.join(root, 'src', 'platform', 'assets'), path.join(rollbackDir, 'assets'));
// application/ is the canonical home for contracts, ports, and services — emit as CJS.
emitCommonJsTree(path.join(root, 'src', 'application'), path.join(rollbackDir, 'application'));
// TUI module is ESM-only (ink 6 has top-level await) — emit as .mjs so that
// the dynamic import() in dist/index.js loads it as an ESM module.
emitEsmTree(path.join(root, 'src', 'interfaces', 'tui'), path.join(rollbackDir, 'interfaces', 'tui'));
// application/projections is required by ui-command.mjs — emit as ESM.
emitEsmTree(path.join(root, 'src', 'application', 'projections'), path.join(rollbackDir, 'application', 'projections'));
// application/controller is required by ui-command.mjs and shell.mjs.
emitEsmTree(path.join(root, 'src', 'application', 'controller'), path.join(rollbackDir, 'application', 'controller'));
// concrete adapters are required by create-board-projection-builder — emit as ESM.
emitEsmTree(path.join(root, 'src', 'adapters', 'backlog'), path.join(rollbackDir, 'adapters', 'backlog'));
// domain modules are required by projections and adapters — emit as ESM.
emitEsmTree(path.join(root, 'src', 'domain'), path.join(rollbackDir, 'domain'));
// sqlite ports are required by create-board-projection-builder — emit as ESM.
emitEsmTree(path.join(root, 'src', 'adapters', 'sqlite'), path.join(rollbackDir, 'adapters', 'sqlite'));
// platform/runtime/lib is required by adapters — emit as ESM.
emitEsmTree(path.join(root, 'src', 'platform', 'runtime', 'lib'), path.join(rollbackDir, 'platform', 'runtime', 'lib'));
// application/ is the canonical home for contracts, ports, and services — emit as ESM.
emitEsmTree(path.join(root, 'src', 'application'), path.join(rollbackDir, 'application'));
// platform/assets are required by some modules — emit as ESM.
emitEsmTree(path.join(root, 'src', 'platform', 'assets'), path.join(rollbackDir, 'platform', 'assets'));

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
publishTree(rollbackDir, publishedRollbackDir);
