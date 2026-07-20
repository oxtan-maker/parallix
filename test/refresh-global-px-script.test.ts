// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { resolvePostIntegrateCommand } = require('../dist/lib/core/post-integrate-hook');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

// These tests only prove the script is wired up, syntactically valid, and reads
// the hook env vars it documents. They never execute the script for real: it
// runs `npm version`, `npm pack`, and `npm install -g`, which would mutate this
// checkout's package metadata and the operator's actual global npm install.

test('workflow.config.json wires the generic post-integrate hook to the checked-in script', () => {
  const command = resolvePostIntegrateCommand(REPO_ROOT);
  assert.equal(command, './scripts/refresh-global-px.sh');
});

test('scripts/refresh-global-px.sh exists and is executable', () => {
  assert.ok(fs.existsSync(SCRIPT_PATH), 'refresh-global-px.sh should be checked in under scripts/');
  const mode = fs.statSync(SCRIPT_PATH).mode;
  assert.ok(mode & 0o111, 'refresh-global-px.sh should have an executable bit set');
});

test('scripts/refresh-global-px.sh is syntactically valid bash', () => {
  const result = spawnSync('bash', ['-n', SCRIPT_PATH], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('scripts/refresh-global-px.sh bumps the patch version and reinstalls from a packed tarball of this checkout', () => {
  const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.match(content, /npm version patch/);
  assert.match(content, /npm run build/);
  assert.match(content, /npm pack/);
  assert.match(content, /npm install -g/);
  // Uses the hook-provided env vars documented in lib/core/post-integrate-hook.ts.
  assert.match(content, /INTEGRATE_HOOK_SLUG/);
});

test('scripts/refresh-global-px.sh cleans up the packed tarball on both success and failure', () => {
  const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
  // A trap-based cleanup fires on EXIT regardless of whether a later step fails,
  // so no tarball is left behind in the repo root either way (task-1424).
  assert.match(content, /trap\s+'rm -f "\$\{TARBALL\}"'\s+EXIT/);
});
