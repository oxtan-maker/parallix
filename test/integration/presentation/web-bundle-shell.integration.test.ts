// HTTP policy and assets from the pipeline build in a source-free package tree.
import test from 'node:test';
import { assertBundleShell, useWebArtifactFixture } from './web-bundle.fixture.js';

useWebArtifactFixture();

test('web bundle shell: serves built assets without src, CDN, or a dev server', { timeout: 120_000 }, async t => {
  await assertBundleShell(t);
});
