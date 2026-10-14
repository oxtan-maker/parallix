import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { checkoutTestTmpdir, linkCheckoutTranspileCache } from '../../../lib/test-tmpdir.js';
import { mkdtemp } from '../../../helpers/temp-dir.js';

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

test('covered invocations retain compiler cache while reclaiming coverage and isolated fixtures (TASK-2747)', () => {
  const base = mkdtemp('test-covered-tmpdir-');
  try {
    const cacheName = `tsx-${process.geteuid ? process.geteuid() : os.userInfo().username}`;
    const first = checkoutTestTmpdir('/work/repo-a', path.join(base, 'first'));
    linkCheckoutTranspileCache('/work/repo-a', first, base);
    fs.writeFileSync(path.join(first, cacheName, 'compiled'), 'compiled source');
    fs.writeFileSync(path.join(first, 'coverage.json'), 'raw coverage');
    fs.mkdirSync(path.join(first, 'fixture'));
    fs.rmSync(path.dirname(first), { recursive: true, force: true });
    const next = checkoutTestTmpdir('/work/repo-a', path.join(base, 'next'));
    linkCheckoutTranspileCache('/work/repo-a', next, base);
    assert.equal(fs.readFileSync(path.join(next, cacheName, 'compiled'), 'utf8'), 'compiled source');
    assert.equal(fs.existsSync(path.join(next, 'coverage.json')), false);
    assert.equal(fs.existsSync(path.join(next, 'fixture')), false);
    const other = checkoutTestTmpdir('/work/repo-b', path.join(base, 'other'));
    linkCheckoutTranspileCache('/work/repo-b', other, base);
    assert.equal(fs.existsSync(path.join(other, cacheName, 'compiled')), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
