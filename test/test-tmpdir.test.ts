import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { checkoutTestTmpdir } from './lib/test-tmpdir.js';
import { mkdtemp } from './helpers/temp-dir.js';

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
