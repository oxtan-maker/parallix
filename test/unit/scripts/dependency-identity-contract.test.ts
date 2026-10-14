// Dependency install identity contract (TASK-2714).
//
// Boundary: scripts/dependency-identity.mjs decides whether a worktree's
// dependencies must be reconciled, and publishes the identity of a successful
// install. The installer itself is a double here — the real `pnpm install`
// boundary is exercised by test/integration/packaging/post-integrate-global-install-contract.test.ts.
// ADR 0063 owns the install command and pnpm-lock.yaml authority; this suite
// pins that the wrapper does not change them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../helpers/temp-dir.js';

// Dynamic import through a variable keeps the .mjs script out of the test
// typegraph while still loading the real module under test.
const identityModuleUrl = new URL('../../../scripts/dependency-identity.mjs', import.meta.url).href;
const identity = (await import(identityModuleUrl)) as typeof import('../../../scripts/dependency-identity.mjs');
const {
  IDENTITY_RELATIVE_PATH,
  INSTALL_ARGS,
  INSTALL_COMMAND,
  INSTALL_STATE_DIRECTORY,
  computeDependencyIdentity,
  readInstalledIdentity,
  readIdentityRecord,
  ensureDependencies,
  installedStatePresent,
  normalizeYamlLockfile,
} = identity;

const LOCKFILE = [
  'lockfileVersion: 9.0',
  'settings:',
  '  autoInstallPeers: true',
  'importers:',
  '  .:',
  '    dependencies:',
  '      left:',
  "        specifier: '^1.0.0'",
  "        version: 1.0.0",
  'packages:',
  '  left@1.0.0:',
  '    resolution: {integrity: sha512-aaaa==}',
  '    engines: {node: \'>=18\'}',
  'snapshots:',
  '  left@1.0.0:',
  '    dependencies:',
  '      right: 2.0.0',
  'version: 9.0',
  '',
].join('\n');

/** @param {string} dir @param {{version?: string, dependencies?: Record<string,string>}} [options] */
function seedWorktree(dir, { version = '1.0.0', dependencies = { left: '^1.0.0' } } = {}) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'fixture',
    version,
    packageManager: 'pnpm@12.9.1',
    dependencies,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), LOCKFILE, 'utf8');
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'overrides:\n  source-map-js: 1.2.2\n', 'utf8');
  return dir;
}

/**
 * Spawn double: records every installer invocation, returns a fixed status and,
 * on success, materialises the installed tree the identity describes. The real
 * `pnpm install` writes node_modules; a double that never does would let the
 * presence check pass on a fiction.
 */
function spawnRecorder(worktree: string, status = 0) {
  /** @type {Array<[string, string[]]>} */
  const calls: Array<[string, string[]]> = [];
  return {
    calls,
    installCount: () => calls.length,
    spawnFn: (_command: string, args: string[]) => {
      calls.push([_command, args]);
      if (status === 0) {
        fs.mkdirSync(path.join(worktree, INSTALL_STATE_DIRECTORY, '.pnpm', 'left@1.0.0'), { recursive: true });
      }
      return { status };
    },
  };
}

function identityPath(dir: string) {
  return path.join(dir, IDENTITY_RELATIVE_PATH);
}

