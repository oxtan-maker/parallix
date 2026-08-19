
// TASK-2381 reproduction: the SEA payload under build/sea/ must never reach the
// npm tarball. build/sea/ is written by scripts/build-sea.ts and released via
// scripts/package-native-release.ts; build/manifest.sha256 deliberately does not
// cover it, so a packed build/sea/** made checksumViolations() fail publishing.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
import { violationsFor } from '../scripts/package-content-audit.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGE_FILES_WITH_SEA = [
  'build/px.mjs',
  'build/px.mjs.map',
  'build/asset-manifest.json',
  'build/manifest.sha256',
  'build/package.json',
  'build/sbom.json',
  'build/config/x',
  'build/migrations/x',
  'build/prompts/x',
  'build/templates/x',
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICES',
  'build/sea/px',
  'build/sea/manifest.sha256',
];

test('violationsFor flags build/sea payload files as forbidden package files', () => {
  const violations = violationsFor(PACKAGE_FILES_WITH_SEA);
  assert.ok(
    violations.includes('forbidden package file: build/sea/px'),
    `expected build/sea/px to be forbidden, got: ${JSON.stringify(violations)}`,
  );
  assert.ok(
    violations.includes('forbidden package file: build/sea/manifest.sha256'),
    `expected build/sea/manifest.sha256 to be forbidden, got: ${JSON.stringify(violations)}`,
  );
  // The negation must not eat the rest of the build/ payload.
  assert.deepEqual(
    violations.filter(violation => !violation.startsWith('forbidden package file: build/sea/')),
    [],
  );
});

test('package.json files allowlist negates the SEA payload directory', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.ok(
    manifest.files.some((entry: string) => /^!build\/sea/.test(entry)),
    `expected a !build/sea negation in files, got: ${JSON.stringify(manifest.files)}`,
  );
  for (const required of ['build/', 'LICENSE', 'README.md', 'NOTICES']) {
    assert.ok(manifest.files.includes(required), `files must still contain ${required}`);
  }
});
