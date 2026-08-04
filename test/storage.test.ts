
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const storage = require('../.test-runtime/adapters/storage/storage.js');

// ---------- resolveParallixHome ----------

test('resolveParallixHome honors PARALLIX_HOME env var', () => {
  const original = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = '/tmp/parallix-test-override';
    assert.equal(storage.resolveParallixHome(), '/tmp/parallix-test-override');
  } finally {
    process.env.PARALLIX_HOME = original;
  }
});

test('resolveParallixHome creates directory when ensureDir is true', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const testHome = path.join(tmpDir, 'new-dir', 'parallix');
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = testHome;
    const resolved = storage.resolveParallixHome(true);
    assert.equal(resolved, testHome);
    assert.ok(fs.statSync(testHome).isDirectory());
  } finally {
    process.env.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveParallixHome returns existing directory when ensureDir is false', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = tmpDir;
    const resolved = storage.resolveParallixHome({ ensureDir: false });
    assert.equal(resolved, path.resolve(tmpDir));
  } finally {
    process.env.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveParallixHome normalizes path (resolves symlinks, cleans segments)', () => {
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = '/tmp/../tmp/./parallix-normalize';
    assert.equal(storage.resolveParallixHome(), '/tmp/parallix-normalize');
  } finally {
    process.env.PARALLIX_HOME = savedHome;
  }
});

test('resolveParallixHome rejects empty PARALLIX_HOME env var (falls through to platform path)', () => {
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = '';
    const result = storage.resolveParallixHome();
    // Empty string should not override — should use platform fallback (linux path includes /)
    assert.ok(result.includes('parallix'));
  } finally {
    process.env.PARALLIX_HOME = savedHome;
  }
});

test('resolveParallixHome selects documented Linux default', () => {
  assert.equal(
    storage.resolveParallixHome({
      platform: 'linux',
      env: {},
      homedir: () => '/tmp/home'
    }),
    '/tmp/home/.local/state/parallix'
  );
});

test('resolveParallixHome selects documented macOS default', () => {
  assert.equal(
    storage.resolveParallixHome({
      platform: 'darwin',
      env: {},
      homedir: () => '/Users/operator'
    }),
    '/Users/operator/Library/Application Support/parallix'
  );
});

test('resolveParallixHome selects documented Windows default and fallback', () => {
  assert.equal(
    storage.resolveParallixHome({
      platform: 'win32',
      env: { LOCALAPPDATA: '/tmp/local-app-data' },
      homedir: () => '/tmp/home'
    }),
    '/tmp/local-app-data/parallix'
  );
  assert.equal(
    storage.resolveParallixHome({
      platform: 'win32',
      env: {},
      homedir: () => '/tmp/home'
    }),
    '/tmp/home/.parallix'
  );
});

test('resolveParallixHome uses ~/.parallix for unsupported platforms', () => {
  assert.equal(
    storage.resolveParallixHome({
      platform: 'freebsd',
      env: {},
      homedir: () => '/tmp/home'
    }),
    '/tmp/home/.parallix'
  );
});

// ---------- resolveAgentsLocalPath ----------

// TASK-2322.08 removed `storage.resolveStatsPath`: statistics live in the
// measurement database, and no runtime path resolves <PARALLIX_HOME>/stats.csv.
test('storage exposes no stats.csv resolver after the measurement cut-over', () => {
  assert.equal(storage.resolveStatsPath, undefined);
});

test('resolveAgentsLocalPath returns <PARALLIX_HOME>/agents.local.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-agents-'));
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = tmpDir;
    assert.equal(storage.resolveAgentsLocalPath(), path.join(tmpDir, 'agents.local.json'));
  } finally {
    process.env.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveAgentsLocalPath accepts an explicit string path', () => {
  assert.equal(storage.resolveAgentsLocalPath('/custom/path.json'), '/custom/path.json');
});

// ---------- readJson ----------

test('readJson returns { ok: true } for valid JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-json-'));
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = tmpDir;
    const file = path.join(tmpDir, 'test.json');
    fs.writeFileSync(file, JSON.stringify({ blocklist: { gemini: true } }), 'utf8');
    const result = storage.readJson(file);
    assert.equal(result.ok, true);
    assert.equal(result.data.blocklist.gemini, true);
  } finally {
    process.env.PARALLIX_HOME = savedHome;
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-json-'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-json-'));
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = tmpDir;
    const file = path.join(tmpDir, 'test.json');
    fs.writeFileSync(file, JSON.stringify({ key: 'val' }), 'utf8');
    const result = storage.readJson(() => file);
    assert.equal(result.ok, true);
    assert.equal(result.data.key, 'val');
  } finally {
    process.env.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------- writeJson ----------

test('writeJson writes JSON and creates parent dirs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-write-'));
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = tmpDir;
    const nested = path.join(tmpDir, 'sub', 'deep');
    storage.writeJson(path.join(nested, 'data.json'), { hello: 'world' });
    const result = JSON.parse(fs.readFileSync(path.join(nested, 'data.json'), 'utf8'));
    assert.deepEqual(result, { hello: 'world' });
  } finally {
    process.env.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeJson accepts a resolver function instead of a path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-write-'));
  const savedHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = tmpDir;
    const file = path.join(tmpDir, 'resolved.json');
    storage.writeJson(() => file, { resolved: true });
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(result, { resolved: true });
  } finally {
    process.env.PARALLIX_HOME = savedHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic propagates write failure and removes its stale temporary file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-write-fail-'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-rename-fail-'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-mode-'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-utf8-'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-sensitive-'));
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
    const savedHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = tmpPath;
    assert.equal(storage.isInitialized(), false);
  } finally {
    process.env.PARALLIX_HOME = undefined;
  }
});

test('isInitialized returns true after ensureDir', () => {
  const tmpPath = path.join(os.tmpdir(), 'px-init-' + Date.now());
  try {
    const savedHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = tmpPath;
    assert.equal(storage.isInitialized(), false);
    storage.resolveParallixHome(true);
    assert.equal(storage.isInitialized(), true);
  } finally {
    process.env.PARALLIX_HOME = undefined;
    try { fs.rmSync(tmpPath, { recursive: true, force: true }); } catch {}
  }
});

test('isInitialized returns false when PARALLIX_HOME points to a file', () => {
  const tmpPath = path.join(os.tmpdir(), 'px-file-' + Date.now());
  try {
    fs.writeFileSync(tmpPath, 'not a dir');
    const savedHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = tmpPath;
    assert.equal(storage.isInitialized(), false);
  } finally {
    process.env.PARALLIX_HOME = undefined;
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

test('isInitialized uses default platform path when PARALLIX_HOME is unset', () => {
  const savedHome = process.env.PARALLIX_HOME;
  try {
    delete process.env.PARALLIX_HOME;
    // Should use platform-specific path; always returns a boolean
    const result = storage.isInitialized();
    assert.equal(typeof result, 'boolean');
  } finally {
    process.env.PARALLIX_HOME = savedHome;
  }
});
