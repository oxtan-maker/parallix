import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  PREBUILT_PX_ENTRY, SOURCE_PX, SOURCE_PX_ENTRY, TSX_LOADER, pxNodeArgs, resolvePxEntryLoader,
} from '../../../lib/px-entry.js';

const bundlePresent: NonNullable<NonNullable<Parameters<typeof resolvePxEntryLoader>[0]>["exists"]> = (file) => file === PREBUILT_PX_ENTRY;
const bundleMissing = () => false;

test('resolvePxEntryLoader runs the prebuilt bundle with no loader in a prebuilt lane whose bundle exists', () => {
  const px = resolvePxEntryLoader({ env: { PARALLIX_PREBUILT_PACK: '1' }, exists: bundlePresent });
  assert.deepEqual(px, { entry: PREBUILT_PX_ENTRY, loader: '' });
  assert.equal(path.relative(path.resolve(import.meta.dirname, '..', '..', '..', '..'), px.entry), path.join('build', 'px.mjs'));
});

test('resolvePxEntryLoader runs the source entry through tsx outside a prebuilt lane or without the bundle', () => {
  for (const options of [
    { env: {}, exists: bundlePresent },
    { env: { PARALLIX_PREBUILT_PACK: '0' }, exists: bundlePresent },
    { env: { PARALLIX_PREBUILT_PACK: '1' }, exists: bundleMissing },
  ]) {
    assert.deepEqual(resolvePxEntryLoader(options), { entry: SOURCE_PX_ENTRY, loader: TSX_LOADER });
  }
  assert.equal(path.relative(path.resolve(import.meta.dirname, '..', '..', '..', '..'), SOURCE_PX.entry), path.join('src', 'entry', 'px.ts'));
  assert.match(TSX_LOADER, /node_modules[/\\]tsx[/\\]/);
});

test('pxNodeArgs adds --import only when the entry needs a loader', () => {
  assert.deepEqual(pxNodeArgs({ entry: '/b/px.mjs', loader: '' }, ['status']), ['--v8-pool-size=1', '/b/px.mjs', 'status']);
  assert.deepEqual(pxNodeArgs({ entry: '/s/px.ts', loader: '/tsx.mjs' }, ['status']), ['--v8-pool-size=1', '--import', '/tsx.mjs', '/s/px.ts', 'status']);
});

test('prebuilt CLI launches omit unattributable bundle coverage while source launches retain their loader (TASK-2787)', () => {
  assert.deepEqual(pxNodeArgs({ entry: PREBUILT_PX_ENTRY, loader: '' }, ['version']), [
    '--v8-pool-size=1', '--import', path.resolve('test/lib/prebuilt-cli-runtime.mjs'), PREBUILT_PX_ENTRY, 'version',
  ]);
  assert.deepEqual(pxNodeArgs(SOURCE_PX, ['version']), [
    '--v8-pool-size=1', '--import', TSX_LOADER, SOURCE_PX_ENTRY, 'version',
  ]);
});
