import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };


// ---------- resolveParallixHome ----------

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
const storage = mockModule<typeof import('../../../../src/adapters/storage/storage.js')>('../../../../src/adapters/storage/storage.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

test('resolveParallixHome honors PARALLIX_HOME env var', () => {
  const original = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = '/tmp/parallix-test-override';
    assert.equal(storage.resolveParallixHome({ configuration: resolveConfiguration(environment) }), '/tmp/parallix-test-override');
  } finally {
    environment.PARALLIX_HOME = original;
  }
});

test('resolveParallixHome creates directory when ensureDir is true', () => {
  const tmpDir = registeredMkdtemp('storage-test-');
  const testHome = path.join(tmpDir, 'new-dir', 'parallix');
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = testHome;
    const resolved = storage.resolveParallixHome({ ensureDir: true, configuration: resolveConfiguration(environment) });
    assert.equal(resolved, testHome);
    assert.ok(fs.statSync(testHome).isDirectory());
  } finally {
    environment.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveParallixHome returns existing directory when ensureDir is false', () => {
  const tmpDir = registeredMkdtemp('storage-test-');
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = tmpDir;
    const resolved = storage.resolveParallixHome({ configuration: resolveConfiguration(environment), ensureDir: false });
    assert.equal(resolved, path.resolve(tmpDir));
  } finally {
    environment.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveParallixHome normalizes path (resolves symlinks, cleans segments)', () => {
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = '/tmp/../tmp/./parallix-normalize';
    assert.equal(storage.resolveParallixHome({ configuration: resolveConfiguration(environment) }), '/tmp/parallix-normalize');
  } finally {
    environment.PARALLIX_HOME = savedHome;
  }
});

test('resolveParallixHome rejects empty PARALLIX_HOME env var (falls through to platform path)', () => {
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = '';
    const result = storage.resolveParallixHome({ configuration: resolveConfiguration(environment) });
    // Empty string should not override — should use platform fallback (linux path includes /)
    assert.ok(result.includes('parallix'));
  } finally {
    environment.PARALLIX_HOME = savedHome;
  }
});

test('resolveParallixHome selects documented Linux default', () => {
  assert.equal(
    storage.resolveParallixHome({ configuration: resolveConfiguration({}),
      platform: 'linux',

      homedir: () => '/tmp/home'
    }),
    '/tmp/home/.local/state/parallix'
  );
});

test('resolveParallixHome selects documented macOS default', () => {
  assert.equal(
    storage.resolveParallixHome({ configuration: resolveConfiguration({}),
      platform: 'darwin',

      homedir: () => '/Users/operator'
    }),
    '/Users/operator/Library/Application Support/parallix'
  );
});

test('resolveParallixHome selects documented Windows default and fallback', () => {
  assert.equal(
    storage.resolveParallixHome({ configuration: resolveConfiguration({ LOCALAPPDATA: '/tmp/local-app-data' }),
      platform: 'win32',

      homedir: () => '/tmp/home'
    }),
    '/tmp/local-app-data/parallix'
  );
  assert.equal(
    storage.resolveParallixHome({ configuration: resolveConfiguration({}),
      platform: 'win32',

      homedir: () => '/tmp/home'
    }),
    '/tmp/home/.parallix'
  );
});

test('resolveParallixHome uses ~/.parallix for unsupported platforms', () => {
  assert.equal(
    storage.resolveParallixHome({ configuration: resolveConfiguration({}),
      platform: 'freebsd',

      homedir: () => '/tmp/home'
    }),
    '/tmp/home/.parallix'
  );
});

// ---------- resolveAgentsLocalPath ----------

// TASK-2322.08 removed `storage.resolveStatsPath`: statistics live in the
// measurement database, and no runtime path resolves <PARALLIX_HOME>/stats.csv.
test('storage exposes no stats.csv resolver after the measurement cut-over', () => {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  assert.equal(storage.resolveStatsPath, undefined);
});

test('resolveAgentsLocalPath returns <PARALLIX_HOME>/agents.local.json', () => {
  const tmpDir = registeredMkdtemp('storage-agents-');
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = tmpDir;
    assert.equal(storage.resolveAgentsLocalPath({ configuration: resolveConfiguration(environment) }), path.join(tmpDir, 'agents.local.json'));
  } finally {
    environment.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveAgentsLocalPath accepts an explicit string path', () => {
  assert.equal(storage.resolveAgentsLocalPath('/custom/path.json'), '/custom/path.json');
});

// ---------- readJson ----------

test('readJson returns { ok: true } for valid JSON', () => {
  const tmpDir = registeredMkdtemp('storage-json-');
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = tmpDir;
    const file = path.join(tmpDir, 'test.json');
    fs.writeFileSync(file, JSON.stringify({ blocklist: { gemini: true } }), 'utf8');
    const result = storage.readJson(file);
    assert.equal(result.ok, true);
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.equal(result.data.blocklist.gemini, true);
  } finally {
    environment.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readJson returns { ok: false, error: null } for missing file', () => {
  const result = storage.readJson('/tmp/nonexistent-px-storage-test-12345.json');
  assert.equal(result.ok, false);
  assert.equal(result.error, null);
  assert.equal(result.data, null);
});

