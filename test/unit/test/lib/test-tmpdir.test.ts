import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { checkoutTestTmpdir } from '../../../lib/test-tmpdir.js';
import { mkdtemp, mkdtempAt } from '../../../helpers/temp-dir.js';

test('each checkout gets one stable private temporary directory outside the repository', () => {
  const base = mkdtemp('test-tmpdir-');
  try {
    const first = checkoutTestTmpdir('/work/repo-a', base);
    assert.equal(checkoutTestTmpdir('/work/repo-a/', base), first, 'the same checkout reuses its directory, keeping the tsx cache warm');
    assert.notEqual(checkoutTestTmpdir('/work/repo-b', base), first, 'another checkout never shares it');
    assert.equal(path.dirname(first), base);
    assert.ok(fs.statSync(first).isDirectory());
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
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
