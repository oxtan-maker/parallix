import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Regression group from test/integration/verification/codeql-suite-options.test.ts
{
function run(args: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeql-options-'));
  try {
    return spawnSync('bash', ['scripts/codeql-sast.sh', ...args], {
      encoding: 'utf8', cwd: process.cwd(), timeout: 10_000,
      env: { ...process.env, CODEQL_CACHE_DIR: path.join(root, 'cache'), CODEQL_WORK_DIR: path.join(root, 'work') },
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

}

test('--suite <name> (two-argument form) is accepted on --dry-run', () => {
  const res = run(['--suite', 'codeql/javascript-queries', '--dry-run']);
  assert.equal(res.status, 0, `--suite NAME should exit 0:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /Suite:\s+codeql\/javascript-queries/, 'recorded suite should be echoed');
  assert.match(res.stdout, /dry-run: plan resolved/, 'dry-run should resolve and exit 0');
});

test('--suite with no value exits non-zero', () => {
  // No second argument: $2 is unset, so the runner's ${2:?...} guard fires.
  const res = run(['--suite']);
  assert.notEqual(res.status, 0, '--suite with no value must fail');
  assert.match(res.stderr, /--suite requires a value/, 'should report the missing value');
});

test('--suite=NAME (equals form) is accepted on --dry-run', () => {
  const res = run(['--suite=codeql/javascript-queries', '--dry-run']);
  assert.equal(res.status, 0, `--suite=NAME should exit 0:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /Suite:\s+codeql\/javascript-queries/, 'equals form should set the suite');
});
}

// The dry-run contract does not execute CodeQL; exercise it even on a clean runner.
test('clean cache dry-run resolves the plan without CodeQL or downloads (TASK-2717)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeql-dry-plan-'));
  try {
    const freshCache = path.join(root, 'cache');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const marker = path.join(root, 'unexpected-codeql');
    fs.writeFileSync(path.join(bin, 'codeql'), `#!/bin/sh\necho invoked > '${marker}'\nexit 1\n`, { mode: 0o755 });
    const res = spawnSync('bash', ['scripts/codeql-sast.sh', '--dry-run'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, CODEQL_CACHE_DIR: freshCache, CODEQL_WORK_DIR: path.join(root, 'work'), PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, `clean-cache --dry-run failed:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /dry-run: plan resolved/);
    assert.equal(fs.existsSync(marker), false, 'dry-run must not execute even a configured CodeQL');
    assert.equal(fs.existsSync(freshCache), false, 'dry-run must not download or clone into the cache');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
