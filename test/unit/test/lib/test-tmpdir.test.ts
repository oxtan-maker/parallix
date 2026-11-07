import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import os from 'node:os';
import { checkoutTestTmpdir, linkSharedTsxCache, createTestTranscriptRoot, restoreFixtureTmpdir } from '../../../lib/test-tmpdir.js';
import { DISK_TEMP_FALLBACK, bulkStorageProbe, diskBackedTempBase } from '../../../../src/adapters/process/bulk-storage.js';
import { CHECKOUT_CACHE_OWNER_FILE, ensureCheckoutCache, readCheckoutCacheOwner, retireCheckoutCache } from '../../../../src/adapters/verification/checkout-cache.js';
import { mkdtemp, mkdtempAt } from '../../../helpers/temp-dir.js';

test('each checkout gets one stable private temporary directory outside the repository', () => {
  const base = mkdtemp('test-tmpdir-');
  try {
    const first = checkoutTestTmpdir('/work/repo-a', base);
    assert.equal(checkoutTestTmpdir('/work/repo-a/', base), first, 'the same checkout reuses its directory, keeping the tsx cache warm');
    const compileCache = path.join(first, 'node-compile-cache');
    fs.mkdirSync(compileCache);
    fs.writeFileSync(path.join(compileCache, 'warm-entry'), 'warm');
    assert.equal(path.join(checkoutTestTmpdir('/work/repo-a', base), 'node-compile-cache'), compileCache,
      'the same checkout reuses its Node compile-cache path');
    assert.equal(fs.readFileSync(path.join(compileCache, 'warm-entry'), 'utf8'), 'warm');
    const other = checkoutTestTmpdir('/work/repo-b', base);
    assert.notEqual(other, first, 'another checkout never shares it');
    assert.notEqual(path.join(other, 'node-compile-cache'), compileCache, 'distinct checkouts isolate Node compile caches');
    assert.equal(path.dirname(first), base);
    assert.ok(fs.statSync(first).isDirectory());
    assert.equal(fs.statSync(path.join(first, CHECKOUT_CACHE_OWNER_FILE)).mode & 0o777, 0o600);
    assert.deepEqual(readCheckoutCacheOwner(first), {
      kind: 'parallix-checkout-cache', version: 1, cacheRoot: first,
      checkoutPath: '/work/repo-a', checkoutGitDir: null, repositoryGitDir: null,
      owner: { pid: process.pid, startId: readCheckoutCacheOwner(first)?.owner.startId ?? null },
    }, 'cache creation durably records checkout, repository, and process identity');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('covered runs keep raw coverage scratch off memory-backed temporary storage (TASK-2816)', { skip: process.platform !== 'linux' && 'statfs filesystem types are Linux-specific' }, t => {
  const base = mkdtemp('test-tmpdir-bulk-');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  t.mock.method(os, 'tmpdir', () => base);
  const TMPFS = 0x01021994;
  let tmpdirType = TMPFS;
  let fallbackType = 0xef53;
  // Model distinct filesystems even when the fixture is nested below /var/tmp.
  t.mock.method(bulkStorageProbe, 'statfs', (dir: string) => ({ type: dir === DISK_TEMP_FALLBACK ? fallbackType : tmpdirType }));
  t.mock.method(bulkStorageProbe, 'writable', () => true);
  assert.equal(diskBackedTempBase(undefined), DISK_TEMP_FALLBACK, 'a tmpfs TMPDIR falls back to the disk-backed system temp dir');
  tmpdirType = 0xef53;
  assert.equal(diskBackedTempBase(undefined), path.resolve(os.tmpdir()), 'a disk-backed TMPDIR is used as is');
  assert.equal(diskBackedTempBase(os.tmpdir()), DISK_TEMP_FALLBACK, 'a TMPDIR that is the runtime directory counts as memory-backed');
  tmpdirType = TMPFS;
  fallbackType = TMPFS;
  const ownedFallback = path.join(base, 'owned-fallback');
  fs.mkdirSync(ownedFallback);
  t.mock.method(bulkStorageProbe, 'statfs', (dir: string) => ({ type: dir === ownedFallback ? 0xef53 : TMPFS }));
  assert.equal(diskBackedTempBase(undefined, [ownedFallback]), ownedFallback,
    'an explicit disk-backed checkout fallback is used when system temporary storage is unavailable');
  t.mock.method(bulkStorageProbe, 'statfs', () => ({ type: TMPFS }));
  assert.throws(() => diskBackedTempBase(undefined), /Raw coverage payloads need disk-backed storage.*Set TMPDIR to a directory on a disk-backed filesystem/);
});

test('a planted link at the checkout directory on a shared base is refused (TASK-2816)', () => {
  const base = mkdtemp('test-tmpdir-planted-');
  try {
    const expected = checkoutTestTmpdir('/work/repo-a', base);
    fs.rmSync(expected, { recursive: true });
    fs.mkdirSync(path.join(base, 'elsewhere'));
    fs.symlinkSync(path.join(base, 'elsewhere'), expected);
    assert.throws(() => checkoutTestTmpdir('/work/repo-a', base), /Unsafe checkout temporary directory/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('checkout cache retirement accepts a symlinked temporary base (TASK-2843 F1)', () => {
  const fixture = mkdtemp('test-tmpdir-symlink-base-');
  try {
    const realBase = path.join(fixture, 'real'), linkedBase = path.join(fixture, 'linked');
    fs.mkdirSync(realBase); fs.symlinkSync(realBase, linkedBase);
    const cache = ensureCheckoutCache('/work/repo-a', linkedBase);
    assert.equal(retireCheckoutCache('/work/repo-a', linkedBase), true);
    assert.equal(fs.existsSync(cache), false);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('nested coverage roots reuse the checkout directory without repeating path segments (px-0011)', () => {
  const base = mkdtemp('test-tmpdir-');
  try {
    const first = checkoutTestTmpdir('/work/repo-a', base);
    let inherited = first;
    for (let depth = 0; depth < 4; depth++) {
      inherited = path.join(inherited, 'coverage-scratch-TYSVml');
      assert.equal(checkoutTestTmpdir('/work/repo-a', inherited), first);
      const other = checkoutTestTmpdir('/work/repo-b', inherited);
      assert.equal(path.dirname(other), base);
      assert.notEqual(other, first);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('nested coverage scratch leaves room for the tsx build socket (TASK-2762)', () => {
  const base = mkdtemp('test-tmpdir-socket-');
  try {
    const checkout = checkoutTestTmpdir('/work/repo-a', base);
    const scratch = mkdtempAt(checkout, 'coverage-scratch-');
    const nested = checkoutTestTmpdir('/work/repo-a', scratch);
    // Model the runner's /tmp base independently of this case's private root.
    // npm prepack launches tsx here, including its UID and build process PID.
    const socket = path.join('/tmp', path.relative(base, nested), 'tsx-1000', '9999999.pipe');
    assert.ok(Buffer.byteLength(socket) < 108, `tsx socket exceeds Linux sun_path: ${socket}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a covered coverage scratch reuses the checkout tsx transpile cache (px-0017)', t => {
  const uid = process.getuid?.();
  if (uid === undefined) { t.skip('no POSIX uid on this platform'); return; }
  const base = mkdtemp('test-tmpdir-tsx-cache-');
  try {
    const checkout = checkoutTestTmpdir('/work/repo-a', base);
    const cache = path.join(checkout, `tsx-${uid}`);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'entry.json'), '{"warm":true}');
    const scratch = mkdtempAt(checkout, 'coverage-scratch-');
    linkSharedTsxCache(scratch, checkout);
    linkSharedTsxCache(scratch, checkout);
    assert.equal(fs.realpathSync(path.join(scratch, `tsx-${uid}`)), fs.realpathSync(cache),
      'the scratch reaches the checkout cache instead of starting a cold one');
    fs.rmSync(scratch, { recursive: true, force: true });
    assert.equal(fs.readFileSync(path.join(cache, 'entry.json'), 'utf8'), '{"warm":true}',
      'removing the invocation scratch removes the link, never the cache');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('test bootstraps restore fixture TMPDIR and register private disk-backed transcript storage (TASK-2816)', t => {
  const base = mkdtemp('test-transcript-isolation-');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  t.mock.method(os, 'tmpdir', () => base);
  t.mock.method(bulkStorageProbe, 'statfs', () => ({ type: 0xef53 }));
  t.mock.method(bulkStorageProbe, 'writable', () => true);
  const registered: string[] = [];
  const root = createTestTranscriptRoot(dir => registered.push(dir));
  assert.deepEqual(registered, [root]);
  assert.equal(path.dirname(root), base);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  const before = { TMPDIR: process.env.TMPDIR, fixture: process.env.PARALLIX_TEST_FIXTURE_TMPDIR };
  try {
    process.env.PARALLIX_TEST_FIXTURE_TMPDIR = base;
    process.env.TMPDIR = '/disk/raw-coverage';
    restoreFixtureTmpdir();
    assert.equal(process.env.TMPDIR, base, 'fixtures return to the original filesystem after native coverage initialization');
  } finally {
    for (const [key, value] of Object.entries({ TMPDIR: before.TMPDIR, PARALLIX_TEST_FIXTURE_TMPDIR: before.fixture })) {
      if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
    }
  }
});

test('nested test bootstraps retain private disk storage when their checkout is on tmpfs (TASK-2816)', t => {
  const base = mkdtemp('nested-test-transcripts-');
  const inherited = path.join(base, 'parent-transcripts');
  fs.mkdirSync(inherited, { mode: 0o700 });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const previous = process.env.PARALLIX_TEST_TRANSCRIPT_TMPDIR;
  t.after(() => {
    if (previous === undefined) { delete process.env.PARALLIX_TEST_TRANSCRIPT_TMPDIR; }
    else { process.env.PARALLIX_TEST_TRANSCRIPT_TMPDIR = previous; }
  });
  process.env.PARALLIX_TEST_TRANSCRIPT_TMPDIR = inherited;
  t.mock.method(bulkStorageProbe, 'statfs', (dir: string) => ({ type: dir === inherited ? 0xef53 : 0x01021994 }));
  t.mock.method(bulkStorageProbe, 'writable', (dir: string) => dir === inherited);
  const registered: string[] = [];
  const root = createTestTranscriptRoot(dir => registered.push(dir));
  assert.equal(path.dirname(root), inherited);
  assert.deepEqual(registered, [root]);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  fs.rmSync(root, { recursive: true });
  assert.ok(fs.existsSync(inherited), 'child cleanup preserves its live parent');
  t.mock.method(bulkStorageProbe, 'statfs', () => ({ type: 0x01021994 }));
  assert.throws(() => createTestTranscriptRoot(() => {}), /Isolated test transcripts need disk-backed storage/,
    'an inherited path is still checked, never silently accepted on tmpfs');
});
