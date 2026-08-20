// @ts-nocheck -- exercises the real git helper against a throwaway repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/adapters/git/git.js';
import { isManifestVersionOnlyConflict, resolveManifestVersionDrift } from '../src/adapters/git/manifest-version-drift.js';

/** Run a command in `dir`, throwing on failure. */
function sh(dir: string, args: string[]) {
  const r = git(['-C', dir, ...args]);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stdout}${r.stderr}`);
  }
  return r.stdout;
}

/** Build a repo where `main` is at `mainVer` and `branch` diverged at `branchVer`. */
function makeRepo(initialVer: string, branchVer: string, bumpedVer: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-drift-'));
  const pkg = (v: string) => JSON.stringify({ name: '@x/y', version: v }, null, 2);
  const lock = (v: string) => JSON.stringify({ name: '@x/y', version: v, lockfileVersion: 3, packages: { '': { name: '@x/y', version: v } } }, null, 2);
  sh(dir, ['init', '-q']);
  sh(dir, ['config', 'user.email', 't@t']);
  sh(dir, ['config', 'user.name', 't']);
  sh(dir, ['checkout', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg(initialVer));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lock(initialVer));
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-qm', 'main']);
  sh(dir, ['checkout', '-q', '-b', 'branch']);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg(branchVer));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lock(branchVer));
  fs.writeFileSync(path.join(dir, 'README.md'), 'real content change\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-qm', 'branch']);
  sh(dir, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg(bumpedVer));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lock(bumpedVer));
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-qm', 'bump']);
  return dir;
}

test('isManifestVersionOnlyConflict flags only the manifest files', () => {
  assert.equal(isManifestVersionOnlyConflict(['package.json', 'package-lock.json']), true);
  assert.equal(isManifestVersionOnlyConflict(['package.json', 'src/index.ts']), false);
  assert.equal(isManifestVersionOnlyConflict([]), false);
});

test('resolveManifestVersionDrift takes the newer version (main ahead)', () => {
  const dir = makeRepo('1.5.3', '1.5.0', '1.5.4');
  try {
    const merge = git(['-C', dir, 'merge', '--no-commit', '--no-ff', 'branch']);
    assert.notEqual(merge.status, 0, 'expected a conflict');
    assert.equal(resolveManifestVersionDrift(dir, { gitRunner: git }), true);
    const remaining = git(['-C', dir, 'diff', '--name-only', '--diff-filter=U']);
    assert.equal(remaining.stdout.trim(), '', 'all manifest conflicts resolved');
    // main's newer version must win (resolved into the index).
    assert.match(git(['-C', dir, 'show', ':0:package.json']).stdout, /"version": "1\.5\.4"/);
    git(['-C', dir, 'merge', '--abort']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** makeRepo variant where the branch adds real (non-version) content to package.json. */
function makeRepoWithContentChange(initialVer: string, branchVer: string, bumpedVer: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-drift-content-'));
  const pkg = (v: string, extra = '') => JSON.stringify({ name: '@x/y', version: v, ...extra }, null, 2);
  const lock = (v: string) => JSON.stringify({ name: '@x/y', version: v, lockfileVersion: 3, packages: { '': { name: '@x/y', version: v } } }, null, 2);
  sh(dir, ['init', '-q']);
  sh(dir, ['config', 'user.email', 't@t']);
  sh(dir, ['config', 'user.name', 't']);
  sh(dir, ['checkout', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg(initialVer));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lock(initialVer));
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-qm', 'main']);
  sh(dir, ['checkout', '-q', '-b', 'branch']);
  // Branch adds a real dependency field (content change), not just a version.
  fs.writeFileSync(path.join(dir, 'package.json'), pkg(branchVer, { dependencies: { lodash: '^4.0.0' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lock(branchVer));
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-qm', 'branch']);
  sh(dir, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg(bumpedVer));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lock(bumpedVer));
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-qm', 'bump']);
  return dir;
}

test('resolveManifestVersionDrift fails closed on real content change (no data loss)', () => {
  const dir = makeRepoWithContentChange('1.5.3', '1.5.0', '1.5.4');
  try {
    const merge = git(['-C', dir, 'merge', '--no-commit', '--no-ff', 'branch']);
    assert.notEqual(merge.status, 0, 'expected a conflict');
    // Real content conflict: must NOT be silently resolved to main's version.
    assert.equal(resolveManifestVersionDrift(dir, { gitRunner: git }), false);
    git(['-C', dir, 'merge', '--abort']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveManifestVersionDrift takes the newer version (branch ahead)', () => {
  const dir = makeRepo('1.5.2', '1.5.9', '1.5.4');
  try {
    const merge = git(['-C', dir, 'merge', '--no-commit', '--no-ff', 'branch']);
    assert.notEqual(merge.status, 0, 'expected a conflict');
    assert.equal(resolveManifestVersionDrift(dir, { gitRunner: git }), true);
    const remaining = git(['-C', dir, 'diff', '--name-only', '--diff-filter=U']);
    assert.equal(remaining.stdout.trim(), '', 'all manifest conflicts resolved');
    // branch's newer version must win (resolved into the index).
    assert.match(git(['-C', dir, 'show', ':0:package.json']).stdout, /"version": "1\.5\.9"/);
    git(['-C', dir, 'merge', '--abort']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
