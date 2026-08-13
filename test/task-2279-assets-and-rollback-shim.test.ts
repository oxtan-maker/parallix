
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const assetStoreSource = fs.readFileSync(path.join(ROOT, 'src/adapters/assets/runtime-assets.ts'), 'utf8');

test('task-2279 routes shipped prompts and configuration through the runtime AssetStore', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'asset-manifest.json'), 'utf8'));
  for (const asset of [
    'config/agents.json', 'config/state-map.json', 'prompts/act-on-review.md',
    'prompts/draft.md', 'prompts/execute.md', 'prompts/review.md',
    'templates/mission-scaffold.md',
  ]) {
    assert.match(assetStoreSource, new RegExp(`'${asset.replace('.', '\\.')}'`));
    assert.ok(manifest.assets.some((entry) => entry.key === asset && entry.sha256), `${asset} must be in the canonical asset manifest`);
  }

  for (const file of [
    'src/adapters/cli/commands/draft-prompts.ts',
    'src/adapters/cli/commands/active.ts',
    'src/adapters/review/review-prompts.ts',
    'src/adapters/agents/agent-config.ts',
    'src/adapters/config/state-map.ts',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /runtimeAssetStore\.readText/);
    assert.doesNotMatch(source, /packageRoot\(import.meta.dirname\).*'(prompts|templates|config)'/);
  }
});

// TASK-2288 retired the transitional CommonJS rollback tree. The build no longer
// emits dist/; build/px.mjs is the sole executable product target, and rollback
// is the coherent phase documented in docs/npm-package-major-migration.md rather
// than a second distribution shipped alongside the bundle.
test('task-2288 build emits the canonical bundle as the sole executable package target', () => {
  for (const file of ['build/px.mjs', 'build/px.mjs.map']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} must exist after npm run build`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'dist')),
    'the transitional CommonJS dist/ tree must not be emitted by the build');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.bin.px, 'build/px.mjs', 'package bin must point at the canonical bundle');
  assert.ok(!pkg.main, 'package must not declare a CommonJS main entry');
});
