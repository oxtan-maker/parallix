'use strict';

// Rollback from the canonical ESM npm package (TASK-2285) to the previous
// CommonJS `dist/` artifact.
//
// `scripts/build-canonical-bundle.js` keeps emitting the CommonJS rollback tree
// alongside the bundle, so rolling back is a package-metadata change only: no
// source change, no rebuild of a retired toolchain. `src/` remains the sole
// source authority in both shapes (SC8).
//
//   node scripts/rollback-commonjs-package.js            # print the rollback manifest
//   node scripts/rollback-commonjs-package.js --apply    # rewrite package.json in place
//
// Then `npm install` (the CommonJS tree resolves ink/react from node_modules
// rather than from the bundle) and `npm pack`.
//
// See docs/npm-package-major-migration.md § Rollback.

const fs = require('node:fs');
const path = require('node:path');

/**
 * Packages that the CommonJS tree resolves at runtime from `node_modules`.
 *
 * The canonical bundle inlines these, which is why the ESM package declares no
 * `dependencies`. `dist/` is transpiled, not bundled, so its `require('ink')`
 * and `require('react')` calls need a real install closure again.
 */
const ROLLBACK_DEPENDENCIES = {
  '@earendil-works/pi-coding-agent': '^0.80.6',
  '@types/react': '^19.2.14',
  ink: '^6.8.0',
  react: '^19.2.3',
};

/** Files the CommonJS package shipped: the dist tree plus package-root assets. */
const ROLLBACK_FILES = [
  'dist/',
  'LICENSE',
  'README.md',
  'CHANGELOG.md',
  'NOTICES',
  'config/',
  'data/',
  'docs/',
  'examples/',
  'prompts/',
  'templates/',
  'tools/setup-forgejo-docker.sh',
];

/**
 * Build the CommonJS manifest from the current (ESM) manifest.
 *
 * Key order is preserved where the key already exists so the diff stays legible.
 *
 * @param manifest parsed package.json of the ESM package
 */
function rollbackManifest(manifest) {
  const rolled = { ...manifest };
  rolled.type = 'commonjs';
  rolled.main = 'dist/index.js';
  rolled.bin = { px: 'dist/px.js' };
  rolled.exports = { '.': './dist/index.js', './package.json': './package.json' };
  rolled.files = [...ROLLBACK_FILES];
  // The Node floor stays at the TASK-2285 value: the CommonJS tree is emitted
  // with the same `node22.23` esbuild target, so it does not need Node 23.
  rolled.engines = { ...manifest.engines, node: '>=22.23.1' };
  rolled.dependencies = { ...ROLLBACK_DEPENDENCIES };
  // The pi SDK returns to a hard dependency in this shape, so the optional-peer
  // declaration would be redundant and npm would warn about the duplication.
  delete rolled.peerDependencies;
  delete rolled.peerDependenciesMeta;
  const devDependencies = { ...manifest.devDependencies };
  for (const name of Object.keys(ROLLBACK_DEPENDENCIES)) { delete devDependencies[name]; }
  rolled.devDependencies = devDependencies;
  return rolled;
}

function main(argv, rootDir = path.resolve(__dirname, '..')) {
  const manifestPath = path.join(rootDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rolled = rollbackManifest(manifest);
  if (argv.includes('--apply')) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(rolled, null, 2)}\n`);
    process.stdout.write('package.json rewritten to the CommonJS rollback shape. Run `npm install` and `npm pack`.\n');
    return 0;
  }
  process.stdout.write(`${JSON.stringify(rolled, null, 2)}\n`);
  return 0;
}

if (require.main === module) { process.exitCode = main(process.argv.slice(2)); }

module.exports = { ROLLBACK_DEPENDENCIES, ROLLBACK_FILES, main, rollbackManifest };