test('a successful install publishes the identity and the next run skips reconciliation (TASK-2714)', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-skip-'));
  const spawn = spawnRecorder(worktree);
  const log: string[] = [];
  try {
    const first = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: (line) => log.push(line) });
    assert.equal(first.action, 'installed');
    assert.equal(first.exitCode, 0);
    assert.equal(spawn.installCount(), 1);
    assert.ok(fs.existsSync(identityPath(worktree)), 'the successful identity is published');

    const second = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: (line) => log.push(line) });
    assert.equal(second.action, 'skipped');
    assert.equal(second.reason, 'identity-match');
    assert.equal(spawn.installCount(), 1, 'a routine refresh does not reinstall');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('the identity wrapper keeps ADR 0063 install authority: pnpm, frozen lockfile, prefer-offline', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-command-'));
  const spawn = spawnRecorder(worktree);
  try {
    ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
    assert.equal(INSTALL_COMMAND, 'pnpm');
    assert.deepEqual(INSTALL_ARGS, ['install', '--frozen-lockfile', '--prefer-offline']);
    assert.deepEqual(spawn.calls[0], ['pnpm', ['install', '--frozen-lockfile', '--prefer-offline']]);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('release version-only changes keep the installed identity unchanged (TASK-2714)', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-version-'));
  const spawn = spawnRecorder(worktree);
  try {
    ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });

    // scripts/bump-version.sh rewrites package.json `version` and, where the root
    // lockfile carries one, that lockfile's root version metadata.
    fs.writeFileSync(path.join(worktree, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.1', packageManager: 'pnpm@12.9.1', dependencies: { left: '^1.0.0' },
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(worktree, 'pnpm-lock.yaml'), LOCKFILE.replace('version: 9.0', 'version: 9.1'), 'utf8');

    const before = computeDependencyIdentity(worktree).identity;
    const result = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
    assert.equal(result.action, 'skipped', 'version metadata is not an install input');
    assert.equal(result.identity, before);
    assert.equal(spawn.installCount(), 1);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('normalizeYamlLockfile drops only root version metadata, never nested resolutions', () => {
  const normalized = normalizeYamlLockfile(LOCKFILE);
  assert.ok(!normalized.includes('version: 9.0'), 'the top-level lockfile version is release metadata');
  assert.ok(normalized.includes('version: 1.0.0'), 'importer resolutions stay in the identity');
  assert.ok(normalized.includes('resolution: {integrity: sha512-aaaa==}'), 'integrity stays in the identity');
});

test('dependency, resolution, integrity, install-policy and toolchain changes each invalidate the identity (TASK-2714)', () => {
  const mutations: Array<[string, (dir: string) => void]> = [
    ['added dependency', (dir) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', packageManager: 'pnpm@12.9.1', dependencies: { left: '^1.0.0', right: '^2.0.0' },
    }, null, 2), 'utf8')],
    ['changed dependency specifier', (dir) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', packageManager: 'pnpm@12.9.1', dependencies: { left: '^2.0.0' },
    }, null, 2), 'utf8')],
    ['changed resolution', (dir) => fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), LOCKFILE.replace('version: 1.0.0', 'version: 1.0.1'), 'utf8')],
    ['changed integrity', (dir) => fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), LOCKFILE.replace('sha512-aaaa==', 'sha512-bbbb=='), 'utf8')],
    ['changed install policy', (dir) => fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'overrides:\n  source-map-js: 1.2.1\n', 'utf8')],
    ['changed pinned toolchain', (dir) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', packageManager: 'pnpm@12.10.0', dependencies: { left: '^1.0.0' },
    }, null, 2), 'utf8')],
  ];

  for (const [label, mutate] of mutations) {
    const worktree = seedWorktree(mkdtemp(`dep-identity-${label.replace(/\s+/g, '-')}-`));
    const spawn = spawnRecorder(worktree);
    try {
      ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
      mutate(worktree);
      const result = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
      assert.equal(result.action, 'installed', `${label} must reconcile the install`);
      assert.equal(spawn.installCount(), 2, `${label} must run the installer again`);
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
});