test('readJson returns { ok: false, error } for malformed JSON', () => {
  const tmpDir = registeredMkdtemp('storage-json-');
  try {
    const file = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(file, '{ invalid json }', 'utf8');
    const result = storage.readJson(file);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readJson accepts a resolver function instead of a path', () => {
  const tmpDir = registeredMkdtemp('storage-json-');
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = tmpDir;
    const file = path.join(tmpDir, 'test.json');
    fs.writeFileSync(file, JSON.stringify({ key: 'val' }), 'utf8');
    const result = storage.readJson(() => file);
    assert.equal(result.ok, true);
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.equal(result.data.key, 'val');
  } finally {
    environment.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------- writeJson ----------

test('writeJson writes JSON and creates parent dirs', () => {
  const tmpDir = registeredMkdtemp('storage-write-');
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = tmpDir;
    const nested = path.join(tmpDir, 'sub', 'deep');
    storage.writeJson(path.join(nested, 'data.json'), { hello: 'world' });
    const result = JSON.parse(fs.readFileSync(path.join(nested, 'data.json'), 'utf8'));
    assert.deepEqual(result, { hello: 'world' });
  } finally {
    environment.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeJson accepts a resolver function instead of a path', () => {
  const tmpDir = registeredMkdtemp('storage-write-');
  const savedHome = environment.PARALLIX_HOME;
  try {
    environment.PARALLIX_HOME = tmpDir;
    const file = path.join(tmpDir, 'resolved.json');
    storage.writeJson(() => file, { resolved: true });
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(result, { resolved: true });
  } finally {
    environment.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic propagates write failure and removes its stale temporary file', () => {
  const tmpDir = registeredMkdtemp('storage-write-fail-');
  const target = path.join(tmpDir, 'state.json');
  const staleTemp = path.join(tmpDir, '.state.json.stale.tmp');
  fs.writeFileSync(staleTemp, 'stale');
  const fsModule = { ...fs, writeFileSync() { throw new Error('injected write failure'); } };
  try {
    assert.throws(
      () => storage.writeFileAtomic(target, 'new', { fsModule, tempPathFactory: () => staleTemp }),
      /injected write failure/
    );
    assert.equal(fs.existsSync(staleTemp), false);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic propagates rename failure and preserves the previous valid file', () => {
  const tmpDir = registeredMkdtemp('storage-rename-fail-');
  const target = path.join(tmpDir, 'state.json');
  const temp = path.join(tmpDir, '.state.json.rename.tmp');
  fs.writeFileSync(target, 'previous\n');
  const fsModule = { ...fs, renameSync() { throw new Error('injected rename failure'); } };
  try {
    assert.throws(
      () => storage.writeFileAtomic(target, 'replacement\n', { fsModule, tempPathFactory: () => temp }),
      /injected rename failure/
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'previous\n');
    assert.equal(fs.existsSync(temp), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic successfully replaces content and preserves permission mode', () => {
  const tmpDir = registeredMkdtemp('storage-mode-');
  const target = path.join(tmpDir, 'state.json');
  try {
    fs.writeFileSync(target, 'old\n', { mode: 0o640 });
    fs.chmodSync(target, 0o640);
    storage.writeFileAtomic(target, 'new\n');
    assert.equal(fs.readFileSync(target, 'utf8'), 'new\n');
    assert.equal(fs.statSync(target).mode & 0o777, 0o640);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeJson creates parents and serializes UTF-8 with exactly one final newline', () => {
  const tmpDir = registeredMkdtemp('storage-utf8-');
  const target = path.join(tmpDir, 'nested', 'state.json');
  try {
    storage.writeJson(target, { label: 'räksmörgås' });
    const raw = fs.readFileSync(target, 'utf8');
    assert.deepEqual(JSON.parse(raw), { label: 'räksmörgås' });
    assert.equal(raw, `${JSON.stringify({ label: 'räksmörgås' }, null, 2)}\n`);
    assert.equal(raw.endsWith('\n'), true);
    assert.equal(raw.endsWith('\n\n'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic applies a restrictive requested mode to new sensitive state', () => {
  const tmpDir = registeredMkdtemp('storage-sensitive-');
  const target = path.join(tmpDir, 'operator.json');
  try {
    storage.writeFileAtomic(target, '{}\n', { mode: 0o600 });
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------- isInitialized ----------

test('isInitialized returns false for non-existent directory', () => {
  const tmpPath = path.join(os.tmpdir(), 'px-noexist-' + Date.now());
  try {
    const savedHome = environment.PARALLIX_HOME;
    environment.PARALLIX_HOME = tmpPath;
    assert.equal(storage.isInitialized(resolveConfiguration(environment)), false);
  } finally {
    environment.PARALLIX_HOME = undefined;
  }
});

test('isInitialized returns true after ensureDir', () => {
  const tmpPath = path.join(os.tmpdir(), 'px-init-' + Date.now());
  try {
    const savedHome = environment.PARALLIX_HOME;
    environment.PARALLIX_HOME = tmpPath;
    assert.equal(storage.isInitialized(resolveConfiguration(environment)), false);
    storage.resolveParallixHome({ ensureDir: true, configuration: resolveConfiguration(environment) });
    assert.equal(storage.isInitialized(resolveConfiguration(environment)), true);
  } finally {
    environment.PARALLIX_HOME = undefined;
    try { fs.rmSync(tmpPath, { recursive: true, force: true }); } catch {}
  }
});

test('isInitialized returns false when PARALLIX_HOME points to a file', () => {
  const tmpPath = path.join(os.tmpdir(), 'px-file-' + Date.now());
  try {
    fs.writeFileSync(tmpPath, 'not a dir');
    const savedHome = environment.PARALLIX_HOME;
    environment.PARALLIX_HOME = tmpPath;
    assert.equal(storage.isInitialized(resolveConfiguration(environment)), false);
  } finally {
    environment.PARALLIX_HOME = undefined;
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('isInitialized uses default platform path when PARALLIX_HOME is unset', () => {
  const savedHome = environment.PARALLIX_HOME;
  try {
    delete environment.PARALLIX_HOME;
    // Should use platform-specific path; always returns a boolean
    const result = storage.isInitialized(resolveConfiguration(environment));
    assert.equal(typeof result, 'boolean');
  } finally {
    environment.PARALLIX_HOME = savedHome;
  }
});
