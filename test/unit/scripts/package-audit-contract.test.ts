// Regression provenance: TASK-2228.

// The published package shape after TASK-2285: the canonical ESM bundle plus
// release metadata, with runtime assets staged under the bundle's payload root.

import test from 'node:test';
import assert from 'node:assert/strict';
import { violationsFor, parsePackReport } from '../../../scripts/package-content-audit.js';
import { artifactDifferences, compareFileLists } from '../../../scripts/verify-reproducible-build.js';
const VALID_PACKAGE_FILES = [
  'build/asset-manifest.json',
  'build/config/agents.json',
  'build/config/state-map.json',
  'build/manifest.sha256',
  'build/migrations/0001-initial-schema.sql',
  'build/migrations/0002-import-history.sql',
  'build/migrations/0003-board-lane-events.sql',
  'build/migrations/0004-mission-aggregate.sql',
  'build/migrations/0005-mission-external-task-ref.sql',
  'build/migrations/0005-repository-scoped-session-markers.sql',
  'build/migrations/0006-session-markers.sql',
  'build/package.json',
  'build/prompts/act-on-review.md',
  'build/prompts/draft.md',
  'build/prompts/execute.md',
  'build/prompts/review.md',
  'build/px.mjs',
  'build/px.mjs.map',
  'build/sbom.json',
  'build/templates/mission-scaffold.md',
  'build/web/index.html',
  'build/web/manifest.json',
  'build/web/assets/index-hash.js',
  'build/web/fonts/FONTS.txt',
  'build/web/fonts/OFL-Barlow-Condensed.txt',
  'build/web/fonts/OFL-JetBrains-Mono.txt',
  'build/web/fonts/barlow-condensed-latin-400.woff2',
  'build/web/fonts/jetbrains-mono-latin-400.woff2',
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICES',
];

test('package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules', () => {
  assert.deepEqual(violationsFor(VALID_PACKAGE_FILES), []);
  assert.match(
    violationsFor([...VALID_PACKAGE_FILES, 'test/leak.test.js', 'src/entry/px.ts']).join('\n'),
    /forbidden package file/,
  );
});

test('package-content audit rejects the pre-TASK-2285 CommonJS dist package shape', () => {
  const violations = violationsFor([
    'dist/index.js', 'dist/index.js.map', 'dist/px.js', 'dist/px.js.map',
    'package.json', 'README.md', 'LICENSE',
    'config/agents.json', 'prompts/draft.md', 'templates/mission-scaffold.md',
    'tools/setup-forgejo-docker.sh',
  ]).join('\n');
  assert.match(violations, /forbidden package file: dist\/px\.js/);
  assert.match(violations, /forbidden package file: config\/agents\.json/);
  assert.match(violations, /forbidden package file: tools\/setup-forgejo-docker\.sh/);
  assert.match(violations, /missing required package file: build\/px\.mjs/);
  assert.match(violations, /missing required package file: NOTICES/);
  assert.match(violations, /missing canonical ESM bundle/);
});

test('package-content audit requires the release-metadata artifacts', () => {
  for (const required of ['NOTICES', 'build/sbom.json', 'build/manifest.sha256']) {
    const withoutOne = VALID_PACKAGE_FILES.filter(file => file !== required);
    assert.match(
      violationsFor(withoutOne).join('\n'),
      new RegExp(`missing required package file: ${required.replace('/', '\\/')}`),
      `${required} must be a required package file`,
    );
  }
});

test('package-content audit rejects payload files outside build/ and the metadata allowlist', () => {
  assert.match(
    violationsFor([...VALID_PACKAGE_FILES, 'workflow.config.json']).join('\n'),
    /forbidden package file: workflow\.config\.json/,
  );
  assert.match(
    violationsFor([...VALID_PACKAGE_FILES, 'stats.csv']).join('\n'),
    /unexpected package file outside build\/: stats\.csv/,
  );
});

test('package-content audit rejects omitted web payloads (TASK-2762)', () => {
  for (const required of ['build/web/index.html', 'build/web/manifest.json']) {
    assert.ok(violationsFor(VALID_PACKAGE_FILES.filter(file => file !== required))
      .includes(`missing required package file: ${required}`));
  }
  assert.ok(violationsFor(VALID_PACKAGE_FILES.filter(file => !file.startsWith('build/web/assets/')))
    .includes('missing required package asset directory: build/web/assets/'));
});

test('package-content audit rejects a packaged tree missing a bundled font subset or its notices (TASK-2773.11)', () => {
  // A lost subset renders the platform fallback faces with no signal, and a
  // lost licence or coverage record ships OFL-licensed binaries with no record
  // of what they cover. Both fail the package.
  for (const [font, family] of [
    ['build/web/fonts/jetbrains-mono-latin-400.woff2', 'jetbrains-mono'],
    ['build/web/fonts/barlow-condensed-latin-400.woff2', 'barlow-condensed'],
  ] as const) {
    assert.ok(violationsFor(VALID_PACKAGE_FILES.filter(file => file !== font))
      .includes(`missing required package font subset: build/web/fonts/${family}-*.woff2`),
    `${font} must be required in the packaged tree`);
  }
  for (const notice of ['build/web/fonts/FONTS.txt', 'build/web/fonts/OFL-JetBrains-Mono.txt',
    'build/web/fonts/OFL-Barlow-Condensed.txt']) {
    assert.ok(violationsFor(VALID_PACKAGE_FILES.filter(file => file !== notice))
      .includes(`missing required package font notice: ${notice}`), `${notice} must ship with the font assets`);
  }
});

test('pack report parses past prepack build output on stdout', () => {
  const report = '[bundle-size] build/px.mjs: 2 809 346 bytes (2.7 MB)\n'
    + '[bundle-size] PASS: 2.7 MB within 5 MB stop rule\n'
    + '[\n  {\n    "files": [ { "path": "build/px.mjs" } ]\n  }\n]\n';
  assert.deepEqual(parsePackReport(report)[0].files, [{ path: 'build/px.mjs' }]);
  // A clean stdout with no prepack noise still parses.
  assert.deepEqual(parsePackReport('[\n  {\n    "files": []\n  }\n]\n')[0].files, []);
});

test('reproducible build check compares complete clean-build file lists', () => {
  assert.equal(compareFileLists(['px.mjs', 'px.mjs.map'], ['px.mjs', 'px.mjs.map']), true);
  assert.equal(compareFileLists(['px.mjs'], ['px.mjs', 'px.mjs.map']), false);
});

test('reproducible build check reports added, removed, and byte-changed artifacts', () => {
  const base = { files: ['px.mjs', 'sbom.json'], digests: { 'px.mjs': 'aaa', 'sbom.json': 'bbb' } };
  assert.deepEqual(artifactDifferences(base, base), []);

  const renamed = { files: ['px.mjs'], digests: { 'px.mjs': 'aaa' } };
  assert.deepEqual(artifactDifferences(base, renamed), ['only in first build: sbom.json']);
  assert.deepEqual(artifactDifferences(renamed, base), ['only in second build: sbom.json']);

  // A nondeterministic build emits the same file names with different bytes —
  // the failure mode the retired file-list-only check could not see.
  const rebuilt = { files: ['px.mjs', 'sbom.json'], digests: { 'px.mjs': 'aaa', 'sbom.json': 'ccc' } };
  assert.deepEqual(artifactDifferences(base, rebuilt), ['content differs: sbom.json (bbb != ccc)']);
});
