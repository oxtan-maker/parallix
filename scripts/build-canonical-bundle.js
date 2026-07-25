#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const output = path.join(buildDir, 'px.mjs');
const rollbackDir = path.join(root, 'dist');

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

esbuild.buildSync({
  absWorkingDir: root,
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
  logLevel: 'error',
  jsx: 'automatic',
  loader: {
    '.tsx': 'tsx',
  },
  banner: {
    js: "import { fileURLToPath as __pxFileURLToPath } from 'node:url'; import { dirname as __pxDirname } from 'node:path'; import { createRequire as __pxCreateRequire } from 'node:module'; const __filename = __pxFileURLToPath(import.meta.url); const __dirname = __pxDirname(__filename); const module = { exports: {} }; const require = __pxCreateRequire(import.meta.url);",
  },
});

const assets = { version: 1, assets: [] };
assets.assets = [
  'config/agents.json',
  'config/state-map.json',
  'prompts/act-on-review.md',
  'prompts/draft.md',
  'prompts/execute.md',
  'prompts/review.md',
  'templates/mission-scaffold.md',
].map(key => ({ key, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, key))).digest('hex') }));
fs.writeFileSync(path.join(buildDir, 'asset-manifest.json'), `${JSON.stringify(assets, null, 2)}\n`);

const files = fs.readdirSync(buildDir).filter(file => file !== 'manifest.sha256').sort();
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
      .replace('../../interfaces/tui/ui-command.js', './interfaces/tui/ui-command.mjs');
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
fs.rmSync(rollbackDir, { recursive: true, force: true });
emitCommonJsTree(path.join(root, 'src', 'platform', 'runtime'), rollbackDir);
emitCommonJsTree(path.join(root, 'src', 'platform', 'assets'), path.join(rollbackDir, 'assets'));
// TUI module is ESM-only (ink 6 has top-level await) — emit as .mjs so that
// the dynamic import() in dist/index.js loads it as an ESM module.
emitEsmTree(path.join(root, 'src', 'interfaces', 'tui'), path.join(rollbackDir, 'interfaces', 'tui'));
// application/projections is required by ui-command.mjs — emit as ESM.
emitEsmTree(path.join(root, 'src', 'application', 'projections'), path.join(rollbackDir, 'application', 'projections'));
// concrete adapters are required by create-board-projection-builder — emit as ESM.
emitEsmTree(path.join(root, 'src', 'adapters', 'backlog'), path.join(rollbackDir, 'adapters', 'backlog'));
// domain modules are required by projections and adapters — emit as ESM.
emitEsmTree(path.join(root, 'src', 'domain'), path.join(rollbackDir, 'domain'));
// sqlite ports are required by create-board-projection-builder — emit as ESM.
emitEsmTree(path.join(root, 'src', 'adapters', 'sqlite'), path.join(rollbackDir, 'adapters', 'sqlite'));
// platform/runtime/lib is required by adapters — emit as ESM.
emitEsmTree(path.join(root, 'src', 'platform', 'runtime', 'lib'), path.join(rollbackDir, 'platform', 'runtime', 'lib'));
// platform/assets are required by some modules — emit as ESM.
emitEsmTree(path.join(root, 'src', 'platform', 'assets'), path.join(rollbackDir, 'platform', 'assets'));

// SC6: Bundle-size gate — stop rule is 5 MB
const bundleStat = fs.statSync(output);
const bundleSizeBytes = bundleStat.size;
const bundleSizeMB = (bundleSizeBytes / (1024 * 1024)).toFixed(1);
console.log(`[bundle-size] ${output}: ${bundleSizeBytes.toLocaleString()} bytes (${bundleSizeMB} MB)`);
const maxSizeBytes = 5 * 1024 * 1024; // 5 MB stop rule
if (bundleSizeBytes > maxSizeBytes) {
  console.error(`[bundle-size] FAIL: ${bundleSizeMB} MB exceeds ${maxSizeBytes / (1024 * 1024)} MB stop rule`);
  process.exit(1);
}
console.log(`[bundle-size] PASS: ${bundleSizeMB} MB within 5 MB stop rule`);
