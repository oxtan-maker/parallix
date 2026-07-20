// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const { violationsFor } = require('../scripts/package-content-audit.js');
const { compareFileLists } = require('../scripts/verify-reproducible-dist.js');

test('package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules', () => {
  const valid = [
    'dist/index.js', 'dist/index.js.map', 'dist/px.js', 'dist/px.js.map',
    'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'tools/setup-forgejo-docker.sh',
    'config/a.json', 'data/a.json', 'docs/a.md', 'examples/a.sh', 'prompts/a.md', 'templates/a.md',
  ];
  assert.deepEqual(violationsFor(valid), []);
  assert.match(violationsFor([...valid, 'test/leak.test.js', 'lib/core/leak.ts']).join('\n'), /forbidden package file/);
});

test('reproducible dist check compares complete clean-build file lists', () => {
  assert.equal(compareFileLists(['index.js', 'px.js'], ['index.js', 'px.js']), true);
  assert.equal(compareFileLists(['index.js'], ['index.js', 'px.js']), false);
});
