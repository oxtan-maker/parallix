// The real npm artifact and packaged CLI board lifecycle form one boundary.
import test from 'node:test';
import { assertPackagedAssets, assertPackagedBoard } from './web-package-smoke.integration.cases.js';

test('web package smoke: the tarball ships the built web assets and nothing else', () => {
  assertPackagedAssets();
});

test('web package smoke: the packaged tarball serves the shell from built assets without src, CDN, or a dev server', { timeout: 120_000 }, async t => {
  await assertPackagedBoard(t);
});