test('a different pinned node runtime invalidates the identity for the same dependency inputs', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-node-'));
  const spawn = spawnRecorder(worktree);
  try {
    ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
    const result = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {}, nodeVersion: 'v99.0.0' });
    assert.equal(result.action, 'installed', 'engines-sensitive installs must not be skipped for a new toolchain');
    assert.equal(spawn.installCount(), 2);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('missing, unreadable and schema-invalid identity records all reconcile instead of skipping', () => {
  const cases: Array<[string, (dir: string) => void]> = [
    ['missing', (dir) => fs.rmSync(identityPath(dir), { force: true })],
    ['unreadable', (dir) => fs.writeFileSync(identityPath(dir), 'not json at all', 'utf8')],
    ['schema-mismatch', (dir) => fs.writeFileSync(identityPath(dir), JSON.stringify({
      schema: 999, identity: 'a'.repeat(64),
    }), 'utf8')],
    ['malformed-identity', (dir) => fs.writeFileSync(identityPath(dir), JSON.stringify({
      schema: 1, identity: 'nope',
    }), 'utf8')],
  ];

  for (const [label, corrupt] of cases) {
    const worktree = seedWorktree(mkdtemp(`dep-identity-${label}-`));
    const spawn = spawnRecorder(worktree);
    try {
      ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
      corrupt(worktree);
      assert.equal(readInstalledIdentity(worktree), null, `${label} identity record must read as unusable`);
      const result = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
      assert.equal(result.action, 'installed', `${label} identity record must trigger reconciliation`);
      assert.equal(spawn.installCount(), 2);
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
});

test('a failed install publishes no successful identity, keeps the prior record untrusted and blocks dependent work', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-failure-'));
  const ok = spawnRecorder(worktree, 0);
  try {
    const first = ensureDependencies({ worktree, spawnFn: ok.spawnFn, logFn: () => {} });
    const published = readInstalledIdentity(worktree);
    assert.equal(published.identity, first.identity);

    fs.writeFileSync(path.join(worktree, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', packageManager: 'pnpm@12.9.1', dependencies: { left: '^1.0.0', right: '^2.0.0' },
    }, null, 2), 'utf8');

    const failing = spawnRecorder(worktree, 1);
    const result = ensureDependencies({ worktree, spawnFn: failing.spawnFn, logFn: () => {} });
    assert.equal(result.action, 'failed');
    assert.equal(result.exitCode, 1, 'the caller stops on the installer status');
    assert.equal(readInstalledIdentity(worktree), null, 'a failed install leaves no successful identity');
    assert.equal(readIdentityRecord(worktree)?.identity, published.identity,
      'the prior identity stays in the file for inspection, marked pending');
    assert.ok(readIdentityRecord(worktree)?.pendingReconciliation, 'the record is explicitly withdrawn');

    // The next run must reconcile again rather than trust the stale record.
    const retry = spawnRecorder(worktree, 0);
    const next = ensureDependencies({ worktree, spawnFn: retry.spawnFn, logFn: () => {} });
    assert.equal(next.action, 'installed');
    assert.equal(readInstalledIdentity(worktree).identity, next.identity);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('a matching identity with a deleted installed tree reconciles instead of skipping (TASK-2714)', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-pruned-'));
  const spawn = spawnRecorder(worktree, 0);
  const log: string[] = [];
  try {
    const first = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: (line) => log.push(line) });
    assert.ok(installedStatePresent(worktree), 'the successful install left an installed tree');

    // The operator prunes the installed tree but the record survives.
    fs.rmSync(path.join(worktree, INSTALL_STATE_DIRECTORY), { recursive: true, force: true });
    assert.equal(readInstalledIdentity(worktree)?.identity, first.identity,
      'the record itself still matches the dependency inputs');

    const result = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: (line) => log.push(line) });
    assert.equal(result.action, 'installed', 'an identity match without an installed tree must reconcile');
    assert.equal(result.reason, 'installed dependency tree is missing');
    assert.equal(spawn.installCount(), 2, 'the refresh restores dependencies instead of building on nothing');
    assert.ok(log.some(line => line.includes('node_modules is missing')), 'the reason is reported');
    assert.ok(installedStatePresent(worktree), 'the reconciled tree is present again');

    // An empty node_modules is not an installed tree either.
    fs.rmSync(path.join(worktree, INSTALL_STATE_DIRECTORY), { recursive: true, force: true });
    fs.mkdirSync(path.join(worktree, INSTALL_STATE_DIRECTORY), { recursive: true });
    const emptied = ensureDependencies({ worktree, spawnFn: spawn.spawnFn, logFn: () => {} });
    assert.equal(emptied.action, 'installed', 'an empty node_modules is not proof of an install');
    assert.equal(spawn.installCount(), 3);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('trust is withdrawn before the installer mutates the tree, so a partial install is never covered by the prior success (TASK-2714)', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-partial-'));
  const ok = spawnRecorder(worktree, 0);
  try {
    const first = ensureDependencies({ worktree, spawnFn: ok.spawnFn, logFn: () => {} });
    const manifestA = fs.readFileSync(path.join(worktree, 'package.json'), 'utf8');
    assert.equal(readInstalledIdentity(worktree).identity, first.identity);

    // Inputs change to B and the installer mutates the tree, then fails.
    fs.writeFileSync(path.join(worktree, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', packageManager: 'pnpm@12.9.1', dependencies: { left: '^1.0.0', right: '^2.0.0' },
    }, null, 2), 'utf8');
    const partial = { status: 1, seen: [] as string[] };
    const failingSpawn = (_command: string, args: string[]) => {
      // A real pnpm writes into node_modules before it fails.
      fs.rmSync(path.join(worktree, INSTALL_STATE_DIRECTORY, '.pnpm', 'left@1.0.0'), { recursive: true, force: true });
      fs.mkdirSync(path.join(worktree, INSTALL_STATE_DIRECTORY, '.pnpm', 'right@2.0.0-beta'), { recursive: true });
      partial.seen.push(args.join(' '));
      return { status: 1 };
    };
    const failed = ensureDependencies({ worktree, spawnFn: failingSpawn, logFn: () => {} });
    assert.equal(failed.action, 'failed');
    assert.equal(readInstalledIdentity(worktree), null,
      'trust is gone before the installer touches the tree, not only after it fails');

    // The operator reverts the inputs to A. The A identity still matches the record
    // file, but that record was withdrawn: the half-installed B tree must be rebuilt.
    fs.writeFileSync(path.join(worktree, 'package.json'), manifestA, 'utf8');
    assert.equal(computeDependencyIdentity(worktree).identity, first.identity, 'inputs are back to A');
    const reverted = ensureDependencies({ worktree, spawnFn: spawnRecorder(worktree, 0).spawnFn, logFn: () => {} });
    assert.equal(reverted.action, 'installed', 'reverted inputs after a partial failure still reconcile');
    assert.equal(reverted.identity, first.identity);
    assert.equal(readInstalledIdentity(worktree).identity, first.identity, 'success republishes a trusted record');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('a forced reinstall that fails leaves the identity untrusted (TASK-2714)', () => {
  const worktree = seedWorktree(mkdtemp('dep-identity-force-fail-'));
  const ok = spawnRecorder(worktree, 0);
  try {
    const first = ensureDependencies({ worktree, spawnFn: ok.spawnFn, logFn: () => {} });
    const failed = ensureDependencies({ worktree, force: true, spawnFn: spawnRecorder(worktree, 1).spawnFn, logFn: () => {} });
    assert.equal(failed.action, 'failed');
    assert.equal(failed.exitCode, 1);
    assert.equal(readInstalledIdentity(worktree), null, 'a forced reinstall that fails cannot keep the old success trusted');
    const retry = ensureDependencies({ worktree, spawnFn: spawnRecorder(worktree, 0).spawnFn, logFn: () => {} });
    assert.equal(retry.action, 'installed');
    assert.equal(retry.identity, first.identity);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('parallel worktrees keep independent identities and never overwrite each other', () => {
  const parent = mkdtemp('dep-identity-parallel-');
  const a = path.join(parent, 'worktree-a');
  const b = path.join(parent, 'worktree-b');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  seedWorktree(a);
  seedWorktree(b);
  const spawnA = spawnRecorder(a);
  const spawnB = spawnRecorder(b);
  try {
    const first = ensureDependencies({ worktree: a, spawnFn: spawnA.spawnFn, logFn: () => {} });
    assert.ok(!fs.existsSync(identityPath(b)), 'a sibling worktree has no identity until it installs');

    const second = ensureDependencies({ worktree: b, spawnFn: spawnB.spawnFn, logFn: () => {} });
    assert.equal(second.action, 'installed', 'each worktree records its own successful install');
    assert.equal(spawnA.installCount(), 1);
    assert.equal(spawnB.installCount(), 1);
    assert.equal(second.identity, first.identity, 'identical inputs hash identically');
    assert.notEqual(identityPath(a), identityPath(b));

    // Reconciling one worktree must not let the other skip its own install.
    fs.writeFileSync(path.join(b, 'pnpm-workspace.yaml'), 'overrides:\n  source-map-js: 1.3.0\n', 'utf8');
    const third = ensureDependencies({ worktree: b, spawnFn: spawnB.spawnFn, logFn: () => {} });
    assert.equal(third.action, 'installed');
    assert.equal(readInstalledIdentity(a).identity, first.identity, 'worktree A keeps its own record');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
