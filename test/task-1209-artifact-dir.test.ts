


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const reviewArtifactPathModule = mockModule<typeof import('../src/adapters/review/review-artifacts.js')>('../src/adapters/review/review-artifacts.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { reviewArtifactPath, resolveArtifactDir } = reviewArtifactPathModule;
function withTempRepo(config, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1209-artifact-dir-'));
  try {
    if (config !== null) {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify(config));
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ============================================================================
// SC3: reviewArtifactPath honors an explicit tmpDir
// ============================================================================

test('reviewArtifactPath builds path under the supplied tmpDir (task-1209 SC3)', () => {
  assert.equal(
    reviewArtifactPath('task-999', 'review-findings.md', '/custom/tmp'),
    path.join('/custom/tmp', 'task-999-review-findings.md')
  );
});

test('reviewArtifactPath falls back to os.tmpdir() when tmpDir omitted', () => {
  assert.equal(
    reviewArtifactPath('task-999', 'review-findings.md'),
    path.join(os.tmpdir(), 'task-999-review-findings.md')
  );
});

// ============================================================================
// SC2: resolveArtifactDir reads adapters.review.tmpDir, else os.tmpdir()
// ============================================================================

test('resolveArtifactDir returns configured adapters.review.tmpDir when present (task-1209 SC2)', () => {
  withTempRepo({ product: {}, adapters: { review: { provider: 'none', tmpDir: '/tmp/task-1209-tests' } } }, root => {
    assert.equal(resolveArtifactDir(root), '/tmp/task-1209-tests');
  });
});

test('resolveArtifactDir falls back to os.tmpdir() when tmpDir absent (task-1209 SC2)', () => {
  withTempRepo({ product: {}, adapters: { review: { provider: 'none' } } }, root => {
    assert.equal(resolveArtifactDir(root), os.tmpdir());
  });
});

test('resolveArtifactDir falls back to os.tmpdir() when no config file exists', () => {
  withTempRepo(null, root => {
    assert.equal(resolveArtifactDir(root), os.tmpdir());
  });
});

test('resolveArtifactDir resolves a relative tmpDir against the repo root', () => {
  withTempRepo({ product: {}, adapters: { review: { provider: 'none', tmpDir: '.review-artifacts' } } }, root => {
    assert.equal(resolveArtifactDir(root), path.resolve(root, '.review-artifacts'));
  });
});

test('resolveArtifactDir ignores a blank tmpDir', () => {
  withTempRepo({ product: {}, adapters: { review: { provider: 'none', tmpDir: '   ' } } }, root => {
    assert.equal(resolveArtifactDir(root), os.tmpdir());
  });
});
