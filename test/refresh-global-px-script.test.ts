


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const resolvePostIntegrateCommandModule = mockModule<typeof import('../src/adapters/process/post-integrate-hook.js')>('../src/adapters/process/post-integrate-hook.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { resolvePostIntegrateCommand } = resolvePostIntegrateCommandModule;
const REPO_ROOT = path.join(import.meta.dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

// These tests only prove the script is wired up, syntactically valid, and reads
// the hook env vars it documents. They never execute the script for real: it
// runs `npm pack` and `npm install -g`, which would mutate the operator's actual
// global npm install.

test('workflow.config.json wires the generic post-integrate hook to the checked-in script', () => {
  const command = resolvePostIntegrateCommand(REPO_ROOT);
  assert.equal(command, './scripts/refresh-global-px.sh && npm run sonar:delete-branch');
});

test('the post-integrate hook chain runs the global px refresh before the SonarQube mission branch deletion', () => {
  const command = resolvePostIntegrateCommand(REPO_ROOT) || '';
  const refreshIndex = command.indexOf('./scripts/refresh-global-px.sh');
  const deleteIndex = command.indexOf('npm run sonar:delete-branch');
  assert.ok(refreshIndex !== -1, `refresh step missing from: ${command}`);
  assert.ok(deleteIndex !== -1, `deletion step missing from: ${command}`);
  assert.ok(refreshIndex < deleteIndex, 'refresh-global-px.sh must complete before the deletion step starts');
  // The `&&` chain means a refresh failure aborts the hook before any
  // SonarQube call; the deletion step itself never fails the hook because the
  // delete-branch subcommand always exits 0 (ADR 0060).
  assert.match(command, /&&/);
});

test('no product code path invokes the SonarQube mission branch deletion', () => {
  // The deletion is reachable only through the post-integrate hook, which runs
  // solely from the confirmed-integration landing path after the landed
  // integration is persisted. Failed, closed, and review-only missions never
  // run postIntegrateCommand, and no code under src/ may invoke the deletion
  // directly (ADR 0060 product boundary).
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') ? [full] : [];
  });
  const offenders = walk(path.join(REPO_ROOT, 'src')).filter(file => {
    const content = fs.readFileSync(file, 'utf8');
    return content.includes('sonar:delete-branch') || content.includes('deleteMissionBranch') || content.includes('deleteSonarBranch');
  });
  assert.deepEqual(offenders, [], 'the SonarQube branch deletion must be wired only through workflow.config.json postIntegrateCommand');
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

test('scripts/refresh-global-px.sh rebuilds and reinstalls from a packed tarball without allocating a version', () => {
  const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.match(content, /npm run build/);
  assert.match(content, /npm pack/);
  assert.match(content, /npm install -g/);
  assert.doesNotMatch(content, /npm version/);
  assert.doesNotMatch(content, /git commit/);
  // Uses the hook-provided env vars documented in lib/core/post-integrate-hook.ts.
  assert.match(content, /INTEGRATE_HOOK_SLUG/);
});

test('scripts/refresh-global-px.sh cleans up the packed tarball on both success and failure', () => {
  const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
  // A trap-based cleanup fires on EXIT regardless of whether a later step fails,
  // so no tarball is left behind in the repo root either way (task-1424).
  assert.match(content, /trap\s+'rm -f "\$\{TARBALL\}"'\s+EXIT/);
});

test('workflow.config.json wires local version allocation as the integrate pre-commit hook', () => {
  const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'workflow.config.json'), 'utf8'));
  assert.equal(config.adapters.integrate.preCommitCommand, './scripts/bump-version.sh');
  assert.ok(fs.statSync(path.join(REPO_ROOT, 'scripts', 'bump-version.sh')).mode & 0o111, 'bump-version.sh must be executable');
});
